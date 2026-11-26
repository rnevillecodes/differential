//! Listing and viewing working-tree files against throwaway repositories.

mod common;

use common::TestRepo;
use differential_lib::content::limits;
use differential_lib::error::AppError;
use differential_lib::files::{list_files, read_image, view_file, FileView};
use differential_lib::git::Git;

fn sorted(mut v: Vec<String>) -> Vec<String> {
    v.sort();
    v
}

#[test]
fn lists_tracked_and_untracked_files() {
    let repo = TestRepo::with_files(&[("src/a.ts", "a\n"), ("README.md", "r\n")]);
    repo.write("src/b.ts", "b\n");
    let files = sorted(list_files(&Git::default(), repo.path()).unwrap());
    assert_eq!(files, vec!["README.md", "src/a.ts", "src/b.ts"]);
}

#[test]
fn excludes_ignored_files() {
    let repo = TestRepo::with_files(&[(".gitignore", "dist/\n"), ("a.txt", "a\n")]);
    repo.write("dist/out.js", "x\n");
    let files = list_files(&Git::default(), repo.path()).unwrap();
    assert!(!files.iter().any(|f| f.starts_with("dist/")), "{files:?}");
}

#[test]
fn lists_staged_and_unstaged_file_once() {
    let repo = TestRepo::with_files(&[("a.txt", "one\n")]);
    repo.write("a.txt", "two\n");
    repo.git(&["add", "a.txt"]);
    repo.write("a.txt", "three\n");
    let files = list_files(&Git::default(), repo.path()).unwrap();
    assert_eq!(files, vec!["a.txt"]);
}

#[test]
fn excludes_files_deleted_from_disk() {
    let repo = TestRepo::with_files(&[("keep.txt", "k\n"), ("gone.txt", "g\n")]);
    repo.remove("gone.txt");
    let files = list_files(&Git::default(), repo.path()).unwrap();
    assert_eq!(files, vec!["keep.txt"]);
}

#[test]
fn lists_paths_with_spaces_and_non_ascii() {
    let repo = TestRepo::with_files(&[("my dir/naïve file.txt", "x\n")]);
    repo.write("日本/新しい.md", "y\n");
    let files = sorted(list_files(&Git::default(), repo.path()).unwrap());
    assert_eq!(files, vec!["my dir/naïve file.txt", "日本/新しい.md"]);
}

#[test]
fn views_text_and_normalizes_crlf() {
    let repo = TestRepo::with_files(&[("a.ts", "let x = 1;\n")]);
    repo.write("win.txt", "a\r\nb\r\n");
    assert_eq!(
        view_file(repo.path(), "a.ts", false).unwrap(),
        FileView::Text { content: "let x = 1;\n".into() }
    );
    assert_eq!(
        view_file(repo.path(), "win.txt", false).unwrap(),
        FileView::Text { content: "a\nb\n".into() }
    );
}

#[test]
fn views_binary() {
    let repo = TestRepo::new();
    repo.write_bytes("img.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR");
    assert_eq!(view_file(repo.path(), "img.png", false).unwrap(), FileView::Binary);
}

#[test]
fn views_large_only_with_force() {
    let repo = TestRepo::new();
    let line = "0123456789abcdef\n";
    let content = line.repeat((limits::MAX_FILE_BYTES as usize) / line.len() + 10);
    repo.write("big.txt", &content);
    let size = content.len() as u64;
    assert_eq!(view_file(repo.path(), "big.txt", false).unwrap(), FileView::Large { size });
    assert_eq!(
        view_file(repo.path(), "big.txt", true).unwrap(),
        FileView::Text { content }
    );
}

#[test]
fn large_binary_is_binary() {
    let repo = TestRepo::new();
    let mut bytes = vec![0u8; 16];
    bytes.resize(limits::MAX_FILE_BYTES as usize + 100, b'a');
    repo.write_bytes("big.bin", &bytes);
    assert_eq!(view_file(repo.path(), "big.bin", false).unwrap(), FileView::Binary);
}

