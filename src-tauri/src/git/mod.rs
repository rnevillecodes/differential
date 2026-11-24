//! Running the `git` executable and resolving repositories and revisions.

pub mod log;
pub mod refs;
pub mod repo;
pub mod runner;

pub use log::{list_commits, CommitInfo, CommitPage, RefLabel};
pub use refs::{list_refs, RefInfo, RefKind};
pub use repo::{canonical, git_dirs, open_repo, resolve_base, GitDirs, RepoInfo};
pub use runner::Git;
