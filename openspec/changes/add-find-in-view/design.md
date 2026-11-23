# Design

## Context

- Every open tab stays mounted in `DiffPane` (`TabPanel`, inactive ones hidden and `inert`). Changed files render `DiffView` and unchanged files render `FileView`. Both are virtualized with `@tanstack/react-virtual` at a fixed `ROW_HEIGHT`, with memoized rows.
- `DiffView` turns the diff into display rows with the pure `buildRows({ diff, oldContent, newContent, expansion, mode })` in `src/rows/build.ts`. Collapsed regions are `gap` rows, and `expandGap(state, gap, "all" | "up" | "down")` reveals lines. A diff line is identified by `(kind, oldNo, newNo)`: context lines have both numbers, removed lines only `oldNo`, added lines only `newNo`. Unchanged context lines in split mode reuse one `DisplayLine` object for both sides.
- Line text is styled by `segments(text, tokens, intraline)` in `src/highlight/tokens.ts`, which cuts syntax tokens at intraline ranges, and `TokenSpans` renders the result.
- Horizontal scrolling works differently per mode. Unified scrolls `.diff-scroll` itself. Split drives a CSS variable (`--sx-left` / `--sx-right`) from each pane's own scrollbar in `.hscroll`.
- `handleShortcut` in `App.tsx` handles global keys. It ignores everything from `[data-terminal]` except `Ctrl+``, and still handles `Ctrl` shortcuts while an input has focus.
- Line widths are measured in columns, with a tab counted as 4 (`maxColumns`). The font is monospace with `tab-size: 4`.

## Goals / Non-Goals

**Goals:**
- Matching cost per keystroke is linear in the file's text and does no React or DOM work proportional to file size.
- Rows without matches do not re-render when the query changes. Scrolling with the bar open costs the same as without it.
- The same find logic serves `DiffView` (both modes) and `FileView`.

**Non-Goals:**
- Running matching in a worker. Plain `indexOf` over 50,000 lines takes milliseconds; revisit only if measurements say otherwise.
- Exact horizontal positioning with tab stops. Columns are approximated the same way as `maxColumns`, which is enough to bring a match into view.

## Decisions

### 1. State: a small find slice in the store; each view owns its matches

The store holds what the bar shows and what the user asked for:
- `findOpen`, `findQuery`, `findMatchCase`.
- `findNav: { seq, dir }`, a request counter the active view reacts to (next/previous).
- `findFocusSeq`, which asks the bar to focus and select its field.
- `findStatus: { current, total } | null`, published by the active view.

Actions are `openFind(initialQuery?)`, `closeFind()`, `setFindQuery`, `toggleFindMatchCase`, `findNext()`, `findPrev()` and `setFindStatus`.

Matches and the current index live in a `useFind` hook inside `DiffView` and `FileView`. It runs only when the view's tab is active (`TabPanel` passes `active` down) and the bar is open with a non-empty query. When a tab becomes inactive it drops its highlights. When it becomes active it recomputes and picks the first match at or after the top of the viewport. Placeholder views (binary, large, loading, empty) never mount the hook, so `DiffPane` publishes `{ current: 0, total: 0 }` for them.

*Alternative:* matches in the store. Rejected because matches depend on view-local state (expansion, mode, contents already loaded) and would make every store subscriber churn on each keystroke.

### 2. Search units: the fully expanded row list, built once per content

To search hidden lines and keep display order, the hook builds a **search index** with `buildRows` at full expansion: every gap revealed, same `mode`. It is memoized on `(diff, oldContent, newContent, mode)`, so it is rebuilt only when contents or mode change, never per keystroke. Walking those rows in order gives the search units. In unified mode each row is one line. In split mode it is left then right, and a pair whose two sides are the same object (unchanged context) gives one unit. Each unit records:
- `lineKey`: `${kind}:${oldNo}:${newNo}`
- `side`: `"left"`, `"right"` or `"unified"`
- its text
- a lower-cased copy, computed lazily the first time a case-insensitive search runs

`FileView` builds units straight from its line array (`lineKey` = line number).

A match is `{ unit, start, end }`. Matching is a loop of `indexOf` over each unit's text (or its lower-cased copy), non-overlapping, so matches can't span lines. The query is run through `useDeferredValue`, so typing never waits on matching. Matching lives in a new pure module, `src/find/match.ts`, unit-tested without React.

*Alternative:* search only the rows currently displayed, and report hidden matches separately. Rejected because the spec counts hidden matches and orders them in place.

### 3. Mapping a match to a displayed row, expanding gaps when needed

The view keeps a `Map<lineKey, rowIndex>` for the currently displayed rows, rebuilt with `rows`. To reveal the current match:
1. Look up its `lineKey`.
2. If it is not displayed, find the gap that contains its line (by `oldNo`/`newNo` against each gap's `oldStart`/`newStart` + `count`) and apply `expandGap(…, "all")`. The scroll is then re-attempted after the rows rebuild. Expanding the whole gap keeps the logic simple and matches the existing "Expand all" button; partial expansion around the match was considered and rejected as more state for little gain.
3. Call `virtualizer.scrollToIndex(index, { align: "center" })` only when the row is outside the visible range, so stepping through matches on screen doesn't jump the view.

### 4. Horizontal reveal

The match's start and end columns are computed from the line text up to `start` and `end`, with tabs counted as 4 like `maxColumns`. They are converted to pixels with a character width measured once from a hidden `1ch` probe inside `.diff-scroll`.
- **Unified and file views:** if the match is outside `[scrollLeft + gutterWidth, scrollLeft + clientWidth]`, set `.diff-scroll.scrollLeft` so the match sits about a third of the way in.
- **Split view:** set `scrollLeft` on that side's `.hscroll [data-pane]` bar instead, which already updates the CSS variable. The other side is untouched.

### 5. Highlighting through `segments()` without re-rendering everything

`segments(text, tokens, intraline, find?)` gains an optional `find: { ranges: Range[]; current: Range | null }`. The existing cutting loop is generalized to cut at every boundary of both range layers. Segments gain `match` and `current` flags, and `TokenSpans` adds `find-match` / `find-current` classes. The match background goes on the segment span, so syntax colour and the intraline background still show; a `find-current` outline makes it distinct on added, removed and word-changed backgrounds.

The hook produces a `Map<lineKey, Range[]>` (per side in split mode) that is stable for a given query and contents. Each row receives only its own ranges array, or a shared empty constant, plus the current range only if it is the current row. Memoized rows without matches therefore keep identical props and skip re-rendering. Changing the current match re-renders at most two rows.

### 6. Keys and focus

`handleShortcut` gets:
- **`Ctrl+F`** (outside `[data-terminal]`, only with a tab open): reads `window.getSelection()`. If the selection is inside `.tab-panels` and has no newline, its text becomes the initial query. Then it calls `openFind` and returns `true`, so the default is prevented and the webview's own find (WebView2 has one) never appears.
- **`F3` / `Shift+F3`** while `findOpen` (outside the terminal, including from the find field): calls `findNext` / `findPrev`.

`Enter` / `Shift+Enter` / `Escape` are handled by the `FindBar` input itself. `Escape` calls `stopPropagation` so nothing else reacts. Closing focuses the active view's `.diff-scroll`, which gets `tabIndex={-1}` so it can take focus without entering the tab order.

### 7. Placement and look

`FindBar` is absolutely positioned at the top-right of `.tab-panels`, overlaying the view rather than pushing it down, so rows and the virtualizer's measurements don't shift. Its contents, in order:
- the query input (`aria-label="Find"`)
- the count (`aria-live="polite"`)
- a match-case toggle (`aria-pressed`, labelled "Aa")
- previous / next icon buttons
- a close button

Colours are new tokens (`--find-bg`, `--find-current`) defined for both themes in `styles.css`.

## Risks / Trade-offs

- **Memory for the search index:** the fully expanded row list duplicates `DisplayLine` objects for a 50,000-line diff, a few MB at most. → It is built only while the bar is open and the tab is active, and dropped when the bar closes.
- **Expanding a huge gap** when jumping to a hidden match adds many rows at once. → Rows are virtualized and `buildRows` is linear. It is the same cost as the existing "Expand all".
- **Column approximation with tabs:** a match after mixed tabs and spaces can land a few characters off. → The match is placed a third of the way into the viewport, so small errors still show it.
- **Keyboard conflicts:** `F3` may be expected to do nothing in some webviews. → The handler only acts while the bar is open.
- **WebView2's built-in find:** it could still open if the keydown isn't prevented early enough. → `handleShortcut` runs on `window` keydown and `preventDefault`s; a manual check on Windows is in the tasks.
