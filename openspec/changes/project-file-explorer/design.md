# Design

## Context

This builds on the in-progress `core-diff-viewer` change. What it relies on:

- **Backend**: `git::Git` runs git with `GIT_OPTIONAL_LOCKS=0` and other read-only-safe settings. `changes.rs` already has `safe_join`, `is_binary_bytes`/`sniff_binary` (NUL check in the first 8,000 bytes), `limits::MAX_FILE_BYTES` (2 MiB), and the `ls-files --others --exclude-standard` call used for untracked files. Commands are thin `blocking(...)` wrappers in `commands.rs`, and their types are exported to `src/model/` with ts-rs.
- **Frontend**: a zustand store (`src/store.ts`) holds `changes`, `selectedId` (an index into `changes.files`), per-file loads, and `viewMode`, and uses a `generation` counter to drop stale responses. `FileList.tsx` is a virtualized list (`@tanstack/react-virtual`, fixed 28px rows). `DiffPane.tsx` chooses between messages, placeholders, and `DiffView`. Highlighting goes through `HighlightClient.highlight(version, path, content)` in a Web Worker.
- `ErrorKind` has no "not found" kind, so a missing file is reported as a `missing` result rather than an error (see the `repo-files` spec).

## Goals / Non-Goals

**Goals:**
- Reuse the existing classification limits, highlighter, virtualization, and store patterns. Add no dependencies.
- Keep the Changes list, the `selectedId` semantics, and `]`/`[` behavior unchanged, so the open `core-diff-viewer` tasks and tests are unaffected.
- Make the tree builder and flattener pure functions so Vitest can cover them without the DOM.

**Non-Goals:**
- Lazy per-directory listing from the backend. One full listing is enough at the target size (50k files).
- Showing gitlink/submodule contents. A submodule shows up as a leaf entry, and opening it shows a "not a file" message (see Decisions).
- Reusing `DiffView` to render unchanged files.

## Decisions

### Backend: one `list_files` call, `--cached --others`, filtered by existence
`list_files(root) -> Vec<String>` runs `git ls-files -z --cached --others --exclude-standard`. It deduplicates the paths (`--cached` lists unmerged entries once per stage) and drops cached entries that are not on disk, using `symlink_metadata` so a broken symlink still counts as present. Sorting happens on the frontend.
- *Why not `git ls-tree -r HEAD`?* It shows the base, not the working tree, and has no untracked files.
- *Why not walk the file system?* We would have to reimplement `.gitignore` handling. `--exclude-standard` already matches what `list_changes` treats as untracked, so the two listings agree.
- The frontend adds the change set's deleted files (`status: deleted`, `oldPath`) to this list. The backend listing then stays independent of the base, and deleted-file decoration has a single source: the change set.

### Backend: `view_file` returns a tagged result, not an error
`view_file(root, path, force) -> FileView`, with
`FileView = { kind: "text", content } | { kind: "binary" } | { kind: "large", size } | { kind: "missing" } | { kind: "notAFile" }`, exported with ts-rs (`#[serde(tag = "kind", rename_all = "camelCase")]`). The order of checks is: `safe_join` (error `invalid` on traversal), `metadata` (not found → `missing`, directory/submodule → `notAFile`), then size over `MAX_FILE_BYTES` and not `force` → `large` (a large file is sniffed with `sniff_binary` first, so a large binary reports `binary`), then read the bytes and run `is_binary_bytes`, then lossy UTF-8 with `\r\n` turned into `\n`. The existing helpers move out of `changes.rs` into a small shared module (`src-tauri/src/content.rs`) that both modules use.
- *Why not reuse `file_content(..., Worktree)`?* It has no binary or size guard, and changing it would affect diff context expansion.

