//! Ignore filtering and live watching against real temporary repositories.
//!
//! Watch tests wait on real file-system events, so timeouts are generous.

mod common;

use std::sync::mpsc;
use std::time::{Duration, Instant};

use common::TestRepo;
use differential_lib::git::Git;
use differential_lib::watch::ignore::{list_ignored_dirs, IgnoreFilter};
use differential_lib::watch::{RepoEvent, WatchHandle, Watchers};

fn repo_with_ignores() -> TestRepo {
    let repo = TestRepo::with_files(&[
        (".gitignore", "target/\nnode_modules/\n*.log\n"),
        ("src/a.ts", "a\n"),
        ("keep.log", "tracked despite the pattern\n"),
    ]);
    // `add -A` skips ignored files, so track `keep.log` explicitly.
    repo.git(&["add", "-f", "keep.log"]);
    repo.git(&["commit", "-q", "-m", "track keep.log"]);
    repo.write("target/debug/app", "bin");
    repo.write("web/node_modules/x/index.js", "x");
    repo
}

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

// ---- ignore filtering ------------------------------------------------------------

#[test]
fn lists_topmost_ignored_directories() {
    let repo = repo_with_ignores();
    let mut dirs = list_ignored_dirs(&Git::default(), repo.path()).unwrap();
    dirs.sort();
    // git also lists `web/`, an untracked folder holding only ignored files.
    assert!(dirs.contains(&"target".to_string()) && dirs.contains(&"web/node_modules".to_string()));
}

#[test]
fn folder_holding_only_ignored_files_is_not_treated_as_ignored() {
    let repo = repo_with_ignores();
    let f = IgnoreFilter::new(Git::default(), repo.path()).unwrap();
    assert!(f.in_ignored_dir("target/debug/app"));
    assert!(f.in_ignored_dir("web/node_modules/x/index.js"));
    assert!(!f.in_ignored_dir("web/src/new.ts"));
    assert!(f.any_relevant(&s(&["web/src/new.ts"])).unwrap());
}

#[test]
fn tracked_file_matching_an_ignore_pattern_is_not_ignored() {
    let repo = repo_with_ignores();
    let f = IgnoreFilter::new(Git::default(), repo.path()).unwrap();
    let ignored = f.ignored(&["keep.log", "other.log"]).unwrap();
    assert!(!ignored.contains("keep.log"));
    assert!(ignored.contains("other.log"));
}

#[test]
fn batch_relevance() {
    let repo = repo_with_ignores();
    let f = IgnoreFilter::new(Git::default(), repo.path()).unwrap();
    // Only ignored paths (cached directories and pattern matches).
    assert!(!f.any_relevant(&s(&["target/debug/app", "web/node_modules/y", "new.log"])).unwrap());
    // Mixed: one source file among ignored output.
    assert!(f.any_relevant(&s(&["target/debug/app", "src/a.ts"])).unwrap());
    // A deleted tracked file (no longer on disk) is relevant.
    std::fs::remove_file(repo.path().join("src/a.ts")).unwrap();
    assert!(f.any_relevant(&s(&["src/a.ts"])).unwrap());
    // A new untracked file is relevant.
    assert!(f.any_relevant(&s(&["src/b.ts"])).unwrap());
    assert!(!f.any_relevant(&s(&[])).unwrap());
}

#[test]
fn many_paths_are_checked_in_chunks() {
    let repo = repo_with_ignores();
    let f = IgnoreFilter::new(Git::default(), repo.path()).unwrap();
    let mut paths: Vec<String> = (0..2500).map(|i| format!("out{i}.log")).collect();
    assert!(!f.any_relevant(&paths).unwrap());
    paths.push("src/new.ts".into());
    assert!(f.any_relevant(&paths).unwrap());
}

#[test]
fn rebuild_follows_changed_ignore_rules() {
    let repo = repo_with_ignores();
    let mut f = IgnoreFilter::new(Git::default(), repo.path()).unwrap();
    repo.write("dist/out.js", "x");
    assert!(!f.in_ignored_dir("dist/out.js"));
    repo.write(".gitignore", "target/\nnode_modules/\n*.log\ndist/\n");
    f.rebuild().unwrap();
    assert!(f.in_ignored_dir("dist/out.js"));
}

// ---- live watching ---------------------------------------------------------------

const SETTLE: Duration = Duration::from_millis(1500);
const TIMEOUT: Duration = Duration::from_secs(10);

fn start(repo: &TestRepo) -> (WatchHandle, mpsc::Receiver<RepoEvent>) {
    let (tx, rx) = mpsc::channel();
    let handle = WatchHandle::start(
        Git::default(),
        repo.path(),
        Box::new(move |e| {
            let _ = tx.send(e);
        }),
    )
    .expect("start watching");
    // Linux reports one change once its initial directory walk is done; let startup settle.
    drain(&rx, SETTLE);
    (handle, rx)
}

/// Collect events until none arrive for `quiet`.
fn drain(rx: &mpsc::Receiver<RepoEvent>, quiet: Duration) -> Vec<RepoEvent> {
    let mut out = Vec::new();
    while let Ok(e) = rx.recv_timeout(quiet) {
        out.push(e);
    }
    out
}

