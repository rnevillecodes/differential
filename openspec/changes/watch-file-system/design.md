# Design

## Context

See proposal.md for motivation; requirements are in `specs/repo-watch`, `specs/diff-viewer`, `specs/file-explorer`, and `specs/base-picker`.

Current state that shapes the approach:

- **Backend**: Tauri v2, Rust. All git access goes through `git::runner::Git`, which already sets `GIT_OPTIONAL_LOCKS=0`, so the app's own `git status`/`diff` never rewrite `.git/index`. Long-lived per-app state lives in managed state (`commands::Terminals`), and streaming to the UI uses a Tauri `Channel` passed into a command (`terminal_spawn`). There is no file watching today and no `notify` dependency.
- **Frontend**: `src/store.ts` (zustand) owns loading. `refresh()` calls `loadChanges(root, base, keepTabs=true)`, which bumps `generation`, sets `loading: true`, and replaces `files` with `{}` — so the active diff falls back to "Loading…" (`DiffPane.tsx`) and is re-fetched. `DiffView` is keyed by `` `${baseSha}:${file.id}:${path}` ``; `file.id` is the index in the change list, so any reorder or a moved `HEAD` remounts the view and loses scroll position and context expansion. Unchanged-file views (`views`) already keep "ready" content during a reload (`loadView` with `keep`). `closeVanished()` already closes tabs of files that disappeared. `invalidateGraph()` reloads the commit graph if open, else marks it stale. `loadRefs()` reloads refs (and thus the toolbar branch).
- The app is used primarily on Windows (README examples), but also builds for Linux and macOS.

## Goals / Non-Goals

**Goals:**
- One watcher per open repository in the backend, emitting coalesced, classified, ignore-filtered notifications over a channel.
- A "quiet" refresh path in the store that updates data in place without loading states, scroll loss, or remounts.
- Always-on watching with no user setting; a toolbar notice appears only when watching is unavailable.

**Non-Goals:**
- Per-file incremental diffing: a notification triggers the same full `list_changes` (+ active tab reload) as a manual refresh. `list_changes` is already fast enough for manual refresh; making it incremental is a separate optimisation.
- Telling the UI *which* files changed. Notifications carry only the change kind.
- Watching files outside the repository (e.g. global git config, `core.excludesFile`).
- Preserving context-expansion state in a diff whose content changed (see Decisions).

## Decisions

### 1. `notify` crate with our own coalescer, not `notify-debouncer-full`
Use `notify` (raw events) and a small coalescing thread: collect events; flush 300 ms after the last event, or 2 s after the first unflushed event, whichever comes first. This gives the spec's "≤1 s after settle, at least every 3 s under load" with margin. The coalescer is a pure function over (event, time) → flush decisions so it can be unit-tested with a fake clock.
- *Alternative*: `notify-debouncer-full` — settles only on quiet, has no max-wait, so continuous activity (an agent streaming writes, a long build touching tracked files) would never notify.
- *Alternative*: polling `git status` on a timer — simple and portable, but costly on large repos and laggy; kept only implicitly as the manual-refresh fallback.

### 2. Recursive native watch on Windows/macOS; pruned per-directory watch on Linux
- Windows (`ReadDirectoryChangesW`) and macOS (FSEvents) watch a whole tree with one handle, so `RecursiveMode::Recursive` on the repository root is cheap even with huge ignored folders; ignored events are discarded by filtering (Decision 4).
- On Linux, inotify needs one watch per directory and `notify`'s recursive mode would register every folder under `node_modules/`, `target/`, etc., hitting `max_user_watches` on real projects. Instead, walk the tree once and add `NonRecursive` watches only for directories that are not ignored (ignored directories come from `git ls-files --others --ignored --exclude-standard --directory`), and add a watch when a create event reveals a new non-ignored directory.
- *Alternative*: recursive everywhere — simpler, but fails or degrades exactly on the Linux repos with big build outputs.

### 3. Git directory handling and classification
Resolve the git directory and common directory once with `git rev-parse --absolute-git-dir --git-common-dir` (handles linked worktrees, where `.git` is a file and refs live elsewhere). Watch them (they are inside the root in the common case and covered by the tree watch; on Linux, `.git` itself and `refs/**` are added explicitly, never `objects/`). Classify each event path:
- under a git dir → **git** if it is `HEAD`, `index`, `packed-refs`, or under `refs/`; otherwise dropped (`objects/`, `logs/`, `hooks/`, `FETCH_HEAD`, `ORIG_HEAD`, `*.lock`, …). Lock files are dropped because the subsequent rename onto the real file produces its own event.
- elsewhere in the root → **worktree candidate**, subject to ignore filtering.
- *Alternative*: treat any `.git/` event as git — `objects/` churn during commits/fetch/gc would cause redundant reloads.

### 4. Ignore filtering via `git check-ignore`, with an ignored-directory prefix cache
At flush time, worktree candidates are checked: first against a cache of known ignored directory prefixes (from the listing in Decision 2, refreshed when any `.gitignore`/`.git/info/exclude` changes); the rest are piped to one `git check-ignore --stdin -z` invocation (without `--no-index`, so tracked files are never treated as ignored). As soon as one path is not ignored, the batch counts as a worktree change; paths are checked in bounded chunks so a 10,000-file burst does not build a giant command. Paths named `.gitignore` short-circuit to a worktree change. `check-ignore` is read-only and runs with the runner's lock-free environment.
- *Alternative*: re-implement gitignore matching (e.g. the `ignore` crate) — fast, but can diverge from git (global excludes, `core.excludesFile`, negations); the codebase's rule is "git is the source of truth".

