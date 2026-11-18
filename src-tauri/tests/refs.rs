mod common;

use common::TestRepo;
use differential_lib::git::{list_refs, resolve_base, Git, RefInfo, RefKind};

fn refs(repo: &TestRepo) -> Vec<RefInfo> {
    list_refs(&Git::default(), repo.path()).unwrap()
}

fn find<'a>(refs: &'a [RefInfo], name: &str, kind: RefKind) -> &'a RefInfo {
    refs.iter()
        .find(|r| r.name == name && r.kind == kind)
        .unwrap_or_else(|| panic!("{name} ({kind:?}) not listed in {refs:?}"))
}

/// A commit on `main`, a second branch, a tag, and a remote-tracking branch
/// with a symbolic `origin/HEAD`, created through a real clone.
fn repo_with_all_kinds() -> TestRepo {
    let upstream = TestRepo::with_files(&[("a.txt", "a\n")]);
    let repo = TestRepo::new();
    repo.git(&[
        "remote",
        "add",
        "origin",
        &upstream.root().to_string_lossy(),
    ]);
    repo.git(&["fetch", "-q", "origin"]);
    repo.git(&["remote", "set-head", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", "main", "origin/main"]);
    repo.git(&["branch", "feature"]);
    repo.git(&["tag", "v1.0"]);
    // `upstream` may be dropped now: fetched refs and objects are local copies.
    repo
}

#[test]
fn lists_local_remote_and_tag_refs() {
    let repo = repo_with_all_kinds();
    let refs = refs(&repo);
    find(&refs, "main", RefKind::Local);
    find(&refs, "feature", RefKind::Local);
    find(&refs, "origin/main", RefKind::Remote);
    find(&refs, "v1.0", RefKind::Tag);
}

#[test]
fn omits_symbolic_remote_head() {
    let repo = repo_with_all_kinds();
    assert!(repo
        .git(&["symbolic-ref", "refs/remotes/origin/HEAD"])
        .ends_with("origin/main"));
    let refs = refs(&repo);
    assert!(!refs.iter().any(|r| r.name == "origin/HEAD"), "{refs:?}");
    assert!(
        !refs
            .iter()
            .any(|r| r.name == "origin" && r.kind == RefKind::Remote),
        "{refs:?}"
    );
}

#[test]
fn branch_names_with_slashes() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    repo.git(&["branch", "feat/login"]);
    let refs = refs(&repo);
    assert_eq!(find(&refs, "feat/login", RefKind::Local).rev, "feat/login");
}

#[test]
fn marks_only_the_checked_out_branch() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    repo.git(&["checkout", "-q", "-b", "feature"]);
    let refs = refs(&repo);
    let current: Vec<_> = refs
        .iter()
        .filter(|r| r.current)
        .map(|r| r.name.as_str())
        .collect();
    assert_eq!(current, vec!["feature"]);
}

#[test]
fn detached_head_marks_nothing() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    repo.git(&["checkout", "-q", "--detach"]);
    assert!(refs(&repo).iter().all(|r| !r.current));
}

#[test]
fn most_recent_first_within_a_kind() {
    // Commit dates are second-granular, so give `main` an old commit date to make
    // the order deterministic; `feature` then gets a commit dated now.
    let repo = TestRepo::new();
    repo.write("a.txt", "a\n");
    repo.git(&["add", "-A"]);
    let out = std::process::Command::new("git")
        .current_dir(repo.path())
        .args(["commit", "-q", "-m", "older"])
        .env("GIT_COMMITTER_DATE", "2001-01-01 00:00:00 +0000")
        .env("GIT_AUTHOR_DATE", "2001-01-01 00:00:00 +0000")
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("b.txt", "b\n");
    repo.commit_all("newer");
    let locals: Vec<_> = refs(&repo)
        .into_iter()
        .filter(|r| r.kind == RefKind::Local)
        .map(|r| r.name)
        .collect();
    assert_eq!(locals, vec!["feature", "main"]);
}

#[test]
fn repo_without_commits_lists_nothing() {
    let repo = TestRepo::new();
    assert!(refs(&repo).is_empty());
}

#[test]
fn listing_refs_is_read_only() {
    let repo = repo_with_all_kinds();
    repo.write("a.txt", "staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "staged then unstaged\n");
    repo.write("new.txt", "untracked\n");

    // `git status` itself may refresh the index, so take it first, then the index state.
    let status_before = repo.git(&["status", "--porcelain=v2"]);
    let index = repo.path().join(".git/index");
    let mtime_before = std::fs::metadata(&index).unwrap().modified().unwrap();
    let index_bytes_before = std::fs::read(&index).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));

    refs(&repo);

    assert_eq!(
        std::fs::metadata(&index).unwrap().modified().unwrap(),
        mtime_before
    );
    assert_eq!(std::fs::read(&index).unwrap(), index_bytes_before);
    assert_eq!(repo.git(&["status", "--porcelain=v2"]), status_before);
}

#[test]
fn ambiguous_branch_and_tag_resolve_to_their_own_commits() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    let first = repo.git(&["rev-parse", "HEAD"]);
    repo.git(&["tag", "main"]); // tag `main` -> first commit
    repo.write("a.txt", "b\n");
    let second = repo.commit_all("second"); // branch `main` -> second commit
    let refs = refs(&repo);
    let branch = find(&refs, "main", RefKind::Local);
    let tag = find(&refs, "main", RefKind::Tag);
    assert_ne!(branch.rev, tag.rev);
    let git = Git::default();
    assert_eq!(
        resolve_base(&git, repo.path(), &branch.rev).unwrap(),
        second
    );
    assert_eq!(resolve_base(&git, repo.path(), &tag.rev).unwrap(), first);
}
