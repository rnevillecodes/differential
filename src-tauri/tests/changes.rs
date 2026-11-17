mod common;

use common::TestRepo;
use mydiff_lib::changes::{file_content, file_diff, limits, list_changes};
use mydiff_lib::diff::model::{ChangeSet, FileStatus, FileSummary, LineKind, Side};
use mydiff_lib::error::AppError;
use mydiff_lib::git::Git;

fn find<'a>(cs: &'a ChangeSet, path: &str) -> &'a FileSummary {
    cs.files
        .iter()
        .find(|f| f.display_path() == path)
        .unwrap_or_else(|| panic!("{path} not in {:#?}", cs.files))
}

fn texts(git: &Git, repo: &TestRepo, cs: &ChangeSet, path: &str) -> Vec<(LineKind, String)> {
    let d = file_diff(git, repo.path(), &cs.base_sha, find(cs, path), false).unwrap();
    d.hunks
        .iter()
        .flat_map(|h| &h.lines)
        .map(|l| (l.kind, l.text.clone()))
        .collect()
}

// ---- 4.1 list_changes ------------------------------------------------------

#[test]
fn lists_each_status_with_stats() {
    let repo = TestRepo::with_files(&[
        ("mod.txt", "a\nb\nc\n"),
        ("del.txt", "x\ny\n"),
        ("ren.txt", "1\n2\n3\n4\n5\n6\n7\n8\n"),
        ("img.png", "\0PNG\x01"),
    ]);
    repo.write("mod.txt", "a\nB\nc\nd\n");
    repo.remove("del.txt");
    repo.rename("ren.txt", "dir/moved.txt");
    repo.write("dir/moved.txt", "1\n2\n3\n4\n5\n6\n7\nEIGHT\n");
    repo.write_bytes("img.png", b"\0PNG\x02");
    repo.write("staged_new.txt", "s\n");
    repo.git(&["add", "staged_new.txt"]);

    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "").unwrap();

    let m = find(&cs, "mod.txt");
    assert_eq!((m.status, m.additions, m.deletions), (FileStatus::Modified, 2, 1));
    let d = find(&cs, "del.txt");
    assert_eq!((d.status, d.deletions, d.new_path.clone()), (FileStatus::Deleted, 2, None));
    let a = find(&cs, "staged_new.txt");
    assert_eq!((a.status, a.additions, a.old_path.clone()), (FileStatus::Added, 1, None));
    let b = find(&cs, "img.png");
    assert!(b.is_binary && b.status == FileStatus::Modified);

    // The rename is only detected once git sees both sides; the new path is untracked
    // unless staged, so stage the move like an agent's `git mv` would.
    repo.git(&["add", "-A", "ren.txt", "dir/moved.txt"]);
    let cs = list_changes(&git, repo.path(), "").unwrap();
    let r = find(&cs, "dir/moved.txt");
    assert_eq!(r.status, FileStatus::Renamed);
    assert_eq!(r.old_path.as_deref(), Some("ren.txt"));
    assert_eq!((r.additions, r.deletions), (1, 1));

    assert_eq!(cs.totals.files as usize, cs.files.len());
    assert_eq!(cs.totals.additions, cs.files.iter().map(|f| f.additions).sum::<u32>());
    let ids: Vec<u32> = cs.files.iter().map(|f| f.id).collect();
    assert_eq!(ids, (0..cs.files.len() as u32).collect::<Vec<_>>());
}

#[test]
fn staged_and_unstaged_changes_are_combined_against_worktree() {
    let repo = TestRepo::with_files(&[("f.txt", "1\n2\n3\n")]);
    repo.write("f.txt", "ONE\n2\n3\n");
    repo.git(&["add", "f.txt"]);
    repo.write("f.txt", "ONE\n2\nTHREE\n");
    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "HEAD").unwrap();
    let f = find(&cs, "f.txt");
    assert_eq!((f.additions, f.deletions), (2, 2));
    let lines = texts(&git, &repo, &cs, "f.txt");
    assert!(lines.contains(&(LineKind::Added, "ONE".into())));
    assert!(lines.contains(&(LineKind::Added, "THREE".into())));
}

