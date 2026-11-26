# Proposal

## Why

Markdown files (READMEs, docs, specs, agent notes) are opened from the project tree to be read, but today they show as raw source with line numbers. Reading headings, lists, tables and links through the markup is slow. A rendered view makes these files readable at a glance, while the source stays one click away.

## What Changes

- When an **unchanged** Markdown file (`.md`, `.markdown`) is opened from the Files tree, the main pane shows it **rendered** by default: headings, paragraphs, emphasis, lists, task lists, block quotes, code blocks (syntax highlighted), tables, horizontal rules and links (CommonMark plus GitHub-flavoured tables, task lists, strikethrough and autolinks).
- The file header gets a **Source / Rendered** toggle button. Clicking it switches that tab between the rendered view and today's source view (line numbers, highlighting). The choice is per tab and is not remembered; a newly opened Markdown file always starts rendered.
- **Links**: a relative link to another file in the repository opens that file in a tab (an in-page `#anchor` scrolls to the heading). `http`, `https` and `mailto` links open in the system's default browser or mail client. The app window itself never navigates away.
- **Safety and offline**: raw HTML in the Markdown is not rendered (shown as text), and images are not loaded — each image shows its alt text as a placeholder.
- **Find** (`Ctrl+F`) works in the rendered view, searching and highlighting the rendered text.
- Automatic updates keep working: when the file changes on disk, the rendered view redraws in place, keeping the scroll position as close as possible.

Out of scope: rendering changed Markdown files (they keep showing their diff), a rendered diff, `.mdx`, Mermaid/math, front-matter tables, loading images, and editing.

## Capabilities

### New Capabilities
- `markdown-preview`: rendering a Markdown file in the main pane — the supported syntax, the Source/Rendered toggle, link handling, raw-HTML and image handling, find in the rendered view, and live updates.

### Modified Capabilities
- `file-explorer`: "View an unchanged file" changes so that unchanged Markdown files open rendered by default instead of as line-numbered source.

## Impact

- **Frontend:**
  - New `MarkdownView` component and a Source/Rendered toggle in `UnchangedFile` (`src/components/DiffPane.tsx`).
  - Per-tab view-mode state (rendered/source) in `src/store.ts`.
  - Fenced code blocks highlighted through the existing Shiki worker (`src/highlight/`).
  - Find in the rendered view via the existing find slice (`src/find/`).
  - Styles for rendered Markdown in light and dark themes in `src/styles.css`.
- **New dependencies:** `react-markdown` and `remark-gfm` (frontend); `tauri-plugin-opener` (backend), with a capability scoped to `http`, `https` and `mailto` URLs only.
- **Docs:** README section on viewing Markdown.
