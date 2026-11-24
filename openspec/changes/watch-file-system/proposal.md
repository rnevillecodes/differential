# Proposal

## Why

Differential exists to review what a coding agent changes, but today the view is a snapshot: after the agent (or the user in the built-in terminal) edits files, commits, or switches branches, nothing updates until the user presses Refresh (`Ctrl+R`). Reviewing an agent while it works means pressing refresh again and again and still looking at stale diffs in between. The app should watch the repository and keep the diff, file tree, open files, branch, and history in step with the disk on its own.

## What Changes

- The backend watches the open repository's working tree and git metadata (`HEAD`, refs, index) and tells the UI when something relevant changed. Events are coalesced (debounced) so a burst of writes, such as an agent saving many files or a build, causes one update, not hundreds.
- Changes to files git ignores (e.g. `node_modules/`, `target/`, `dist/`) do not cause updates; changes inside `.git/` count only when they can affect what is shown (`HEAD`, refs, packed refs, index).
- On a working-tree change the UI refreshes in place: the changed-file list, totals, file tree, and the open tabs (diffs and unchanged-file views) are reloaded. The file on screen keeps showing its current content until the new content arrives — no "Loading…" flash — and keeps its scroll position when the file still exists.
- On a git metadata change (commit, checkout, branch create/delete, `git add`) the UI also reloads the branch shown in the toolbar, the base picker's ref list, and the commit graph.
- Watching is the application's standard behavior: always on for the open repository, with no setting or toggle to turn it off. Because updates are quiet (no loading flash, scroll kept, active tab unchanged), there is nothing to gain from pausing them. Manual refresh (`Ctrl+R`) remains as a fallback.
- Watching stops when another repository is opened or the app exits. If the watcher cannot be started (unsupported filesystem, OS watch limit), the toolbar shows that updates are unavailable and why, and manual refresh is used.
- **Supersedes the terminal panel's "no automatic refresh" rule** (from the in-flight `add-terminal-panel` change): file changes made by terminal commands now appear automatically, like any other change on disk. The app still never types into or runs commands in a terminal.
- README updated: the notes saying the diff, branch, and history only update on refresh (repository switching, terminal, commit graph sections) are replaced.

## Capabilities

### New Capabilities
- `repo-watch`: Watching an open repository's working tree and git metadata for changes, filtering out ignored and irrelevant paths, coalescing bursts, and notifying the UI with the kind of change (working tree vs. git metadata), without modifying the repository.

### Modified Capabilities
- `diff-viewer`: "Manual refresh" becomes the fallback beside always-on automatic refresh; new requirements for automatic updates, quiet in-place updates (displayed diff and scroll position kept), and showing when watching is unavailable.
- `file-explorer`: "Tree follows refresh and repository changes" now also follows automatic refreshes; an open unchanged file's contents update when the file changes on disk, and a deleted file's tab follows the existing vanished-tab behavior.
- `base-picker`: "Ref list stays current" reloads the refs when git metadata changes, not only on manual refresh.
- `terminal`: "No automatic actions" drops the clause that terminal activity does not refresh the diff. This capability is introduced by the in-flight `add-terminal-panel` change, so `add-terminal-panel` must be archived before this change.

## Impact

- **Rust backend** (`src-tauri`): new `watch` module and Tauri commands to start/stop watching a repository root, holding watcher state in managed app state (like `Terminals`); new dependency on the `notify` crate (plus its debouncer). Ignore filtering reuses the git runner (`git check-ignore --stdin`), keeping `GIT_OPTIONAL_LOCKS=0` so the app's own git reads never trigger events.
- **Frontend**: `src/api/index.ts` gains `watchRepo`/`unwatchRepo` (a Tauri `Channel` for events, mocked in tests); `src/store.ts` gains a "quiet" refresh path that keeps loaded diffs/views until replacements arrive, plus the watcher lifecycle; `Toolbar.tsx` gains an "updates unavailable" indicator shown only when watching fails.
- **Generated types**: a new ts-rs `RepoChange` event type in `src/model/`.
- **Docs**: README sections on repository switching, refresh, terminal, and commit graph.
- **Change ordering**: archive `add-terminal-panel` (which creates the `terminal` spec) before archiving this change, which modifies it. `add-terminal-panel`'s own artifacts are left as they are, since they record that change's decision at the time. Its pending manual check (task 7.2, "a terminal command editing a file changes the diff only after `Ctrl+R`") no longer applies once this change lands.
- No change to the read-only guarantee: watching only observes the file system.
