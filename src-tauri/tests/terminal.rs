//! PTY sessions: output, input, exit ordering, closing, and errors.

use std::sync::mpsc::{self, Receiver};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use differential_lib::error::AppError;
use differential_lib::terminal::{ShellSpec, TerminalExit, TerminalManager};

/// Output collected so far, and the output length at the moment exit was reported.
struct Run {
    id: u32,
    out: Arc<Mutex<Vec<u8>>>,
    exit: Receiver<(TerminalExit, usize)>,
}

impl Run {
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.out.lock().unwrap()).into_owned()
    }

    fn wait_for(&self, needle: &str, timeout: Duration) -> bool {
        let start = Instant::now();
        while start.elapsed() < timeout {
            if self.text().contains(needle) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn wait_exit(&self, timeout: Duration) -> (TerminalExit, usize) {
        self.exit.recv_timeout(timeout).expect("session did not report exit in time")
    }
}

/// Start `shell`, answering cursor-position queries (`ESC[6n`) the way xterm.js does in the app:
/// ConPTY sends one at startup and waits for the reply before running anything.
fn spawn(mgr: &Arc<TerminalManager>, shell: ShellSpec) -> Run {
    let out = Arc::new(Mutex::new(Vec::new()));
    let (tx, exit) = mpsc::channel();
    let (dsr_tx, dsr_rx) = mpsc::channel::<()>();
    let data = out.clone();
    let at_exit = out.clone();
    let id_cell = Arc::new(OnceLock::<u32>::new());
    let cwd = std::env::temp_dir();
    let id = mgr
        .spawn_shell(
            shell,
            &cwd,
            120,
            30,
            Box::new(move |chunk| {
                if chunk.windows(4).any(|w| w == b"[6n") {
                    let _ = dsr_tx.send(());
                }
                data.lock().unwrap().extend_from_slice(&chunk);
            }),
            Box::new(move |e| {
                let len = at_exit.lock().unwrap().len();
                let _ = tx.send((e, len));
            }),
        )
        .expect("spawn");
    id_cell.set(id).unwrap();
    let responder = mgr.clone();
    std::thread::spawn(move || {
        while dsr_rx.recv().is_ok() {
            let _ = responder.write(*id_cell.get().unwrap(), b"[1;1R");
        }
    });
    Run { id, out, exit }
}

/// Run `script` through the platform's simple command shell and exit.
fn one_shot(script: &str) -> ShellSpec {
    if cfg!(windows) {
        ShellSpec::new("cmd.exe", vec!["/d".into(), "/c".into(), script.into()])
    } else {
        ShellSpec::new("/bin/sh", vec!["-c".into(), script.into()])
    }
}

/// An interactive command shell.
fn interactive() -> ShellSpec {
    if cfg!(windows) {
        ShellSpec::new("cmd.exe", vec!["/d".into()])
    } else {
        ShellSpec::new("/bin/sh", vec![])
    }
}

const NEWLINE: &str = if cfg!(windows) { "\r\n" } else { "\n" };
const LONG: Duration = Duration::from_secs(20);

#[test]
fn command_output_and_exit_code() {
    let mgr = Arc::new(TerminalManager::new());
    let run = spawn(&mgr, one_shot("echo hi"));
    let (exit, len_at_exit) = run.wait_exit(LONG);
    assert_eq!(exit.code, Some(0));
    assert!(run.text().contains("hi"), "output was {:?}", run.text());
    assert_eq!(run.out.lock().unwrap().len(), len_at_exit, "no output after exit");
    assert!(mgr.is_empty(), "exited session is removed");
}

#[test]
fn nonzero_exit_code() {
    let mgr = Arc::new(TerminalManager::new());
    let run = spawn(&mgr, one_shot("exit 3"));
    assert_eq!(run.wait_exit(LONG).0.code, Some(3));
}

#[test]
fn large_output_arrives_before_exit() {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join("big.txt");
    let mut content = String::new();
    let mut n = 0;
    while content.len() < 1_200_000 {
        content.push_str(&format!("line {n:07} of the large output test{NEWLINE}"));
        n += 1;
    }
    content.push_str("END-OF-BIG-OUTPUT");
    content.push_str(NEWLINE);
    std::fs::write(&file, &content).unwrap();

    let script = if cfg!(windows) { format!("type {}", file.display()) } else { format!("cat '{}'", file.display()) };
    let mgr = Arc::new(TerminalManager::new());
    let run = spawn(&mgr, one_shot(&script));
    let (exit, len_at_exit) = run.wait_exit(Duration::from_secs(60));
    assert_eq!(exit.code, Some(0));
    let text = run.text();
    assert!(text.contains("END-OF-BIG-OUTPUT"), "last line missing; got {} bytes", text.len());
    assert!(text.len() > 1_000_000, "expected over 1 MB of output, got {}", text.len());
    assert_eq!(run.out.lock().unwrap().len(), len_at_exit, "no output after exit");
}

#[test]
fn input_reaches_interactive_shell() {
    let mgr = Arc::new(TerminalManager::new());
    let run = spawn(&mgr, interactive());
    // The quoting splits the word in the echoed input, so only the command's output contains it.
    let cmd = if cfg!(windows) { "echo mark^er" } else { "echo mark''er" };
    mgr.write(run.id, format!("{cmd}{NEWLINE}").as_bytes()).unwrap();
    assert!(run.wait_for("marker", LONG), "output was {:?}", run.text());
    mgr.write(run.id, format!("exit{NEWLINE}").as_bytes()).unwrap();
    run.wait_exit(LONG);
}

#[test]
fn resize_running_session() {
    let mgr = Arc::new(TerminalManager::new());
    let run = spawn(&mgr, interactive());
    mgr.resize(run.id, 200, 50).unwrap();
    mgr.close(run.id);
    run.wait_exit(LONG);
}

#[test]
fn close_ends_long_running_command_promptly() {
    let mgr = Arc::new(TerminalManager::new());
    let script = if cfg!(windows) { "ping -n 120 127.0.0.1" } else { "sleep 120" };
    let run = spawn(&mgr, one_shot(script));
    std::thread::sleep(Duration::from_millis(500));
    let start = Instant::now();
    mgr.close(run.id);
    run.wait_exit(Duration::from_secs(10));
    assert!(start.elapsed() < Duration::from_secs(10));
    assert!(mgr.is_empty());
}

#[test]
fn close_is_idempotent_and_unknown_ids_are_ignored() {
    let mgr = Arc::new(TerminalManager::new());
    let run = spawn(&mgr, interactive());
    mgr.close(run.id);
    mgr.close(run.id);
    run.wait_exit(LONG);
    mgr.close(9999);
    mgr.write(9999, b"x").unwrap();
    mgr.resize(9999, 10, 10).unwrap();
}

#[test]
fn close_all_ends_every_session() {
    let mgr = Arc::new(TerminalManager::new());
    let a = spawn(&mgr, interactive());
    let b = spawn(&mgr, interactive());
    assert_eq!(mgr.len(), 2);
    mgr.close_all();
    a.wait_exit(LONG);
    b.wait_exit(LONG);
    assert!(mgr.is_empty());
}

#[test]
fn missing_cwd_is_an_io_error() {
    let mgr = Arc::new(TerminalManager::new());
    let missing = std::env::temp_dir().join("differential-no-such-dir-4b1f");
    let err = mgr
        .spawn_shell(interactive(), &missing, 80, 24, Box::new(|_| {}), Box::new(|_| {}))
        .unwrap_err();
    assert!(matches!(err, AppError::Io(_)), "{err:?}");
}

#[test]
fn missing_shell_is_an_io_error_naming_it() {
    let mgr = Arc::new(TerminalManager::new());
    let shell = ShellSpec::new("differential-no-such-shell", vec![]);
    let err = mgr
        .spawn_shell(shell, &std::env::temp_dir(), 80, 24, Box::new(|_| {}), Box::new(|_| {}))
        .unwrap_err();
    match err {
        AppError::Io(msg) => assert!(msg.contains("differential-no-such-shell"), "{msg}"),
        other => panic!("expected Io, got {other:?}"),
    }
    assert!(mgr.is_empty());
}
