# Design

## Context

- The terminal panel comes from the in-progress `add-terminal-panel` change. Its `terminal` spec lives only in that change's delta, so this change's MODIFIED requirements are written against that delta. `add-terminal-panel` must be archived (or synced) before this change is archived.
- Store (`src/store.ts`): the terminal slice is a flat `terminals: TerminalTab[]` (id, title, cwd, status) plus `activeTerminal`, `terminalOpen`, `terminalHeight` (persisted) and `terminalMaximized`. The actions are `toggleTerminal`, `newTerminal`, `closeTerminal`, `setActiveTerminal`, `renameTerminal`, `setTerminalHeight` and `toggleTerminalMaximized`. When a shell exits, `onExit` calls `closeTerminal`, and closing the last tab hides the panel. Tab ids come from a counter that is never reset.
- Sessions (`src/terminal/sessions.ts`): a registry outside React keyed by tab id. `attach(id, cwd, host)` creates the xterm once and later only moves its element into `host`. Each entry has its own `ResizeObserver` that refits the xterm, and `onResize` forwards cols and rows to that terminal's PTY. Hidden (zero-size) elements are not fitted. So terminals can already move between containers and resize on their own.
- Panel (`src/components/TerminalPanel.tsx`): one header (tab strip, +, maximize, hide), one `.terminal-body[data-terminal]` that holds a `TerminalHost` per tab (inactive ones `hidden`), and one context menu that acts on `activeTerminal`. On `open`/`active` changes, `sessions.focus(active)` is called. `handleShortcut` ignores everything except `` Ctrl+` `` when the target is inside `[data-terminal]`.

## Goals / Non-Goals

**Goals:**
- Add groups without changing the sessions registry, the backend, or the behavior of a panel that has not been split.
- Keep the store as the single source of truth, so behavior is testable with the mock `Api` and no DOM.

**Non-Goals:**
- Moving terminals between groups (drag-and-drop or menu), or merging groups.
- Stacking groups vertically, or nested layouts.
- A keyboard shortcut for splitting or for moving focus between groups. While a terminal has focus, every key except `` Ctrl+` `` goes to the shell, and adding exceptions is a separate decision.
- Persisting groups, widths, or terminals across restarts.

## Decisions

### Store shape: groups reference tab ids
Keep `terminals: TerminalTab[]` as the flat metadata list, unchanged, and add:
- `terminalGroups: { id: number; tabs: number[]; active: number; size: number }[]` in display order (left to right). `size` is a fraction of the panel width, and the sizes add up to 1.
- `activeTerminalGroup: number | null`.

`activeTerminal` stays as a derived-but-stored field: it is always the active group's `active` tab. Each action that changes groups updates it in the same `set`, so existing readers (focus effect, context menu, tests) keep working. Group ids come from their own never-reused counter.
- *Alternative:* nest tabs inside groups (`groups[].terminals: TerminalTab[]`). Rejected: it rewrites every reader of `terminals` (status updates, rename, tests) for no gain, and status updates from sessions are keyed by tab id anyway.

Invariants, enforced by the actions and covered by store tests: every tab is in exactly one group, no group is empty, `terminals.length === 0` ⇔ `terminalGroups.length === 0`, and `activeTerminalGroup` points at an existing group whenever any exist.

### Actions
- `newTerminal(groupId?)`: adds the tab to `groupId`, or to the active group when no id is given. With no groups, it creates the first group with `size: 1`. Makes the tab that group's active tab and makes the group active.
- `splitTerminal(groupId)`: no-op at `MAX_TERMINAL_GROUPS = 4` or without a repo. Otherwise it creates a tab and a new group right after `groupId`, halves the source group's `size` and gives the new group the other half, makes the new group active, and opens the panel if it was hidden.
- `closeTerminal(id)`: removes the tab from its group. If the group still has tabs and the closed tab was its active tab, the neighbor tab takes over (same index rule as today). If the group is now empty, it is removed and its `size` goes to the left neighbor (the right one for the leftmost group). If it was the active group, that neighbor becomes active. Closing the last tab hides the panel, as today. `onExit` still goes through here.
- `setActiveTerminal(id)`: also makes the tab's group active.
- `setActiveTerminalGroup(groupId)`: sets the group and updates `activeTerminal`.
- `setTerminalGroupSizes(sizes: number[])`: replaces all sizes and normalizes them to add up to 1. It is called by divider dragging.
- When the panel is first shown or the app restarts, the store starts with no groups, and the existing "show empty panel ⇒ `newTerminal()`" path creates group 1. That is how the spec's single-group restart behavior is met.