#[test]
fn custom_base_includes_commits_and_uncommitted_edits() {
    let repo = TestRepo::with_files(&[("f.txt", "a\n")]);
    repo.write("f.txt", "a\nb\n");
    repo.commit_all("b");
    repo.write("f.txt", "a\nb\nc\n");
    repo.commit_all("c");
    repo.write("f.txt", "a\nb\nc\nd\n");
    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "HEAD~2").unwrap();
    assert_eq!(cs.base_ref, "HEAD~2");
    assert_eq!(cs.base_sha, repo.git(&["rev-parse", "HEAD~2"]));
    assert_eq!(find(&cs, "f.txt").additions, 3);
}

#[test]
fn clean_tree_has_no_changes() {
    let repo = TestRepo::with_files(&[("f.txt", "a\n")]);
    let cs = list_changes(&Git::default(), repo.path(), "").unwrap();
    assert!(cs.files.is_empty());
    assert_eq!(cs.totals.files, 0);
}

#[test]
fn bad_base_is_reported() {
    let repo = TestRepo::with_files(&[("f.txt", "a\n")]);
    let err = list_changes(&Git::default(), repo.path(), "nope").unwrap_err();
    assert!(matches!(err, AppError::BadRevision(_)), "{err:?}");
}

// ---- 4.2 untracked ---------------------------------------------------------

#[test]
fn untracked_files_are_listed_and_ignored_files_are_not() {
    let repo = TestRepo::with_files(&[(".gitignore", "*.log\nbuild/\n")]);
    repo.write("new/agent.rs", "fn a() {}\nfn b() {}\nfn c() {}");
    repo.write("debug.log", "noise\n");
    repo.write("build/out.txt", "noise\n");
    repo.write_bytes("blob.bin", b"\x00\x01\x02");
    let cs = list_changes(&Git::default(), repo.path(), "").unwrap();
    let u = find(&cs, "new/agent.rs");
    assert_eq!((u.status, u.additions, u.deletions), (FileStatus::Untracked, 3, 0));
    assert!(find(&cs, "blob.bin").is_binary);
    assert!(cs.files.iter().all(|f| f.display_path() != "debug.log"));
    assert!(cs.files.iter().all(|f| !f.display_path().starts_with("build/")));
}

// ---- 4.3 large-file guard ----------------------------------------------------

#[test]
fn large_files_are_flagged_and_refused_without_force() {
    let repo = TestRepo::with_files(&[("small.txt", "x\n")]);
    let many: String = (0..=limits::MAX_CHANGED_LINES).map(|i| format!("line {i}\n")).collect();
    repo.write("package-lock.json", &many);
    repo.write("small.txt", "y\n");
    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "").unwrap();
    let big = find(&cs, "package-lock.json");
    assert!(big.is_large);
    assert!(!find(&cs, "small.txt").is_large);

    let err = file_diff(&git, repo.path(), &cs.base_sha, big, false).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    let d = file_diff(&git, repo.path(), &cs.base_sha, big, true).unwrap();
    assert_eq!(d.hunks[0].lines.len() as u32, limits::MAX_CHANGED_LINES + 1);
}

#[test]
fn large_tracked_file_by_size() {
    let big = "x".repeat(limits::MAX_FILE_BYTES as usize + 10) + "\n";
    let repo = TestRepo::with_files(&[("big.txt", &big)]);
    repo.write("big.txt", &format!("{big}tail\n"));
    let cs = list_changes(&Git::default(), repo.path(), "").unwrap();
    assert!(find(&cs, "big.txt").is_large);
}

// ---- 4.4 file_diff -------------------------------------------------------------

