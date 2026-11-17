# Tasks

## 1. Project scaffold

- [x] 1.1 Scaffold a Tauri v2 + React + TypeScript + Vite app in the repo root (`src/`, `src-tauri/`), named `mydiff`; verify `npm run tauri dev` opens an empty window on Windows
- [x] 1.2 Add `.gitattributes` (`* text=auto eol=lf`, binary patterns) and `.gitignore` for `node_modules/`, `target/`, `dist/`; verify `git status` shows no build output after a dev build
- [x] 1.3 Add backend dependencies (`serde`, `serde_json`, `thiserror`, `similar`, `ts-rs`, `tauri-plugin-dialog`; dev: `tempfile`) and frontend dependencies (`@tanstack/react-virtual`, `shiki`, `zustand`; dev: `vitest`); verify `cargo build` and `npm run build` succeed
- [x] 1.4 Restrict Tauri capabilities to the dialog plugin and app commands only; verify `src-tauri/capabilities/` grants no fs/shell permissions
- [x] 1.5 Create the module layout from design §1 (`src-tauri/src/{git,diff}`, `src/{model,api,rows,highlight,components}`) and add `npm test` / `cargo test` scripts; verify both commands run (with zero tests)

## 2. Git runner and repository resolution (repo-diff)

- [x] 2.1 Implement the git process runner (flags `--no-pager`, `-c core.quotepath=false`, `GIT_OPTIONAL_LOCKS=0`, `CREATE_NO_WINDOW` on Windows, async, captured stdout/stderr) and the typed error enum (`NotARepo`, `GitNotFound`, `BadRevision`, `Io`, `Git{stderr}`); verify unit tests for error mapping, including a missing-executable case
- [x] 2.2 Implement `open_repo` (`rev-parse --show-toplevel`, git version check ≥ 2.30); verify integration tests: repo root, subfolder resolves to top level, non-repo folder → `NotARepo`
- [x] 2.3 Implement base resolution (`rev-parse --verify --end-of-options <rev>^{commit}`, default `HEAD`); verify integration tests for branch, tag, SHA prefix, `HEAD~N`, unresolvable ref → `BadRevision`, and a repo with no commits → `BadRevision`
- [x] 2.4 Add an integration-test helper that builds throwaway repos in `tempfile` dirs with real `git` (commits, edits, staged changes, renames, binaries, ignores); verify it is used by the tests in 2.2–2.3

## 3. Diff model and parser (repo-diff)

- [ ] 3.1 Define the diff model types (design §5) with serde + `ts-rs`, generating TS into `src/model/`; verify `cargo test` regenerates identical, checked-in TS files
- [ ] 3.2 Implement the unified-diff parser (headers, hunk headers with section text, `+`/`-`/context lines with old/new numbers, `\ No newline at end of file`, `Binary files ... differ`); verify fixture tests for: simple modify, multiple hunks, add, delete, rename with edits, no-EOF-newline on each side, binary, CRLF content, unicode paths, whitespace-only lines preserved
- [ ] 3.3 Implement intraline ranges with `similar` (pair removed/added lines by position within each change block, word granularity, UTF-16 offsets, skip lines > 1,000 chars or < ~40% similar); verify unit tests including `const timeout = 30;` → `60;` highlighting only the number

## 4. Change listing and per-file diffs (repo-diff)

- [ ] 4.1 Implement `list_changes`: one `git diff -z -M --raw --numstat <sha>` call parsed into `FileSummary` (status, old/new paths, stats, binary), plus totals; verify integration tests for modified, added, deleted, renamed, binary, and staged+unstaged combined against the working tree
- [ ] 4.2 Add untracked files via `git ls-files -z --others --exclude-standard`, computing line counts and binary-ness in Rust (NUL in first 8 KB); verify integration tests: new file listed as `untracked` with full line count, ignored file absent
- [ ] 4.3 Apply the large-file guard (changes > 10,000 lines or side > 2 MB → `isLarge`, constants in one module); verify an integration test with a generated large file
- [ ] 4.4 Implement `file_diff` for tracked files (`git diff -M <sha> -- <old> <new>` → parser → intraline) and synthesized all-added diffs for untracked files; refuse large files unless `force`; verify integration tests for each file status and the force flag
- [ ] 4.5 Implement `file_content(path, side)` (base via `git show <sha>:<path>`, worktree from disk, CRLF normalized); verify integration tests for both sides and a deleted/added file's missing side
- [ ] 4.6 Add the read-only guarantee test: after `list_changes` + `file_diff` + `file_content` on a repo with staged, unstaged, and untracked files, `git status --porcelain=v2` output and `.git/index` mtime are unchanged; verify it passes
- [ ] 4.7 Register all commands (`open_repo`, `list_changes`, `file_diff`, `file_content`, `initial_args`) with Tauri and parse `mydiff [path] [--base <rev>]` from argv; verify `initial_args` unit test and that commands are callable from the devtools console

