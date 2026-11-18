# Tasks

Prerequisite: the `core-diff-viewer` change's sections 5–8 (toolbar, file list, diff renderer, highlighting) are implemented on this branch, because this change extends `FileList`, `DiffPane`, `DiffView` token rendering, and the store.

## 1. Backend: file listing and file view (repo-files)

- [x] 1.1 Move `safe_join`, `is_binary_bytes`, `sniff_binary`, and the CRLF normalization from `changes.rs` into a shared `src-tauri/src/content.rs` and point `changes.rs` at them; verify `npm run test:rust` still passes unchanged
- [x] 1.2 Implement `files::list_files(git, root) -> Vec<String>` (`ls-files -z --cached --others --exclude-standard`, deduplicated, dropping cached paths missing on disk via `symlink_metadata`); verify with integration tests in `src-tauri/tests/files.rs` covering the spec scenarios: tracked + untracked, ignored excluded, staged-and-unstaged listed once, deleted-from-disk excluded, paths with spaces/non-ASCII
- [x] 1.3 Implement `files::view_file(root, path, force) -> FileView` (tagged `text | binary | large{size} | missing | notAFile`, ts-rs export) per design; verify integration tests for text, CRLF file, binary, large without/with `force`, large binary → `binary`, missing, directory → `notAFile`, and `../secrets.txt` → `invalid` error
- [x] 1.4 Register `list_files` and `view_file` Tauri commands in `commands.rs`/`lib.rs` using `blocking(...)`; verify with `src-tauri/tests/ipc.rs` cases that invoke both through IPC, and add a read-only test asserting the index file's bytes and `git status --porcelain` are unchanged after listing and reading
- [x] 1.5 Regenerate TS types (`npm run test:rust`) and add `listFiles` / `viewFile` to the `Api` interface and `tauriApi`; verify `npm run typecheck` passes and `src/model/FileView.ts` exists

## 2. Tree model (file-explorer)

- [x] 2.1 Implement `src/tree/build.ts`: `buildTree(paths, changeSet)` (merging in deleted files, keying renames by new path, folders first, case-insensitive sort, bottom-up `changedCount`) and `flatten(tree, expanded)`; verify Vitest tests in `src/tree/build.test.ts` for the `Tree structure`, `Deleted file appears`, `Folder with nested changes`, and `Renamed file` scenarios, plus collapse hiding descendants
- [x] 2.2 Add `ancestorsOf(path)` and `pruneExpanded(expanded, tree)` helpers; verify unit tests that revealing `a/b/c.ts` yields `a`, `a/b`, and that pruning drops vanished folders but keeps existing ones
- [x] 2.3 Add a perf check: build and flatten 50,000 synthetic paths with everything expanded in a Vitest test and assert it completes in under 200 ms; verify the test passes locally

## 3. Store: tabs, project files, and viewed file (file-explorer)

- [x] 3.1 Add `sidebarTab` (persisted under `differential.sidebarTab` via `KeyValue`, default `changes`) and `setSidebarTab`; verify store tests that the tab persists via the fake storage and that switching tabs does not change `selectedId` or `viewed`
- [x] 3.2 Add `projectFiles`, `filesError`, and `expanded`, loading `listFiles` lazily on first Files-tab activation and again with each `loadChanges` (same `generation` guard), resetting `expanded` on `openPath` and pruning it on refresh/base change; verify store tests with the mock `Api` for lazy load, reload on refresh, stale-response drop, and reset on a new repo
- [x] 3.3 Add `viewed` and `openTreePath(path)` (a changed path goes to `select(id)`; otherwise clear `selectedId` and load `viewFile`), make `select` clear `viewed`, add `loadViewedAnyway`, and re-request or clear `viewed` on refresh; verify store tests that `selectedId` and `viewed` are never both set, that `selectNext` from a viewed file selects file 0, and that large → load anyway → text

## 4. Sidebar tabs and tree UI (file-explorer)

- [x] 4.1 Extract `STATUS_LETTER` and the status-badge markup into a shared module used by `FileList`; verify the existing `components.test.tsx` passes unchanged
- [x] 4.2 Build `Sidebar.tsx` (tablist with Changes / Files, rendering `FileList` or `FileTree`) and swap it into `App.tsx`; verify an RTL test that clicking Files shows the tree and the main pane header is unchanged
- [x] 4.3 Build the virtualized `FileTree.tsx` (`role="tree"`, indentation, chevrons, status letters, folder changed-count badges, click to toggle/open, selected-row highlight); verify RTL tests for rendering the `Folder with nested changes` scenario and that clicking a changed file selects it in the store
- [x] 4.4 Add tree keyboard handling (Up/Down/Left/Right/Enter per spec) on the tree element; verify an RTL test for the `Expand and open with the keyboard` scenario and that `]`/`[` still work while the tree has focus
- [x] 4.5 Reveal the selection: on Files-tab activation and on selection change, expand ancestors and scroll the row into view; verify an RTL test for the `Reveal the selection` scenario
- [ ] 4.6 Style the tabs, tree rows, and badges with the existing light/dark tokens in `styles.css`; verify manually in both OS themes that indicators and badges are legible

## 5. Unchanged-file view (file-explorer)

- [ ] 5.1 Factor the token-span line rendering out of `DiffView` into a shared component if it isn't already separate; verify `npm test` passes and a `.ts` diff still highlights in `npx tauri dev`
- [ ] 5.2 Build `FileView.tsx`: virtualized single column with a line-number gutter, no wrapping, horizontal scroll, and highlighting via `HighlightClient.highlight("worktree", path, content)` with plain text until tokens arrive; verify an RTL test that lines and numbers render, plus a manual check that an unchanged `.ts` file is highlighted
- [x] 5.3 Render `viewed` in `DiffPane` (header with path + "unchanged", `FileView`, and binary/large/missing/notAFile placeholders, with "Load anyway" for large); verify RTL tests for the binary, large → load, and missing placeholders

## 6. Documentation

- [x] 6.1 Update `README.md` (sidebar tabs, tree keyboard keys, the `src/tree/` and `src-tauri/src/files.rs` layout entries); verify the README's shortcut table matches the implemented keys

## 7. Integration and performance verification

- [x] 7.1 Extend `scripts/make-perf-repo.mjs` with an option to add N unchanged files across nested folders (default 50,000 when given) and document it in the README; verify running it produces a repo whose `git ls-files | wc -l` is at least N
- [ ] 7.2 In a release build against that repo, verify the `Very large project` scenario: open the Files tab, expand large folders, scroll top to bottom, and confirm there are no visible stalls; also confirm refresh with the Files tab open stays responsive
- [ ] 7.3 End-to-end pass on a real repo with an agent-style change set (new, deleted, and renamed files; base `HEAD~N`): walk every `file-explorer` scenario, confirm no mutating controls exist, and confirm `git status` is unchanged afterwards

## Workflow follow-up

- Archive the change with `/opsx:archive` once the implementation is reviewed and merged (after `core-diff-viewer` is archived, so its capabilities exist in `openspec/specs/`).
