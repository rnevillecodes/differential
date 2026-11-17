//! Running the `git` executable and resolving repositories and revisions.

pub mod repo;
pub mod runner;

pub use repo::{open_repo, resolve_base, RepoInfo};
pub use runner::Git;
