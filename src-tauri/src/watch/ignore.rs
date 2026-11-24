//! Deciding whether changed working-tree paths are ignored by git.
//!
//! git stays the source of truth: ignored directories come from `git ls-files` and
//! everything else is asked of `git check-ignore`. Both only read the repository.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::error::{AppError, Result};
use crate::git::Git;

/// Paths sent to one `git check-ignore` call.
const CHUNK: usize = 1000;

/// Answers "is this path ignored?" for one repository.
#[derive(Debug)]
pub struct IgnoreFilter {
    git: Git,
    root: PathBuf,
    /// Repo-relative ignored directories, without a trailing `/`.
    dirs: HashSet<String>,
}

impl IgnoreFilter {
    /// Build the filter, listing the repository's ignored directories.
    pub fn new(git: Git, root: &Path) -> Result<Self> {
        let mut f = IgnoreFilter { git, root: root.to_path_buf(), dirs: HashSet::new() };
        f.rebuild()?;
        Ok(f)
    }

    /// Re-list ignored directories (after the ignore rules changed).
    pub fn rebuild(&mut self) -> Result<()> {
        self.dirs.clear();
        let listed = list_ignored_dirs(&self.git, &self.root)?;
        let mut confirmed = HashSet::new();
        // `ls-files --directory` also lists untracked folders holding only ignored files, which
        // are not ignored themselves (new files there count); keep only what git confirms.
        for chunk in listed.chunks(CHUNK) {
            let refs: Vec<&str> = chunk.iter().map(String::as_str).collect();
            confirmed.extend(self.ignored(&refs)?);
        }
        self.dirs = confirmed;
        Ok(())
    }

    /// Whether `rel` is a known ignored directory or lies inside one.
    pub fn in_ignored_dir(&self, rel: &str) -> bool {
        if self.dirs.is_empty() {
            return false;
        }
        let mut end = 0;
        loop {
            let next = rel[end..].find('/').map(|i| end + i);
            let prefix = &rel[..next.unwrap_or(rel.len())];
            if self.dirs.contains(prefix) {
                return true;
            }
            match next {
                Some(i) => end = i + 1,
                None => return false,
            }
        }
    }

    /// Remember `rel` as an ignored directory.
    pub fn add_ignored_dir(&mut self, rel: &str) {
        self.dirs.insert(rel.trim_end_matches('/').to_string());
    }

    /// Whether any of `paths` is not ignored. Stops at the first one found.
    pub fn any_relevant<'a, I: IntoIterator<Item = &'a String>>(&self, paths: I) -> Result<bool> {
        let mut chunk: Vec<&str> = Vec::with_capacity(CHUNK);
        for p in paths {
            if self.in_ignored_dir(p) {
                continue;
            }
            chunk.push(p);
            if chunk.len() == CHUNK {
                if self.count_ignored(&chunk)? < chunk.len() {
                    return Ok(true);
                }
                chunk.clear();
            }
        }
        Ok(!chunk.is_empty() && self.count_ignored(&chunk)? < chunk.len())
    }

    /// Which of `paths` git ignores.
    pub fn ignored(&self, paths: &[&str]) -> Result<HashSet<String>> {
        if paths.is_empty() {
            return Ok(HashSet::new());
        }
        let mut input = Vec::new();
        for p in paths {
            input.extend_from_slice(p.as_bytes());
            input.push(0);
        }
        // Without `--no-index`, tracked files are never reported as ignored.
        let out = self.git.run_raw_with_stdin(&self.root, &["check-ignore", "--stdin", "-z"], &input)?;
        // Exit 0: some ignored; 1 (silently): none ignored; a fatal error writes to stderr.
        if !out.success && !out.stderr.is_empty() {
            return Err(AppError::Git(out.stderr));
        }
        Ok(out
            .stdout
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).into_owned())
            .collect())
    }

    fn count_ignored(&self, paths: &[&str]) -> Result<usize> {
        Ok(self.ignored(paths)?.len())
    }
}

/// The repository's ignored directories (repo-relative, no trailing `/`). Only the topmost
/// ignored directory of each ignored subtree is listed.
pub fn list_ignored_dirs(git: &Git, root: &Path) -> Result<Vec<String>> {
    let out = git.run(
        root,
        &["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
    )?;
    Ok(out
        .split(|b| *b == 0)
        .filter_map(|s| s.strip_suffix(b"/"))
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn filter(dirs: &[&str]) -> IgnoreFilter {
        IgnoreFilter {
            git: Git::default(),
            root: PathBuf::from("."),
            dirs: dirs.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn prefix_cache_matches_whole_components() {
        let f = filter(&["target", "web/node_modules"]);
        assert!(f.in_ignored_dir("target"));
        assert!(f.in_ignored_dir("target/debug/app"));
        assert!(f.in_ignored_dir("web/node_modules/x/index.js"));
        assert!(!f.in_ignored_dir("targets/a"));
        assert!(!f.in_ignored_dir("src/target"));
        assert!(!f.in_ignored_dir("web/src/a.ts"));
        assert!(!filter(&[]).in_ignored_dir("target/x"));
    }
}
