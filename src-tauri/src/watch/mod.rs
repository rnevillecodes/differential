//! Watching the open repository for changes that can affect what the UI shows.
//!
//! A [`WatchHandle`] owns a native file-system watcher and a worker thread. The worker
//! classifies event paths ([`classify`]), drops ignored ones ([`ignore`]), coalesces bursts
//! ([`coalesce`]) and reports one [`RepoEvent`] per settled burst. Watching never writes to
//! the repository and never takes git locks.

pub mod classify;
pub mod coalesce;
pub mod ignore;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Instant;

use notify::event::{AccessKind, EventKind, MetadataKind, ModifyKind};
use notify::{Config, Event, EventKindMask, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, Result};
use crate::git::{canonical, git_dirs, Git};
use classify::{classify, Batch, Layout, PathClass};
use coalesce::Coalescer;
use ignore::IgnoreFilter;

/// A notification about the watched repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum RepoEvent {
    /// Something changed: in the working tree, in git metadata (`HEAD`, refs, index), or both.
    Changed { worktree: bool, git: bool },
    /// Watching stopped or could not work; the UI falls back to manual refresh.
    Unavailable { message: String },
}

/// Receives the events of one watch.
pub type Sink = Box<dyn Fn(RepoEvent) + Send + 'static>;

/// Linux watches one directory at a time, skipping ignored ones (inotify needs a watch per
/// directory). Other platforms watch the whole tree with one recursive watch.
const PRUNED: bool = cfg!(target_os = "linux");

enum Msg {
    Fs(notify::Result<Event>),
    Stop,
}

/// A running watch of one repository. Dropping it stops the watch.
pub struct WatchHandle {
    tx: mpsc::Sender<Msg>,
    thread: Option<JoinHandle<()>>,
}

impl WatchHandle {
    /// Start watching the repository whose top-level directory is `root`.
    /// Fails if the repository can't be watched at all; later failures arrive as
    /// [`RepoEvent::Unavailable`].
    pub fn start(git: Git, root: &Path, sink: Sink) -> Result<WatchHandle> {
        let root = canonical(root);
        if !root.is_dir() {
            return Err(AppError::Io(format!("{} is not a folder", root.display())));
        }
        if let Some(reason) = unsupported_fs(&root) {
            return Err(AppError::Io(reason));
        }
        let dirs = git_dirs(&git, &root)?;
        let layout = Layout { root, git_dir: dirs.git_dir, common_dir: dirs.common_dir };
        let filter = IgnoreFilter::new(git, &layout.root)?;

        let (tx, rx) = mpsc::channel();
        let fs_tx = tx.clone();
        // Core events only: reads (the app's own included) produce access events.
        let config = Config::default().with_event_kinds(EventKindMask::CORE);
        let mut watcher = RecommendedWatcher::new(
            move |res| {
                let _ = fs_tx.send(Msg::Fs(res));
            },
            config,
        )
        .map_err(|e| AppError::Io(describe(&e)))?;
        if PRUNED {
            watch_git_dirs(&mut watcher, &layout)?;
        } else {
            watch(&mut watcher, &layout.root, RecursiveMode::Recursive)?;
            // A linked worktree's git dirs live outside it (its own git dir is inside the common one).
            if !layout.common_dir.starts_with(&layout.root) {
                watch(&mut watcher, &layout.common_dir, RecursiveMode::Recursive)?;
            }
        }

        let worker = Worker {
            watcher,
            layout,
            filter,
            batch: Batch::default(),
            coalescer: Coalescer::default(),
            sink,
        };
        let thread = std::thread::Builder::new()
            .name("repo-watch".into())
            .spawn(move || worker.run(rx))
            .map_err(AppError::from)?;
        Ok(WatchHandle { tx, thread: Some(thread) })
    }
}

impl Drop for WatchHandle {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

struct Worker {
    watcher: RecommendedWatcher,
    layout: Layout,
    filter: IgnoreFilter,
    batch: Batch,
    coalescer: Coalescer,
    sink: Sink,
}

/// Why the worker stopped early.
struct Fatal(String);

impl Worker {
    fn run(mut self, rx: mpsc::Receiver<Msg>) {
        if let Err(Fatal(message)) = self.run_inner(&rx) {
            (self.sink)(RepoEvent::Unavailable { message });
        }
    }

