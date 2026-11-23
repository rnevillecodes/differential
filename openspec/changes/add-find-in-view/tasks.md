# Tasks

## 1. Matching and segments

- [ ] 1.1 Add `src/find/match.ts`. It builds search units from the fully expanded rows (`buildRows` with every gap revealed) for unified and split modes, and from plain line arrays for the file view. Units carry `lineKey` (`${kind}:${oldNo}:${newNo}`), `side` and text; split context lines whose sides are the same object give one unit. `findMatches(units, query, matchCase)` returns ordered, non-overlapping, single-line matches with lazily lower-cased text. Verify Vitest cases for: case-insensitive vs match-case, empty query, overlapping repeats (`aaa` / `aa`), hidden gap lines included and in display order, split order (left before right), one unit for split context lines, removed and added lines both searched, and a 50,000-line input finishing well under 50 ms.
- [ ] 1.2 Add `gapContaining(gaps, match)` and `lineKeyIndex(rows)` helpers, used to map a match to a displayed row index or to the gap hiding it. Verify unit tests for a line before the first hunk, between hunks, after the last hunk, and in an already partly expanded gap.
- [ ] 1.3 Extend `segments()` in `src/highlight/tokens.ts` with an optional `find: { ranges, current }` layer. Cut at the boundaries of both intraline and find ranges, and add `match`/`current` flags. Render them in `TokenSpans` as `find-match` / `find-current` classes. Verify existing `segments` tests still pass, and new cases for matches across token boundaries, matches overlapping intraline ranges, and a current match among several.

## 2. Store and shortcuts

- [ ] 2.1 Add the find slice to `src/store.ts`: `findOpen`, `findQuery`, `findMatchCase`, `findNav { seq, dir }`, `findFocusSeq`, `findStatus`. Actions: `openFind(initial?)` (bumps `findFocusSeq` and keeps the previous query when there is no initial text), `closeFind`, `setFindQuery`, `toggleFindMatchCase`, `findNext`, `findPrev`, `setFindStatus`. Verify `src/store.test.ts` cases for each, including that reopening keeps the query and match case.
- [ ] 2.2 Handle `Ctrl+F` (only with a tab open; initial query from a single-line selection inside `.tab-panels`) and `F3` / `Shift+F3` (only while the bar is open) in `handleShortcut`. Update its doc comment. Verify `App` tests: `Ctrl+F` opens the bar and is default-prevented, a single-line selection seeds the query and a multi-line one doesn't, nothing happens with no tab open, `F3` goes next and `Shift+F3` previous, and all three return `false` from inside `[data-terminal]`.

## 3. Find bar and views

- [ ] 3.1 Add `src/components/FindBar.tsx`, rendered by `DiffPane` at the top-right of `.tab-panels` while `findOpen`. It has the query input (`aria-label="Find"`, focus and select on `findFocusSeq`), the count ("3 of 17" / "No results", `aria-live="polite"`), a match-case toggle (`aria-pressed`), previous/next buttons and a close button. `Enter` / `Shift+Enter` go to the next/previous match. `Escape` closes, stops propagation and focuses the active view's `.diff-scroll` (`tabIndex={-1}`). Add `--find-bg` / `--find-current` tokens for light and dark, plus bar styles, in `styles.css`. Verify component tests for the controls, keys, focus return, and "No results" on a binary placeholder.
- [ ] 3.2 Add a `useFind` hook and wire it into `FileView`. It runs only for the active tab with the bar open and a deferred non-empty query. It sets `findStatus`, picks the first match at or after the viewport top, reacts to `findNav`, passes per-line ranges (a shared empty constant when none) and the current range to `LineView`, and scrolls vertically only when the row is off-screen. Verify component tests: the count updates while typing, matches and the current match carry the right classes, `Enter` wraps from last to first, and an off-screen match scrolls into view.
- [ ] 3.3 Wire `useFind` into `DiffView` for both modes, mapping matches to rows by `lineKey`. A match in a collapsed region applies `expandGap(…, "all")` and scrolls once the rows rebuild. Pass ranges per side to `RowView` / `Cell` so rows without matches keep identical props. Verify component tests: a match only in a collapsed region expands it and becomes current with the count unchanged, split rows highlight the correct side, unchanged context counts once in split, and switching tabs recomputes for the new tab and clears highlights on the old one.
- [ ] 3.4 Add horizontal reveal: measure the character width with a `1ch` probe and compute columns with tabs counted as 4. Unified and file views set `.diff-scroll.scrollLeft`; split sets that side's `.hscroll [data-pane]` bar. Verify component tests (stubbed widths) that a match at column 300 sets the right `scrollLeft`, and in split that only the matching side's bar moves.
- [ ] 3.5 Recompute on content change (refresh, large file loaded) while keeping the current match on the same line when it still exists. Verify a component test where a refresh changes the file and the count updates.
- [ ] 3.6 Update the README: a Find section (`Ctrl+F`, next/previous keys, match case, collapsed regions searched and expanded, selection seeds the query, terminal keeps `Ctrl+F`) and the shortcuts table. Verify the statements match the `find-in-view` spec.

## 4. Integration checks

- [ ] 4.1 Run `npm test`, `npm run typecheck` and `npm run build`; verify all pass.
- [ ] 4.2 Manually check a release build on Windows against the `find-in-view` scenarios, using a 50,000-line file from `npm run perf-repo`:
  - typing stays responsive
  - scrolling with the bar open is smooth
  - matches in collapsed regions expand
  - horizontal reveal works in unified and split
  - highlights are legible in light and dark
  - WebView2's own find bar never appears
  - `Ctrl+F` inside the terminal reaches the shell