### Layout: flex row with fractional widths
`.terminal-panel` keeps its vertical resize handle on top. Its content becomes `.terminal-groups`, a flex row of `.terminal-group` elements, each `flex: <size> 1 0` with `min-width: MIN_TERMINAL_GROUP_WIDTH` (200px), separated by `.terminal-group-divider` elements (4px, `cursor: col-resize`, `role="separator"`, `aria-orientation="vertical"`). Each group is a column: its own `.terminal-header` (tab strip, +, split) and its own `.terminal-body[data-terminal]` holding that group's `TerminalHost`s. Fractions keep proportions when the window or panel is resized, with no extra code.

The maximize/restore and hide buttons render only in the last group's header, after its split button, so a one-group panel looks the same as today apart from the new split button.
- *Alternative:* a separate full-width panel title bar for the panel controls. Rejected: it costs a row of terminal height in a panel that is usually short.

### Divider dragging
Use the same pointer-capture pattern as the existing height handle. On pointer down, record the pixel widths of the two adjacent groups and the panel width. On move, shift pixels between those two only, clamped so neither goes below `MIN_TERMINAL_GROUP_WIDTH`, then convert all widths back to fractions and call `setTerminalGroupSizes`. Each xterm's own `ResizeObserver` refits it and resizes its PTY. Nothing new is needed in sessions.

### Rendering hosts per group
`TerminalPanel` maps groups to a `TerminalGroup` component that renders `TerminalHost` for each of its tab ids. React keys hosts by tab id within a group. If a tab ever changed groups, the new host would call `sessions.attach`, which moves the existing element. That case does not happen in this change, but it is safe.

### Active group and focus
- Each group's root listens to `onFocusCapture` (fires when its xterm textarea gets focus) and `onPointerDown`, and calls `setActiveTerminalGroup(group.id)` when the group is not already active. Focus is the reliable signal, because xterm puts focus in its hidden textarea on click.
- The existing effect `open && activeTerminal !== null ⇒ sessions.focus(activeTerminal)` already focuses the right terminal, because `activeTerminal` follows the active group. The effect also runs after a split, because `activeTerminal` changes to the new tab.
- When `terminalGroups.length > 1`, the active group gets an `active` class: its tab strip's active tab uses the accent top border, and inactive groups' active tabs use a muted border.

### Context menu per group
`onContextMenu` moves to each group's body and records that group's active tab id in the menu state (`{ x, y, canCopy, tab }`). Copy and Paste act on `menu.tab` instead of the global `activeTerminal`, and right-clicking also activates the group.

### Keyboard
No change to `handleShortcut`. Every group body keeps `data-terminal`, so the "keys belong to the shell" rule applies in every group. `` Ctrl+` `` still toggles the whole panel.

## Risks / Trade-offs

- [Narrow groups make full-screen programs cramped] → 200px minimum width and a 4-group cap. At the minimum panel widths typical for this app, 4 groups still fit, and `min-width` overflow is clipped rather than wrapped.
- [Many visible terminals cost rendering time under heavy output] → at most 4 visible xterms. Each already batches writes, which is acceptable for a desktop app.
- [`activeTerminal` drifting from groups] → only group-aware actions write it, and store tests assert the invariant after each action.
- [Archive ordering] → this change modifies requirements that only exist in `add-terminal-panel`'s delta. Archive that change first. Running `openspec validate` on this change reports that as INFO until then.
- [Window narrower than 4 × 200px] → groups keep their min width and the row clips. Acceptable at this size, and the user can close a group.

## Migration Plan

Additive and frontend-only. No persisted keys change, so stored `terminalOpen`/`terminalHeight` stay valid. Rollback is reverting the change.