/// Wait for the first event, then collect any that follow within `SETTLE`.
fn next_events(rx: &mpsc::Receiver<RepoEvent>) -> Vec<RepoEvent> {
    let deadline = Instant::now() + TIMEOUT;
    match rx.recv_timeout(deadline - Instant::now()) {
        Ok(first) => {
            let mut v = vec![first];
            v.extend(drain(rx, SETTLE));
            v
        }
        Err(_) => Vec::new(),
    }
}

fn changed(worktree: bool, git: bool) -> RepoEvent {
    RepoEvent::Changed { worktree, git }
}

#[test]
fn editing_a_tracked_file_reports_one_worktree_change() {
    let repo = repo_with_ignores();
    let (_h, rx) = start(&repo);
    repo.write("src/a.ts", "a\nb\n");
    assert_eq!(next_events(&rx), vec![changed(true, false)]);
}

#[test]
fn files_in_new_folders_are_seen() {
    let repo = repo_with_ignores();
    let (_h, rx) = start(&repo);
    repo.write("src/deep/new/file.ts", "x\n");
    assert_eq!(next_events(&rx), vec![changed(true, false)]);
    // The new folder is now watched too.
    repo.write("src/deep/new/file.ts", "y\n");
    assert_eq!(next_events(&rx), vec![changed(true, false)]);
}

#[test]
fn ignored_output_reports_nothing() {
    let repo = repo_with_ignores();
    let (_h, rx) = start(&repo);
    for i in 0..500 {
        repo.write(&format!("target/debug/deps/f{i}.o"), "obj");
    }
    // A brand-new ignored folder too.
    repo.write("node_modules/pkg/index.js", "x");
    assert_eq!(drain(&rx, Duration::from_secs(3)), vec![]);
}

#[test]
fn commit_reports_a_git_change() {
    let repo = repo_with_ignores();
    let (_h, rx) = start(&repo);
    repo.write("src/a.ts", "committed\n");
    drain(&rx, SETTLE);
    repo.commit_all("change a");
    let events = next_events(&rx);
    assert!(
        events.iter().any(|e| matches!(e, RepoEvent::Changed { git: true, .. })),
        "{events:?}"
    );
}

#[test]
fn branch_created_reports_a_git_change() {
    let repo = repo_with_ignores();
    let (_h, rx) = start(&repo);
    repo.git(&["branch", "feature"]);
    assert_eq!(next_events(&rx), vec![changed(false, true)]);
}

#[test]
fn dropping_the_handle_stops_events() {
    let repo = repo_with_ignores();
    let (h, rx) = start(&repo);
    drop(h);
    repo.write("src/a.ts", "after drop\n");
    assert!(drain(&rx, Duration::from_secs(2)).is_empty());
}

#[test]
fn watchers_replace_and_ignore_stale_unwatch() {
    let a = repo_with_ignores();
    let b = repo_with_ignores();
    let watchers = Watchers::default();
    let (tx_a, rx_a) = mpsc::channel();
    let id_a = watchers
        .watch(Git::default(), a.path(), Box::new(move |e| drop(tx_a.send(e))))
        .unwrap();
    let (tx_b, rx_b) = mpsc::channel();
    let id_b = watchers
        .watch(Git::default(), b.path(), Box::new(move |e| drop(tx_b.send(e))))
        .unwrap();
    assert_ne!(id_a, id_b);
    watchers.unwatch(id_a); // stale: must not stop b
    assert_eq!(watchers.current_id(), Some(id_b));
    drain(&rx_b, SETTLE);
    drain(&rx_a, Duration::from_millis(100));

    a.write("src/a.ts", "a changed\n");
    b.write("src/a.ts", "b changed\n");
    assert_eq!(next_events(&rx_b), vec![changed(true, false)]);
    assert!(drain(&rx_a, Duration::from_secs(1)).is_empty());

    watchers.unwatch(id_b);
    assert_eq!(watchers.current_id(), None);
}

#[test]
fn app_reads_do_not_trigger_events_or_change_the_repo() {
    use differential_lib::{changes, files, git};
    let repo = repo_with_ignores();
    repo.write("src/a.ts", "edited\n");
    repo.write("src/new.ts", "new\n");
    repo.git(&["add", "src/new.ts"]);
    let status_before = repo.git(&["status", "--porcelain"]);
    let index_before = std::fs::read(repo.path().join(".git/index")).unwrap();

    let (_h, rx) = start(&repo);
    let g = Git::default();
    let root = repo.root();
    for _ in 0..3 {
        let cs = changes::list_changes(&g, &root, "HEAD").unwrap();
        assert_eq!(cs.files.len(), 2);
        files::list_files(&g, &root).unwrap();
        git::list_refs(&g, &root).unwrap();
        files::view_file(&root, "src/a.ts", false).unwrap();
    }
    assert_eq!(drain(&rx, Duration::from_secs(2)), vec![], "the app's own reads caused events");
    assert_eq!(repo.git(&["status", "--porcelain"]), status_before);
    assert_eq!(std::fs::read(repo.path().join(".git/index")).unwrap(), index_before);
}
