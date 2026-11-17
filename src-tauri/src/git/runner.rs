//! Spawns the `git` executable with a fixed, read-only-safe environment.

use std::ffi::{OsStr, OsString};
use std::path::Path;
use std::process::{Command, Output};

use crate::error::{AppError, Result};

/// Handle to a `git` executable. `Git::default()` uses `git` from `PATH`.
#[derive(Debug, Clone)]
pub struct Git {
    exe: OsString,
}

impl Default for Git {
    fn default() -> Self {
        Git { exe: "git".into() }
    }
}

/// Raw result of a git invocation that completed (whatever its exit code).
#[derive(Debug)]
pub struct GitOutput {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl Git {
    /// Use a specific executable (mainly for tests).
    pub fn with_exe(exe: impl Into<OsString>) -> Self {
        Git { exe: exe.into() }
    }

    fn command(&self, cwd: &Path) -> Command {
        let mut cmd = Command::new(&self.exe);
        cmd.current_dir(cwd)
            // Never let git opportunistically refresh/write the index: we are read-only.
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("GIT_TERMINAL_PROMPT", "0")
            // Stable, English messages so error classification works.
            .env("LC_ALL", "C")
            .env("LANG", "C")
            .args(["--no-pager", "-c", "core.quotepath=false"]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        cmd
    }

    /// Run git and return its output regardless of exit status.
    pub fn run_raw<S: AsRef<OsStr>>(&self, cwd: &Path, args: &[S]) -> Result<GitOutput> {
        let out: Output = self.command(cwd).args(args).output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                // Either the executable or the working directory is missing.
                if cwd.exists() { AppError::GitNotFound } else { AppError::Io(format!("{} does not exist", cwd.display())) }
            } else {
                AppError::from(e)
            }
        })?;
        Ok(GitOutput {
            success: out.status.success(),
            stdout: out.stdout,
            stderr: String::from_utf8_lossy(&out.stderr).trim().to_string(),
        })
    }

    /// Run git feeding `input` on stdin, mapping a non-zero exit to an error.
    pub fn run_with_stdin<S: AsRef<OsStr>>(
        &self,
        cwd: &Path,
        args: &[S],
        input: &[u8],
    ) -> Result<Vec<u8>> {
        use std::io::Write;
        use std::process::Stdio;
        let mut child = self
            .command(cwd)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::GitNotFound
                } else {
                    AppError::from(e)
                }
            })?;
        let mut stdin = child.stdin.take().expect("piped stdin");
        let input = input.to_vec();
        // Write on another thread so a large output can't deadlock against our input.
        let writer = std::thread::spawn(move || stdin.write_all(&input));
        let out = child.wait_with_output()?;
        writer
            .join()
            .map_err(|_| AppError::Io("stdin writer panicked".into()))??;
        if out.status.success() {
            Ok(out.stdout)
        } else {
            Err(classify_failure(
                cwd,
                String::from_utf8_lossy(&out.stderr).trim(),
            ))
        }
    }

    /// Run git, mapping a non-zero exit to an error.
    pub fn run<S: AsRef<OsStr>>(&self, cwd: &Path, args: &[S]) -> Result<Vec<u8>> {
        let out = self.run_raw(cwd, args)?;
        if out.success {
            Ok(out.stdout)
        } else {
            Err(classify_failure(cwd, &out.stderr))
        }
    }

    /// Run git and return trimmed UTF-8 stdout.
    pub fn run_text<S: AsRef<OsStr>>(&self, cwd: &Path, args: &[S]) -> Result<String> {
        let out = self.run(cwd, args)?;
        Ok(String::from_utf8_lossy(&out).trim().to_string())
    }
}

/// Map git's stderr to the most specific error we know about.
pub fn classify_failure(cwd: &Path, stderr: &str) -> AppError {
    if stderr.to_ascii_lowercase().contains("not a git repository") {
        AppError::NotARepo(cwd.display().to_string())
    } else {
        AppError::Git(stderr.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_executable_is_git_not_found() {
        let git = Git::with_exe("definitely-not-a-real-git-binary-xyz");
        let err = git.run(&std::env::temp_dir(), &["--version"]).unwrap_err();
        assert!(matches!(err, AppError::GitNotFound), "{err:?}");
    }

    #[test]
    fn missing_directory_is_io_error() {
        let err = Git::default().run(Path::new("Z:/no/such/dir/anywhere"), &["status"]).unwrap_err();
        assert!(matches!(err, AppError::Io(_)), "{err:?}");
    }

    #[test]
    fn classifies_not_a_repo() {
        let err = classify_failure(Path::new("C:/x"), "fatal: not a git repository (or any of the parent directories): .git");
        assert!(matches!(err, AppError::NotARepo(_)));
        let err = classify_failure(Path::new("C:/x"), "fatal: something else");
        assert!(matches!(err, AppError::Git(ref m) if m == "fatal: something else"));
    }

    #[test]
    fn runs_real_git() {
        let v = Git::default().run_text(&std::env::temp_dir(), &["--version"]).unwrap();
        assert!(v.starts_with("git version"), "{v}");
    }
}
