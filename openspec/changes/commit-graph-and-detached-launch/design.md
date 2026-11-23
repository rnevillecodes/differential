# Design

## Context

- Git access goes through `Git` in `src-tauri/src/git/runner.rs` (fixed env, `GIT_OPTIONAL_LOCKS=0`, no console window). Each read has a small module (`refs.rs`, `repo.rs`) with a pure parser tested on fixed text, plus integration tests in `src-tauri/tests/` against throwaway repositories.
- `ChangeSet` already carries `baseSha`, the commit the base resolved to, so the graph can highlight the base without another lookup.
- `store.setBase(rev)` recomputes the diff for any revision. The base picker displays the base string as given.
- The window layout is `.main` = `Sidebar | .workspace(DiffPane / TerminalPanel)`. The terminal panel already has the resize-handle and persisted-size pattern (`differential.terminal*` keys, clamped drag) that the graph pane can copy.
- `@tanstack/react-virtual` is already a dependency and is used for long lists.
- `main.rs` uses the Windows GUI subsystem only in release builds. Git Bash (MSYS) waits for any child process and can end the whole process tree when its window closes, so subsystem alone does not detach (see proposal.md - Why).

## Goals / Non-Goals

**Goals:**
- History listing that stays a thin, read-only git wrapper, consistent with `refs.rs`.
- Graph layout that continues correctly across pages without re-laying out what is already loaded.
- Smooth scrolling for histories of tens of thousands of commits.
- A detach mechanism with no new launcher files and no change to `tauri dev`.

**Non-Goals:**
- Very large monorepos (hundreds of thousands of commits) being as fast as small ones. Correctness is required; speed there is best effort.
- Filtering the graph (by branch, author, or path) and searching it.
- Single-instance behaviour: running `differential` twice opens two windows, as today.

## Decisions

### 1. History listing: `git log` with offset paging, labels from `for-each-ref`

`list_commits(root, offset, limit)` runs:

```
git log --branches --remotes --tags [HEAD] --topo-order --skip=<offset> --max-count=<limit+1>
        --format=%H%x00%h%x00%P%x00%an%x00%aI%x00%s
```

- `HEAD` is added only when it resolves to a commit, using the existing check in `repo.rs`. If there is no `HEAD` commit and no refs, return an empty page without running `git log`, which would otherwise fail on an unborn branch.
- `--branches --remotes --tags` rather than `--all`, so `refs/stash`, notes, and other private refs do not add stray commits.
- Asking for `limit + 1` gives `hasMore` without a count query.
- Labels: one `for-each-ref` over `refs/heads`, `refs/remotes`, and `refs/tags` with `%(objectname)` and `%(*objectname)` (the peeled target of an annotated tag). This builds a map from SHA to labels, filtered to the page's commits. It reuses the name, rev, and kind rules and the symref exclusion from `refs.rs`; factor the shared parsing out rather than duplicating it. Each label carries `rev`, git's unambiguous short refname, for clicking.
- Result type `CommitPage { commits: CommitInfo[], hasMore }`. `CommitInfo { sha, shortSha, parents, author, date, subject, labels: RefLabel[], head }`. All types are exported to `src/model/` with ts-rs.
- Page size is 500.

*Alternatives:* `%D` decorations in `git log`. Rejected: its text form (`HEAD -> main, tag: v1.0, origin/HEAD`) is awkward to parse reliably for names containing `, ` or ` -> `. A long-lived streaming `git log` process. Rejected: much more lifecycle code for a speed-up only very large repos need.

### 2. Lane layout in TypeScript, incremental across pages

Earlier discussion leaned towards Rust, but layout state has to persist between pages on the client, and the output feeds rendering directly. So the layout is a pure TS module, `src/graph/layout.ts`, tested with Vitest:

```
layout(commits, state) -> { rows, state }
state = lanes: (sha expected | null)[]  + colour per lane
```

For each commit, in order:
1. The commit's column is the leftmost lane expecting its SHA. Any other lanes expecting it close into that column (a branch point when read downwards). If no lane expects it (a branch tip), it takes the first free lane, or a new one on the right.
2. Its lane then expects its first parent and keeps its colour.
3. Each further parent (a merge) joins an existing lane already expecting that parent, or opens a new lane with a new colour.
4. Trailing empty lanes are trimmed.

Each row records its column and colour, plus the edges from row top to row centre (incoming lanes) and from centre to row bottom (outgoing lanes). That is all a row needs to draw itself, independently of its neighbours. Appending a page calls `layout(newCommits, lastState)`, so loaded rows never change.

*Alternative:* layout in Rust. Rejected for the reason above; the backend stays a plain lister.

### 3. Rendering: virtualized rows, one inline SVG per row

- The `CommitGraph` pane uses `@tanstack/react-virtual` with a fixed 24 px row height. When the last virtual item comes within about 50 rows of the end, it loads the next page.
- Each row has a small SVG: lane width 12 px, lines for its edges, and a dot for the commit (hollow when it is `HEAD`). Then come the short SHA, label chips, and the subject (truncated with an ellipsis).
- The graph column width is `min(maxLanesInViewport, 16) × 12px`. Lanes beyond 16 are clipped, with a fade at the edge.
- Lane colours are a fixed set of 8 CSS custom properties on `:root`, redefined for dark mode, cycling by lane colour index.
- Label chips are styled per kind (local, remote, tag). Rows have `title` set to the full SHA, author, and date.
- The base row gets an `is-base` class when `row.sha === changes.baseSha`.

