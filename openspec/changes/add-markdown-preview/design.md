# Design

## Context

Unchanged files opened from the tree render in `UnchangedFile` (`src/components/DiffPane.tsx`), which shows `FileView`: a virtualized, line-numbered view fed by `ViewLoad` content from `api.viewFile`. Tabs are `{ path, preview }` in `src/store.ts`; every tab stays mounted (inactive ones are hidden and `inert`), so per-tab UI state survives tab switches as long as it lives with the tab. Files open via `openTreePath(path, pin?)`, which already picks diff vs contents. Find (`src/find/`) works on "search units" (key + text) supplied by each view, and highlights by passing ranges into `TokenSpans`. Syntax highlighting runs in a Shiki web worker through `highlighter.highlight(version, path, content)`, where language comes from `languageFor(path)`. The Tauri app has no opener/shell plugin and `csp: null`, so the webview itself would happily load remote images or follow links if we let it.

## Goals / Non-Goals

**Goals:**
- Render Markdown safely (no raw HTML, no network) with React elements, not `innerHTML`.
- Keep the source view exactly the existing `FileView`.
- Reuse the existing highlighter worker and find slice rather than adding parallel machinery.

**Non-Goals:**
- Virtualizing the rendered view. Markdown files over the large-file limit already need an explicit "load anyway"; normal docs are small enough to render whole.
- Mapping between rendered and source scroll positions when toggling.

## Decisions

### 1. `react-markdown` + `remark-gfm`
Produces a React tree from an mdast; raw HTML is ignored/escaped unless `rehype-raw` is added (we won't), and URL sanitizing is built in. `components` overrides give a clean hook for links, images, code blocks and checkboxes.
- *Alternative — `markdown-it` / `marked` + `dangerouslySetInnerHTML`:* smaller, but needs a sanitizer to be trusted and makes per-element behavior (link interception, highlighting, find) DOM-patching work.
- *Alternative — Shiki's markdown grammar only:* that's the source view we already have.

### 2. Per-tab view mode on the `Tab`
Add `markdownMode?: "rendered" | "source"` (absent = rendered) to `Tab`, plus a `toggleMarkdownMode(path)` action. Living on the tab means it survives tab switches, is dropped when the tab closes, and a preview tab replaced by another file starts fresh — matching the spec without extra bookkeeping. Not persisted (spec says a new tab always starts rendered). Always on; no setting.
- *Alternative — component-local `useState`:* lost if the panel remounts (e.g. when a refresh flips the tab between changed/unchanged and back).

### 3. Markdown detection
`isMarkdown(path)`: extension `md` or `markdown`, case-insensitive. Lives next to `languageFor` in `src/highlight/languages.ts`. `.mdx` excluded.

### 4. Code blocks through the existing worker
Override `code` for fenced blocks: map the info string to a Shiki language (accept Shiki ids directly, else treat it as an extension via the existing `BY_EXTENSION` map — e.g. `ts`, `py`, `sh`), then request tokens with a synthetic path and `version` = `"md:" + file path`, and render lines with `TokenSpans`. Unknown/absent language → plain `<pre><code>`. This needs a small `languageForFence(info)` export; the client's `highlight` gets a variant that takes a language id directly instead of a path.

### 5. Links: intercept every click, open externally via `tauri-plugin-opener`
Override `a` to render an `<a href title>` whose `onClick` always `preventDefault`s, then:
- `#frag` → scroll to the element with `id` = GitHub-style slug of the heading. Headings get ids from a small slugger in the `h1`–`h6` overrides (lowercase, strip punctuation, spaces→`-`, dedupe with `-1`, `-2`).
- Scheme `http`/`https`/`mailto` → `openUrl` from `@tauri-apps/plugin-opener`.
- Other scheme → ignore.
- Otherwise relative: resolve with POSIX path logic against the file's folder, drop `?query`/`#frag`, reject if it escapes the root (leading `..`), else `openTreePath(resolved)` — a missing target gets the existing "File not found" placeholder from `viewFile`, so no file-list lookup is needed (the project file list is loaded lazily and may be null).
The opener capability in `src-tauri/capabilities/default.json` is scoped to `http://*`, `https://*` and `mailto:*` only, so even a bug in the UI can't open arbitrary paths or programs. A global guard in `MarkdownView` (`onClickCapture` on the root) also stops any stray anchor navigation.
- *Alternative — no external links:* users expect README links to work; the scoped plugin is the standard, small way.

### 6. Images as placeholders
Override `img` to render a `<span class="md-image">` with the alt text (or "image") and `title` = src. No `<img>` element is ever created, so nothing is fetched regardless of CSP.

### 7. Find via DOM text + CSS Custom Highlight API
The rendered view is ordinary DOM, so it can't use `TokenSpans` ranges. After render, `MarkdownView` walks its text nodes (skipping nothing visible — task checkboxes have no text) and builds search units, one per text node with key `md:<index>`. `useFind` does the matching as today. Highlights are painted with `CSS.highlights` (`Highlight` of DOM `Range`s for all matches, a second one for the current match), styled with `::highlight(find-match)` / `::highlight(find-current)` using the existing find color variables. Reveal scrolls the current range's bounding rect into view. Units are rebuilt when content changes.
- *Alternative — wrap matches in `<mark>` by mutating React-owned DOM:* fights React reconciliation.
- *Risk:* the Highlight API must exist in all three webviews (WebView2/Chromium yes; WebKitGTK and macOS WKWebView from Safari 17.2-era WebKit). If `CSS.highlights` is missing, find still counts and scrolls to matches but without paint — acceptable degradation, documented in a code comment.

### 8. Live updates and scroll
`ViewLoad` content updates in place (existing watcher behavior). `MarkdownView` is keyed by path only, so a content change re-renders without remounting the scroll container; the browser keeps `scrollTop`, clamped by the new height.

### 9. Header toggle
`UnchangedFile` renders a small button in `.diff-header` (right-aligned, like other header controls) when `isMarkdown(path)` and the load is `ready`: label "Source" while rendered, "Rendered" while showing source, with `aria-pressed` on source. No keyboard shortcut — not requested.

### 10. Styling
A `.markdown-body` block in `styles.css` using existing theme variables (`--fg`, `--bg`, `--border`, link/code colors), max readable width (~80ch, centered), sizes in `rem`/`em` so UI zoom scales it, `pre` and table wrappers with `overflow-x: auto`.

## Risks / Trade-offs

- [New dependencies grow the bundle (react-markdown pulls in unified/remark/mdast)] → Lazy-load `MarkdownView` with `React.lazy` so the cost is paid only when a Markdown file is first opened.
- [Very long Markdown file loaded via "load anyway" renders slowly without virtualization] → Acceptable; it was an explicit opt-in. Highlighting reuses the existing `MAX_HIGHLIGHT_LINES` cutoff per block.
- [Links to ignored files open them even though the tree hides them] → Harmless and read-only; `viewFile` already rejects paths outside the root.
- [Highlight API missing on some webview] → Degrades to count + scroll without paint (see decision 7).
- [GitHub slug rules differ subtly for odd characters] → Good enough for typical headings; mismatched anchors just don't scroll.

## Migration Plan

Additive frontend feature plus one Tauri plugin. Rollback = revert the change; no persisted state is added.
