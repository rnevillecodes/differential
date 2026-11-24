# Tasks

## 1. Backend: dependency and event model

- [x] 1.1 Add `notify` (default features) to `src-tauri/Cargo.toml` and confirm `npm run test:rust` still builds and passes
- [x] 1.2 Create `src-tauri/src/watch/mod.rs` with the ts-rs `RepoEvent` enum (`changed { worktree, git }` / `unavailable { message }`, design D5), register the module in `lib.rs`, and verify the ts-rs export test generates `src/model/RepoEvent.ts` with that union

## 2. Backend: coalescing and classification (pure logic)

- [x] 2.1 Implement the coalescer (D1) as a pure state machine over (event kind, instant) that returns flush decisions: flush 300 ms after the last event or 2 s after the first unflushed one, merging kinds; verify with fake-clock unit tests: a 200-event burst in 500 ms yields one flush ≤1 s after the last event, 10 s of continuous events yields flushes ≤3 s apart, worktree+git kinds merge into one flush
- [x] 2.2 Implement path classification (D3) given the worktree root, git dir, and common dir: `HEAD`, `index`, `packed-refs`, `refs/**` → git; other git-dir paths (incl. `objects/`, `logs/`, `*.lock`, `FETCH_HEAD`) → dropped; everything else → worktree candidate; `.gitignore` / `info/exclude` flagged as ignore-rule changes; verify with unit tests covering each case plus a linked-worktree layout (`.git` file, refs in a common dir outside the root)
- [x] 2.3 Add a git helper resolving `--absolute-git-dir` and `--git-common-dir` for a root; verify with a `tempfile` repo test, including a `git worktree add` linked worktree

## 3. Backend: ignore filtering

- [x] 3.1 Add a git helper that lists ignored directories (`git ls-files --others --ignored --exclude-standard --directory`) and build the ignored-prefix cache (D4); verify with a temp repo test that `target/` and `node_modules/` are reported and a tracked file inside an ignored pattern is not
- [x] 3.2 Implement batch filtering: prefix cache first, then chunked `git check-ignore --stdin -z` stopping at the first non-ignored path, `.gitignore` paths short-circuiting to relevant; verify with temp repo tests: only-ignored batch → not relevant, mixed batch → relevant, deleted (non-existent) tracked path → relevant, ignore rule changed → cache rebuilt

## 4. Backend: watcher, commands, lifecycle

- [x] 4.1 Implement `WatchHandle`: notify watcher + coalescer thread + filter, sending `RepoEvent`s through a callback; recursive root watch on Windows/macOS, pruned per-directory `NonRecursive` watches on Linux that skip ignored dirs and `objects/`, add watches for newly created non-ignored dirs, and emit one `changed{worktree}` after the initial Linux walk (D2); map overflow/`Rescan` to `changed{worktree,git}` and fatal errors / start failures to `unavailable` with a readable message; on Linux report `unavailable` for repos under `/mnt/<drive>` (Risks); dropping the handle stops the thread. Verify with integration tests on a temp repo (generous timeouts): editing a tracked file → one worktree event; writing 500 files under an ignored dir → no event; `git commit` → event with `git: true`; dropping the handle → no further events
- [x] 4.2 Add managed `Watchers` state and the `watch_repo(root, on_event: Channel<RepoEvent>) -> u32` / `unwatch_repo(id)` commands (replace-on-watch, stale-id unwatch is a no-op), register them in `lib.rs`, and stop watching on `RunEvent::Exit`; verify with a mock-runtime test that a second `watch_repo` replaces the first and `unwatch_repo` with the old id leaves the new one running
- [x] 4.3 Verify read-only behavior: a test that watches a temp repo through edits and reloads (`list_changes`, `list_files`, `list_refs`) and asserts `git status --porcelain` and the index file's bytes are unchanged by the app, and that a `list_changes` call alone produces no event (no refresh loop)

## 5. Frontend: API and store