    fn run_inner(&mut self, rx: &mpsc::Receiver<Msg>) -> std::result::Result<(), Fatal> {
        if PRUNED {
            let root = self.layout.root.clone();
            self.walk(&root, false)?;
            // Changes made while the tree was being walked may have been missed.
            (self.sink)(RepoEvent::Changed { worktree: true, git: false });
        }
        loop {
            let msg = match self.coalescer.deadline() {
                Some(d) => match rx.recv_timeout(d.saturating_duration_since(Instant::now())) {
                    Ok(m) => Some(m),
                    Err(mpsc::RecvTimeoutError::Timeout) => None,
                    Err(mpsc::RecvTimeoutError::Disconnected) => return Ok(()),
                },
                None => match rx.recv() {
                    Ok(m) => Some(m),
                    Err(_) => return Ok(()),
                },
            };
            match msg {
                Some(Msg::Stop) => return Ok(()),
                Some(Msg::Fs(Ok(event))) => self.on_event(event)?,
                Some(Msg::Fs(Err(e))) => self.on_error(e)?,
                None => {}
            }
            if self.coalescer.take_due(Instant::now()) {
                self.flush();
            }
        }
    }

    fn on_event(&mut self, event: Event) -> std::result::Result<(), Fatal> {
        let now = Instant::now();
        if event.need_rescan() {
            self.batch.rescan = true;
            self.coalescer.record(now);
            return Ok(());
        }
        if is_noise(&event.kind) {
            return Ok(());
        }
        for path in &event.paths {
            let class = classify(&self.layout, path);
            if let PathClass::Worktree(rel) = &class {
                if self.filter.in_ignored_dir(rel) {
                    continue;
                }
                if PRUNED && is_new_dir(&event.kind, path) && !self.watch_new_dir(path, rel)? {
                    continue;
                }
            }
            if self.batch.add(class) {
                self.coalescer.record(now);
            }
        }
        Ok(())
    }

    fn on_error(&mut self, e: notify::Error) -> std::result::Result<(), Fatal> {
        if matches!(e.kind, notify::ErrorKind::MaxFilesWatch) {
            return Err(Fatal(describe(&e)));
        }
        if !self.layout.root.is_dir() {
            return Err(Fatal("The repository folder no longer exists.".into()));
        }
        // Other errors (a path vanishing mid-registration, …) are transient.
        Ok(())
    }

    /// Report the pending batch if anything in it can affect what is shown.
    fn flush(&mut self) {
        let batch = std::mem::take(&mut self.batch);
        let (worktree, git) = if batch.rescan {
            (true, true)
        } else {
            if batch.ignore_rules {
                // On failure keep the old list; the check-ignore pass below stays correct.
                let _ = self.filter.rebuild();
            }
            let worktree = batch.ignore_rules
                || batch.overflow
                // If git can't answer, refreshing is the safe choice.
                || self.filter.any_relevant(&batch.candidates).unwrap_or(true);
            (worktree, batch.git)
        };
        if worktree || git {
            (self.sink)(RepoEvent::Changed { worktree, git });
        }
    }

    /// A directory appeared (pruned mode). Returns `false` if git ignores it.
    fn watch_new_dir(&mut self, path: &Path, rel: &str) -> std::result::Result<bool, Fatal> {
        if self.filter.ignored(&[rel]).is_ok_and(|s| !s.is_empty()) {
            self.filter.add_ignored_dir(rel);
            return Ok(false);
        }
        self.walk(path, true)?;
        Ok(true)
    }

    /// Watch `start` and every directory below it that is not ignored (pruned mode).
    /// With `verify`, child directories not in the ignored-directory list are checked with git
    /// (needed for new directories; at startup the list is complete).
    fn walk(&mut self, start: &Path, verify: bool) -> std::result::Result<(), Fatal> {
        let mut stack = vec![start.to_path_buf()];
        while let Some(dir) = stack.pop() {
            match self.watcher.watch(&dir, RecursiveMode::NonRecursive) {
                Ok(()) => {}
                Err(e) if matches!(e.kind, notify::ErrorKind::MaxFilesWatch) => {
                    return Err(Fatal(describe(&e)));
                }
                Err(_) => continue,
            }
            let Ok(entries) = std::fs::read_dir(&dir) else { continue };
            let mut children: Vec<(PathBuf, String)> = Vec::new();
            for entry in entries.flatten() {
                // `file_type` does not follow symlinks, so linked directories are not entered.
                if !entry.file_type().is_ok_and(|t| t.is_dir()) || entry.file_name() == ".git" {
                    continue;
                }
                let path = entry.path();
                if let PathClass::Worktree(rel) = classify(&self.layout, &path)
                    && !self.filter.in_ignored_dir(&rel)
                {
                    children.push((path, rel));
                }
            }
            if verify && !children.is_empty() {
                let rels: Vec<&str> = children.iter().map(|(_, r)| r.as_str()).collect();
                let ignored = self.filter.ignored(&rels).unwrap_or_default();
                for rel in &ignored {
                    self.filter.add_ignored_dir(rel);
                }
                children.retain(|(_, r)| !ignored.contains(r));
            }
            stack.extend(children.into_iter().map(|(p, _)| p));
        }
        Ok(())
    }
}

/// Pruned mode: watch the files in the git directories that matter, never `objects/`.
fn watch_git_dirs(watcher: &mut RecommendedWatcher, layout: &Layout) -> Result<()> {
    watch(watcher, &layout.git_dir, RecursiveMode::NonRecursive)?;
    if layout.common_dir != layout.git_dir {
        watch(watcher, &layout.common_dir, RecursiveMode::NonRecursive)?;
    }
    watch(watcher, &layout.common_dir.join("refs"), RecursiveMode::Recursive)?;
    let info = layout.common_dir.join("info");
    if info.is_dir() {
        watch(watcher, &info, RecursiveMode::NonRecursive)?;
    }
    Ok(())
}

fn watch(watcher: &mut RecommendedWatcher, path: &Path, mode: RecursiveMode) -> Result<()> {
    watcher.watch(path, mode).map_err(|e| AppError::Io(describe(&e)))
}

/// Events that never change content: reads and access-time updates.
fn is_noise(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Access(AccessKind::Any | AccessKind::Read | AccessKind::Open(_) | AccessKind::Other)
            | EventKind::Modify(ModifyKind::Metadata(MetadataKind::AccessTime))
    )
}

