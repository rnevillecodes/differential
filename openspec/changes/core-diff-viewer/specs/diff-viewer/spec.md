# Spec Delta

## Purpose

Presents a repository's diff visually for fast, read-only review: choosing the repository and base, navigating changed files, and reading each file's changes in unified or side-by-side form, smoothly even for very large diffs.

## ADDED Requirements

### Requirement: Open a repository
The application SHALL let the user choose the repository to review, either from a path passed on the command line at launch or through a folder picker in the UI.

#### Scenario: Launch with a path argument
- **WHEN** the application is launched with a repository path as its argument
- **THEN** it opens directly into that repository's diff against the default base

#### Scenario: Launch without arguments
- **WHEN** the application is launched with no arguments
- **THEN** it shows a screen inviting the user to open a repository, with an action that opens the folder picker; the folder picker does not open by itself

#### Scenario: Open a different repository
- **WHEN** a repository is already open and the user picks another folder
- **THEN** the view switches to the new repository's diff

### Requirement: Choose the base ref
The application SHALL display the current base ref and let the user change it by typing a revision. Changing the base SHALL recompute and redisplay the diff. A base ref MAY also be passed at launch.

#### Scenario: Change base in the UI
- **WHEN** the user enters `HEAD~3` as the base
- **THEN** the file list and diff update to show changes since `HEAD~3`

#### Scenario: Invalid base entered
- **WHEN** the user enters a revision that does not resolve
- **THEN** an inline error is shown and the previously displayed diff remains

### Requirement: Manual refresh
The application SHALL provide a refresh action that recomputes the diff for the current repository and base.

#### Scenario: Agent changed files since opening
- **WHEN** files change on disk and the user triggers refresh
- **THEN** the file list and the displayed file reflect the current working tree

### Requirement: Changed-file list
The application SHALL show a list of all changed files with each file's path, change classification, and added/removed line counts, plus totals for the whole diff. Binary and large files SHALL be marked as such.

#### Scenario: File list contents
- **WHEN** the diff contains a modified, an untracked, and a renamed file
- **THEN** each appears in the list with a distinct status indicator and its line counts, and the renamed file shows both old and new paths

#### Scenario: Clean working tree
- **WHEN** there are no changes against the base
- **THEN** the application states that there are no changes

### Requirement: Navigate between files
Selecting a file in the list SHALL display that file's diff. The user SHALL be able to move to the next and previous file with keyboard shortcuts.

#### Scenario: Keyboard navigation
- **WHEN** a file is displayed and the user presses the next-file shortcut
- **THEN** the next file in the list is selected and displayed

### Requirement: Unified view
The application SHALL render a file's diff in a unified layout: a single column of lines in order, each showing old and new line numbers where applicable and visually distinguishing added, removed, and context lines.

#### Scenario: Unified rendering of a modification
- **WHEN** a hunk replaces one line with two lines
- **THEN** the removed line is shown marked as removed with its old line number, followed by the two added lines marked as added with their new line numbers

### Requirement: Side-by-side view
The application SHALL render a file's diff in a side-by-side layout with the base on the left and the working tree on the right. Corresponding removed and added lines SHALL be aligned on the same row, with empty filler on the shorter side, and both sides SHALL always scroll together.

#### Scenario: Aligned rows
- **WHEN** a hunk removes two lines and adds three
- **THEN** the first two rows pair removed and added lines, and the third row shows an added line on the right with empty filler on the left

#### Scenario: Locked scrolling
- **WHEN** the user scrolls a side-by-side diff
- **THEN** both sides stay vertically aligned at all times

### Requirement: Toggle and remember the view mode
The user SHALL be able to switch between unified and side-by-side views at any time, and the choice SHALL persist across files and application restarts.

#### Scenario: Persisted preference
- **WHEN** the user selects side-by-side and restarts the application
- **THEN** diffs open in side-by-side view

### Requirement: Syntax highlighting
Code in the diff SHALL be syntax highlighted according to the file's language, inferred from its file name or extension. Files of unknown language SHALL be shown as plain text. Highlighting SHALL NOT block display or scrolling; text MAY appear unhighlighted briefly before colors are applied.

#### Scenario: Known language
- **WHEN** a `.ts` file's diff is displayed
- **THEN** keywords, strings, and comments are colored as TypeScript

#### Scenario: Unknown extension
- **WHEN** a file with an unrecognized extension is displayed
- **THEN** its lines are shown as plain text with diff coloring intact

### Requirement: Intraline change highlighting
For a removed line paired with an added line, the application SHALL additionally highlight the specific words or characters that differ within those lines. Very long lines MAY skip intraline highlighting.

#### Scenario: Single word changed
- **WHEN** a line changes from `const timeout = 30;` to `const timeout = 60;`
- **THEN** only `30` and `60` receive the intraline highlight on their respective lines

### Requirement: Collapsed context and expansion
Unchanged regions between hunks and at the start and end of a file SHALL be collapsed into a marker showing how many lines are hidden. The user SHALL be able to expand hidden lines, partially or fully.

#### Scenario: Expand a gap
- **WHEN** a marker indicates 40 hidden lines and the user expands it fully
- **THEN** those 40 lines appear as context lines with correct line numbers on both sides

#### Scenario: Partial expansion
- **WHEN** the user chooses to expand a limited number of lines from a marker
- **THEN** that many lines are revealed adjacent to the hunk and the marker updates its remaining count

### Requirement: Placeholders for binary and large files
Binary files SHALL be shown with a placeholder stating the file is binary and no line content. Large files SHALL be shown with a placeholder and an explicit action to load and render the diff anyway.

#### Scenario: Binary placeholder
- **WHEN** the user selects a binary file
- **THEN** a placeholder states that the file is binary and that its contents are not shown

#### Scenario: Load a large file on demand
- **WHEN** the user selects a large file and chooses to load it
- **THEN** its diff is rendered normally

### Requirement: Smooth rendering of large diffs
Rendering cost SHALL NOT grow with the total size of the displayed diff: scrolling SHALL remain smooth and the first screen of lines SHALL appear promptly even for a single file diff of 50,000 lines.

#### Scenario: Very long diff
- **WHEN** a file with a 50,000-line diff is displayed
- **THEN** the first lines appear promptly and scrolling from top to bottom remains smooth without visible stalls

#### Scenario: Many changed files
- **WHEN** the diff contains 1,000 changed files
- **THEN** the file list scrolls smoothly

### Requirement: No line wrapping
Lines SHALL NOT wrap; long lines SHALL be reachable by horizontal scrolling.

#### Scenario: Long line
- **WHEN** a line is wider than the viewport
- **THEN** it stays on one row and the rest of it can be scrolled into view horizontally

### Requirement: Read-only presentation
The application SHALL NOT offer any action that edits file contents, stages, commits, discards, or otherwise changes the repository.

#### Scenario: No mutating actions
- **WHEN** the user inspects any file's diff
- **THEN** no control exists that would change files or git state

### Requirement: Light and dark themes
The application SHALL follow the operating system's light or dark preference, with diff colors and syntax highlighting legible in both.

#### Scenario: Dark mode
- **WHEN** the operating system is set to dark mode
- **THEN** the application, diff colors, and syntax highlighting render in a dark theme
