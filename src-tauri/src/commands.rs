//! Tauri command handlers: thin async wrappers over `git` and `changes`.
//!
//! Every handler runs its git work on a blocking thread so the UI stays responsive.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use ts_rs::TS;

use crate::changes;
use crate::diff::model::{ChangeSet, FileDiff, FileSummary, Side};
use crate::error::{AppError, Result};
use crate::files::{self, FileView};
use crate::git::{self, CommitPage, Git, RefInfo, RepoInfo};
use crate::terminal::{TerminalExit, TerminalManager};
use crate::watch::{RepoEvent, WatchersState};

/// Arguments given on the command line: `differential [path] [--base <rev>] [--wait]`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct InitialArgs {
    pub path: Option<String>,
    pub base: Option<String>,
    /// `--wait`: stay in the foreground instead of detaching from the terminal. Backend only.
    #[serde(skip)]
    #[ts(skip)]
    pub wait: bool,
}

/// Parse launch arguments (without the program name). Relative paths resolve against `cwd`.
pub fn parse_args<I: IntoIterator<Item = String>>(args: I, cwd: &Path) -> InitialArgs {
    let mut out = InitialArgs::default();
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        if arg == "--base" || arg == "-b" {
            out.base = it.next();
        } else if let Some(v) = arg.strip_prefix("--base=") {
            out.base = Some(v.to_string());
        } else if arg == "--wait" {
            out.wait = true;
        } else if arg.starts_with('-') {
            // Unknown flag (e.g. passed through by the dev tooling): ignore.
        } else if out.path.is_none() {
            let p = PathBuf::from(&arg);
            let abs = if p.is_absolute() { p } else { cwd.join(p) };
            out.path = Some(abs.to_string_lossy().replace('\\', "/"));
        }
    }
    out
}

async fn blocking<T, F>(f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Io(format!("background task failed: {e}")))?
}

#[tauri::command]
pub fn initial_args(args: tauri::State<'_, InitialArgs>) -> InitialArgs {
    args.inner().clone()
}

#[tauri::command]
pub async fn open_repo(path: String) -> Result<RepoInfo> {
    blocking(move || git::open_repo(&Git::default(), Path::new(&path))).await
}

#[tauri::command]
pub async fn list_changes(root: String, base: String) -> Result<ChangeSet> {
    blocking(move || changes::list_changes(&Git::default(), Path::new(&root), &base)).await
}

#[tauri::command]
pub async fn file_diff(
    root: String,
    base_sha: String,
    file: FileSummary,
    force: bool,
) -> Result<FileDiff> {
    blocking(move || {
        changes::file_diff(&Git::default(), Path::new(&root), &base_sha, &file, force)
    })
    .await
}

#[tauri::command]
pub async fn file_content(
    root: String,
    base_sha: String,
    path: String,
    side: Side,
) -> Result<Option<String>> {
    blocking(move || {
        changes::file_content(&Git::default(), Path::new(&root), &base_sha, &path, side)
    })
    .await
}

#[tauri::command]
pub async fn list_files(root: String) -> Result<Vec<String>> {
    blocking(move || files::list_files(&Git::default(), Path::new(&root))).await
}

#[tauri::command]
pub async fn list_refs(root: String) -> Result<Vec<RefInfo>> {
    blocking(move || git::list_refs(&Git::default(), Path::new(&root))).await
}

/// One page of the commit history (all branches, remote branches, tags and `HEAD`).
#[tauri::command]
pub async fn list_commits(root: String, offset: usize, limit: usize) -> Result<CommitPage> {
    blocking(move || git::list_commits(&Git::default(), Path::new(&root), offset, limit)).await
}