### Frontend: data model
- `src/tree/build.ts` builds `buildTree(paths: string[], changed: Map<path, FileSummary>) → DirNode`. Each `DirNode` has `{ name, path, dirs[], files[], changedCount }` and each `FileNode` has `{ name, path, change: FileSummary | null }`. The builder sorts folders first and compares names with `localeCompare(undefined, { sensitivity: "base" })`. `changedCount` is computed bottom-up. Renamed files are keyed by `newPath`; their `oldPath` is not on disk, so it is not in the listing.
- `flatten(root, expanded: Set<string>) → TreeRow[]`, where `TreeRow = { node, depth }`, returns the visible rows. It is memoized on `(tree, expanded)`. For 50k files fully expanded this is one linear pass, which is cheap. Collapsed subtrees are skipped entirely.
- The store adds `sidebarTab: "changes" | "files"` (persisted in `localStorage`, key `differential.sidebarTab`), `projectFiles: string[] | null`, `expanded: Set<string>`, `filesError`, and `viewed: { path, load: ViewLoad } | null` for an unchanged file. `ViewLoad` mirrors `FileLoad`: `loading | ready(content) | binary | large(size) | missing | notAFile | error`.
- **Selection model**: the main pane shows `viewed` when it is set, and the diff for `selectedId` otherwise. `openPath(path)` from the tree: if the path is a changed file, call `select(id)` and clear `viewed`. Otherwise set `selectedId = null` and load `viewed`. `select(id)` always clears `viewed`. `move()` already treats `selectedId === null` as "go to 0", which gives the spec's "next-file shows the first changed file" with no new code.
- *Alternative considered*: one selection keyed by path for everything. It is cleaner, but `selectedId` is used throughout the store, tests, and `FileList`, and the open `core-diff-viewer` tasks depend on it. It can be revisited later.

### Frontend: loading and refresh
`projectFiles` loads the first time the Files tab is shown for a repo (lazily, so the Changes-only workflow pays nothing) and again on each `loadChanges` once it has been loaded. It runs alongside `list_changes` and is tied to the same `generation`. The tree is built from both results, so a listing that arrives before the change set shows an undecorated tree briefly. `openPath` (a new repo) resets `expanded` and `viewed`. Refresh and base change keep `expanded` and drop paths that no longer exist as folders. They also re-request `viewed` if it is still in the listing, and otherwise clear it.

### Frontend: components
- `Sidebar.tsx` holds the tab strip and renders `FileList` (unchanged) or `FileTree`. It replaces `<FileList />` in `App.tsx`. The tabs use `role="tablist"`/`tab`.
- `FileTree.tsx` is a virtualized `role="tree"` list with the same row height and virtualizer setup as `FileList`. Each row has an indent of `depth × 12px`, a chevron for folders, a name, and then either a status letter (reusing `STATUS_LETTER` and the `.status-*` classes, moved to a shared module) or the folder's changed-count badge. The highlighted row is held in local component state and is separate from the selection. The keyboard handler covers Up, Down, Left, Right, and Enter as the spec describes. When the Files tab activates, or the selection changes while it is active, the selected path's ancestors are added to `expanded` and the row is scrolled into view.
- `FileView.tsx` renders unchanged-file contents. It is a virtualized single-column list with a line-number gutter, the same 20px row height, and the same no-wrap horizontal scroll as `DiffView`. Tokens come from `HighlightClient.highlight("worktree", path, content)`, and lines render as plain text until tokens arrive. It reuses the token-span rendering from `DiffView`, factored into a shared `TokenLine` component if it is not already separate.
- `DiffPane` checks `viewed` first and renders a header (path, "unchanged" label) plus a `FileView` or placeholder. The global `]`/`[` handler already ignores keys typed into inputs. The tree's arrow keys are handled on the tree element, so they don't interfere with it.

## Risks / Trade-offs

- [Listing 50k+ paths on every refresh adds IPC/JSON cost of roughly 2–4 MB] → Load only after the Files tab has been opened once. Measure against a generated large repo (extend `scripts/make-perf-repo.mjs` with a `--files N` option for unchanged files). If it turns out slow, switch to returning a single NUL-joined string.
- [`--cached` plus an existence check costs one `stat` per tracked file] → It is fast enough at 50k on local disks. If profiling shows a problem, use `git ls-files --deleted` once and subtract its results instead.
- [Two selection fields (`selectedId`, `viewed`) could fall out of sync] → Every write path goes through `select`/`openPath` in the store, and store tests assert that the two fields are mutually exclusive.
- [Case-insensitive file systems (Windows) can list paths that differ only in case] → They are treated as distinct entries, as git does. The sort is stable so they appear next to each other.
- [A very large single file viewed with "load anyway"] → It uses the same virtualization as the diff view. Highlighting is skipped above `MAX_HIGHLIGHT_LINES`, as it already is.

## Migration Plan

This is purely additive. No stored data changes. The new `localStorage` key defaults to `changes` when it is absent, so existing users see the same sidebar as before until they pick the Files tab.
