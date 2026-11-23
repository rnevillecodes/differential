mod common;

use std::collections::HashSet;

use common::TestRepo;
use differential_lib::git::{list_commits, CommitInfo, CommitPage, Git, RefKind};

fn page(repo: &TestRepo, offset: usize, limit: usize) -> CommitPage {
    list_commits(&Git::default(), repo.path(), offset, limit).unwrap()
}

fn all(repo: &TestRepo) -> Vec<CommitInfo> {
    page(repo, 0, 10_000).commits
}

fn by_sha<'a>(commits: &'a [CommitInfo], sha: &str) -> &'a CommitInfo {
    commits.iter().find(|c| c.sha == sha).unwrap_or_else(|| panic!("{sha} not listed"))
}

fn position(commits: &[CommitInfo], sha: &str) -> usize {
    commits.iter().position(|c| c.sha == sha).unwrap_or_else(|| panic!("{sha} not listed"))
}

fn commit(repo: &TestRepo, file: &str, msg: &str) -> String {
    repo.write(file, msg);
    repo.commit_all(msg)
}

#[test]
fn lists_branches_merges_and_topological_order() {
    let repo = TestRepo::new();
    let a = commit(&repo, "a.txt", "A");
    let b = commit(&repo, "b.txt", "B");
    repo.git(&["checkout", "-q", "-b", "feature", &a]);
    let c = commit(&repo, "c.txt", "C");
    repo.git(&["checkout", "-q", "main"]);
    repo.git(&["merge", "-q", "--no-ff", "-m", "M", "feature"]);
    let m = repo.git(&["rev-parse", "HEAD"]);

    let commits = all(&repo);
    assert_eq!(commits.len(), 4);
    assert_eq!(by_sha(&commits, &b).parents, vec![a.clone()]);
    assert_eq!(by_sha(&commits, &c).parents, vec![a.clone()]);
    assert_eq!(by_sha(&commits, &m).parents, vec![b.clone(), c.clone()]);
    assert!(by_sha(&commits, &a).parents.is_empty());
    for (child, parent) in [(&m, &b), (&m, &c), (&b, &a), (&c, &a)] {
        assert!(position(&commits, child) < position(&commits, parent));
    }
    let mc = by_sha(&commits, &m);
    assert_eq!(mc.subject, "M");
    assert_eq!(mc.author, "Test");
    assert!(mc.sha.starts_with(&mc.short_sha) && mc.short_sha.len() < mc.sha.len());
}

#[test]
fn labels_and_head_marker() {
    let repo = TestRepo::new();
    commit(&repo, "a.txt", "A");
    let b = commit(&repo, "b.txt", "B");
    repo.git(&["tag", "-a", "v1.0", "-m", "release"]);
    repo.git(&["branch", "feature"]);

    let commits = all(&repo);
    let tip = by_sha(&commits, &b);
    assert!(tip.head);
    let labels: Vec<_> = tip.labels.iter().map(|l| (l.name.as_str(), l.kind)).collect();
    assert_eq!(
        labels,
        vec![("feature", RefKind::Local), ("main", RefKind::Local), ("v1.0", RefKind::Tag)]
    );
    assert_eq!(commits.iter().filter(|c| c.head).count(), 1);
}

#[test]
fn remote_head_alias_is_not_a_label() {
    let upstream = TestRepo::with_files(&[("a.txt", "a\n")]);
    let repo = TestRepo::new();
    repo.git(&["remote", "add", "origin", &upstream.root().to_string_lossy()]);
    repo.git(&["fetch", "-q", "origin"]);
    repo.git(&["remote", "set-head", "origin", "main"]);
    repo.git(&["checkout", "-q", "-b", "main", "origin/main"]);

    let commits = all(&repo);
    let names: Vec<_> = commits[0].labels.iter().map(|l| l.name.as_str()).collect();
    assert_eq!(names, vec!["main", "origin/main"]);
}

#[test]
fn detached_head_on_unreferenced_commit_is_listed() {
    let repo = TestRepo::new();
    commit(&repo, "a.txt", "A");
    repo.git(&["checkout", "-q", "--detach"]);
    let loose = commit(&repo, "b.txt", "loose");

    let commits = all(&repo);
    assert!(by_sha(&commits, &loose).head);
}

#[test]
fn stash_commits_are_not_listed() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    repo.write("a.txt", "changed\n");
    repo.git(&["stash", "-q"]);
    let stash = repo.git(&["rev-parse", "refs/stash"]);

    let commits = all(&repo);
    assert_eq!(commits.len(), 1);
    assert!(!commits.iter().any(|c| c.sha == stash));
}

#[test]
fn pages_cover_every_commit_once() {
    let repo = TestRepo::new();
    for i in 0..12 {
        commit(&repo, "f.txt", &format!("c{i}"));
    }
    let p1 = page(&repo, 0, 5);
    let p2 = page(&repo, 5, 5);
    let p3 = page(&repo, 10, 5);
    assert_eq!((p1.commits.len(), p1.has_more), (5, true));
    assert_eq!((p2.commits.len(), p2.has_more), (5, true));
    assert_eq!((p3.commits.len(), p3.has_more), (2, false));
    let seen: HashSet<_> = [p1, p2, p3].iter().flat_map(|p| p.commits.iter().map(|c| c.sha.clone())).collect();
    assert_eq!(seen.len(), 12);
    // An exact fit reports no more.
    assert!(!page(&repo, 0, 12).has_more);
}

#[test]
fn empty_repository_is_an_empty_page() {
    let repo = TestRepo::new();
    let p = page(&repo, 0, 500);
    assert!(p.commits.is_empty());
    assert!(!p.has_more);
}

#[test]
fn listing_does_not_modify_the_repository() {
    let repo = TestRepo::with_files(&[("a.txt", "one\n")]);
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

    all(&repo);

    assert_eq!(std::fs::metadata(&index).unwrap().modified().unwrap(), mtime_before);
    assert_eq!(std::fs::read(&index).unwrap(), index_bytes_before);
    assert_eq!(repo.git(&["status", "--porcelain=v2"]), status_before);
}
