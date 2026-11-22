# Proposal

## Why

Differential is used to check what a coding agent changed, but today the reviewer has to switch to a separate terminal window to run the tests, poke at the code, or drive the agent itself, then switch back and refresh. An integrated terminal panel keeps that loop inside one window, rooted in the repository being reviewed.

## What Changes

- Add a **terminal panel** docked below the diff pane, shown and hidden with a toolbar button and `` Ctrl+` ``. Its open state and height are remembered across restarts.
- Each terminal is a **full interactive shell** running in a pseudo-terminal (the user's default shell, started in the open repository's root): colors, cursor movement, full-screen programs (`vim`, `less`, agent TUIs), `Ctrl+C`, and resizing all work.
- The panel holds **multiple terminals as tabs**: create a new one, switch between them, close one (which ends its shell). A shell that exits leaves its tab open showing the exit status until closed.
- While a terminal has keyboard focus, keystrokes go to the shell — the app's own shortcuts (`Ctrl+R`, `Ctrl+W`, `Ctrl+B`, `[`/`]`, …) are not intercepted, except the panel toggle.
- Terminals follow the light/dark theme. All shells are ended when the app closes.
- **No automatic refresh**: running commands in the terminal does not refresh the diff; `Ctrl+R` remains the way to reload.
- The application's own controls stay read-only. The `diff-viewer` "Read-only presentation" requirement is narrowed so it is clear that commands the user types in a terminal are theirs, not an app action that changes the repository.

## Capabilities

### New Capabilities
- `terminal`: the integrated terminal panel — interactive shell sessions in a pseudo-terminal, terminal tabs, panel visibility and sizing, keyboard focus rules, and session lifecycle.

### Modified Capabilities
- `diff-viewer`: "Read-only presentation" is clarified so that the application offers no mutating controls of its own, while input the user types into a terminal session is outside that rule.

## Impact

- **Backend (Rust)**: new `terminal` module managing PTY sessions (spawn, write, resize, close, kill-all on exit) and new Tauri commands; streaming output to the webview over a Tauri IPC channel. New dependency: `portable-pty` (ConPTY on Windows, Unix PTYs elsewhere).
- **Frontend**: new dependencies `@xterm/xterm` and `@xterm/addon-fit`; new `TerminalPanel` component (tab strip, xterm views, resize handle), store slice for terminal tabs and panel state, layout change in `App.tsx`/`styles.css`, a toolbar toggle, and shortcut handling changes in `handleShortcut`.
- **API surface**: `Api` gains terminal methods (mocked in tests).
- **Security posture**: the webview can now start a shell through app commands. Only the bundled UI can call them (no remote content is loaded); the capability file's description is updated to say so.
- **Docs**: README gains a Terminal section and the new shortcut; the "never modifies the repository" wording is kept for the app and clarified for the terminal.
