# Proposal

## Why

Markdown files (READMEs, docs, specs, agent notes) are opened from the project tree to be read, but today they show as raw source with line numbers. Reading headings, lists, tables and links through the markup is slow. A rendered view makes these files readable at a glance, while the source stays one click away.

## What Changes

- When an **unchanged** Markdown file (`.md`, `.markdown`) is opened from the Files tree, the main pane shows it **rendered** by default: headings, paragraphs, emphasis, lists, task lists, block quotes, code blocks (syntax highlighted), tables, horizontal rules and links (CommonMark plus GitHub-flavoured tables, task lists, strikethrough and autolinks).
- The file header gets a **Source / Rendered** toggle button. Clicking it switches that tab between the rendered view and today's source view (line numbers, highlighting). The choice is per tab and is not remembered; a newly opened Markdown file always starts rendered.
- **Links**: a relative link to another file in the repository opens that file in a tab (an in-page `#anchor` scrolls to the heading). `http`, `https` and `mailto` links open in the system's default browser or mail client. The app window itself never navigates away.
- **Safety and offline**: HTML in the Markdown is rendered after sanitizing it with GitHub's README allowlist (scripts, event handlers, styles, iframes and unsafe links are removed), and only **local images** are loaded: relative image paths inside the repository (common image formats, up to 10 MB) are displayed, while remote images are never fetched and show their alt text as a placeholder, as do missing or unsupported ones.
- **Find** (`Ctrl+F`) works in the rendered view, searching and highlighting the rendered text.
- Automatic updates keep working: when an unchanged file's contents change while it stays unchanged (switching branches, pulling), the rendered view redraws in place, keeping the scroll position as close as possible. Editing the file makes it a changed file, so its tab shows the diff, and it shows rendered again once it is unchanged (for example after a commit).

Out of scope: rendering changed Markdown files (they keep showing their diff), a rendered diff, `.mdx`, Mermaid/math, front-matter tables, remote images, and editing.

## Capabilities

### New Capabilities
- `markdown-preview`: rendering a Markdown file in the main pane — the supported syntax, the Source/Rendered toggle, link handling, raw-HTML and image handling, find in the rendered view, and live updates.

### Modified Capabilities
- `file-explorer`: "View an unchanged file" changes so that unchanged Markdown files open rendered by default instead of as line-numbered source.
- `repo-files`: adds reading a working-tree image's bytes (inside the repository, allowed formats, size-limited) for the rendered view.

## Impact

- **Frontend:**
  - New `MarkdownView` component and a Source/Rendered toggle in `UnchangedFile` (`src/components/DiffPane.tsx`).
  - Per-tab view-mode state (rendered/source) in `src/store.ts`.
  - Fenced code blocks highlighted through the existing Shiki worker (`src/highlight/`).
  - Find in the rendered view via the existing find slice (`src/find/`).
  - Styles for rendered Markdown in light and dark themes in `src/styles.css`.
- **Backend:** a `read_image` command in `src-tauri/src/files.rs` / `commands.rs`, returning raw bytes.
- **New dependencies:** `react-markdown` and `remark-gfm` (frontend); `tauri-plugin-opener` (backend), with a capability scoped to `http`, `https` and `mailto` URLs only.
- **Docs:** README section on viewing Markdown.
