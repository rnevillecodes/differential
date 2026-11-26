# Tasks

## 1. Dependencies and opener plugin

- [ ] 1.1 Add `react-markdown` and `remark-gfm` to `package.json` (exact current versions) and verify `npm install` and `npm run typecheck` succeed
- [ ] 1.2 Add `tauri-plugin-opener` to `src-tauri/Cargo.toml` and `@tauri-apps/plugin-opener` to `package.json`, register the plugin in `src-tauri/src/lib.rs`, and verify `npm run test:rust` passes
- [ ] 1.3 Grant `opener:allow-open-url` in `src-tauri/capabilities/default.json` scoped to `http://*`, `https://*` and `mailto:*` only, update the capability description, and verify the app builds (`npx tauri build --debug` or `npx tauri dev` starts) with no capability errors

## 2. Detection, tab mode and toggle

- [ ] 2.1 Add `isMarkdown(path)` (`.md`/`.markdown`, case-insensitive, not `.mdx`) and `languageForFence(info)` to `src/highlight/languages.ts`; verify with unit tests covering `README.md`, `NOTES.MARKDOWN`, `page.mdx`, fences `ts`, `typescript`, `py`, `nosuchlang`, and empty
- [ ] 2.2 Add `markdownMode?: "rendered" | "source"` to `Tab` and a `toggleMarkdownMode(path)` action in `src/store.ts`; verify with store tests that a new tab is rendered, the toggle flips only that tab, and closing and reopening the file (or a preview tab being replaced) starts rendered again
- [ ] 2.3 In `UnchangedFile` (`src/components/DiffPane.tsx`), show a header toggle button for ready Markdown files ("Source" / "Rendered", `aria-pressed`) and choose between `FileView` and a `MarkdownView` placeholder by tab mode; verify with component tests that `main.ts` has no button and `README.md` switches between source lines and the rendered container

## 3. Rendered view

- [ ] 3.1 Create `src/components/MarkdownView.tsx` (loaded with `React.lazy`) rendering content with `react-markdown` + `remark-gfm`, no raw HTML; verify with tests that headings, emphasis, inline code, lists, quotes, GFM tables with alignment, strikethrough and autolinks render, and that `<script>` / `<img onerror>` source appears as text with no elements created
- [ ] 3.2 Override task-list checkboxes to be read-only and images to render an alt-text placeholder (`image` fallback, `title` = src) with no `<img>` element; verify with tests that clicking a checkbox does not change it and no `img` exists in the output
- [ ] 3.3 Highlight fenced code blocks through the existing worker: add a language-id variant to `HighlightClient`, render lines with `TokenSpans`, plain `<pre>` for unknown languages; verify with tests using the mocked worker that a `ts` fence requests TypeScript and a `nosuchlang` fence requests nothing
- [ ] 3.4 Add heading ids via a GitHub-style slugger (with `-1`, `-2` dedupe); verify with unit tests for punctuation, case, and duplicate headings
- [ ] 3.5 Add `.markdown-body` styles in `src/styles.css` (theme variables, readable max width, `em`/`rem` sizing, horizontal scroll for `pre` and tables) and verify visually in light and dark themes and at 150% UI zoom with `npm run tauri dev`

## 4. Links

- [ ] 4.1 Implement link handling in `MarkdownView`: always `preventDefault`, `#anchor` scrolls to the heading, `http`/`https`/`mailto` call `openUrl`, other schemes are ignored, relative paths resolve against the file's folder (dropping query/fragment, rejecting paths escaping the root) and call `openTreePath`; every link has its target as `title`. Verify with tests (opener mocked) for each case in the "Links" requirement, including `../SETUP.md`, `javascript:`, `file:`, and an escaping `../../x.md`
- [ ] 4.2 Verify in the running app that clicking a web link opens the default browser, a relative link opens the file (its diff when changed, "File not found" when missing), and the window never navigates away

## 5. Find and live updates

- [ ] 5.1 Build find search units from `MarkdownView`'s rendered text nodes and paint matches with the CSS Custom Highlight API (`::highlight(find-match)` / `::highlight(find-current)` using existing find colors), revealing the current match by scrolling its range into view; degrade to count + scroll when `CSS.highlights` is missing. Verify with tests that searching `**` in `**bold** text` gives no results, a word appearing three times reports 3, and next/previous moves the current match
- [ ] 5.2 Verify that toggling rendered/source with the find bar open re-runs the query against the newly shown view (test), and that `Ctrl+F` in the running app highlights matches in a rendered README
- [ ] 5.3 Key `MarkdownView` by path so content updates re-render in place; verify with a test that new content replaces the old without remounting the scroll container, and in the running app that editing an open README from the terminal updates the rendered view while staying scrolled near the same place

## 6. Docs and integration

- [ ] 6.1 Add a "Viewing Markdown" section to `README.md` (rendered by default, Source button, link behavior, no images/HTML) and verify it renders correctly in the app's own rendered view
- [ ] 6.2 Run `npm test`, `npm run typecheck` and `npm run test:rust` and verify all pass