### 4. Store and layout wiring

- New store state: `graphOpen` and `graphWidth`, persisted as `differential.graphOpen` and `differential.graphWidth` like the terminal keys. Also `graph: { rows, state, hasMore, loading, error, stale }` and a load-generation counter. Responses from an older generation (refresh, repo switch) are dropped.
- Loading: showing the pane with a repo and nothing loaded (or `stale` set) loads page 1. `refresh()` and `openPath()` reset the graph; if the pane is hidden they only mark it stale, so a hidden pane costs nothing.
- Click a row: `setBase(shortSha)`. Click a label: `setBase(label.rev)`. The short SHA keeps the toolbar's base display readable with no base-picker change. Git abbreviates it to be unambiguous at listing time. Enter on a focused row does the same as a click.
- Toggle: `toggleGraph()` is a no-op without a repo. The toolbar button sits next to the terminal button, and `Ctrl+G` is added to `handleShortcut`. It is inside the existing early return for `[data-terminal]`, so a focused terminal keeps the key.
- Layout: `.main` becomes `Sidebar | .workspace | GraphPane`. The drag handle is on the pane's left edge. Width is clamped to `[240px, main width − sidebar − 400px]` so the file pane keeps room, the same approach as `MIN_FILE_PANE_HEIGHT`.

### 5. Detach: relaunch self, release builds only

At the very start of `run()`, before Tauri is built:

```
if release build && !args.wait && env DIFFERENTIAL_DETACHED unset && launched with stdio:
    spawn current_exe() with the same args, same cwd,
          stdin/stdout/stderr = null, env DIFFERENTIAL_DETACHED=1,
          Windows: DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB
          Unix:    pre_exec(setsid)
    on spawn success: exit(0)
    on spawn failure (Windows): retry once without CREATE_BREAKAWAY_FROM_JOB
    still failing: fall through and run in the foreground
```

- **Release builds only** (`cfg(not(debug_assertions))`). `tauri dev` runs the debug binary and tracks it as the app process; detaching would make the dev server think the app quit.
- **`CREATE_BREAKAWAY_FROM_JOB`** is what survives closing mintty or Windows Terminal: they place children in a job that is killed with the window. Some jobs forbid breakaway, which produces access denied, hence the retry without it.
- **"Launched with stdio":** on Windows, skip the relaunch when the process has no standard handles (started from Explorer or a shortcut), because there is nothing to detach from. On Unix, skip when none of stdin, stdout, or stderr is a terminal. This avoids a pointless second process start for desktop launches.
- **Environment guard** `DIFFERENTIAL_DETACHED=1` prevents a relaunch loop. The child removes it from its environment immediately, so terminals the app spawns do not inherit it.
- **Arguments** are passed through unchanged. The child gets the same cwd, so relative paths resolve the same way `parse_args` already handles them. `--wait` is parsed into `InitialArgs.wait` and ignored by the frontend.
- **Unix `setsid`** needs `libc` (already in the dependency tree via `portable-pty`). Add it as a direct `[target.'cfg(unix)'.dependencies]` entry. `process_group(0)` alone was rejected: it survives Ctrl+C but not the SIGHUP sent when the terminal closes.
- The logic goes in its own module, `src-tauri/src/launch.rs`. The decision ("should relaunch?") is a pure function of build, args, env, and stdio state, unit-tested. The spawn itself is verified manually.

*Alternatives:* a `differential.cmd` shim using `start` (Windows-only, an extra file to install, and Git Bash would need its own script). A GUI subsystem for all builds (does not fix Git Bash, and loses dev console logs).

## Risks / Trade-offs

- [`--skip` makes git redo the topological sort for every page, which is O(total commits) per page] → Fine for typical repos (well under a second for tens of thousands of commits). It is noted as a non-goal for huge repos. A streaming process can replace it later behind the same command.
- [Lane explosion in histories with many parallel branches] → The 16-lane clip with a fade keeps rows readable. Lanes still lay out correctly beyond the clip.
- [The short SHA as base becomes ambiguous if the repo later grows a colliding prefix] → Practically negligible at git's chosen length. A refresh re-resolves the base and reports an error inline, as for any typed revision.
- [Antivirus or EDR flags a self-relaunching process] → It's a plain `CreateProcess` of the same signed binary with no injection. If it is reported, `--wait` is the escape hatch.
- [Detached app writes nowhere when it panics at startup] → The same as today's release build, which has no console. Not made worse.
- [Two processes briefly exist at launch] → The parent exits immediately after a successful spawn. The extra start costs tens of milliseconds.

## Migration Plan

Nothing to migrate. New persisted keys default to the pane hidden. Users who relied on the release build blocking their terminal can add `--wait`. Rollback means reverting the change; no data formats are affected.