### 5. Command and event shape
- `watch_repo(root, on_event: Channel<RepoEvent>) -> Result<u32>` replaces any current watcher and returns a watch id; `unwatch_repo(id)` stops it if still current. State lives in a new managed `Watchers` (a `Mutex<Option<(id, WatchHandle)>>`); dropping the handle stops the notify watcher and the coalescer thread. Watching is also stopped on `RunEvent::Exit`, next to `Terminals::close_all`.
- `RepoEvent` (ts-rs generated into `src/model/RepoEvent.ts`): `{ kind: "changed", worktree: bool, git: bool } | { kind: "unavailable", message: string }`. A fatal notify error after start (the watched root removed, watches lost) is sent as `unavailable`. An event-queue overflow (`Rescan` flag) is instead reported as `changed { worktree: true, git: true }`, because a full refresh is the correct recovery.
- *Alternative*: Tauri global `emit` events — works, but the channel pattern is already used, scopes events to one subscription, and avoids stale-repo events reaching a newly opened repo.

### 6. Store: watcher lifecycle, always on
- `openPath` starts watching after `openRepo` succeeds (watch failures do not fail the open). A `watchGen` guards the callback so events from a previous repository are ignored even if they arrive late; the previous watch is stopped first.
- There is no live/paused flag. Quiet updates (D7, D8) keep the screen stable, which removes the main reason to pause, and one fewer mode means fewer states to test.
- `watchStatus: { kind: "active" } | { kind: "unavailable", message }` drives a toolbar notice rendered only for `unavailable`.
- *Alternative considered*: a persisted "Live" toggle, on by default. Rejected: nothing is gained by pausing once updates no longer disturb the view, and `Ctrl+R` already covers the case where watching fails.

### 7. Store: quiet refresh — single-flight, keep-until-replaced
- `autoRefresh(kinds)` merges kinds into a pending set. If no auto refresh is running, it starts one; otherwise the pending set is picked up when the current one finishes (one trailing run). This prevents sustained activity from cancelling every in-flight load via `generation` and never finishing. A manual refresh or base/repo change bumps `generation` and supersedes it as today.
- Quiet `loadChanges` does not set `loading`, and does not clear `files`. It maps existing `FileLoad`s from old ids to new ids by display path, keeping them on screen; only the active tab's diff is re-fetched (other tabs reload when activated, as today) and swapped in when ready. If the new `ChangeSet` and the new active diff are equal to the old ones, the old objects are kept so React does not re-render.
- If `git` is set, it also calls `loadRefs()` (toolbar branch, base picker) and `invalidateGraph()`.
- Errors in a quiet refresh keep current data and show nothing, except `badRevision` (base deleted), which sets `baseError` as today. Transient failures (e.g. `index.lock` mid-rebase) are retried by the next notification.
- Manual refresh adopts the same keep-until-replaced data handling (no "Loading…" blanking of the diff) but still shows the toolbar's loading state.

### 8. Views: stable keys
`DiffView`'s key becomes the display path (plus the view mode only if needed), so a new `baseSha` or list order does not remount it; the virtualizer's scroll element persists and its scroll offset is clamped naturally when the row count shrinks. Context-expansion state resets when the file's hunks change (compare the incoming `FileDiff` identity — unchanged diffs keep the same object per Decision 7) because expansion ranges refer to old line numbers. `FileView` is already keyed by path.

## Risks / Trade-offs

- **[WSL / network drives / some FUSE mounts don't deliver events]** → watcher may start but stay silent. Mitigation: manual refresh still works; on Linux, detect paths under `/mnt/<drive>` (9p/drvfs) and report `unavailable` with "file changes on this drive can't be watched", rather than silently showing stale data.
- **[Large repos make every notification a full `list_changes`]** → with an agent writing continuously, a refresh runs at most every ~2 s and never overlaps (single-flight). Acceptable for now; incremental diffing is a non-goal.
- **[Commit graph reloads from the top on every commit]** → `invalidateGraph()` resets pagination. Acceptable: commits are infrequent; a smarter merge is out of scope.
- **[Linux directory walk at open on huge trees]** → runs on a background thread after the diff is shown; events in not-yet-watched folders before the walk completes are missed only until the first refresh, which the walk triggers on completion (`changed {worktree: true}`) to close the gap.
- **[Editors' atomic saves (write temp + rename)]** → produce create/rename/delete events on temp files; coalescing collapses them, and temp files that are ignored are filtered. Non-ignored temp files may cause one extra (harmless) refresh.
- **[Context expansion lost when the shown file changes]** → deliberate simplification (Decision 8); scroll position is kept.

## Migration Plan

Behavior change rather than an opt-in: every user gets automatic updates. Nothing is persisted, so rollback is simply reverting the change.

Spec ordering: this change modifies the `terminal` capability that the in-flight `add-terminal-panel` change creates. Archive `add-terminal-panel` first, then this change. Its "No automatic actions" delta then replaces the terminal panel's no-auto-refresh clause.

## Open Questions

- Exact settle/max-wait values (300 ms / 2 s) may be tuned after trying it on a large repo; any values within the spec's bounds are acceptable.
