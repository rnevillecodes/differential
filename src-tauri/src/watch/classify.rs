//! Sorting file-system event paths into what they can affect, and collecting them into batches.

use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

/// Where the watched repository lives on disk. All paths are absolute and canonical.
#[derive(Debug, Clone)]
pub struct Layout {
    /// The working tree's top-level directory.
    pub root: PathBuf,
    /// This worktree's git directory (`HEAD`, `index`).
    pub git_dir: PathBuf,
    /// The shared git directory (refs, `packed-refs`, `info/exclude`).
    pub common_dir: PathBuf,
}

/// What a changed path can affect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathClass {
    /// `HEAD`, the index, or a ref: branch, history, and possibly the base moved.
    Git,
    /// A working-tree path (repo-relative, `/`-separated), relevant unless git ignores it.
    Worktree(String),
    /// A file that changes which paths git ignores (`.gitignore`, `info/exclude`): always relevant.
    IgnoreRules,
    /// Cannot affect anything shown.
    Drop,
}

/// Classify one event path.
pub fn classify(layout: &Layout, path: &Path) -> PathClass {
    // A linked worktree's git dir lies inside the common dir, so check it first.
    if let Ok(rel) = path.strip_prefix(&layout.git_dir) {
        return classify_git(&slash(rel), true, layout.git_dir == layout.common_dir);
    }
    if let Ok(rel) = path.strip_prefix(&layout.common_dir) {
        return classify_git(&slash(rel), false, true);
    }
    let Ok(rel) = path.strip_prefix(&layout.root) else {
        return PathClass::Drop;
    };
    if rel.as_os_str().is_empty() {
        return PathClass::Drop;
    }
    // Nested git metadata (a linked worktree's `.git` file, a submodule's `.git`).
    if rel.components().any(|c| matches!(c, Component::Normal(n) if n == ".git")) {
        return PathClass::Drop;
    }
    if rel.file_name().is_some_and(|n| n == ".gitignore") {
        return PathClass::IgnoreRules;
    }
    PathClass::Worktree(slash(rel))
}

/// `rel` is relative to a git directory. `own` is true for this worktree's git dir;
/// `shared` is true when it holds the shared files (refs, info).
fn classify_git(rel: &str, own: bool, shared: bool) -> PathClass {
    if rel.ends_with(".lock") {
        // The rename of the lock onto the real file produces its own event.
        return PathClass::Drop;
    }
    if own && (rel == "HEAD" || rel == "index") {
        return PathClass::Git;
    }
    if shared {
        if rel == "packed-refs" || rel == "refs" || rel.starts_with("refs/") {
            return PathClass::Git;
        }
        if rel == "info/exclude" {
            return PathClass::IgnoreRules;
        }
    }
    PathClass::Drop
}

fn slash(rel: &Path) -> String {
    let parts: Vec<_> = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect();
    parts.join("/")
}

/// Most distinct working-tree paths kept per batch; beyond this the batch counts as relevant.
pub const MAX_CANDIDATES: usize = 20_000;

/// Everything seen since the last flush.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Batch {
    pub git: bool,
    pub ignore_rules: bool,
    /// The OS dropped events: refresh everything.
    pub rescan: bool,
    /// Working-tree paths still to be checked against the ignore rules.
    pub candidates: BTreeSet<String>,
    /// Too many candidates to check: treat the working tree as changed.
    pub overflow: bool,
}

impl Batch {
    /// Add a classified path. Returns whether it can matter (and so should start the timer).
    pub fn add(&mut self, class: PathClass) -> bool {
        match class {
            PathClass::Git => self.git = true,
            PathClass::IgnoreRules => self.ignore_rules = true,
            PathClass::Worktree(rel) => {
                if self.candidates.len() >= MAX_CANDIDATES {
                    self.overflow = true;
                } else {
                    self.candidates.insert(rel);
                }
            }
            PathClass::Drop => return false,
        }
        true
    }

