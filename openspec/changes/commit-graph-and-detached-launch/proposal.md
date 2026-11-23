# Proposal

## Why

Differential compares the working tree against a base, but there is no way to see the repository's history: choosing a base means already knowing a branch name or SHA. Separately, launching `differential` from Git Bash ties up the terminal until the app closes, and closing that terminal kills the app. A GUI-subsystem release build does not help, because Git Bash (MSYS) waits for any child process.

## What Changes

- Add a **commit graph pane** on the right of the window, full height and beside the file pane and terminal. It shows the history of all branches and tags as lanes, one row per commit (graph, short SHA, subject, ref labels). The pane is toggled from the toolbar and with a shortcut, can be resized, and remembers whether it is open and its width.
- **Clicking a commit sets it as the diff base**, the same as picking a typed revision in the base picker. The commit that is currently the base is highlighted.
- The graph loads in pages as the user scrolls and reloads on refresh (`Ctrl+R`).
- Add a backend command that lists commits (SHA, parents, subject, author, date, ref labels) in topological order, in pages, without modifying the repository.
- **The app detaches from the launching terminal.** When `differential` is started, it relaunches itself as a detached background process and the launching process exits immediately, on Windows (including Git Bash) and on Unix. A `--wait` flag keeps the current foreground behaviour.

Out of scope: showing a commit's own diff (commit vs. its parent), changing terminal copy and paste, and putting `differential` on `PATH` or adding an installer.

## Capabilities

### New Capabilities
- `repo-history`: lists a repository's commits with their parents and ref labels, in topological order and in pages, without modifying the repository.
- `commit-graph`: the right-hand pane that draws the commit history as a lane graph, loads more on scroll, and sets the clicked commit as the diff base.
- `app-launch`: how the `differential` command starts: it detaches from the launching terminal by default, with a `--wait` opt-out.

### Modified Capabilities
<!-- None: setting the base from the graph reuses the existing base behaviour (typed revisions) without changing base-picker requirements. -->

## Impact

- **Backend (Rust):** new `src-tauri/src/git/log.rs` (commit listing and parsing), a lane-layout module, and a new `list_commits` command in `commands.rs` registered in `lib.rs`. The detach logic runs at the start of `run()`/`main.rs`, before Tauri starts, using `std::process::Command` with Windows creation flags (`DETACHED_PROCESS`, `CREATE_NEW_PROCESS_GROUP`, `CREATE_BREAKAWAY_FROM_JOB`) or `setsid` on Unix. `parse_args` learns `--wait`.
- **Frontend:** new `CommitGraph` component and graph rendering, a graph slice in `src/store.ts` (open state, width, pages, loading and error state), a toolbar toggle, a shortcut in `handleShortcut`, layout changes in `App.tsx` and `styles.css`, and new generated types in `src/model/`.
- **Docs:** README sections for the graph pane, the new shortcut, and launch behaviour (`--wait`).
- **Dependencies:** no new crates or npm packages expected. Unix `setsid` uses `std::os::unix::process::CommandExt::pre_exec` with `libc::setsid`, or `process_group(0)`; the choice is made in the design.
