//! Detaching from the launching terminal.
//!
//! `differential` relaunches itself as a background process and the launching process exits at
//! once, so the terminal gets its prompt back and closing it does not end the app. A GUI-subsystem
//! build alone is not enough: Git Bash (MSYS) waits for any child, and terminals can end the whole
//! process tree (or job) when their window closes.

use std::process::{Command, Stdio};

/// Set in the relaunched process so it does not relaunch again.
pub const DETACHED_ENV: &str = "DIFFERENTIAL_DETACHED";

/// Whether to relaunch in the background: release builds only (`tauri dev` tracks the process it
/// started), not with `--wait`, not when already relaunched, and only when started with standard
/// streams (a launch from Explorer or a desktop shortcut has no terminal to detach from).
pub fn should_relaunch(release: bool, wait: bool, already_detached: bool, has_stdio: bool) -> bool {
    release && !wait && !already_detached && has_stdio
}

/// Whether this process was started with any standard stream attached.
#[cfg(windows)]
pub fn has_stdio() -> bool {
    use std::os::windows::io::AsRawHandle;
    // A process started without standard handles reports them as null.
    let handles = [
        std::io::stdin().as_raw_handle(),
        std::io::stdout().as_raw_handle(),
        std::io::stderr().as_raw_handle(),
    ];
    handles.iter().any(|h| is_usable_handle(*h as isize))
}

/// Whether a raw standard handle value refers to something (not null, not `INVALID_HANDLE_VALUE`).
#[cfg(windows)]
fn is_usable_handle(h: isize) -> bool {
    h != 0 && h != -1
}

/// Whether this process was started with any standard stream attached to a terminal.
#[cfg(not(windows))]
pub fn has_stdio() -> bool {
    use std::io::IsTerminal;
    std::io::stdin().is_terminal() || std::io::stdout().is_terminal() || std::io::stderr().is_terminal()
}

/// Relaunch in the background and exit when that is wanted and succeeds; otherwise return so the
/// app runs in the foreground. In the relaunched process, clears the guard variable so terminals
/// started by the app do not inherit it.
pub fn detach_if_needed(wait: bool) {
    let already_detached = std::env::var_os(DETACHED_ENV).is_some();
    if already_detached {
        // SAFETY: called at the very start of `run()`, before any other thread exists.
        unsafe { std::env::remove_var(DETACHED_ENV) };
    }
    if !should_relaunch(cfg!(not(debug_assertions)), wait, already_detached, has_stdio()) {
        return;
    }
    if relaunch().is_ok() {
        std::process::exit(0);
    }
}

fn base_command() -> std::io::Result<Command> {
    let mut cmd = Command::new(std::env::current_exe()?);
    cmd.args(std::env::args_os().skip(1))
        .current_dir(std::env::current_dir()?)
        .env(DETACHED_ENV, "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Ok(cmd)
}

#[cfg(windows)]
fn relaunch() -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let flags = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    // Leave the terminal's job so closing the terminal does not end the app. A job may forbid
    // breakaway (access denied), so try once more without it.
    match base_command()?.creation_flags(flags | CREATE_BREAKAWAY_FROM_JOB).spawn() {
        Ok(_) => Ok(()),
        Err(_) => base_command()?.creation_flags(flags).spawn().map(|_| ()),
    }
}

#[cfg(unix)]
fn relaunch() -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    let mut cmd = base_command()?;
    // SAFETY: setsid is async-signal-safe, as pre_exec requires.
    unsafe {
        cmd.pre_exec(|| {
            // A new session: no controlling terminal, so no SIGHUP when the terminal closes.
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
    cmd.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relaunches_only_from_a_terminal_in_release() {
        assert!(should_relaunch(true, false, false, true));
    }

    #[test]
    fn debug_builds_stay_in_the_foreground() {
        assert!(!should_relaunch(false, false, false, true));
    }

    #[test]
    fn wait_flag_stays_in_the_foreground() {
        assert!(!should_relaunch(true, true, false, true));
    }

    #[test]
    fn relaunched_process_does_not_relaunch_again() {
        assert!(!should_relaunch(true, false, true, true));
    }

    #[test]
    fn launch_without_standard_streams_does_not_relaunch() {
        assert!(!should_relaunch(true, false, false, false));
    }

    #[cfg(windows)]
    #[test]
    fn null_and_invalid_handles_are_not_usable() {
        assert!(!is_usable_handle(0));
        assert!(!is_usable_handle(-1));
        assert!(is_usable_handle(0x1234));
    }
}
