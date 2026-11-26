# Design

## Context

Unchanged files opened from the tree render in `UnchangedFile` (`src/components/DiffPane.tsx`), which shows `FileView`: a virtualized, line-numbered view fed by `ViewLoad` content from `api.viewFile`. Tabs are `{ path, preview }` in `src/store.ts`; every tab stays mounted (inactive ones are hidden and `inert`), so per-tab UI state survives tab switches as long as it lives with the tab. Files open via `openTreePath(path, pin?)`, which already picks diff vs contents. Find (`src/find/`) works on "search units" (key + text) supplied by each view, and highlights by passing ranges into `TokenSpans`. Syntax highlighting runs in a Shiki web worker through `highlighter.highlight(version, path, content)`, where language comes from `languageFor(path)`. The Tauri app has no opener/shell plugin and `csp: null`, so the webview itself would happily load remote images or follow links if we let it.

## Goals / Non-Goals

**Goals:**
- Render Markdown safely (sanitized HTML only, no network) with React elements, not `innerHTML`.
- Keep the source view exactly the existing `FileView`.
- Reuse the existing highlighter worker and find slice rather than adding parallel machinery.

**Non-Goals:**
- Virtualizing the rendered view. Markdown files over the large-file limit already need an explicit "load anyway"; normal docs are small enough to render whole.
- Mapping between rendered and source scroll positions when toggling.

## Decisions

### 1. `react-markdown` + `remark-gfm`
Produces a React tree from an mdast; URL sanitizing is built in. `components` overrides give a clean hook for links, images, code blocks and checkboxes.
- *Alternative — `markdown-it` / `marked` + `dangerouslySetInnerHTML`:* smaller, but needs a sanitizer to be trusted and makes per-element behavior (link interception, highlighting, find) DOM-patching work.
- *Alternative — Shiki's markdown grammar only:* that's the source view we already have.

### 1b. Raw HTML: `rehype-raw` + `rehype-sanitize` (GitHub schema)
READMEs commonly use HTML (`<p align="center">`, `<details>`, `<kbd>`). `rehype-raw` parses it into the hast tree, then `rehype-sanitize` with its default schema — GitHub's allowlist — removes every element, attribute and URL scheme not on it. The result is still a React tree (no `innerHTML`), so HTML `<a>` and `<img>` go through the same `a`/`img` components as Markdown ones. Plugin order: `rehypeRaw` → `rehypeSanitize` → `rehypeHeadingAnchors` (anchors last, so the sanitizer can't strip `data-anchor`). The sanitizer prefixes `id`s with `user-content-` (anti-clobbering, as GitHub does), so anchor lookup also matches `user-content-<id>`; that also fixes GFM footnote links.
- *Alternative — show HTML as text (the first version):* safe but makes typical README headers unreadable.
- *Alternative — DOMPurify on an HTML string:* needs `innerHTML` and loses per-element React handling.

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

### 6. Local images: a `read_image` command and `blob:` URLs
Images are loaded only from the working tree, never from the network, so the webview never sees an `http(s)`, `file:` or asset URL.
- **Backend:** `read_image(root, path)` returns the file's bytes as a raw IPC response (`tauri::ipc::Response`, no JSON/base64 overhead). It checks, in order: `safe_join` (no absolute or `..`), extension allowlist, `canonicalize` of the file starts with `canonicalize(root)` (stops symlinks out of the repo — `view_file` doesn't need this because it never shows binary content, but images are binary by definition), regular file, size ≤ `limits::MAX_IMAGE_BYTES` (10 MiB, separate from the 2 MiB text limit since screenshots are often bigger). Any failure is an `Invalid`/`Io` error; the UI only needs "not loaded".
- **Frontend:** the `img` component resolves `src` with `linkTarget` (same rules as links); anything but a `file` target with an allowed extension stays a placeholder. Otherwise it calls `api.readImage` through a store action (`readImage(path)`, which supplies the repo root), wraps the bytes in a `Blob` with a MIME type from the extension (needed for SVG), and renders `<img src={blob:…}>`, revoking the URL on unmount or reload. A placeholder shows while loading and on failure.
- **Reload:** the load effect depends on a store counter, `changesSeq`, bumped on every change-set load (watcher pickup or refresh). The `changes` object itself can't be used: it is kept when the new change set is identical, which happens when an already-untracked image is replaced again. A small in-memory cache is not worth it: images are read once per document render.
- **SVG:** shown via `<img>`, where browsers never run its scripts or load its external resources.
- **Sizing:** `max-width: 100%; height: auto`, keeping sanitized `width`/`height` attributes.
- *Alternative — Tauri asset protocol (`convertFileSrc`):* needs a filesystem scope covering every repository the user might open (effectively the whole disk) and puts file URLs in the webview; the command keeps every check in one place.
- *Alternative — base64 data URIs in JSON:* 33% bigger and slower than a raw response.