/// Whether the event created (or moved in) a directory at `path`.
fn is_new_dir(kind: &EventKind, path: &Path) -> bool {
    matches!(kind, EventKind::Create(_) | EventKind::Modify(ModifyKind::Name(_)))
        && std::fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
}

/// A readable reason for a watcher error.
fn describe(e: &notify::Error) -> String {
    match &e.kind {
        notify::ErrorKind::MaxFilesWatch => {
            if cfg!(target_os = "linux") {
                "The system limit on watched folders was reached (raise fs.inotify.max_user_watches)."
                    .into()
            } else {
                "The system limit on watched folders was reached.".into()
            }
        }
        notify::ErrorKind::PathNotFound => "The repository folder no longer exists.".into(),
        _ => format!("File changes can't be watched: {e}"),
    }
}

/// Linux: file systems that don't report changes (a Windows drive mounted in WSL).
#[cfg(target_os = "linux")]
fn unsupported_fs(root: &Path) -> Option<String> {
    use std::os::unix::ffi::OsStrExt;
    const V9FS_MAGIC: i64 = 0x0102_1997;
    let path = std::ffi::CString::new(root.as_os_str().as_bytes()).ok()?;
    // SAFETY: `statfs` writes into the zeroed struct we pass and reads the NUL-terminated path.
    let mut stat: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statfs(path.as_ptr(), &mut stat) } != 0 {
        return None;
    }
    #[allow(clippy::unnecessary_cast)]
    let magic = stat.f_type as i64;
    (magic == V9FS_MAGIC).then(|| {
        "File changes on this drive can't be watched (a Windows drive mounted in WSL).".to_string()
    })
}

#[cfg(not(target_os = "linux"))]
fn unsupported_fs(_root: &Path) -> Option<String> {
    None
}

/// The app's current watch, as held in managed state. At most one repository is watched.
#[derive(Default)]
pub struct Watchers {
    current: Mutex<Option<(u32, WatchHandle)>>,
    next_id: AtomicU32,
}

/// Shared handle to [`Watchers`] for managed state.
pub type WatchersState = Arc<Watchers>;

impl Watchers {
    /// Stop the current watch, then watch `root`. Returns the new watch's id.
    pub fn watch(&self, git: Git, root: &Path, sink: Sink) -> Result<u32> {
        // Stop the old watch first: even if the new one fails, the old repository is closed.
        self.stop_all();
        let handle = WatchHandle::start(git, root, sink)?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let old = self.current.lock().unwrap_or_else(|e| e.into_inner()).replace((id, handle));
        drop(old);
        Ok(id)
    }

    /// Stop watch `id` if it is still the current one; otherwise do nothing.
    pub fn unwatch(&self, id: u32) {
        let old = {
            let mut cur = self.current.lock().unwrap_or_else(|e| e.into_inner());
            if cur.as_ref().is_some_and(|(i, _)| *i == id) { cur.take() } else { None }
        };
        drop(old);
    }

    /// The current watch's id, if any.
    pub fn current_id(&self) -> Option<u32> {
        self.current.lock().unwrap_or_else(|e| e.into_inner()).as_ref().map(|(i, _)| *i)
    }

    /// Stop watching.
    pub fn stop_all(&self) {
        let old = self.current.lock().unwrap_or_else(|e| e.into_inner()).take();
        drop(old);
    }
}
