# Tasks

Prerequisite: the toolbar, base handling (`setBase`, `baseError`), and `RepoPicker` from the earlier changes are on this branch.

## 1. Backend: list refs (repo-refs)

- [x] 1.1 Implement `git::refs::list_refs(git, root) -> Vec<RefInfo>` in `src-tauri/src/git/refs.rs` (`RefInfo { name, rev, kind: local|remote|tag, current }`, ts-rs export), using one `for-each-ref --sort=-creatordate` call over `refs/heads refs/remotes refs/tags` with `%00`-separated fields, dropping symbolic refs, per design; verify unit tests on canned output for kind/name parsing, slash names, `origin/HEAD` dropped, and `*` → current
- [x] 1.2 Add integration tests in `src-tauri/tests/refs.rs` against temp repos for each `repo-refs` scenario: all kinds listed, `feat/login` name, current branch vs detached HEAD, `origin/HEAD` omitted, recency order, repo with no commits → empty list, and a branch and tag both named `main` yield distinct `rev`s that each resolve with `resolve_base` to their own commit; verify `npm run test:rust` passes
- [x] 1.3 Register a `list_refs(root)` Tauri command in `commands.rs` and `lib.rs` via `blocking(...)`; verify an `src-tauri/tests/ipc.rs` case invoking it, and a read-only test asserting `git status --porcelain` output and the index file bytes are unchanged after listing refs
- [x] 1.4 Regenerate TS types (`npm run test:rust`) and add `listRefs(root)` to the `Api` interface, `tauriApi`, and `fakeApi` in `src/test/fixtures.ts`; verify `npm run typecheck` passes and `src/model/RefInfo.ts` exists

## 2. Store: ref list (base-picker)

- [x] 2.1 Add `refs: RefInfo[] | null` and `refsError` to the store, loading `listRefs` in parallel with the change set on `openPath` and `refresh` under the same generation guard, not on `setBase`, and resetting both on `openPath`; verify store tests that refs load on open, reload on refresh, are not refetched by `setBase`, drop a stale response, and that a `listRefs` failure sets `refsError` without setting `error`

## 3. BasePicker UI (base-picker)

- [x] 3.1 Build `src/components/BasePicker.tsx` per design (trigger showing the current base, popover with search input and grouped listbox, current-branch mark, initial highlight on the current base, `Use "<text>"` option, 200-row cap with "N more" row, outside-click close) and replace the base `<input>` in `Toolbar.tsx`, keeping the inline `baseError`; verify RTL tests in `src/components/BasePicker.test.tsx` for the `Open the dropdown`, `No repository open`, `Pick another branch` (calls `listChanges` with the picked `rev`), `Pick a tag`, `Filter by words`, `Apply a relative revision`, and `Typed revision does not resolve` scenarios
- [x] 3.2 Add keyboard handling (arrows, Home/End, Enter, Escape) and the listing-failure message; verify RTL tests for `Choose with the keyboard`, `Dismiss with Escape`, and `Listing fails` (message shown, typed revision still applies)
- [x] 3.3 Style the picker to match the repo picker in light and dark themes, and update `README.md` to describe picking a branch as the base; verify `npm run build` succeeds and the README section reads correctly

## 4. Integration check

- [ ] 4.1 Run `npm test`, `npm run typecheck`, and `npm run test:rust`; then, in the running app on a repo with a second branch and uncommitted edits, pick that branch and confirm the diff includes the uncommitted edits while `git status` and the checked-out branch are unchanged
