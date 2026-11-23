# Proposal

## Why

The terminal panel shows one terminal at a time, so the common review loop of a long-running process (dev server, test watcher, coding agent) next to a scratch shell means switching tabs over and over. Splitting the panel into groups that sit side by side lets the reviewer see several terminals at once, and the wide, short panel has room for it.

## What Changes

- The terminal panel can be **split into tab groups** laid out side by side (one row; vertical dividers only). Each group has its own tab strip and its own active terminal, and shows that terminal. A panel that has not been split looks and behaves as it does today: a single group.
- Each group's header has a **split** control. It opens a new terminal (a fresh shell in the open repository's root) in a new group placed directly to the right of that group, and the new terminal gets keyboard focus. The panel holds at most **4 groups**, and the split control is disabled at the limit.
- The **+** control in a group's header opens the new terminal in that group.
- Exactly one group is **active**: the one whose terminal last had keyboard focus, or that the user last clicked. It is shown as active. Showing the panel (`` Ctrl+` ``) focuses the active group's terminal.
- **Draggable dividers** between groups change their widths, with a minimum width so every group stays usable. A new group takes half the width of the group it was split from, and a closed group's width goes to its neighbor. Widths last for the session only and are not saved.
- Closing a group's last terminal (with × or middle-click, or because its shell exited) **removes the group**. Closing the last terminal in the panel still hides it.
- The panel's own controls (maximize/restore, hide) appear once, at the right end of the rightmost group's header. Resize, maximize, hide/show, rename, copy/paste and the keyboard rules work the same as before. The right-click menu acts on the terminal that was clicked.
- After a restart the panel comes back with a single group, as today. Groups and terminals are not restored.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `terminal`: adds requirements for splitting the panel into side-by-side tab groups, the active group, resizing groups, and removing empty groups. "Multiple terminals as tabs", "Closing a terminal ends its shell", "Shell exit closes the tab", and "Terminal size follows the panel" are rewritten for groups. The `terminal` capability is introduced by the in-progress `add-terminal-panel` change and does not exist in `openspec/specs/` yet. That change has to be archived (or synced) before this one is archived.

## Impact

- **Frontend store** (`src/store.ts`): the terminal slice gains groups (`terminalGroups`, `activeTerminalGroup`) and the actions `splitTerminal`, `setActiveTerminalGroup` and `setTerminalGroupSizes`. `newTerminal`, `closeTerminal` and `setActiveTerminal` become aware of groups. `activeTerminal` stays, and means the active group's active terminal.
- **Components** (`src/components/TerminalPanel.tsx`): the panel renders one header, tab strip and body per group, plus dividers. The context menu is per group. A new split icon goes in `src/components/icons`. Styles change in `src/styles.css`.
- **Terminal sessions** (`src/terminal/sessions.ts`): no API change. Each terminal's xterm already fits itself to its own container, and moving elements between hosts is already supported.
- **Backend**: no change. Each terminal is still one PTY session, resized independently.
- **Tests**: new store cases in `src/store.test.ts` and component cases in `src/components/terminal.test.tsx`.
- **Docs**: the Terminal section of the README explains splitting.