- [x] 5.1 Add `watchRepo(root, onEvent)` and `unwatchRepo(id)` to the `Api` interface and `tauriApi` (Channel-based, like `terminalSpawn`), and extend the test mock API with a controllable event emitter; verify `npm run typecheck` passes
- [x] 5.2 Store watcher lifecycle (D6), always on with no setting: start watching after `openRepo` succeeds (failure → `watchStatus: unavailable`, open still succeeds), stop the previous watch on repo switch, ignore events from a superseded `watchGen`; verify with `src/store.test.ts` cases: opening a repo starts watching it; events after switching repos are ignored; a rejected `watchRepo` leaves the diff loaded and sets `watchStatus`; an `unavailable` event sets `watchStatus`
- [x] 5.3 Implement quiet `autoRefresh(kinds)` (D7): single-flight with one merged trailing run, no `loading` flag, existing `FileLoad`s carried over by display path until the active tab's new diff arrives, unchanged `ChangeSet`/diff objects reused, `loadRefs()` + `invalidateGraph()` when `git`, transient errors swallowed and `badRevision` routed to `baseError`, vanished tabs closed; verify with store tests: no `loading`/"loading" file state during an auto refresh, active diff object replaced only when content differs, three events during one in-flight refresh cause exactly one trailing refresh, git kind reloads refs and graph, failing `listChanges` keeps the previous changes, deleted active file closes its tab
- [x] 5.4 Make manual `refresh()` use the same keep-until-replaced file handling while still setting `loading` for the toolbar; verify the existing refresh tests still pass and a new test shows the active file is not set to "loading" during a manual refresh
- [x] 5.5 Re-read open unchanged-file views on worktree changes, keeping current contents (existing `keep` path), and switch the tab to the diff when the file becomes changed; verify with store tests for both cases

## 6. Frontend: views and toolbar

- [x] 6.1 Key `DiffView` by display path instead of `baseSha:id:path` and reset context expansion only when the `FileDiff` object changes (D8); verify with a component test that re-rendering with a reordered change set or new `baseSha` keeps the same `DiffView` instance and scroll offset, and that a new diff resets expansion
- [x] 6.2 Add an "Automatic updates unavailable" notice to `Toolbar.tsx`, rendered only when `watchStatus` is `unavailable`, with the reason in its tooltip; Refresh stays enabled; verify with a `toolbar-extras.test.tsx` test that the notice is absent while watching and present with the reason when unavailable
- [x] 6.3 Confirm the file tree keeps expanded folders and scroll position across an automatic update; verify with an `explorer.test.tsx` test that an auto refresh adding a file in an expanded folder shows it with the untracked marker and leaves expansion and `scrollTop` unchanged
- [x] 6.4 Update README: describe automatic updates as standard behavior (with `Ctrl+R` as the fallback when watching is unavailable), and replace the "press refresh after switching branches", "the diff is not refreshed when you run commands" (Terminal section), and "commits made in the terminal appear after a refresh" notes; verify the README no longer claims updates require a refresh except when watching is unavailable
- [x] 6.5 Add a terminal test that a file created while a terminal session is open shows up after a simulated watch event with no `refresh()` call, and that the app writes nothing to the terminal; verify it passes in `src/components/terminal.test.tsx` or `src/store.test.ts`

## 7. Integration

- [ ] 7.1 Run `npm run typecheck`, `npm test`, and `npm run test:rust` and confirm all pass
- [ ] 7.2 In `npm run tauri dev` on Windows (and Linux if available): edit, create, and delete files from the built-in terminal and an editor, commit, switch branches, run a build into an ignored folder; confirm the diff, tree, branch, base picker, and graph update within a few seconds, the displayed diff never flashes "Loading…" or loses scroll, and ignored build output causes no refresh
- [ ] 7.3 Open the perf repo (`npm run perf-repo`) and run a script writing to many tracked files continuously for 30 s; confirm the UI stays responsive, refreshes at most every few seconds, and settles to the final state after writes stop
