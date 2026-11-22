//! Interactive shell sessions in pseudo-terminals, for the terminal panel.
//!
//! Each session has a reader thread that forwards PTY output in chunks and a waiter thread that
//! waits for the shell to exit, closes the PTY so the reader drains to EOF, and only then reports
//! the exit, so the exit notification always follows the last output.

pub mod shell;

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, Result};
pub use shell::{default_shell, ShellSpec};

/// Sent once when a session's shell has exited. `code` is null when it was ended by a signal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct TerminalExit {
    pub code: Option<u32>,
}

/// Receives each chunk of raw PTY output, in order.
pub type DataSink = Box<dyn FnMut(Vec<u8>) + Send>;
/// Receives the exit notification, after all output.
pub type ExitSink = Box<dyn FnOnce(TerminalExit) + Send>;

const READ_CHUNK: usize = 64 * 1024;
/// How long the waiter waits for the reader to drain after the shell exits.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(3);

struct Session {
    /// Dropped (closing the PTY) when the shell exits or the session is closed.
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Session {
    fn shut_down(&self) {
        let _ = self.killer.lock().unwrap().kill();
        self.master.lock().unwrap().take();
    }
}

type Sessions = Arc<Mutex<HashMap<u32, Arc<Session>>>>;

/// All live terminal sessions, held in Tauri managed state.
#[derive(Default)]
pub struct TerminalManager {
    next_id: AtomicU32,
    sessions: Sessions,
}

fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows: rows.max(1), cols: cols.max(1), pixel_width: 0, pixel_height: 0 }
}

fn io_err(context: &str, e: impl std::fmt::Display) -> AppError {
    AppError::Io(format!("{context}: {e}"))
}

impl TerminalManager {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start the user's default shell in `cwd`.
    pub fn spawn(&self, cwd: &Path, cols: u16, rows: u16, on_data: DataSink, on_exit: ExitSink) -> Result<u32> {
        self.spawn_shell(default_shell(), cwd, cols, rows, on_data, on_exit)
    }

    /// Start `shell` in `cwd` attached to a new PTY of `cols`×`rows`. Returns the session id.
    pub fn spawn_shell(
        &self,
        shell: ShellSpec,
        cwd: &Path,
        cols: u16,
        rows: u16,
        mut on_data: DataSink,
        on_exit: ExitSink,
    ) -> Result<u32> {
        if !cwd.is_dir() {
            return Err(AppError::Io(format!("{} is not a directory", cwd.display())));
        }
        let pair = native_pty_system()
            .openpty(size(cols, rows))
            .map_err(|e| io_err("could not open a terminal", e))?;

        let mut cmd = CommandBuilder::new(&shell.program);
        cmd.args(&shell.args);
        for (k, v) in &shell.env {
            cmd.env(k, v);
        }
        cmd.cwd(cwd);
        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| io_err(&format!("could not start shell '{}'", shell.program), e))?;
        // Only the master side is kept: the PTY closes once the master is dropped too.
        drop(pair.slave);

        let master = pair.master;
        let mut reader = master.try_clone_reader().map_err(|e| io_err("could not read the terminal", e))?;
        let writer = master.take_writer().map_err(|e| io_err("could not write to the terminal", e))?;
        let killer = child.clone_killer();

        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let session = Arc::new(Session {
            master: Mutex::new(Some(master)),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
        });
        self.sessions.lock().unwrap().insert(id, session.clone());

        let (drained_tx, drained_rx) = mpsc::channel::<()>();
        std::thread::Builder::new()
            .name(format!("terminal-{id}-reader"))
            .spawn(move || {
                let mut buf = vec![0u8; READ_CHUNK];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) | Err(_) => break,
                        Ok(n) => on_data(buf[..n].to_vec()),
                    }
                }
                let _ = drained_tx.send(());
            })
            .map_err(|e| io_err("could not start the terminal reader", e))?;

        let sessions = self.sessions.clone();
        std::thread::Builder::new()
            .name(format!("terminal-{id}-waiter"))
            .spawn(move || {
                let code = match child.wait() {
                    Ok(status) if status.signal().is_none() => Some(status.exit_code()),
                    _ => None,
                };
                // Close the PTY so the reader sees EOF once it has drained the remaining output.
                session.master.lock().unwrap().take();
                let _ = drained_rx.recv_timeout(DRAIN_TIMEOUT);
                sessions.lock().unwrap().remove(&id);
                on_exit(TerminalExit { code });
            })
            .map_err(|e| io_err("could not start the terminal waiter", e))?;

        Ok(id)
    }

    fn get(&self, id: u32) -> Option<Arc<Session>> {
        self.sessions.lock().unwrap().get(&id).cloned()
    }

    /// Send input to a session. Unknown or ended sessions are ignored.
    pub fn write(&self, id: u32, data: &[u8]) -> Result<()> {
        if let Some(s) = self.get(id) {
            let mut w = s.writer.lock().unwrap();
            w.write_all(data).and_then(|_| w.flush()).map_err(|e| io_err("could not write to the terminal", e))?;
        }
        Ok(())
    }

    /// Resize a session's PTY. Unknown or ended sessions are ignored.
    pub fn resize(&self, id: u32, cols: u16, rows: u16) -> Result<()> {
        if let Some(s) = self.get(id) {
            if let Some(m) = s.master.lock().unwrap().as_ref() {
                m.resize(size(cols, rows)).map_err(|e| io_err("could not resize the terminal", e))?;
            }
        }
        Ok(())
    }

    /// End a session's shell and close its PTY. Idempotent.
    pub fn close(&self, id: u32) {
        let session = self.sessions.lock().unwrap().remove(&id);
        if let Some(s) = session {
            s.shut_down();
        }
    }

    /// End every session (on application exit).
    pub fn close_all(&self) {
        let all: Vec<_> = self.sessions.lock().unwrap().drain().map(|(_, s)| s).collect();
        for s in all {
            s.shut_down();
        }
    }

    /// Number of live sessions.
    pub fn len(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}
