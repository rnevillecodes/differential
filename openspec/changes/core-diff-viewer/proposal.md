# Proposal

## Why

Reviewing what a coding agent changed is now the main human checkpoint in an agentic dev workflow, and existing diff tools are either editors with a diff mode bolted on or generic "compare two files" utilities. We need a fast, read-only, visual diff tool built for one job, reviewing a repo's changes against a chosen base, as the foundation that later agent-review features (review marks, comments, live refresh, worktrees, agent integration) will build on.

## What Changes

- New Tauri v2 desktop application (React + TypeScript frontend, Rust backend), Windows first.
- Open a git repository (by path argument or folder picker) and diff a chosen **base ref** (default `HEAD`) against the **working tree**, including uncommitted and **untracked** files.
- The tool is strictly **read-only**: it never modifies the repository, its index, or its refs.
- Rust backend shells out to the `git` CLI and parses unified diff output into a typed **diff model** (files, hunks, lines) that is the stable seam for future features.
- File list showing each changed file's status (added / modified / deleted / renamed / untracked) and `+/-` line counts.
- Custom, virtualized diff renderer with **unified** and **side-by-side** views, syntax highlighting, word-level intraline highlights, and expandable collapsed context.
- Placeholders for binary files and large files instead of rendering them inline.

Out of scope for this change (future changes): live refresh / file watching, multiple worktrees, per-file review marks, comments, agent integration (CLI/MCP hooks), merge-base (`base...`) mode, line wrapping.

## Capabilities

### New Capabilities
- `repo-diff`: Producing the diff of a repository from a base ref to the working tree, read-only via the `git` CLI, including untracked files, rename detection, binary/large file classification, and full-file content for context expansion, exposed as a typed diff model.
- `diff-viewer`: Presenting a repo diff visually: repository/base selection, changed-file list with stats, unified and side-by-side views, syntax and intraline highlighting, context expansion, placeholders, and the performance expectations for large diffs.

### Modified Capabilities
<!-- None: this is the first change in a new project. -->

## Impact

- New project scaffold: `src-tauri/` (Rust, Tauri v2) and `src/` (React + TypeScript, Vite).
- Runtime dependency: a `git` executable on `PATH`.
- New dependencies (indicative): `tauri` v2, `serde`, `similar` (Rust); `react`, `@tanstack/react-virtual`, `shiki` (frontend).
- No existing code, APIs, or specs are affected.