#[test]
fn file_diff_for_each_status() {
    let repo = TestRepo::with_files(&[
        ("m.txt", "const timeout = 30;\nkeep\n"),
        ("d.txt", "bye\n"),
        ("r.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n"),
    ]);
    repo.write("m.txt", "const timeout = 60;\nkeep\n");
    repo.remove("d.txt");
    repo.rename("r.txt", "r2.txt");
    repo.write("r2.txt", "1\n2\n3\n4\n5\n6\n7\n8\n9\nTEN\n");
    repo.git(&["add", "-A", "r.txt", "r2.txt"]);
    repo.write("u.txt", "brand\nnew");
    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "").unwrap();

    let m = file_diff(&git, repo.path(), &cs.base_sha, find(&cs, "m.txt"), false).unwrap();
    let removed = &m.hunks[0].lines[0];
    assert_eq!((removed.kind, removed.old_no), (LineKind::Removed, Some(1)));
    assert_eq!(removed.intraline.as_ref().unwrap()[0].start, 16, "intraline attached");

    assert_eq!(
        texts(&git, &repo, &cs, "d.txt"),
        vec![(LineKind::Removed, "bye".into())]
    );
    assert_eq!(
        texts(&git, &repo, &cs, "r2.txt"),
        vec![
            (LineKind::Context, "7".into()),
            (LineKind::Context, "8".into()),
            (LineKind::Context, "9".into()),
            (LineKind::Removed, "10".into()),
            (LineKind::Added, "TEN".into()),
        ]
    );
    let u = file_diff(&git, repo.path(), &cs.base_sha, find(&cs, "u.txt"), false).unwrap();
    assert_eq!(u.hunks[0].lines.len(), 2);
    assert!(u.new_no_eof_newline);
    assert_eq!(u.file_id, find(&cs, "u.txt").id);
}

#[test]
fn binary_file_diff_has_no_hunks() {
    let repo = TestRepo::new();
    repo.write_bytes("a.bin", b"\x00\x01");
    repo.commit_all("i");
    repo.write_bytes("a.bin", b"\x00\x02");
    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "").unwrap();
    let d = file_diff(&git, repo.path(), &cs.base_sha, find(&cs, "a.bin"), false).unwrap();
    assert!(d.is_binary && d.hunks.is_empty());
}

// ---- 4.5 file_content ------------------------------------------------------------

#[test]
fn file_content_for_both_sides_and_missing_sides() {
    let repo = TestRepo::with_files(&[("f.txt", "old\n"), ("gone.txt", "g\n")]);
    repo.write("f.txt", "new\r\nline\r\n");
    repo.remove("gone.txt");
    repo.write("added.txt", "a\n");
    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "").unwrap();
    let sha = &cs.base_sha;
    let root = repo.path();

    assert_eq!(file_content(&git, root, sha, "f.txt", Side::Base).unwrap().as_deref(), Some("old\n"));
    assert_eq!(
        file_content(&git, root, sha, "f.txt", Side::Worktree).unwrap().as_deref(),
        Some("new\nline\n"),
        "CRLF normalized"
    );
    assert_eq!(file_content(&git, root, sha, "gone.txt", Side::Worktree).unwrap(), None);
    assert_eq!(file_content(&git, root, sha, "added.txt", Side::Base).unwrap(), None);
    assert!(file_content(&git, root, sha, "../outside.txt", Side::Worktree).is_err());
}

// ---- 4.6 read-only guarantee ----------------------------------------------------

#[test]
fn diffing_never_modifies_the_repository() {
    let repo = TestRepo::with_files(&[("a.txt", "1\n"), ("b.txt", "2\n")]);
    repo.write("a.txt", "1 staged\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "1 staged and unstaged\n");
    repo.write("b.txt", "2 unstaged\n");
    repo.write("c.txt", "untracked\n");

    // `git status` itself may refresh the index, so take it first, then the mtime.
    let status_before = repo.git(&["status", "--porcelain=v2"]);
    let index = repo.path().join(".git/index");
    let mtime_before = std::fs::metadata(&index).unwrap().modified().unwrap();
    let index_bytes_before = std::fs::read(&index).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));

    let git = Git::default();
    let cs = list_changes(&git, repo.path(), "").unwrap();
    for f in &cs.files {
        file_diff(&git, repo.path(), &cs.base_sha, f, true).unwrap();
        for side in [Side::Base, Side::Worktree] {
            file_content(&git, repo.path(), &cs.base_sha, f.display_path(), side).unwrap();
        }
    }

    assert_eq!(std::fs::metadata(&index).unwrap().modified().unwrap(), mtime_before);
    assert_eq!(std::fs::read(&index).unwrap(), index_bytes_before);
    assert_eq!(repo.git(&["status", "--porcelain=v2"]), status_before);
}
