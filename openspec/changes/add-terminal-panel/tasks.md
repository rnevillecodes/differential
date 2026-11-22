# Tasks

## 1. Dependencies

- [x] 1.1 Add `portable-pty` to `src-tauri/Cargo.toml` and verify `cargo build --manifest-path src-tauri/Cargo.toml` succeeds
- [x] 1.2 Add `@xterm/xterm` and `@xterm/addon-fit` to `package.json` and verify `npm install` and `npm run typecheck` succeed

## 2. Backend: shell resolution and session manager

- [x] 2.1 Add `src-tauri/src/terminal/shell.rs` with a pure `resolve_shell(os, env, path_lookup)` (Windows: `pwsh.exe` on PATH else `powershell.exe` with `-NoLogo`; macOS: `$SHELL` or `/bin/zsh` with `-l`; others: `$SHELL` or `/bin/sh`) plus the `TERM`/`COLORTERM` env; verify with unit tests covering each platform branch and fallback
- [x] 2.2 Add `src-tauri/src/terminal/mod.rs` with `TerminalManager` (`Mutex<HashMap<u32, Session>>`, id counter) and `spawn` (validates `cwd` is an existing directory, opens a PTY at `cols`×`rows`, starts the shell), taking an output sink and exit sink as closures so it is testable without Tauri; verify a Rust test spawning a short command (`cmd /c echo hi` on Windows, `sh -c 'echo hi'` elsewhere) receives `hi` in its output and an exit code of 0
- [x] 2.3 Implement the reader thread (64 KiB chunks) and waiter thread (wait → drop master → join reader → report exit) so exit is always reported after the last output; verify the test from 2.2 asserts ordering and that a command printing >1 MiB delivers all bytes before exit
- [x] 2.4 Implement `write`, `resize`, `close` (kill child + drop master, idempotent, unknown id is a no-op) and `close_all`; verify Rust tests: writing `echo marker` plus newline to a spawned interactive shell yields `marker`; `close` on a session running a long sleep reports exit promptly; `close` twice does not error; spawn with a missing `cwd` returns an `Io` error
- [x] 2.5 Map spawn failures (shell not found) to `AppError::Io` with the shell name in the message; verify with a test using an overridden, nonexistent shell path

## 3. Backend: Tauri commands and lifecycle

- [x] 3.1 Add `terminal_spawn` (with `on_data: Channel` sending raw bytes and `on_exit: Channel` sending `{ code }`), `terminal_write`, `terminal_resize`, `terminal_close` to `commands.rs`; `.manage(TerminalManager)` and register them in `lib.rs::configure`; verify `src-tauri/tests/ipc.rs` gains tests that invoke `terminal_resize`/`terminal_close` on an unknown id (no-op) and `terminal_spawn` with a bad `cwd` (error payload)
- [ ] 3.2 Call `TerminalManager::close_all()` on `RunEvent::Exit` in `run()`; verify manually: start `ping -t localhost` (Windows) / `sleep 1000` (Unix) in a terminal, quit the app, and confirm no shell or child process remains in the task manager / `ps`
- [x] 3.3 Update `capabilities/default.json` description to state the webview can start terminal sessions via the app's own commands (no plugin permissions added); verify `npm run tauri build` (or `cargo build`) still accepts the capability file
- [x] 3.4 Run `npm run test:rust` and verify all Rust tests pass on this machine (Windows)

## 4. Frontend: API and store

- [ ] 4.1 Extend `Api` and `tauriApi` in `src/api/index.ts` with `terminalSpawn(cwd, cols, rows, onData, onExit)`, `terminalWrite`, `terminalResize`, `terminalClose` using `invoke` and `new Channel()`; extend the test mock API in `src/test/fixtures.ts`; verify `npm run typecheck` passes
- [ ] 4.2 Add the terminal slice to `src/store.ts` (`terminalOpen`, `terminalHeight` persisted as `differential.terminalOpen`/`differential.terminalHeight`; `terminals` with status; `activeTerminal`; `toggleTerminal`, `newTerminal`, `closeTerminal`, `setActiveTerminal`, `setTerminalHeight`), including: first show creates a terminal, closing the last terminal hides the panel, toggling is a no-op without a repo, repo switch leaves terminals untouched; verify with new cases in `src/store.test.ts`
- [ ] 4.3 Add `src/terminal/sessions.ts`, the idempotent per-tab registry that creates the xterm + fit addon, spawns the backend session with the current repo root, wires data/exit/failure callbacks to the store status, forwards input and resizes, and disposes on close; verify unit tests with mocked `@xterm/xterm` and mock API: calling `ensure` twice spawns once, exit writes the exit message and marks the tab exited, spawn failure marks the tab failed with the message, `close` calls `terminalClose` and disposes

## 5. Frontend: panel UI, keyboard, theme

- [ ] 5.1 Add `TerminalPanel` (tab strip with titles and exited/failed markers, "+" and hide buttons, close × and middle-click on tabs, one mounted container per terminal with inactive ones hidden) and render it in `App.tsx` under `DiffPane` with a drag handle clamped to `[120px, container − 160px]`; add styles in `styles.css`; verify component tests (mocked xterm) for showing/hiding, creating, switching, and closing tabs, and manually that dragging resizes and the height survives a restart
- [ ] 5.2 Fit on panel/window resize via `ResizeObserver` (rAF-debounced, skipped at zero size) and forward cols/rows to `terminalResize`; verify manually that `vim` or `less` redraws correctly after resizing the window and the panel
- [ ] 5.3 Add the toolbar terminal toggle (`aria-pressed`, disabled without a repo, title with `` Ctrl+` ``); verify a component test for its disabled and pressed states
- [ ] 5.4 Update `handleShortcut`: handle `ctrlKey && code === "Backquote"` everywhere; when the target is inside `[data-terminal]`, handle nothing else; in xterm's custom key handler swallow `` Ctrl+` `` and implement `Ctrl+Shift+C`/`Ctrl+Shift+V`, plus a Copy/Paste context menu; verify tests in the existing shortcut tests that `Ctrl+R`, `Ctrl+W`, `Ctrl+B`, `]` inside a terminal return `false` and do not call store actions, while `` Ctrl+` `` toggles the panel from both inside and outside a terminal
- [ ] 5.5 Build the xterm theme from the CSS custom properties and re-apply on `prefers-color-scheme` change; verify manually in light and dark OS modes that text, cursor, selection, and `ls --color`/`Get-ChildItem` output are legible
- [ ] 5.6 Update README: Terminal section (panel, tabs, shell per platform, starts in repo root, survives repo switches, no auto-refresh), `` Ctrl+` `` and `Ctrl+Shift+C/V` in the shortcuts table, and the read-only wording clarified for terminal commands; verify the README renders and its statements match the specs

## 6. Integration checks

- [ ] 6.1 Run `npm test`, `npm run typecheck`, `npm run test:rust`, and `npm run build`; verify all pass
- [ ] 6.2 Manual end-to-end check in `npm run tauri dev` on Windows against the `terminal` spec scenarios: run `git status` with colors, `Ctrl+C` a running command, open two terminals and switch with output preserved, `exit` shows the exit code, close a tab with a running command (process gone), hide/show keeps output, switch repository (old terminal stays, new one starts in new root), `Ctrl+R` in terminal does not refresh the diff, and a terminal command editing a file changes the diff only after `Ctrl+R`
- [ ] 6.3 Contingency: if 3.2 or 6.2 shows grandchild processes surviving on Windows, assign each shell to a Job Object with `KILL_ON_JOB_CLOSE` and re-run the 3.2 check; otherwise mark not needed
