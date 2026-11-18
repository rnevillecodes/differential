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

- `path` — any folder inside a git repository (resolved to the repository root). Without it, differential starts on an "Open a repository" screen (or press `Ctrl+O`).
- `--base <rev>` — any revision git understands: branch, tag, SHA, `HEAD~3`, … Defaults to `HEAD`. The base can also be changed in the toolbar (see [Comparing against a branch](#comparing-against-a-branch)).

Examples (after `npm run tauri build`):

```sh
src-tauri/target/release/differential C:/code/my-project
src-tauri/target/release/differential C:/code/my-project --base main
```

### Comparing against a branch

Click **Base** in the toolbar to pick what the working tree is compared against. The list shows the repository's local branches, remote branches, and tags (most recently updated first, the checked-out branch marked *current*); type to filter it. Picking one diffs your current files — committed, uncommitted, and untracked — against that branch's latest commit. Your checkout is never switched or modified.

Any other revision works too: type it (for example `HEAD~3` or a commit SHA) and choose **Use "…"**. Remote branches are shown as of your last `git fetch`; differential never fetches. Refresh (`Ctrl+R`) reloads the list.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `]` / `[` | Next / previous file |
| `Ctrl+R` | Refresh the diff |
| `Ctrl+O` | Open a repository |
| `Ctrl+\` | Toggle unified / side-by-side view |

The view mode is remembered across files and restarts. Shift+mouse wheel scrolls the pane under the pointer horizontally in side-by-side view.

### Sidebar

The sidebar has two tabs, and the last one used is remembered:

- **Changes**: the changed files, with status and `+/-` line counts.
- **Files**: the whole project as a folder tree (tracked files plus untracked files that are not ignored, and files deleted since the base). Changed files show their status letter; folders show how many changed files they contain. Selecting a changed file shows its diff; selecting an unchanged file shows its contents read-only. The tree updates when you refresh.

In the Files tree:

| Key | Action |
| --- | --- |
| `↑` / `↓` | Move between rows |
| `→` | Expand a folder, or move into an expanded one |
| `←` | Collapse a folder, or move to the parent folder |
| `Enter` | Open a file, or toggle a folder |

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
src-tauri/src/git/      git process runner, repository and base resolution
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
src/components/         toolbar, sidebar (file list, project tree), diff and file views
```

Design and requirements live in [`openspec/`](openspec/).
