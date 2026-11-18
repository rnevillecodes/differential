mod common;

use common::TestRepo;
use differential_lib::error::AppError;
use differential_lib::git::{open_repo, resolve_base, Git};
use std::path::Path;

fn same_path(a: &str, b: &Path) -> bool {
    let canon = |p: &Path| std::fs::canonicalize(p).unwrap();
    canon(Path::new(a)) == canon(b)
}

#[test]
fn opens_repo_root() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    let info = open_repo(&Git::default(), repo.path()).unwrap();
    assert!(same_path(&info.root, repo.path()), "{}", info.root);
    assert_eq!(
        info.head_sha.as_deref(),
        Some(repo.git(&["rev-parse", "HEAD"]).as_str())
    );
}

#[test]
fn subfolder_resolves_to_top_level() {
    let repo = TestRepo::with_files(&[("src/deep/a.txt", "a\n")]);
    let info = open_repo(&Git::default(), &repo.path().join("src/deep")).unwrap();
    assert!(same_path(&info.root, repo.path()), "{}", info.root);
}

#[test]
fn non_repo_folder_is_not_a_repo() {
    let dir = tempfile::tempdir().unwrap();
    let err = open_repo(&Git::default(), dir.path()).unwrap_err();
    assert!(matches!(err, AppError::NotARepo(_)), "{err:?}");
}

#[test]
fn missing_folder_is_io_error() {
    let err = open_repo(&Git::default(), Path::new("Z:/definitely/not/here")).unwrap_err();
    assert!(matches!(err, AppError::Io(_)), "{err:?}");
}

#[test]
fn missing_git_is_reported() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    let err = open_repo(&Git::with_exe("no-such-git-xyz"), repo.path()).unwrap_err();
    assert!(matches!(err, AppError::GitNotFound), "{err:?}");
}

#[test]
fn repo_without_commits_has_no_head_and_head_base_fails() {
    let repo = TestRepo::new();
    let info = open_repo(&Git::default(), repo.path()).unwrap();
    assert_eq!(info.head_sha, None);
    let err = resolve_base(&Git::default(), repo.path(), "").unwrap_err();
    assert!(matches!(err, AppError::BadRevision(ref r) if r == "HEAD"), "{err:?}");
}

#[test]
fn resolves_revision_forms() {
    let repo = TestRepo::with_files(&[("a.txt", "1\n")]);
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.write("a.txt", "2\n");
    let second = repo.commit_all("second");
    repo.write("a.txt", "3\n");
    let third = repo.commit_all("third");
    repo.git(&["tag", "v1", &first]);
    repo.git(&["branch", "old", &second]);
    let git = Git::default();
    let root = repo.root();

    assert_eq!(resolve_base(&git, &root, "").unwrap(), third, "default is HEAD");
    assert_eq!(resolve_base(&git, &root, "HEAD").unwrap(), third);
    assert_eq!(resolve_base(&git, &root, "HEAD~2").unwrap(), first);
    assert_eq!(resolve_base(&git, &root, "old").unwrap(), second, "branch");
    assert_eq!(resolve_base(&git, &root, "v1").unwrap(), first, "lightweight tag");
    assert_eq!(resolve_base(&git, &root, &second[..8]).unwrap(), second, "sha prefix");
}

#[test]
fn annotated_tag_peels_to_commit() {
    let repo = TestRepo::with_files(&[("a.txt", "1\n")]);
    let sha = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["tag", "-a", "v2", "-m", "release"]);
    assert_eq!(resolve_base(&Git::default(), repo.path(), "v2").unwrap(), sha);
}

#[test]
fn unresolvable_revision_is_bad_revision() {
    let repo = TestRepo::with_files(&[("a.txt", "1\n")]);
    for bad in ["no-such-branch", "--output=x", "HEAD~99"] {
        let err = resolve_base(&Git::default(), repo.path(), bad).unwrap_err();
        assert!(matches!(err, AppError::BadRevision(_)), "{bad}: {err:?}");
    }
}
