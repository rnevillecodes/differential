<p align="center">
  <img src="src-tauri/icons/app-icon.svg" alt="Differential logo" width="128" height="128">
</p>

# Differential

A fast, read-only desktop diff viewer for reviewing a git repository's changes — built for checking what a coding agent changed. It diffs a chosen **base ref** (default `HEAD`) against the **working tree**, including uncommitted and untracked files, and never modifies the repository itself (a built-in [terminal](#terminal) lets you run your own commands).

Built with Tauri v2 (Rust backend that shells out to `git`) and React + TypeScript.

## Prerequisites

- **git ≥ 2.30** on `PATH`
- **Rust** (stable) with the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform (on Windows: MSVC build tools and WebView2)
- **Node.js** 20+ and npm

Install the JavaScript dependencies once:

```sh
npm install
```

## Usage

```sh
differential [path] [--base <rev>] [--wait]
```

- `path` — any folder inside a git repository (resolved to the repository root). Without it, Differential starts on an "Open a repository" screen.
- `--base <rev>` — any revision git understands: branch, tag, SHA, `HEAD~3`, … Defaults to `HEAD`. The base can also be changed in the toolbar (see [Comparing against a branch](#comparing-against-a-branch)).
- `--wait` — stay in the foreground instead of detaching (see below).

The command returns your prompt straight away: Differential relaunches itself as a background process, detached from the terminal, so you can keep using or close the terminal (from Git Bash, PowerShell, cmd, or a Unix shell) without closing the app. With `--wait`, the app runs as the process your shell started instead, so shells that wait for their programs, such as Git Bash, wait until you close the window. Development builds (`npx tauri dev`) never detach.

Examples (after `npm run tauri build`):

```sh
src-tauri/target/release/differential C:/code/my-project
src-tauri/target/release/differential C:/code/my-project --base main
```

The window opens maximised.

### Switching repositories

The toolbar shows the open repository's path. Click it (or press `Ctrl+O`) for a searchable list of recently opened repositories: type to filter, pick one to open it, or type a folder path and press `Enter` to open that. **Browse for a folder…** picks a folder with the system dialog, and the × on a row removes it from the list. The list is remembered across restarts. Next to the path, the checked-out branch is shown (or *detached HEAD*); it updates by itself when you switch branches, in a terminal or anywhere else.

### Automatic updates

Differential watches the open repository and keeps up as files change: when an agent, an editor, or a command in the [terminal](#terminal) edits, creates, or deletes files, the changed-file list, the file tree, and the open tabs update within a second or two. Commits, branch switches, and new branches update the branch shown in the toolbar, the base picker, the commit graph, and the diff (a base such as `main` that moved is compared as it now is). There is nothing to turn on.

Updates happen in place: the file you are reading stays on screen, at the same scroll position, until its new version is drawn, and the active tab never changes on its own. A tab closes only when its file no longer exists. Changes to files git ignores (such as `node_modules/` or build output) don't cause updates.

If the repository can't be watched (for example on a Windows drive opened from WSL, or when the system limit on watched folders is reached), the toolbar shows *Automatic updates unavailable*; hover it for the reason, and press Refresh (`Ctrl+R`) to see changes.

### Comparing against a branch

Click **Base** in the toolbar to pick what the working tree is compared against. The list shows the repository's local branches, remote branches, and tags (most recently updated first, the checked-out branch marked *current*); type to filter it. Picking one diffs your current files — committed, uncommitted, and untracked — against that branch's latest commit. Your checkout is never switched or modified.

Any other revision works too: type it (for example `HEAD~3` or a commit SHA) and choose **Use "…"**. Remote branches are shown as of your last `git fetch`; Differential never fetches. The list updates by itself when branches or tags change.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `]` / `[` | Next / previous changed file |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab (also `Ctrl+PageDown` / `Ctrl+PageUp`) |
| `Ctrl+W` | Close the current tab |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+R` | Refresh the diff, file tree, branch list, and commit graph (they also update automatically) |
| `Ctrl+O` | Switch repository (recent repositories) |
| `Ctrl+\` | Toggle unified / side-by-side view |
| ``Ctrl+` `` | Show / hide the terminal panel (works inside a terminal too) |
| `Ctrl+G` | Show / hide the commit graph |
| `Ctrl+F` | Find in the open file or diff |
| `Ctrl+=` / `Ctrl+-` / `Ctrl+0` | Zoom the whole UI in / out / back to 100% (also the − 100% + control in the toolbar; remembered across restarts) |
| `F3` / `Shift+F3` | Next / previous match while the find bar is open |

While a terminal has keyboard focus, every other key goes to the shell; click outside the terminal to use the shortcuts above.

The view mode is remembered across files and restarts. Shift+mouse wheel scrolls the pane under the pointer horizontally in side-by-side view.

### Tabs

Files open in tabs above the diff, so several can be open at once. A single click in the sidebar opens a file in the *preview* tab (shown in italics), which the next single click replaces; double-click a file (or press `Enter` in the Files tree) to open it in a tab that stays. Double-clicking the preview tab keeps it too.

Close a tab with its ×, a middle-click, or `Ctrl+W`. With a tab focused, `←` / `→` and `Home` / `End` move between tabs and `Delete` closes one. Tabs for files that no longer exist are closed when the change is picked up.

### Markdown files

An unchanged Markdown file (`.md` or `.markdown`) opened from the Files tree is shown rendered: headings, lists, tables, task lists, block quotes, and code blocks with syntax highlighting. **Source** in the file header switches that tab to the plain text with line numbers, and **Rendered** switches back; a Markdown file opened in a new tab always starts rendered. A changed Markdown file shows its diff like any other file, and is shown rendered again once it is unchanged (for example after you commit it).

- A link to another file in the repository opens that file in a tab, and a `#heading` link scrolls to that heading. Web and `mailto:` links open in your default browser or mail client. Other links do nothing, and the window never leaves the document.
- HTML in the Markdown is rendered with the same allowlist GitHub uses for READMEs (centred paragraphs, `<details>`, `<kbd>` and so on); scripts, styles, iframes, forms and unsafe links are removed.
- Images stored in the repository (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO or SVG, up to 10 MB) are shown, and update when the file changes. Images from the web are never downloaded; they, and images that can't be shown, appear as their alt text.
- `Ctrl+F` searches the rendered text, so formatting characters such as `**` are not matched.

### Find

Press `Ctrl+F` to find text in the file or diff open in the current tab. If you have selected text on one line, it becomes the search. Otherwise the last search is kept.

- The bar shows which match is current and how many there are ("3 of 17"), or "No results". Every match on screen is highlighted, and the current one stands out.
- `Enter` / `Shift+Enter` in the field, the arrow buttons, or `F3` / `Shift+F3` move to the next / previous match, wrapping around. The view scrolls, sideways too, to show it; in side-by-side view only the side holding the match scrolls.
- Search is plain text and ignores case unless you turn on **Aa** (match case).
- In a diff, both removed and added lines are searched, and so are unchanged lines hidden in collapsed regions. Moving to a hidden match expands its region. Line numbers are not searched.
- The search stays as you switch tabs and applies to whichever tab is active. `Escape` or the × closes the bar.
- Inside a terminal, `Ctrl+F` goes to the shell.

### Sidebar

The sidebar can be hidden with the button at the left of the toolbar or `Ctrl+B`; whether it is shown is remembered. It has two tabs, and the last one used is remembered:

- **Changes**: the changed files, with status and `+/-` line counts.
- **Files**: the whole project as a folder tree (tracked files plus untracked files that are not ignored, and files deleted since the base). Changed files show their status letter; folders show how many changed files they contain. Selecting a changed file shows its diff; selecting an unchanged file shows its contents read-only. The tree updates by itself as files are created and deleted, keeping open folders and the scroll position. The button beside the repository name collapses every folder. Collapsing a folder remembers which of its subfolders were open; to close a folder and all its subfolders, hover its row and use the collapse button at the right end (shown when something below it is open), or press `Shift+←`.

In the Files tree:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move between rows |
| `→` | Expand a folder, or move into an expanded one |
| `←` | Collapse a folder, or move to the parent folder |
| `Shift+←` | Collapse a folder and all its subfolders |
| `Enter` | Open a file in a tab that stays, or toggle a folder |

### Terminal

The terminal panel opens under the file pane with the terminal button at the right of the toolbar or ``Ctrl+` ``. Each terminal is a full interactive shell started in the open repository's root: PowerShell on Windows (PowerShell 7 when `pwsh` is installed, otherwise Windows PowerShell), your `$SHELL` as a login shell on macOS, and `$SHELL` (or `/bin/sh`) elsewhere. Colors, full-screen programs such as `vim` and `less`, and `Ctrl+C` work as in any terminal.

- **+** opens another terminal; tabs switch between them, and × or a middle-click closes one, ending its shell and anything running in it. Closing the last terminal hides the panel.
- The split button in a group's header opens a terminal in a new group just to its right, so terminals sit side by side (up to four groups). Each group has its own tabs, and its **+** opens the new terminal in that group. Clicking into a group makes it the active one (marked with the accent color), which is the terminal `` Ctrl+` `` focuses when the panel is shown.
- Drag the divider between two groups to change their widths; widths last until you quit. Closing a group's last terminal removes the group and gives its space to its neighbor. After a restart the panel opens with a single group.
- Hiding the panel leaves its shells running. Exiting a shell (for example with `exit`) closes its tab, like the ×.
- Double-click a terminal's tab (or press `F2` on it) to rename it. `Enter` saves, `Escape` cancels, and clearing the name restores the default "Terminal N".
- Drag the panel's top edge to resize it. Whether it is shown and its height are remembered.
- The maximize button in the panel's header makes the terminal fill the file pane's area; press it again to restore the panel's height. Combine it with `Ctrl+B` to give the terminal the whole window below the toolbar.
- Copy and paste with `Ctrl+C` / `Ctrl+V` or the right-click menu. `Ctrl+C` copies only when text is selected; with no selection it goes to the shell as an interrupt.
- Opening another repository keeps existing terminals where they are; new terminals start in the new repository.
- What your commands change shows up in the diff and file tree automatically (see [Automatic updates](#automatic-updates)). `Ctrl+R` inside the terminal goes to the shell, not to Differential.

Differential itself never modifies the repository. Commands you run in the terminal can, just as in any other terminal. All shells are ended when the app closes.

### Commit graph

The commit graph pane runs down the right edge of the window, beside the file pane and the terminal. Show or hide it with the graph button at the right of the toolbar or `Ctrl+G`. It shows the history of every local branch, remote branch, and tag (plus a detached `HEAD`), newest first, one row per commit:

- Lanes show where branches split off and merge back; the commit `HEAD` points at has a hollow dot.
- Each row shows the short SHA, labels for the branches and tags pointing at it, and the subject. Hover a row for the full SHA, author, and date.
- **Click a commit** (or press `Enter` on it) to use it as the base, exactly as if you had typed its SHA in **Base**. **Click a branch or tag label** to use that branch or tag instead. Nothing in the repository changes.
- The row of the commit the current base points at is highlighted, wherever the base was picked.
- More history loads as you scroll down. Commits made in the terminal or elsewhere appear automatically.
- Drag the pane's left edge to resize it. Whether it is shown and its width are remembered.

## Development

| Command | What it does |
| --- | --- |
| `npx tauri dev` | Run the app with hot reload |
| `npx tauri dev -- -- <path> --base <rev>` | Run the app with launch arguments (use an absolute path) |
| `npm test` | Frontend tests (Vitest) |
| `npm run test:rust` | Backend unit and integration tests (also regenerates the TypeScript types in `src/model/`) |
| `npm run typecheck` | TypeScript type check |
| `npm run build` | Production build of the frontend |
| `npx tauri build` | Release build of the app |
| `npm run publish-build [-- [--build] [--dest DIR]]` | Copy the release binary to `~/bin` (or `DIR`); `--build` runs `npx tauri build` first |
| `npm run perf-repo [dir] [-- --files [N]]` | Generate a repository with a 50,000-line single-file diff and 1,000 changed files (default `./perf-repo`) for performance checks; `--files` adds N unchanged files in nested folders (default 50,000) for the project tree |

### Layout

```
src-tauri/src/git/      git process runner, repository and base resolution, branch and tag listing, paged commit history
src-tauri/src/diff/     diff model, unified-diff parser, intraline ranges
src-tauri/src/changes.rs  file list, per-file diffs, file content
src-tauri/src/files.rs  project file listing and read-only file view
src-tauri/src/content.rs  shared size limits, binary detection, safe path joining
src-tauri/src/terminal/ shell sessions in pseudo-terminals for the terminal panel
src-tauri/src/launch.rs  detaching from the launching terminal
src-tauri/tests/        integration tests against throwaway git repositories
src/model/              TypeScript types generated from the Rust model (ts-rs)
src/api/                typed wrappers around the Tauri commands
src/rows/               diff model → flat rows for the virtualized views
src/highlight/          Shiki syntax highlighting in a Web Worker
src/tree/               project files → folder tree → visible rows
src/terminal/           xterm.js terminals and their shell sessions
src/graph/              commit graph lane layout
src/components/         toolbar (repo and base pickers), sidebar (file list, project tree), tabs, diff and file views, terminal panel, commit graph
```

Design and requirements live in [`openspec/`](openspec/).
