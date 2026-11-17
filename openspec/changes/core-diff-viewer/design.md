# Design

## Context

Greenfield repository: it contains only OpenSpec scaffolding. See `proposal.md` for motivation and `specs/repo-diff` and `specs/diff-viewer` for the behavior contract. Primary platform is Windows 11 (WebView2, i.e. Chromium); macOS/Linux should not be precluded but are not verified in this change. The app requires a `git` executable on `PATH`.

## Goals / Non-Goals

**Goals:**
- A clean seam between *producing* a diff (Rust, `repo-diff`) and *presenting* it (React, `diff-viewer`), joined by a typed diff model that future features (review marks, comments, live refresh) can reference by file + line without touching rendering code.
- Rendering cost independent of diff size (virtualization from day one).
- Byte-for-byte agreement with what `git diff` shows for the same base.

**Non-Goals:**
- File watching, worktree management, review state, comments, agent integration.
- Line wrapping, custom themes, configurable keybindings, settings UI.
- Supporting repositories without any commit (an unresolvable base is reported as an error).
- Packaging/installers and auto-update.

## Decisions

### 1. Stack and layout
Tauri v2, React 18 + TypeScript + Vite, npm as package manager.

```
src-tauri/            Rust backend
  src/git/            git process runner, repo/base resolution
  src/diff/           unified-diff parser, model types, intraline
  src/commands.rs     Tauri command handlers (thin)
  tests/              integration tests against temp git repos
src/                  React frontend
  model/              generated TS types for the diff model
  api/                typed wrappers around Tauri invoke
  rows/               diff model -> flat row view-models (pure, tested)
  highlight/          Shiki worker + client + token cache
  components/         FileList, DiffView (Unified/Split), Toolbar, placeholders
```
*Alternatives:* Electron (heavier, no benefit for us), a localhost web server (not a desktop app; rejected in exploration).

### 2. Shell out to the `git` CLI, not libgit2/gitoxide
All repository reads go through `std::process::Command` running `git`. This guarantees parity with the user's own `git diff` (config, rename detection, `.gitattributes`, line-ending filters, worktrees).
Every invocation:
- passes `--no-pager`, `-c core.quotepath=false`, and for diff commands `--no-color --no-ext-diff`;
- sets `GIT_OPTIONAL_LOCKS=0` so git does not opportunistically refresh/write the index (required by the read-only requirement);
- on Windows sets the `CREATE_NO_WINDOW` creation flag so no console windows flash;
- uses `-z` output wherever paths are listed;
- runs off the UI thread (async Tauri commands).
*Alternatives:* `git2` crate (fast, but diverges from git on filters/config edge cases; extra native dependency); `gix` (incomplete diff/rename support).

