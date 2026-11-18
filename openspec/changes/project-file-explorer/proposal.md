# Proposal

## Why

The sidebar today is a flat list of changed files only. A reviewer can't see where those changes sit in the project's structure, and can't open an unchanged file to check how changed code is used or what it depends on. A basic project explorer adds that context without leaving the review tool.

## What Changes

- The sidebar gets two tabs: **Changes** (the existing flat changed-file list, unchanged) and **Files** (a new project explorer).
- The **Files** tab shows the whole project as a collapsible folder tree: every tracked file plus untracked, non-ignored files in the working tree, and files deleted relative to the base.
- Changed files in the tree show the same status indicator as the Changes list. Folders that contain changes are marked with the number of changed files inside them.
- Selecting a changed file in the tree opens its diff, exactly as selecting it in the Changes list does, and the two views stay in sync.
- Selecting an unchanged file opens a read-only, syntax-highlighted view of its current contents with line numbers. Binary and large files get placeholders, the same as in the diff view.
- The tree is virtualized and can be navigated with the keyboard (up/down, left/right to collapse/expand, Enter to open).
- New backend commands list the project's files and read a working-tree file for viewing, with binary and large-file classification. Both are read-only.
- The selected sidebar tab is remembered across restarts.

Out of scope: file search or filtering, filtering the tree to changed files only, showing ignored files, browsing files at the base revision, file-system watching (the tree updates on refresh, like the diff), context-menu actions, and anything that changes files.

## Capabilities

### New Capabilities
- `repo-files`: Listing every file in the repository's working tree (tracked plus untracked non-ignored) and reading a working-tree file's contents for display, classifying binary and large files, read-only through the `git` CLI and the file system.
- `file-explorer`: Presenting the project structure in the sidebar: the Changes/Files tabs, the folder tree with change markers, keyboard navigation, opening changed files as diffs, and the read-only view of unchanged files.

### Modified Capabilities
<!-- None. The `diff-viewer` and `repo-diff` capabilities are still in the in-flight `core-diff-viewer` change and not yet in `openspec/specs/`. This change adds to them without changing their requirements: the Changes list, its keyboard navigation, and the diff view keep their current behavior. -->

## Impact

- Depends on the `core-diff-viewer` change (its file list, diff pane, highlighter, and store), which is still in progress. Build this change on top of it on the same branch.
- Backend: new `list_files` and `view_file` Tauri commands in `src-tauri/src/commands.rs`, implemented in a new `src-tauri/src/files.rs`; a new ts-rs type for the file-view result; integration tests in `src-tauri/tests/`.
- Frontend: new sidebar tabs, tree component, and file view in `src/components/`; a pure tree builder in `src/tree/`; store state for the file list, expanded folders, active tab, and viewed file; new `Api` methods.
- No new dependencies. Reuses `@tanstack/react-virtual` and the Shiki highlight worker.
