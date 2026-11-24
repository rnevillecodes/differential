# Design

## Context

See proposal.md for motivation; requirements are in `specs/file-explorer/spec.md`.

- Expanded state is one flat `ReadonlySet<string>` of folder paths in the zustand store (`expanded`). `flatten()` in `src/tree/build.ts` only descends into folders in the set, so a collapsed folder's expanded descendants stay in the set. That is the existing "remember subfolders" behavior.
- `FileTree.tsx` renders virtualized rows through a memoized `TreeRowView`. The caret is a 12px text span (`.chevron`). The keyboard cursor (`active`) is component state shown as an `active` class. Selection uses `aria-selected`.
- The tree container (`.file-list-scroll`, `role="tree"`) holds DOM focus and uses `aria-activedescendant`. Rows are not focusable.
- `.tree-row.active` draws an inset accent outline whatever the focus. The Changes list shares `.file-row` and `--selected`.
- The tree must stay smooth at 50,000 files.

## Goals / Non-Goals

**Goals:**
- Recursive collapse as one store update, with per-row cost of O(1) while rendering.
- Focus-dependent styling that jsdom tests can check, without relying on `:focus-within` being computed.

**Non-Goals:**
- File-type icons, or any icon on file rows.
- Coloring folder icons by change state. Icons use the existing muted color.
- Recursive expand.
- Changing the Changes list's selection styling.

## Decisions

### D1. Recursive collapse is a store action that filters by path prefix
Add `collapseSubtree(path)` next to `setFolderExpanded` / `collapseAll`. It removes `path` and every entry equal to it or starting with `path + "/"`, and skips `set` when nothing changes. Prefix matching on the flat set needs no tree walk and also clears remembered entries under collapsed children, which is the point of the feature.
*Alternative:* walk the `DirNode` subtree and delete each path. That's more work, needs the tree in the store, and gives the same result.

### D2. "Has an expanded folder below" is precomputed once per render
In `FileTree`, derive `hasExpandedBelow: Set<string>` with `useMemo` over `expanded`: for each expanded path, add each of its `ancestorsOf()`. A folder row can collapse its subtree when `expanded.has(p) && hasExpandedBelow.has(p)`. That costs O(|expanded| x depth) per change of `expanded`, independent of file count. The row gets a boolean prop `canCollapseSubtree`, so the `memo` stays effective.
*Alternative:* scan `expanded` for each row. That's O(rows x |expanded|) and too slow for large trees.

### D3. The toggle is always rendered when eligible and shown by CSS
On eligible rows, render a `<button className="subtree-toggle">` with `CollapseAllIcon`, `tabIndex={-1}`, `aria-label="Collapse folder and subfolders"` and a `title`. It starts `visibility: hidden` and becomes visible on `.tree-row:hover` or `.tree-focused .tree-row.active`. Its `onClick` and `onDoubleClick` call `stopPropagation()` so the row doesn't toggle or open. `onMouseDown` calls `preventDefault()` so focus stays where it was.
*Alternative:* track the hovered row in React state. That re-renders on every mouse move over the list and adds nothing.

### D4. Fixed toggle slot on every row
Every tree row ends with a fixed-width slot (icon size plus padding). Folder rows put the toggle in it, and other rows leave it empty. Change counts and status badges then sit in one column, and nothing moves when the toggle appears.
*Alternative:* a slot on eligible folder rows only. Badges would then sit at different horizontal positions on neighbouring rows. Absolute overlay over the badge: hides the change count exactly when hovering.

### D5. Focus is tracked in React state, and CSS keys on a class
`FileTree` keeps `focused` state, set by `onFocus` / `onBlur` on the tree container (checking `relatedTarget` so moving focus inside the container doesn't count as a blur). When it's true the container gets `tree-focused`. CSS:
- `.tree-focused .tree-row.active` draws the accent outline. The bare `.tree-row.active` rule no longer draws it.
- `.file-tree .file-list-scroll:not(.tree-focused) .tree-row[aria-selected="true"]` uses `var(--selected-inactive)`.
The `active` class stays on the cursor row even while blurred, so existing tests that check it keep passing and the cursor position survives a blur. Only its appearance depends on focus.
*Alternative:* pure CSS `:focus-within`. It's simpler, but jsdom doesn't apply it, so tests couldn't verify the behavior.

### D6. A new theme token, `--selected-inactive`
Define it in `:root` (light) and `:root[data-theme="dark"]`. It should be a desaturated shade between `--hover` and `--selected` (starting points: light `#e4e8ee`, dark `#262d38`; check contrast against `--text` in both themes). It's scoped to the tree, per the non-goal.

### D7. Folder icon replaces the caret span
Rename the `.chevron` slot to `.tree-icon`, with a width equal to the icon size (14px). Folder rows render `FolderOpenIcon` or `FilesIcon` depending on `expanded`, and file rows render an empty slot. No new icons. `aria-expanded` on the treeitem still carries open/closed state for assistive tech.

### D8. Shift+Left in `onKeyDown`
`onKeyDown` currently returns early on Ctrl, Alt or Meta. Shift isn't filtered, so add a branch before the plain `ArrowLeft` case: `e.shiftKey && key === "ArrowLeft"` with a highlighted folder calls `collapseSubtree`, and on a file it does nothing and doesn't move. Other Shift+arrow combinations fall through to their current behavior.

## Risks / Trade-offs

- [The fixed toggle slot narrows every row by about 18px] → Long names already ellipsize, and the cost is small next to keeping badges aligned.
- [The open and closed folder icons look alike at 14px] → `aria-expanded` covers accessibility. If they're hard to tell apart in use, a follow-up can tint the open icon. That's a CSS-only change.
- [A blur caused by a click on the toggle button] → Prevented by D3's `mousedown` `preventDefault`. The button is also inside the container, so `relatedTarget` handling in D5 covers keyboard edge cases.
- [Hover-only control is hard to discover] → Accepted by the user. Shift+Left and the README document it.
