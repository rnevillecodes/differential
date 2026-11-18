//! Running the `git` executable and resolving repositories and revisions.

pub mod refs;
pub mod repo;
pub mod runner;

pub use refs::{list_refs, RefInfo, RefKind};
pub use repo::{open_repo, resolve_base, RepoInfo};
pub use runner::Git;