## 5. App shell, repository and base selection (diff-viewer)

- [ ] 5.1 Implement typed API wrappers in `src/api/` and the Zustand store (repo, base, changeset, selected file, view mode, errors); verify Vitest tests for store transitions with a mocked API
- [ ] 5.2 Build the toolbar: repo path + open button (folder picker via dialog plugin), base ref input with inline error that keeps the previous diff, refresh button; wire launch args so `mydiff <path> --base <rev>` opens directly; verify manually against each `Open a repository` / `Choose the base ref` / `Manual refresh` scenario
- [ ] 5.3 Show error states (git not found, not a repo, bad revision) and the "no changes" empty state; verify manually by pointing at a non-repo folder, a clean repo, and an invalid ref
- [ ] 5.4 Implement light/dark theme tokens following `prefers-color-scheme` (diff add/remove/intraline colors legible in both); verify manually by toggling Windows dark mode

## 6. File list (diff-viewer)

- [ ] 6.1 Build the virtualized file list: path (old → new for renames), status indicator, `+/-` counts, binary/large markers, totals header; verify a Vitest/RTL test for rendering each status and manual check with the 1,000-file perf repo (smooth scroll)
- [ ] 6.2 Add selection and keyboard navigation (`]` / `[` next/previous, plus `Ctrl+R`, `Ctrl+O`, `Ctrl+\`); verify a component test for next/previous selection

## 7. Diff renderer (diff-viewer)

- [ ] 7.1 Implement pure row builders: unified rows (hunk header, line, gap) and split rows (paired left/right with filler, gap), plus leading/trailing gaps from full-file line counts; verify Vitest tests for the "remove two, add three" pairing, gap counts, and line numbers
- [ ] 7.2 Implement context expansion in the row builders (expand fully, or expand N lines adjacent to a hunk from either side) using fetched full content; verify Vitest tests for full and partial expansion with correct line numbers on both sides
- [ ] 7.3 Build the virtualized `DiffView` with fixed row height and a single scroll container; render unified mode with gutters, add/remove/context styling, and native horizontal scroll (no wrapping); verify manually against the `Unified view` and `No line wrapping` scenarios
- [ ] 7.4 Render split mode on the same scroller with per-pane horizontal offset (transform + per-pane scrollbar/shift-wheel) and fixed gutters; verify manually that both sides stay vertically aligned and long lines scroll per pane
- [ ] 7.5 Add the view-mode toggle persisted in `localStorage` (guarded with try/catch); verify manually that the choice survives switching files and restarting the app
- [ ] 7.6 Render intraline ranges as highlight spans over the line text; verify a component test that only the changed word gets the intraline class
- [ ] 7.7 Render gap markers with "expand all" / "expand N" actions wired to 7.2; verify manually on a file with a 40-line gap
- [ ] 7.8 Render binary and large-file placeholders, with "load anyway" calling `file_diff(force)` for large files; verify manually against both placeholder scenarios

## 8. Syntax highlighting (diff-viewer)

- [ ] 8.1 Implement the Shiki Web Worker (fine-grained core, lazily loaded common languages, dual light/dark CSS-variable themes) that tokenizes a full file side and returns tokens per line; verify a unit test of the language-from-filename mapping (known, unknown → plain text)
- [ ] 8.2 Implement the highlight client: request both sides on file open, cache by `(baseSha|worktree, path, contentHash)`, skip sides over 20,000 lines; verify Vitest tests for cache hits and the size cutoff
- [ ] 8.3 Merge tokens into rows by old/new line number, layering intraline highlights on top, rendering plain text until tokens arrive; verify manually that a `.ts` file is highlighted, an unknown extension stays plain, and scrolling never waits on highlighting

## 9. Integration and performance verification

- [ ] 9.1 Add a script (`scripts/make-perf-repo`) that generates a repo with a 50,000-line single-file diff and 1,000 changed files; verify it runs and produces the repo
- [ ] 9.2 Verify the `Smooth rendering of large diffs` scenarios against the perf repo in a release build (`npm run tauri build`): first screen appears promptly, full-length scroll without visible stalls, in both view modes
- [ ] 9.3 End-to-end review pass on a real repo with an agent-style change set (new files, renames, base `HEAD~N`): walk every `diff-viewer` scenario, confirm no mutating controls exist and `git status` is unchanged afterwards
- [ ] 9.4 Write `README.md` covering prerequisites (git ≥ 2.30, Rust, Node), `mydiff [path] [--base <rev>]` usage, keyboard shortcuts, and dev/test commands; verify the documented commands run as written

## Workflow follow-up

- Archive the change with `/opsx:archive` once the implementation is reviewed and merged.
