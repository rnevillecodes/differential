<p align="center">
  <img src="src-tauri/icons/app-icon.svg" alt="differential logo" width="128" height="128">
</p>

# differential

A fast, read-only desktop diff viewer for reviewing a git repository's changes — built for checking what a coding agent changed. It diffs a chosen **base ref** (default `HEAD`) against the **working tree**, including uncommitted and untracked files, and never modifies the repository.

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
differential [path] [--base <rev>]
```

- `path` — any folder inside a git repository (resolved to the repository root). Without it, differential starts on an "Open a repository" screen.
- `--base <rev>` — any revision git understands: branch, tag, SHA, `HEAD~3`, … Defaults to `HEAD`. The base can also be changed in the toolbar (see [Comparing against a branch](#comparing-against-a-branch)).

Examples (after `npm run tauri build`):

```sh
src-tauri/target/release/differential C:/code/my-project
src-tauri/target/release/differential C:/code/my-project --base main
```

The window opens maximised.

### Switching repositories

The toolbar shows the open repository's path. Click it (or press `Ctrl+O`) for a searchable list of recently opened repositories: type to filter, pick one to open it, or type a folder path and press `Enter` to open that. **Browse for a folder…** picks a folder with the system dialog, and the × on a row removes it from the list. The list is remembered across restarts.

### Comparing against a branch

Click **Base** in the toolbar to pick what the working tree is compared against. The list shows the repository's local branches, remote branches, and tags (most recently updated first, the checked-out branch marked *current*); type to filter it. Picking one diffs your current files — committed, uncommitted, and untracked — against that branch's latest commit. Your checkout is never switched or modified.

Any other revision works too: type it (for example `HEAD~3` or a commit SHA) and choose **Use "…"**. Remote branches are shown as of your last `git fetch`; differential never fetches. Refresh (`Ctrl+R`) reloads the list.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `]` / `[` | Next / previous changed file |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab (also `Ctrl+PageDown` / `Ctrl+PageUp`) |
| `Ctrl+W` | Close the current tab |
| `Ctrl+B` | Show / hide the sidebar |
| `Ctrl+R` | Refresh the diff, file tree, and branch list |
| `Ctrl+O` | Switch repository (recent repositories) |
| `Ctrl+\` | Toggle unified / side-by-side view |

The view mode is remembered across files and restarts. Shift+mouse wheel scrolls the pane under the pointer horizontally in side-by-side view.

### Tabs

Files open in tabs above the diff, so several can be open at once. A single click in the sidebar opens a file in the *preview* tab (shown in italics), which the next single click replaces; double-click a file (or press `Enter` in the Files tree) to open it in a tab that stays. Double-clicking the preview tab keeps it too.

Close a tab with its ×, a middle-click, or `Ctrl+W`. With a tab focused, `←` / `→` and `Home` / `End` move between tabs and `Delete` closes one. Tabs for files that no longer exist are closed on refresh.

### Sidebar

The sidebar can be hidden with the button at the left of the toolbar or `Ctrl+B`; whether it is shown is remembered. It has two tabs, and the last one used is remembered:

- **Changes**: the changed files, with status and `+/-` line counts.
- **Files**: the whole project as a folder tree (tracked files plus untracked files that are not ignored, and files deleted since the base). Changed files show their status letter; folders show how many changed files they contain. Selecting a changed file shows its diff; selecting an unchanged file shows its contents read-only. The tree updates when you refresh. The button beside the repository name collapses every folder.

In the Files tree:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move between rows |
| `→` | Expand a folder, or move into an expanded one |
| `←` | Collapse a folder, or move to the parent folder |
| `Enter` | Open a file in a tab that stays, or toggle a folder |

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
| `npm run perf-repo [dir] [-- --files [N]]` | Generate a repository with a 50,000-line single-file diff and 1,000 changed files (default `./perf-repo`) for performance checks; `--files` adds N unchanged files in nested folders (default 50,000) for the project tree |

### Layout

```
src-tauri/src/git/      git process runner, repository and base resolution, branch and tag listing
src-tauri/src/diff/     diff model, unified-diff parser, intraline ranges
src-tauri/src/changes.rs  file list, per-file diffs, file content
src-tauri/src/files.rs  project file listing and read-only file view
src-tauri/src/content.rs  shared size limits, binary detection, safe path joining
src-tauri/tests/        integration tests against throwaway git repositories
src/model/              TypeScript types generated from the Rust model (ts-rs)
src/api/                typed wrappers around the Tauri commands
src/rows/               diff model → flat rows for the virtualized views
src/highlight/          Shiki syntax highlighting in a Web Worker
src/tree/               project files → folder tree → visible rows
src/components/         toolbar (repo and base pickers), sidebar (file list, project tree), tabs, diff and file views
```

Design and requirements live in [`openspec/`](openspec/).