### 3. Diff pipeline and pinned base
1. **Open:** `git rev-parse --show-toplevel` resolves the repo root (subfolders allowed); failure → "not a git repository". A missing executable → "git not found".
2. **Resolve base:** `git rev-parse --verify --end-of-options <base>^{commit}` → base SHA. All subsequent calls use the **SHA**, so the file list and per-file loads stay consistent even if the ref moves.
3. **File list:** `git diff -z -M --raw --numstat <sha>` (one call) gives status, old/new paths, and `+/-` counts; `-`/`-` numstat marks binary. Then `git ls-files -z --others --exclude-standard` lists untracked files; for each, line count and binary-ness are computed in Rust by reading the file (binary = NUL byte in the first 8 KB, git's heuristic).
4. **Per-file hunks (on demand):** `git diff -M --no-color <sha> -- <old> <new>` for tracked files, parsed by our parser. Untracked files are synthesized in Rust as a single all-added hunk (no index mutation, no `git add -N`).
5. **Full content (for highlighting + expansion):** base side via `git show <sha>:<path>`; working-tree side read from disk. Content is returned with `\r\n` normalized to `\n` for display.

*Alternatives:* `git diff --no-index /dev/null <file>` for untracked files (works, but spawns a process per file and has Windows path quirks; synthesis is trivial).

### 4. Own unified-diff parser in Rust
A small line-oriented parser handling `diff --git` headers, `---/+++`, `@@ -a,b +c,d @@` hunk headers (with section text), `+`/`-`/` ` lines, `\ No newline at end of file`, and `Binary files ... differ`. Tested with fixture patches.
*Alternative:* existing crates (`patch`, `unidiff`) — partial coverage of git's extended headers and no-newline markers; the parser is ~200 lines and central to correctness, so we own it.

### 5. Diff model and type sharing
Rust structs (serde) are the source of truth; TypeScript types are generated with `ts-rs` into `src/model/` and checked in. Shape (abbreviated):

```
ChangeSet   { repoRoot, baseRef, baseSha, files: FileSummary[], totals }
FileSummary { id, status, oldPath?, newPath?, additions, deletions,
              isBinary, isLarge }
FileDiff    { fileId, hunks: Hunk[], oldNoEofNewline, newNoEofNewline }
Hunk        { oldStart, oldLines, newStart, newLines, header, lines: Line[] }
Line        { kind: context|added|removed, text, oldNo?, newNo?,
              intraline?: Range[] }   // char ranges, UTF-16 offsets
```
`fileId` is stable within a `ChangeSet` (index-based) and the `(baseSha, path, side, lineNo)` tuple is the durable address future features attach to.
*Alternative:* `tauri-specta` (also generates command bindings, but heavier setup and moving pre-1.0 APIs).

### 6. Tauri command surface
```
open_repo(path)                          -> RepoInfo { root, headSha? }
list_changes(root, base)                 -> ChangeSet
file_diff(root, baseSha, fileId|paths, force) -> FileDiff     // force bypasses large guard
file_content(root, baseSha, path, side)  -> string
```
Per-file loading keeps IPC payloads small. Errors are a typed enum (`NotARepo`, `GitNotFound`, `BadRevision`, `Io`, `Git{stderr}`) serialized for the UI.

### 7. Intraline highlights computed in Rust
Within each contiguous change block, removed line *i* is paired with added line *i* (same pairing the split view uses). Each pair is diffed with the `similar` crate at word granularity (falling back to characters within short tokens), producing ranges on both lines. Lines over 1,000 chars, or pairs with less than ~40% similarity, get no intraline ranges (avoids noisy "everything changed" highlights).
*Alternative:* `jsdiff` in the frontend — works, but costs main-thread time during scroll; doing it once in Rust at load is free from the UI's perspective.

### 8. Large-file guard
A file is `isLarge` when `additions + deletions > 10,000` or either side's size exceeds 2 MB. Thresholds are constants in one place. `file_diff` refuses large files unless `force` is true.

### 9. Renderer: flat rows + single virtualized scroller
A pure function converts `FileDiff` (+ expansion state) into a flat `Row[]` for the active mode:
- unified: `Hunk header | Line | Gap{hiddenCount, range}`
- split: `Pair{left?, right?} | Gap`, pairing as in decision 7.
`@tanstack/react-virtual` renders only visible rows from one scroll container with **fixed row height** (monospace, no wrap), so no measuring is needed and both split sides can never desync vertically. Expanding a gap re-derives rows from the full-content lines already fetched.

Horizontal scroll: unified uses native horizontal overflow on the scroller (content min-width from the longest line's char count × `1ch`). Split view gives each pane its own horizontal offset applied as a CSS transform to that pane's cells and driven by a per-pane scrollbar/shift-wheel; gutters (line numbers) stay fixed.

The file list is also virtualized.

### 10. Syntax highlighting: Shiki in a Web Worker on full file content
Highlighting only hunk lines breaks multi-line constructs (block comments, template strings), so the worker highlights **each side's full content** (which we fetch anyway for expansion) and returns tokens per line. Rows look up tokens by `oldNo`/`newNo`; intraline ranges are merged on top. Results are cached by `(baseSha|"worktree", path, contentHash)`.
- Shiki's fine-grained core with a fixed set of common languages loaded lazily; language from file extension/name, unknown → plain text.
- Dual light/dark theme via Shiki CSS-variable output, so the theme follows `prefers-color-scheme` without re-highlighting.
- Files above 20,000 lines on a side render without highlighting (still diff-colored).
- Rows render plain text immediately; tokens appear when the worker responds.

### 11. App state and persistence
Plain React state + a small Zustand store (repo, base, changeset, selected file, view mode). View mode persists in `localStorage` (persists in the Tauri webview profile). Keyboard: `]` / `[` next/previous file, `Ctrl+R` refresh, `Ctrl+O` open repo, `Ctrl+\` toggle view (adjustable later).

### 12. Launch arguments and folder picker
`differential [path] [--base <rev>]`, parsed in Rust from `std::env::args` at startup and exposed to the frontend via an `initial_args` command. Folder picker uses `tauri-plugin-dialog`. Tauri capabilities are restricted to the dialog plugin and our own commands (no fs/shell plugins exposed to the webview).

### 13. Testing strategy
- Rust unit tests: parser against fixture patches (renames, no-EOF-newline, binary, empty hunks, CRLF, unicode paths); intraline ranges.
- Rust integration tests: build throwaway repos with `tempfile` + real `git`, covering every `repo-diff` scenario, including asserting `git status --porcelain` and the index file's mtime are unchanged after a full diff.
- Frontend: Vitest on the row builders (pairing, gaps, expansion).
- Performance: a script generates a repo with a 50,000-line single-file diff and 1,000 changed files for manual verification against the "smooth rendering" requirement.

## Risks / Trade-offs

- [Working-tree content read from disk can differ from what git diffs (clean filters, `autocrlf`)] → normalize CRLF for display; line numbers come from git's hunks, and expansion only reveals unchanged regions where filters rarely matter. Revisit if mismatches show up.
- [Process spawn overhead on Windows (~10–30 ms per `git` call)] → file list uses one combined call; per-file calls happen only on selection; untracked files are synthesized without spawning.
- [Shiki highlighting of very large files is slow] → worker keeps the UI responsive; size cutoff; cache.
- [Fixed row height precludes wrapping] → accepted; wrapping is a non-goal for this change.
- [Per-pane transform-based horizontal scrolling in split view is custom code] → isolated in one component; fall back to a shared horizontal scroll if it proves fragile.
- [Index-based `fileId` is not stable across refreshes] → acceptable now; future review features will key on `(path, baseSha)` instead.
- [`git` missing or too old] → detect at startup with a clear error; require git ≥ 2.30 (for `--end-of-options`).

## Open Questions

- Final product/binary name: `differential` (resolved).
- Exact keyboard shortcuts and theme colors (tunable without affecting specs or structure).
