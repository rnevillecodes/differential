//! Which shell a new terminal runs, per platform.

use std::path::Path;

/// The program, arguments and extra environment a terminal session starts with.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

impl ShellSpec {
    /// A bare program with the terminal environment variables and no arguments.
    pub fn new(program: impl Into<String>, args: Vec<String>) -> Self {
        ShellSpec {
            program: program.into(),
            args,
            env: vec![
                ("TERM".into(), "xterm-256color".into()),
                ("COLORTERM".into(), "truecolor".into()),
            ],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Windows,
    MacOs,
    Other,
}

impl Os {
    pub fn current() -> Self {
        if cfg!(windows) {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::MacOs
        } else {
            Os::Other
        }
    }
}

/// Pick the shell: on Windows PowerShell 7 (`pwsh.exe`) when it is on `PATH`, else Windows
/// PowerShell; on macOS `$SHELL` (or zsh) as a login shell, since GUI apps get a minimal
/// environment; elsewhere `$SHELL`, falling back to `/bin/sh`.
pub fn resolve_shell(os: Os, env: &dyn Fn(&str) -> Option<String>, on_path: &dyn Fn(&str) -> bool) -> ShellSpec {
    let from_env = || env("SHELL").filter(|s| !s.trim().is_empty());
    match os {
        Os::Windows => {
            let program = if on_path("pwsh.exe") { "pwsh.exe" } else { "powershell.exe" };
            ShellSpec::new(program, vec!["-NoLogo".into()])
        }
        Os::MacOs => ShellSpec::new(from_env().unwrap_or_else(|| "/bin/zsh".into()), vec!["-l".into()]),
        Os::Other => ShellSpec::new(from_env().unwrap_or_else(|| "/bin/sh".into()), vec![]),
    }
}

/// The shell for this machine, from the real environment.
pub fn default_shell() -> ShellSpec {
    resolve_shell(Os::current(), &|k| std::env::var(k).ok(), &is_on_path)
}

/// Whether an executable with this file name exists in a `PATH` directory.
fn is_on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| Path::new(&dir).join(name).is_file()))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_with<'a>(shell: Option<&'a str>) -> impl Fn(&str) -> Option<String> + 'a {
        move |k| if k == "SHELL" { shell.map(String::from) } else { None }
    }

    #[test]
    fn windows_prefers_pwsh_when_on_path() {
        let s = resolve_shell(Os::Windows, &env_with(None), &|n| n == "pwsh.exe");
        assert_eq!(s.program, "pwsh.exe");
        assert_eq!(s.args, vec!["-NoLogo"]);
    }

    #[test]
    fn windows_falls_back_to_windows_powershell() {
        let s = resolve_shell(Os::Windows, &env_with(Some("/bin/bash")), &|_| false);
        assert_eq!(s.program, "powershell.exe");
    }

    #[test]
    fn macos_uses_shell_env_as_login_shell() {
        let s = resolve_shell(Os::MacOs, &env_with(Some("/opt/homebrew/bin/fish")), &|_| false);
        assert_eq!(s.program, "/opt/homebrew/bin/fish");
        assert_eq!(s.args, vec!["-l"]);
    }

    #[test]
    fn macos_falls_back_to_zsh() {
        let s = resolve_shell(Os::MacOs, &env_with(None), &|_| false);
        assert_eq!(s.program, "/bin/zsh");
        assert_eq!(s.args, vec!["-l"]);
    }

    #[test]
    fn other_uses_shell_env_without_args() {
        let s = resolve_shell(Os::Other, &env_with(Some("/usr/bin/bash")), &|_| false);
        assert_eq!(s.program, "/usr/bin/bash");
        assert!(s.args.is_empty());
    }

    #[test]
    fn other_falls_back_to_sh_for_missing_or_blank_shell() {
        assert_eq!(resolve_shell(Os::Other, &env_with(None), &|_| false).program, "/bin/sh");
        assert_eq!(resolve_shell(Os::Other, &env_with(Some("  ")), &|_| false).program, "/bin/sh");
    }

    #[test]
    fn sets_terminal_environment() {
        let s = resolve_shell(Os::Other, &env_with(None), &|_| false);
        assert!(s.env.contains(&("TERM".into(), "xterm-256color".into())));
        assert!(s.env.contains(&("COLORTERM".into(), "truecolor".into())));
    }
}
