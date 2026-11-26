# Tasks

## 1. Dependencies and opener plugin

- [x] 1.1 Add `react-markdown` and `remark-gfm` to `package.json` (exact current versions) and verify `npm install` and `npm run typecheck` succeed
- [x] 1.2 Add `tauri-plugin-opener` to `src-tauri/Cargo.toml` and `@tauri-apps/plugin-opener` to `package.json`, register the plugin in `src-tauri/src/lib.rs`, and verify `npm run test:rust` passes
- [x] 1.3 Grant `opener:allow-open-url` in `src-tauri/capabilities/default.json` scoped to `http://*`, `https://*` and `mailto:*` only, update the capability description, and verify the app builds (`npx tauri build --debug` or `npx tauri dev` starts) with no capability errors

## 2. Detection, tab mode and toggle

- [x] 2.1 Add `isMarkdown(path)` (`.md`/`.markdown`, case-insensitive, not `.mdx`) and `languageForFence(info)` to `src/highlight/languages.ts`; verify with unit tests covering `README.md`, `NOTES.MARKDOWN`, `page.mdx`, fences `ts`, `typescript`, `py`, `nosuchlang`, and empty
- [x] 2.2 Add `markdownMode?: "rendered" | "source"` to `Tab` and a `toggleMarkdownMode(path)` action in `src/store.ts`; verify with store tests that a new tab is rendered, the toggle flips only that tab, and closing and reopening the file (or a preview tab being replaced) starts rendered again
- [x] 2.3 In `UnchangedFile` (`src/components/DiffPane.tsx`), show a header toggle button for ready Markdown files ("Source" / "Rendered", `aria-pressed`) and choose between `FileView` and a `MarkdownView` placeholder by tab mode; verify with component tests that `main.ts` has no button and `README.md` switches between source lines and the rendered container

## 3. Rendered view

- [x] 3.1 Create `src/components/MarkdownView.tsx` (loaded with `React.lazy`) rendering content with `react-markdown` + `remark-gfm`, no raw HTML; verify with tests that headings, emphasis, inline code, lists, quotes, GFM tables with alignment, strikethrough and autolinks render, and that `<script>` / `<img onerror>` source appears as text with no elements created
- [x] 3.2 Override task-list checkboxes to be read-only and images to render an alt-text placeholder (`image` fallback, `title` = src) with no `<img>` element; verify with tests that clicking a checkbox does not change it and no `img` exists in the output
- [x] 3.3 Highlight fenced code blocks through the existing worker: add a language-id variant to `HighlightClient`, render lines with `TokenSpans`, plain `<pre>` for unknown languages; verify with tests using the mocked worker that a `ts` fence requests TypeScript and a `nosuchlang` fence requests nothing
- [x] 3.4 Add heading ids via a GitHub-style slugger (with `-1`, `-2` dedupe); verify with unit tests for punctuation, case, and duplicate headings
- [x] 3.5 Add `.markdown-body` styles in `src/styles.css` (theme variables, readable max width, `em`/`rem` sizing, horizontal scroll for `pre` and tables) and verify visually in light and dark themes and at 150% UI zoom with `npm run tauri dev`
- [x] 3.6 Render HTML through `rehype-raw` + `rehype-sanitize` (default GitHub schema), replacing the HTML-as-text plugin; make anchor lookup accept `user-content-` ids. Verify with tests that `<p align>`, `<details>`/`<summary>` and `<kbd>` render, that `<script>`, `<iframe>`, `on*` attributes and `javascript:` hrefs are removed, that an HTML `<img>` becomes a placeholder, and in the running app that this project's README header shows a centred logo placeholder

## 4. Links

- [x] 4.1 Implement link handling in `MarkdownView`: always `preventDefault`, `#anchor` scrolls to the heading, `http`/`https`/`mailto` call `openUrl`, other schemes are ignored, relative paths resolve against the file's folder (dropping query/fragment, rejecting paths escaping the root) and call `openTreePath`; every link has its target as `title`. Verify with tests (opener mocked) for each case in the "Links" requirement, including `../SETUP.md`, `javascript:`, `file:`, and an escaping `../../x.md`
- [ ] 4.2 Verify in the running app that clicking a web link opens the default browser, a relative link opens the file (its diff when changed, "File not found" when missing), and the window never navigates away

## 5. Find and live updates

- [x] 5.1 Build find search units from `MarkdownView`'s rendered text nodes and paint matches with the CSS Custom Highlight API (`::highlight(find-match)` / `::highlight(find-current)` using existing find colors), revealing the current match by scrolling its range into view; degrade to count + scroll when `CSS.highlights` is missing. Verify with tests that searching `**` in `**bold** text` gives no results, a word appearing three times reports 3, and next/previous moves the current match
- [x] 5.2 Verify that toggling rendered/source with the find bar open re-runs the query against the newly shown view (test), and that `Ctrl+F` in the running app highlights matches in a rendered README
- [x] 5.3 Key `MarkdownView` by path so content updates re-render in place; verify with a test that new content replaces the old without remounting the scroll container, and in the running app that a branch switch changing an open README updates the rendered view while staying scrolled near the same place, that editing it shows its diff, and that committing the edit shows it rendered again

## 6. Docs and integration

- [x] 6.1 Add a "Viewing Markdown" section to `README.md` (rendered by default, Source button, link behavior, no images/HTML) and verify it renders correctly in the app's own rendered view
- [x] 6.2 Run `npm test`, `npm run typecheck` and `npm run test:rust` and verify all pass

## 7. Local images

- [x] 7.1 Add `read_image` (Rust): `MAX_IMAGE_BYTES` (10 MiB) in `content::limits`, `files::read_image` with `safe_join`, extension allowlist, canonical-path containment, regular-file and size checks, a `commands::read_image` returning `tauri::ipc::Response`, registered in `lib.rs`. Verify with Rust tests for a PNG round trip (exact bytes), a non-image extension, `..`, a symlink to a file outside the repo, a missing file and an oversized file, plus an IPC test
- [x] 7.2 Add `readImage` to the `Api` interface, the Tauri implementation and `fakeApi`, and a store action that supplies the repo root; verify with `npm run typecheck` and a store test that it calls the API with the open repository's root
- [x] 7.3 Load local images in `MarkdownView`'s `img` component (resolve like links, allowed extensions only, `Blob` with the right MIME type, revoke URLs, reload on every change-set load via a `changesSeq` store counter, placeholder while loading and on failure) and add image sizing styles; verify with tests that a relative and an HTML image load, remote/`data:`/unsupported/escaping sources never call the API, a failed read shows the placeholder, and a change pickup reloads the image
- [x] 7.4 Update the README's Markdown section for local images, and verify in the running app that a relative PNG and this project's README logo (SVG) display, a remote image stays a placeholder, and replacing the PNG on disk updates it