#[test]
fn views_missing_and_directories() {
    let repo = TestRepo::with_files(&[("sub/a.txt", "a\n")]);
    assert_eq!(view_file(repo.path(), "nope.txt", false).unwrap(), FileView::Missing);
    assert_eq!(view_file(repo.path(), "sub", false).unwrap(), FileView::NotAFile);
}

#[test]
fn rejects_paths_outside_the_repository() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n")]);
    let err = view_file(repo.path(), "../secrets.txt", false).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "{err:?}");
}

#[test]
fn browsing_leaves_the_repository_untouched() {
    let repo = TestRepo::with_files(&[("a.txt", "a\n"), ("sub/b.txt", "b\n"), ("c.txt", "c\n")]);
    repo.write("a.txt", "changed\n");
    repo.write("new.txt", "new\n");
    repo.remove("c.txt");

    // `git status` itself may refresh the index, so take it first, then the mtime.
    let status_before = repo.git(&["status", "--porcelain=v2"]);
    let index = repo.path().join(".git/index");
    let mtime_before = std::fs::metadata(&index).unwrap().modified().unwrap();
    let index_bytes_before = std::fs::read(&index).unwrap();
    std::thread::sleep(std::time::Duration::from_millis(50));

    let files = list_files(&Git::default(), repo.path()).unwrap();
    for f in &files {
        view_file(repo.path(), f, true).unwrap();
    }

    assert_eq!(std::fs::metadata(&index).unwrap().modified().unwrap(), mtime_before);
    assert_eq!(std::fs::read(&index).unwrap(), index_bytes_before);
    assert_eq!(repo.git(&["status", "--porcelain=v2"]), status_before);
}

const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, b'I', b'H', b'D', b'R'];

#[test]
fn reads_image_bytes_exactly() {
    let repo = TestRepo::new();
    repo.write_bytes("docs/arch.png", PNG);
    repo.write("logo.SVG", "<svg xmlns='http://www.w3.org/2000/svg'/>");
    assert_eq!(read_image(repo.path(), "docs/arch.png").unwrap(), PNG);
    assert!(read_image(repo.path(), "logo.SVG").is_ok());
}

#[test]
fn refuses_non_images_escapes_and_missing_files() {
    let repo = TestRepo::with_files(&[("src/main.ts", "x\n")]);
    for path in ["src/main.ts", "../x.png", "/etc/x.png", "gone.png"] {
        assert!(read_image(repo.path(), path).is_err(), "{path}");
    }
    std::fs::create_dir_all(repo.path().join("dir.png")).unwrap();
    assert!(read_image(repo.path(), "dir.png").is_err());
}

#[test]
fn refuses_oversized_images() {
    let repo = TestRepo::new();
    repo.write_bytes("big.jpg", &vec![0u8; limits::MAX_IMAGE_BYTES as usize + 1]);
    repo.write_bytes("ok.jpg", &vec![0u8; limits::MAX_IMAGE_BYTES as usize]);
    assert!(matches!(read_image(repo.path(), "big.jpg"), Err(AppError::Invalid(_))));
    assert!(read_image(repo.path(), "ok.jpg").is_ok());
}

#[cfg(unix)]
#[test]
fn refuses_symlinks_leaving_the_repository() {
    let outside = TestRepo::new();
    outside.write_bytes("secret.png", PNG);
    let repo = TestRepo::new();
    repo.write_bytes("real.png", PNG);
    std::os::unix::fs::symlink(outside.path().join("secret.png"), repo.path().join("link.png")).unwrap();
    std::os::unix::fs::symlink(repo.path().join("real.png"), repo.path().join("inside.png")).unwrap();
    assert!(read_image(repo.path(), "link.png").is_err());
    assert_eq!(read_image(repo.path(), "inside.png").unwrap(), PNG);
}
