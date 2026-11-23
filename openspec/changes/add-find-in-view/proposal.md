# Proposal

## Why

There is no way to find text in the file or diff being reviewed. The views are virtualized, so only about a screen of lines is in the DOM, and collapsed regions are not rendered at all. That means the webview's own find (where it exists) misses most of the file. Reviewers need to jump to a symbol, string or TODO in a long file without scrolling for it.

## What Changes

- Add a **find bar** for the active tab's view, opened with `Ctrl+F`. It has a query field, a match count ("3 of 17" or "No results"), previous/next buttons, a match-case toggle and a close button.
- **Matching** is plain text, case-insensitive by default, over the code text of the open file. For a diff that covers both sides (removed and added lines) and the unchanged lines hidden in collapsed regions. Line numbers, markers and gap labels are not searched.
- **Highlighting**: every match in the rendered lines is highlighted, and the current match is highlighted differently. Moving to a match scrolls it into view, both vertically and horizontally. In the side-by-side view only the pane holding the match scrolls horizontally. A match inside a collapsed region expands that region.
- **Keys**: `Enter` / `Shift+Enter` in the field and `F3` / `Shift+F3` go to the next and previous match, wrapping around. `Escape` closes the bar and returns focus to the view. `Ctrl+F` while the bar is open focuses the field and selects its text. If a single line of text is selected when the bar opens, the field starts with that text.
- The query stays as you switch tabs, and the find bar searches whichever tab is active. Closing the bar removes the highlights.
- While a terminal has focus, `Ctrl+F` goes to the shell, the same as the other shortcuts.

Out of scope: searching across files or the whole repository (a possible later `Ctrl+Shift+F`), regular expressions and whole-word matching, replace (the app is read-only), and finding in the terminal's scrollback.

## Capabilities

### New Capabilities
- `find-in-view`: the `Ctrl+F` find bar that searches the active file or diff view, including collapsed regions, highlights the matches and moves between them.

### Modified Capabilities
<!-- None: the find bar adds behaviour on top of the diff and file views without changing diff-viewer or file-explorer requirements. -->

## Impact

- **Frontend only:**
  - A new `FindBar` component shown in `DiffPane` over the active tab.
  - A find slice in `src/store.ts`: open state, query, match-case, a navigation request, and the active view's match status.
  - Match computation over a view's lines, including hidden gap lines in `src/rows/`.
  - `segments()` in `src/highlight/tokens.ts` gains match ranges alongside intraline ranges, and `TokenSpans` renders them.
  - `DiffView` and `FileView` scroll to the current match and expand gaps.
  - `handleShortcut` in `App.tsx` handles `Ctrl+F` and `F3`.
  - Styles in `styles.css` for the bar and match highlights in light and dark themes.
- **Docs:** README shortcut list.
- **No backend changes** and no new dependencies.