### 7. Find via DOM text + CSS Custom Highlight API
The rendered view is ordinary DOM, so it can't use `TokenSpans` ranges. After render, `MarkdownView` walks its text nodes (skipping nothing visible — task checkboxes have no text) and builds search units, one per text node with key `md:<index>`. `useFind` does the matching as today. Highlights are painted with `CSS.highlights` (`Highlight` of DOM `Range`s for all matches, a second one for the current match), styled with `::highlight(find-match)` / `::highlight(find-current)` using the existing find color variables. Reveal scrolls the current range's bounding rect into view. Units are rebuilt when content changes.
- *Alternative — wrap matches in `<mark>` by mutating React-owned DOM:* fights React reconciliation.
- *Risk:* the Highlight API must exist in all three webviews (WebView2/Chromium yes; WebKitGTK and macOS WKWebView from Safari 17.2-era WebKit). If `CSS.highlights` is missing, find still counts and scrolls to matches but without paint — acceptable degradation, documented in a code comment.

### 8. Live updates and scroll
`ViewLoad` content updates in place (existing watcher behavior). `MarkdownView` is keyed by path only, so a content change re-renders without remounting the scroll container; the browser keeps `scrollTop`, clamped by the new height. This applies only while the file stays unchanged against the base (branch switch, pull, reset). An edit makes it a changed file, and `TabPanel` already switches the tab to the diff and back when it becomes unchanged again; the tab's `markdownMode` lives on the `Tab`, so it survives that round trip. Changed Markdown files are deliberately never rendered.

### 9. Header toggle
`UnchangedFile` renders a small button in `.diff-header` (right-aligned, like other header controls) when `isMarkdown(path)` and the load is `ready`: label "Source" while rendered, "Rendered" while showing source, with `aria-pressed` on source. No keyboard shortcut — not requested.

### 10. Styling
A `.markdown-body` block in `styles.css` using existing theme variables (`--fg`, `--bg`, `--border`, link/code colors), max readable width (~80ch, centered), sizes in `rem`/`em` so UI zoom scales it, `pre` and table wrappers with `overflow-x: auto`.

## Risks / Trade-offs

- [New dependencies grow the bundle (react-markdown pulls in unified/remark/mdast)] → Lazy-load `MarkdownView` with `React.lazy` so the cost is paid only when a Markdown file is first opened.
- [Very long Markdown file loaded via "load anyway" renders slowly without virtualization] → Acceptable; it was an explicit opt-in. Highlighting reuses the existing `MAX_HIGHLIGHT_LINES` cutoff per block.
- [Links to ignored files open them even though the tree hides them] → Harmless and read-only; `viewFile` already rejects paths outside the root.
- [A document with many large images reads them all at once] → Each is capped at 10 MiB and read on a worker thread (`blocking`), so the UI stays responsive; acceptable for READMEs.
- [Highlight API missing on some webview] → Degrades to count + scroll without paint (see decision 7).
- [GitHub slug rules differ subtly for odd characters] → Good enough for typical headings; mismatched anchors just don't scroll.

## Migration Plan

Additive frontend feature plus one Tauri plugin. Rollback = revert the change; no persisted state is added.
