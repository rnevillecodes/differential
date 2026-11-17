//! Opening a repository and resolving the base revision.

use std::path::{Path, PathBuf};

use serde::Serialize;
use ts_rs::TS;

use super::runner::Git;
use crate::error::{AppError, Result};

/// Minimum supported git version (needed for `--end-of-options`).
pub const MIN_GIT_VERSION: (u32, u32) = (2, 30);

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RepoInfo {
    /// Absolute path of the repository's top-level directory.
    pub root: String,
    /// Commit `HEAD` points to, or `None` in a repository with no commits.
    pub head_sha: Option<String>,
}

/// Parse `git version 2.56.1.windows.1` into `(2, 56)`.
pub fn parse_git_version(s: &str) -> Option<(u32, u32)> {
    let ver = s.trim().strip_prefix("git version ")?;
    let mut parts = ver.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts
        .next()?
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect::<String>()
        .parse()
        .ok()?;
    Some((major, minor))
}

/// Fail with `GitNotFound` / `GitTooOld` unless a usable git is available.
pub fn check_git(git: &Git) -> Result<()> {
    let out = git.run_text(&std::env::temp_dir(), &["--version"])?;
    match parse_git_version(&out) {
        Some(v) if v >= MIN_GIT_VERSION => Ok(()),
        _ => Err(AppError::GitTooOld(
            out.trim_start_matches("git version ").to_string(),
        )),
    }
}

/// Resolve the repository containing `path` (which may be a subfolder).
pub fn open_repo(git: &Git, path: &Path) -> Result<RepoInfo> {
    check_git(git)?;
    if !path.is_dir() {
        return Err(AppError::Io(format!("{} is not a folder", path.display())));
    }
    let top = git
        .run_text(path, &["rev-parse", "--show-toplevel"])
        .map_err(|e| match e {
            AppError::Git(_) => AppError::NotARepo(path.display().to_string()),
            other => other,
        })?;
    if top.is_empty() {
        // e.g. inside the .git directory itself
        return Err(AppError::NotARepo(path.display().to_string()));
    }
    let root = PathBuf::from(&top);
    let head = git.run_raw(&root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])?;
    let head_sha = head
        .success
        .then(|| String::from_utf8_lossy(&head.stdout).trim().to_string())
        .filter(|s| !s.is_empty());
    Ok(RepoInfo {
        root: root.to_string_lossy().replace('\\', "/"),
        head_sha,
    })
}

/// Resolve `base` (default `HEAD`) to a full commit SHA.
pub fn resolve_base(git: &Git, root: &Path, base: &str) -> Result<String> {
    let base = if base.trim().is_empty() { "HEAD" } else { base.trim() };
    let spec = format!("{base}^{{commit}}");
    let out = git.run_raw(
        root,
        &["rev-parse", "--verify", "--quiet", "--end-of-options", &spec],
    )?;
    let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.success && !sha.is_empty() {
        Ok(sha)
    } else if out.stderr.to_ascii_lowercase().contains("not a git repository") {
        Err(AppError::NotARepo(root.display().to_string()))
    } else {
        Err(AppError::BadRevision(base.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_versions() {
        assert_eq!(parse_git_version("git version 2.56.1.windows.1"), Some((2, 56)));
        assert_eq!(parse_git_version("git version 2.30.0"), Some((2, 30)));
        assert_eq!(parse_git_version("git version 2.9-rc1"), Some((2, 9)));
        assert_eq!(parse_git_version("nonsense"), None);
    }

    #[test]
    fn version_ordering() {
        assert!(parse_git_version("git version 2.29.9").unwrap() < MIN_GIT_VERSION);
        assert!(parse_git_version("git version 3.0.0").unwrap() >= MIN_GIT_VERSION);
    }
}
