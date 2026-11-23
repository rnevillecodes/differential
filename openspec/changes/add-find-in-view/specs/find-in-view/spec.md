# Spec Delta

## Purpose

Lets the reviewer find text in the file or diff open in the active tab, including lines hidden in collapsed regions, and step through the matches with the keyboard.

## ADDED Requirements

### Requirement: Open and close the find bar
`Ctrl+F` SHALL open a find bar for the active tab's view and put the keyboard in its query field with the field's text selected. Pressing `Ctrl+F` while the bar is open SHALL do the same. `Escape` in the bar and the bar's close button SHALL close it and return focus to the view. `Ctrl+F` SHALL do nothing while no tab is open.

#### Scenario: Open with the keyboard
- **WHEN** a file tab is active, focus is outside the terminal, and the user presses `Ctrl+F`
- **THEN** the find bar is shown and its query field has focus

#### Scenario: Refocus an open bar
- **WHEN** the find bar is open with the query "foo", focus is in the view, and the user presses `Ctrl+F`
- **THEN** the query field has focus with "foo" selected

#### Scenario: Close with Escape
- **WHEN** the query field has focus and the user presses `Escape`
- **THEN** the find bar is hidden, match highlights are removed, and focus returns to the view

#### Scenario: No tab open
- **WHEN** no tab is open and the user presses `Ctrl+F`
- **THEN** no find bar is shown

### Requirement: Shortcut inside a terminal
While a terminal has focus, `Ctrl+F`, `F3` and `Shift+F3` SHALL go to the shell and SHALL NOT open the find bar or change the current match.

#### Scenario: Ctrl+F in the terminal
- **WHEN** a terminal has focus and the user presses `Ctrl+F`
- **THEN** the key goes to the shell and no find bar is shown

### Requirement: Initial query from the selection
When the find bar opens and the user has selected text within a single line of the view, the query field SHALL start with that text. Otherwise it SHALL keep the previous query.

#### Scenario: Selected word
- **WHEN** the user has selected `parseArgs` in the view and presses `Ctrl+F`
- **THEN** the query field contains `parseArgs` and its matches are shown

#### Scenario: Multi-line selection
- **WHEN** the selection spans more than one line and the user presses `Ctrl+F`
- **THEN** the query field keeps its previous text

### Requirement: What is searched
The find bar SHALL search for the query as plain text (no pattern syntax), case-insensitively by default, within the code text of the active tab's view. For a diff this SHALL include both removed and added lines and the unchanged lines hidden in collapsed regions. For an unchanged file it SHALL include every line. Line numbers, change markers and collapsed-region labels SHALL NOT be searched. Matches SHALL NOT span lines. An empty query SHALL have no matches.

#### Scenario: Removed and added lines
- **WHEN** a diff removes a line containing `oldName` and adds one containing `newName`, and the user searches for `Name`
- **THEN** both lines contain a match

#### Scenario: Hidden lines are searched
- **WHEN** the only occurrence of `helper` is in an unchanged line inside a collapsed region, and the user searches for `helper`
- **THEN** the count shows "1 of 1"

#### Scenario: Line numbers are not searched
- **WHEN** the user searches for `42` and that text appears only as a line number
- **THEN** the find bar shows "No results"

#### Scenario: Unchanged context in the side-by-side view
- **WHEN** the view is side-by-side and an unchanged line contains the query
- **THEN** that line counts as one match, not one per side

### Requirement: Match case
The find bar SHALL have a match-case toggle, off by default. When it is on, only text with the same letter case SHALL match. The toggle's state SHALL be kept for the rest of the session.

#### Scenario: Case-insensitive by default
- **WHEN** the user searches for `todo` in a file containing `TODO`
- **THEN** `TODO` is a match

#### Scenario: Match case on
- **WHEN** match case is on and the user searches for `todo` in a file containing only `TODO`
- **THEN** the find bar shows "No results"

### Requirement: Match count and highlighting
The find bar SHALL show the current match's position and the total number of matches (for example "3 of 17"), or "No results" when there are none. Every match in the rendered lines SHALL be highlighted, and the current match SHALL be highlighted distinctly from the others. The highlights SHALL be legible in both light and dark themes and SHALL be visible on added, removed and word-changed text. Results SHALL update as the query or match case changes.

#### Scenario: Count updates while typing
- **WHEN** the user types a query that occurs 17 times
- **THEN** the find bar shows "1 of 17", the first match at or after the top of the view is current, and all visible matches are highlighted

#### Scenario: No matches
- **WHEN** the query does not occur in the view
- **THEN** the find bar shows "No results" and nothing is highlighted

### Requirement: Move between matches
`Enter` in the query field, the next button and `F3` SHALL make the next match current. `Shift+Enter`, the previous button and `Shift+F3` SHALL make the previous match current. Moving past the last match SHALL wrap to the first, and past the first SHALL wrap to the last. Matches SHALL be ordered by their position in the view, top to bottom and left to right; in the side-by-side view the left side of a row SHALL come before the right. `F3` and `Shift+F3` SHALL work whenever the bar is open and focus is outside the terminal.

#### Scenario: Next wraps around
- **WHEN** the current match is "17 of 17" and the user presses `Enter`
- **THEN** the current match is "1 of 17"

#### Scenario: Previous with Shift+F3
- **WHEN** focus is in the view, the bar is open with the current match "3 of 17", and the user presses `Shift+F3`
- **THEN** the current match is "2 of 17"

### Requirement: Reveal the current match
When a match becomes current, the view SHALL scroll so that its line is visible, and horizontally so that the match itself is visible. In the side-by-side view, only the side that contains the match SHALL scroll horizontally. When the current match is in a collapsed region, that region SHALL be expanded so the line is shown, and it SHALL stay expanded afterwards.

#### Scenario: Off-screen match
- **WHEN** the next match is 2,000 lines below the visible area and the user presses `Enter`
- **THEN** the view scrolls to show the match's line

#### Scenario: Match far to the right
- **WHEN** the current match starts at column 300 of a long line
- **THEN** the view scrolls horizontally so the match is visible

#### Scenario: Match in a collapsed region
- **WHEN** the next match is in a collapsed region and the user presses `Enter`
- **THEN** the region expands, the match's line is shown and highlighted as current, and the count is unchanged

### Requirement: Tabs and refresh
The find bar's open state, query and match case SHALL stay the same when the active tab changes, and the bar SHALL then search the newly active tab's view. When the active view's contents change (for example after a refresh or loading a large file), the matches SHALL be recomputed. Views that show a placeholder instead of lines (binary, large not yet loaded, loading, empty) SHALL show "No results".

#### Scenario: Switching tabs
- **WHEN** the find bar is open with the query `config` and the user switches to another tab
- **THEN** the bar stays open with `config`, and its count and highlights reflect the newly active tab

#### Scenario: Binary file
- **WHEN** the active tab shows a binary-file placeholder and the find bar is open with a query
- **THEN** the find bar shows "No results"

### Requirement: Find stays responsive on large files
Typing in the query field SHALL stay responsive, and the count and first match SHALL appear promptly, for a single file or diff of 50,000 lines. Scrolling the view with the find bar open SHALL remain as smooth as without it.

#### Scenario: Large file
- **WHEN** a 50,000-line file is open and the user types a three-character query
- **THEN** each keystroke appears in the field without noticeable delay and the count appears promptly

### Requirement: Find is read-only
The find bar SHALL NOT offer replace or any other action that changes file contents or the repository.

#### Scenario: No replace
- **WHEN** the find bar is open
- **THEN** it offers no replace field or action
