# Tasks

## 1. Recursive collapse in the store

- [x] 1.1 Add `collapseSubtree(path)` to the store (design D1): remove `path` and every expanded path under `path + "/"`, no-op when nothing changes; verify with new `src/store.test.ts` cases (subtree cleared including remembered entries under a collapsed child, sibling `lib/core` untouched, prefix-lookalike `src2` untouched, no state change when nothing to remove)

## 2. Folder icons

- [x] 2.1 Replace the caret span in `TreeRowView` with a `.tree-icon` slot rendering `FolderOpenIcon` / `FilesIcon` for folders and nothing for files, and update the tree CSS slot width to the icon size (D7); verify with `src/components/explorer.test.tsx` assertions that folder rows contain the matching icon and no `▸`/`▾`, and file rows contain no icon
- [ ] 2.2 Visually check in `npm run tauri dev`, in light and dark themes, that file names align with folder names at the same depth and that open and closed folders can be told apart

## 3. Collapse-subtree toggle and Shift+Left

- [x] 3.1 In `FileTree`, derive `hasExpandedBelow` with `useMemo` (D2) and pass `canCollapseSubtree` to `TreeRowView`; verify with an explorer test that only expanded folders with an expanded folder below them render the toggle
- [x] 3.2 Render the `subtree-toggle` button in a fixed-width slot at the end of every row (D3, D4) with stopPropagation on click/double-click and preventDefault on mousedown; add CSS that hides it by default and shows it on `.tree-row:hover` and `.tree-focused .tree-row.active`; verify with an explorer test that clicking the toggle collapses the subtree without changing the selection or the open file, and re-expanding shows subfolders collapsed
- [x] 3.3 Handle Shift+Left in `onKeyDown` (D8); verify with explorer tests: on a folder it collapses the subtree, on a file nothing changes and the highlighted row stays put, plain Left still remembers subfolders
- [x] 3.4 Document the toggle and the `Shift+←` row in the README's Files-tree section and key table; verify the README table renders with the new row

## 4. Focus-aware highlights

- [x] 4.1 Track tree focus with `onFocus`/`onBlur` (checking `relatedTarget`) and apply `tree-focused` to the tree container; scope the `.tree-row.active` outline to `.tree-focused` (D5); verify with an explorer test that the container gains and loses `tree-focused` when focus moves into the tree and out to another element, and that `active` stays on the cursor row
- [ ] 4.2 Add `--selected-inactive` for light and dark themes and apply it to the selected tree row when the tree is not focused, leaving the Changes list unchanged (D6); verify visually in both themes that the blurred selection is muted but readable, and that the Changes list selection looks unchanged

## 5. Integration

- [x] 5.1 Run `npm run typecheck` and `npm test` and confirm both pass
- [ ] 5.2 Open a large repo (`npm run perf-repo`) in the app, expand deeply, use the toggle and Shift+Left, and confirm there is no visible stall and the toggle appears only on hover or on the focused highlighted row
