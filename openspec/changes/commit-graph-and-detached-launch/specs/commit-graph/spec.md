# Spec Delta

## Purpose

A pane on the right of the window that draws the open repository's history as a lane graph and lets the user pick a commit as the diff base by clicking it.

## ADDED Requirements

### Requirement: Right-hand graph pane
The window SHALL have a commit graph pane on its right edge, spanning the full height below the toolbar, beside both the file pane and the terminal panel. The pane SHALL be hidden by default.

#### Scenario: Pane shown beside the terminal
- **WHEN** a repository is open and both the terminal panel and the graph pane are shown
- **THEN** the graph pane occupies the right edge from below the toolbar to the bottom of the window, and the terminal panel sits under the file pane only

### Requirement: Toggle the graph pane
The toolbar SHALL have a graph button that shows and hides the pane, indicating whether it is shown, and `Ctrl+G` SHALL do the same outside a terminal. Both SHALL be unavailable while no repository is open.

#### Scenario: Toggle with the toolbar button
- **WHEN** a repository is open and the user clicks the graph button
- **THEN** the graph pane is shown and the button is shown as pressed

#### Scenario: Toggle with the keyboard
- **WHEN** focus is outside the terminal and the user presses `Ctrl+G` while the pane is shown
- **THEN** the pane is hidden

#### Scenario: Shortcut inside a terminal
- **WHEN** a terminal has focus and the user presses `Ctrl+G`
- **THEN** the key goes to the shell and the pane does not change

#### Scenario: No repository open
- **WHEN** no repository is open
- **THEN** the graph button is disabled and `Ctrl+G` does nothing

### Requirement: Resizable, remembered pane
The user SHALL be able to resize the pane by dragging its left edge, within limits that always leave room for the file pane. Whether the pane is shown and its width SHALL be remembered across restarts.

#### Scenario: Drag to resize
- **WHEN** the user drags the pane's left edge 100 pixels to the left
- **THEN** the pane becomes 100 pixels wider

#### Scenario: Remembered after restart
- **WHEN** the pane is shown at a width of 420 pixels and the app is restarted with a repository
- **THEN** the pane is shown at 420 pixels

### Requirement: One row per commit with lanes
The pane SHALL show one row per commit in topological order. Each row SHALL show the commit's place in a lane graph, with lines connecting it to its parents, its short SHA, its subject, and labels for the branches and tags pointing at it. The commit `HEAD` points at SHALL be marked. Hovering a row SHALL show the full SHA, author, and date.

#### Scenario: Branch and merge drawn as lanes
- **WHEN** `feature` branched from `main` and was later merged back
- **THEN** the feature commits are drawn in a separate lane that leaves `main`'s lane at the branch point and rejoins it at the merge commit

#### Scenario: Labels on a commit
- **WHEN** `main` and tag `v1.0` point at the newest commit
- **THEN** that row shows labels `main` and `v1.0`, distinguishable by kind

### Requirement: Load more on scroll
The pane SHALL load the history in pages, loading the next page when the user scrolls near the end of the loaded rows, until no more commits remain. Lanes SHALL continue correctly across page boundaries.

#### Scenario: Scroll to the end of the first page
- **WHEN** a repository has more commits than one page and the user scrolls to the last loaded row
- **THEN** the next page is loaded and appended, and lines that cross the page boundary connect

### Requirement: Click a commit to set the base
Clicking a commit's row, or pressing Enter on a focused row, SHALL set that commit as the diff base, exactly as if its SHA had been typed in the base picker. Clicking a branch or tag label SHALL set that ref as the base instead. Neither SHALL modify the repository.

#### Scenario: Click a commit
- **WHEN** the user clicks the row of commit `d4e5f6a`
- **THEN** the base becomes that commit and the file list and diff are recomputed against it
- **AND** the checked-out branch and `git status` are unchanged

#### Scenario: Click a branch label
- **WHEN** the user clicks the `main` label on a row
- **THEN** the base becomes `main`

### Requirement: Highlight the base commit
The row of the commit the current base resolves to SHALL be highlighted, and the highlight SHALL follow the base when it changes from the graph, the base picker, or a refresh.

#### Scenario: Base picked in the toolbar
- **WHEN** the user picks `main` in the base picker
- **THEN** the row of `main`'s tip commit is highlighted and no other row is

#### Scenario: Base commit not loaded yet
- **WHEN** the base resolves to a commit beyond the loaded pages
- **THEN** no row is highlighted until that commit's page is loaded

### Requirement: Graph stays current
The graph SHALL be loaded when the pane is shown for an open repository, reloaded from the first page when the user refreshes or opens another repository, and SHALL show a message instead of rows when the repository has no commits or the history cannot be listed.

#### Scenario: Commit made in the terminal
- **WHEN** a commit is made in the terminal and the user refreshes
- **THEN** the new commit appears at the top of the graph

#### Scenario: Empty repository
- **WHEN** the open repository has no commits
- **THEN** the pane says there are no commits yet

#### Scenario: Listing fails
- **WHEN** listing the history fails
- **THEN** the pane shows the error and the rest of the app keeps working
