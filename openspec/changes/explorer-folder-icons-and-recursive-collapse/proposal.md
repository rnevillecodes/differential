# Proposal

## Why

Folders in the project tree are marked only by a small text caret (`▸`/`▾`), which is easy to miss and does not read as "folder" at a glance. Deep trees are tedious to tidy: collapsing a folder keeps its subfolders' expanded state, so reopening it brings the whole subtree back, and the only alternative is collapsing the entire tree. The keyboard-cursor outline also stays drawn after the tree loses focus, so a stale highlight lingers while the user works in the diff pane.

## What Changes

- Folder rows show a folder icon in place of the caret: a closed folder when collapsed, an open folder when expanded. File rows show no icon; they keep a blank slot of the same width so names stay aligned.
- An expanded folder that has at least one expanded subfolder gets a "collapse subtree" toggle at the right end of its row, shown only while the row is hovered or is the highlighted row in a focused tree. It collapses the folder and every folder below it, so reopening the folder shows its subfolders collapsed.
- `Shift+Left` performs the same recursive collapse on the highlighted folder.
- The keyboard-cursor outline is drawn only while the tree has focus. The selected file keeps its highlight when the tree loses focus, in a muted shade.
- Plain collapse (click, `Enter`, `Left`) keeps its current behavior: subfolders' expanded state is remembered.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `file-explorer`: "Project tree" gains folder icons and recursive collapse; "Keyboard navigation in the tree" gains `Shift+Left`; a new requirement covers how the tree's highlights behave when it gains or loses focus.

## Impact

- `src/components/FileTree.tsx` — row rendering (icon, toggle), `Shift+Left` handling, tree focus tracking.
- `src/store.ts` — new recursive-collapse action alongside `setFolderExpanded` / `collapseAll`.
- `src/styles.css` — folder icon slot, hover-revealed toggle, focus-scoped outline, new muted-selection color for light and dark themes.
- `src/components/icons.tsx` — reuses `FilesIcon`, `FolderOpenIcon`, `CollapseAllIcon`; no new icons expected.
- Tests: `src/components/explorer.test.tsx`, `src/store.test.ts`.
- Docs: `README.md` Files-tree section and key table.
- The Changes list is unaffected; it shares row classes, so styling must be scoped to the tree.