    pub fn is_empty(&self) -> bool {
        *self == Batch::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> Layout {
        Layout {
            root: PathBuf::from("/r"),
            git_dir: PathBuf::from("/r/.git"),
            common_dir: PathBuf::from("/r/.git"),
        }
    }

    fn c(path: &str) -> PathClass {
        classify(&layout(), Path::new(path))
    }

    #[test]
    fn git_metadata_paths() {
        assert_eq!(c("/r/.git/HEAD"), PathClass::Git);
        assert_eq!(c("/r/.git/index"), PathClass::Git);
        assert_eq!(c("/r/.git/packed-refs"), PathClass::Git);
        assert_eq!(c("/r/.git/refs/heads/main"), PathClass::Git);
        assert_eq!(c("/r/.git/refs/remotes/origin/feat/x"), PathClass::Git);
        assert_eq!(c("/r/.git/refs/tags"), PathClass::Git);
    }

    #[test]
    fn other_git_paths_are_dropped() {
        for p in [
            "/r/.git/objects/ab/cdef",
            "/r/.git/logs/HEAD",
            "/r/.git/hooks/pre-commit",
            "/r/.git/index.lock",
            "/r/.git/refs/heads/main.lock",
            "/r/.git/FETCH_HEAD",
            "/r/.git/ORIG_HEAD",
            "/r/.git/config",
            "/r/.git",
        ] {
            assert_eq!(c(p), PathClass::Drop, "{p}");
        }
    }

    #[test]
    fn worktree_paths() {
        assert_eq!(c("/r/src/a.ts"), PathClass::Worktree("src/a.ts".into()));
        assert_eq!(c("/r/target/debug/x"), PathClass::Worktree("target/debug/x".into()));
        assert_eq!(c("/r"), PathClass::Drop);
        assert_eq!(c("/elsewhere/a.ts"), PathClass::Drop);
        assert_eq!(c("/r/sub/.git/HEAD"), PathClass::Drop);
    }

    #[test]
    fn ignore_rule_files() {
        assert_eq!(c("/r/.gitignore"), PathClass::IgnoreRules);
        assert_eq!(c("/r/src/.gitignore"), PathClass::IgnoreRules);
        assert_eq!(c("/r/.git/info/exclude"), PathClass::IgnoreRules);
    }

    #[test]
    fn linked_worktree_layout() {
        let l = Layout {
            root: PathBuf::from("/wt"),
            git_dir: PathBuf::from("/main/.git/worktrees/wt"),
            common_dir: PathBuf::from("/main/.git"),
        };
        let c = |p: &str| classify(&l, Path::new(p));
        assert_eq!(c("/main/.git/worktrees/wt/HEAD"), PathClass::Git);
        assert_eq!(c("/main/.git/worktrees/wt/index"), PathClass::Git);
        assert_eq!(c("/main/.git/refs/heads/feature"), PathClass::Git);
        assert_eq!(c("/main/.git/packed-refs"), PathClass::Git);
        assert_eq!(c("/main/.git/info/exclude"), PathClass::IgnoreRules);
        // The main worktree's HEAD and index, and other worktrees, are not ours.
        assert_eq!(c("/main/.git/HEAD"), PathClass::Drop);
        assert_eq!(c("/main/.git/index"), PathClass::Drop);
        assert_eq!(c("/main/.git/worktrees/other/HEAD"), PathClass::Drop);
        // The `.git` file in the worktree root.
        assert_eq!(c("/wt/.git"), PathClass::Drop);
        assert_eq!(c("/wt/src/a.ts"), PathClass::Worktree("src/a.ts".into()));
    }

    #[test]
    fn batch_merges_kinds() {
        let mut b = Batch::default();
        assert!(b.is_empty());
        assert!(!b.add(PathClass::Drop));
        assert!(b.is_empty());
        assert!(b.add(PathClass::Worktree("a".into())));
        assert!(b.add(PathClass::Worktree("a".into())));
        assert!(b.add(PathClass::Git));
        assert!(b.git);
        assert_eq!(b.candidates.len(), 1);
    }

    #[test]
    fn batch_overflows_instead_of_growing_forever() {
        let mut b = Batch::default();
        for i in 0..=MAX_CANDIDATES {
            b.add(PathClass::Worktree(format!("f{i}")));
        }
        assert_eq!(b.candidates.len(), MAX_CANDIDATES);
        assert!(b.overflow);
    }
}