/// A working-tree image's bytes, as a raw (non-JSON) response.
#[tauri::command]
pub async fn read_image(root: String, path: String) -> Result<tauri::ipc::Response> {
    let bytes = blocking(move || files::read_image(Path::new(&root), &path)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn view_file(root: String, path: String, force: bool) -> Result<FileView> {
    blocking(move || files::view_file(Path::new(&root), &path, force)).await
}

/// The shared terminal session registry, as held in managed state.
pub type Terminals = Arc<TerminalManager>;

/// Start the user's shell in `cwd` in a new pseudo-terminal. Output is streamed as raw bytes on
/// `on_data`; `on_exit` receives one message after the last output. Returns the session id.
#[tauri::command]
pub async fn terminal_spawn(
    terminals: tauri::State<'_, Terminals>,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    on_exit: Channel<TerminalExit>,
) -> Result<u32> {
    let terminals = terminals.inner().clone();
    blocking(move || {
        terminals.spawn(
            Path::new(&cwd),
            cols,
            rows,
            Box::new(move |chunk| {
                let _ = on_data.send(InvokeResponseBody::Raw(chunk));
            }),
            Box::new(move |exit| {
                let _ = on_exit.send(exit);
            }),
        )
    })
    .await
}

/// Send keyboard input to a terminal session. Unknown ids are ignored.
#[tauri::command]
pub async fn terminal_write(terminals: tauri::State<'_, Terminals>, id: u32, data: String) -> Result<()> {
    let terminals = terminals.inner().clone();
    blocking(move || terminals.write(id, data.as_bytes())).await
}

/// Resize a terminal session's pseudo-terminal. Unknown ids are ignored.
#[tauri::command]
pub async fn terminal_resize(terminals: tauri::State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<()> {
    let terminals = terminals.inner().clone();
    blocking(move || terminals.resize(id, cols, rows)).await
}

/// End a terminal session's shell and its programs. Unknown ids are ignored.
#[tauri::command]
pub async fn terminal_close(terminals: tauri::State<'_, Terminals>, id: u32) -> Result<()> {
    let terminals = terminals.inner().clone();
    blocking(move || {
        terminals.close(id);
        Ok(())
    })
    .await
}

/// Watch the repository at `root` for changes, replacing any current watch. Events arrive on
/// `on_event`. Returns the watch id for [`unwatch_repo`].
#[tauri::command]
pub async fn watch_repo(
    watchers: tauri::State<'_, WatchersState>,
    root: String,
    on_event: Channel<RepoEvent>,
) -> Result<u32> {
    let watchers = watchers.inner().clone();
    blocking(move || {
        watchers.watch(
            Git::default(),
            Path::new(&root),
            Box::new(move |event| {
                let _ = on_event.send(event);
            }),
        )
    })
    .await
}

/// Stop watch `id` if it is still the current one; stale ids are ignored.
#[tauri::command]
pub async fn unwatch_repo(watchers: tauri::State<'_, WatchersState>, id: u32) -> Result<()> {
    let watchers = watchers.inner().clone();
    blocking(move || {
        watchers.unwatch(id);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &[&str]) -> Vec<String> {
        v.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn parses_launch_arguments() {
        let cwd = Path::new("C:/work");
        assert_eq!(parse_args(s(&[]), cwd), InitialArgs::default());
        assert_eq!(
            parse_args(s(&["C:/repo", "--base", "HEAD~3"]), cwd),
            InitialArgs { path: Some("C:/repo".into()), base: Some("HEAD~3".into()), wait: false }
        );
        assert_eq!(
            parse_args(s(&["--base=main", "sub/dir"]), cwd),
            InitialArgs { path: Some("C:/work/sub/dir".into()), base: Some("main".into()), wait: false }
        );
        assert_eq!(
            parse_args(s(&["--unknown", "-b", "v1"]), cwd),
            InitialArgs { path: None, base: Some("v1".into()), wait: false }
        );
    }

    #[test]
    fn parses_wait_flag() {
        let cwd = Path::new("C:/work");
        assert_eq!(parse_args(s(&["--wait"]), cwd), InitialArgs { wait: true, ..Default::default() });
        assert_eq!(
            parse_args(s(&["C:/repo", "--wait", "--base", "main"]), cwd),
            InitialArgs { path: Some("C:/repo".into()), base: Some("main".into()), wait: true }
        );
        assert!(!parse_args(s(&["C:/repo", "--base", "main"]), cwd).wait);
    }
}
