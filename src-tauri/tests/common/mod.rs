//! Throwaway git repositories for integration tests.
#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub struct TestRepo {
    dir: tempfile::TempDir,
}

impl TestRepo {
    /// An empty repository on branch `main` with a fixed identity and no line-ending conversion.
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = TestRepo { dir };
        repo.git(&["init", "-q", "-b", "main"]);
        repo.git(&["config", "user.name", "Test"]);
        repo.git(&["config", "user.email", "test@example.com"]);
        repo.git(&["config", "core.autocrlf", "false"]);
        repo.git(&["config", "commit.gpgsign", "false"]);
        repo
    }

    /// A repository with one commit containing `files`.
    pub fn with_files(files: &[(&str, &str)]) -> Self {
        let repo = Self::new();
        for (p, c) in files {
            repo.write(p, c);
        }
        repo.commit_all("initial");
        repo
    }

    pub fn path(&self) -> &Path {
        self.dir.path()
    }

    pub fn root(&self) -> PathBuf {
        self.dir.path().to_path_buf()
    }

    pub fn write(&self, rel: &str, content: &str) {
        self.write_bytes(rel, content.as_bytes());
    }

    pub fn write_bytes(&self, rel: &str, content: &[u8]) {
        let p = self.path().join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, content).unwrap();
    }

    pub fn remove(&self, rel: &str) {
        fs::remove_file(self.path().join(rel)).unwrap();
    }

    pub fn rename(&self, from: &str, to: &str) {
        let to_p = self.path().join(to);
        if let Some(parent) = to_p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::rename(self.path().join(from), to_p).unwrap();
    }

    /// Run git in the repo, panicking on failure; returns trimmed stdout.
    pub fn git(&self, args: &[&str]) -> String {
        let out = Command::new("git")
            .current_dir(self.path())
            .args(args)
            .output()
            .expect("spawn git");
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    /// Stage everything and commit; returns the new commit SHA.
    pub fn commit_all(&self, msg: &str) -> String {
        self.git(&["add", "-A"]);
        self.git(&["commit", "-q", "-m", msg]);
        self.git(&["rev-parse", "HEAD"])
    }
}
