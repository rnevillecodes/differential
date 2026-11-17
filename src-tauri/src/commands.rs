//! Tauri command handlers: thin async wrappers over `git` and `changes`.
//!
//! Every handler runs its git work on a blocking thread so the UI stays responsive.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use crate::changes;
use crate::diff::model::{ChangeSet, FileDiff, FileSummary, Side};
use crate::error::{AppError, Result};
use crate::files::{self, FileView};
use crate::git::{self, Git, RepoInfo};

/// Repository and base given on the command line: `differential [path] [--base <rev>]`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[ts(export)]
pub struct InitialArgs {
    pub path: Option<String>,
    pub base: Option<String>,
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
pub async fn view_file(root: String, path: String, force: bool) -> Result<FileView> {
    blocking(move || files::view_file(Path::new(&root), &path, force)).await
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
            InitialArgs { path: Some("C:/repo".into()), base: Some("HEAD~3".into()) }
        );
        assert_eq!(
            parse_args(s(&["--base=main", "sub/dir"]), cwd),
            InitialArgs { path: Some("C:/work/sub/dir".into()), base: Some("main".into()) }
        );
        assert_eq!(
            parse_args(s(&["--unknown", "-b", "v1"]), cwd),
            InitialArgs { path: None, base: Some("v1".into()) }
        );
    }
}
