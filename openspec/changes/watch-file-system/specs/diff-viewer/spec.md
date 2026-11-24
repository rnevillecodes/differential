# Spec Delta

## MODIFIED Requirements

### Requirement: Manual refresh
The application SHALL provide a refresh action that recomputes the diff for the current repository and base. Manual refresh SHALL remain available alongside automatic updates and SHALL be the way to update when watching is unavailable.

#### Scenario: Agent changed files since opening
- **WHEN** files change on disk and the user triggers refresh
- **THEN** the file list and the displayed file reflect the current working tree

#### Scenario: Refresh when watching is unavailable
- **WHEN** the open repository cannot be watched, files change on disk, and the user triggers refresh
- **THEN** the file list and the displayed file reflect the current working tree

## ADDED Requirements

### Requirement: Automatic updates
While a repository is open, the application SHALL refresh itself whenever the repository reports a change, with no setting to turn this off. On a working-tree change it SHALL recompute the changed-file list, totals, and the open tabs' contents. On a git metadata change it SHALL also reload the current branch shown in the toolbar and the commit history. A base given as a branch or other revision SHALL be re-resolved, so a base that has moved is shown as it now is. Changes SHALL be picked up whatever made them: an agent, an editor, or a command run in the built-in terminal.

#### Scenario: Agent edits a file
- **WHEN** an agent modifies a tracked file
- **THEN** the file appears in the changed-file list with updated line counts within a few seconds, without the user acting

#### Scenario: Command run in the built-in terminal
- **WHEN** a command run in the application's terminal creates a file in the repository
- **THEN** the file appears in the changed-file list without the user refreshing

#### Scenario: Commit against HEAD
- **WHEN** the base is `HEAD`, the working tree has changes, and the user commits them all in a terminal
- **THEN** the changed-file list becomes empty and the commit appears in the commit history

#### Scenario: Branch switched in a terminal
- **WHEN** the user checks out another branch in a terminal
- **THEN** the toolbar shows the new branch and the diff reflects the new working tree

### Requirement: Quiet in-place updates
An automatic update SHALL NOT replace what is on screen with a loading state. The changed-file list, the displayed diff or file, and their scroll positions SHALL stay as they are until the new data arrives, and then be replaced. If the displayed file is still present after the update, its view SHALL keep its scroll position (clamped to the new length) and view mode. An automatic update SHALL NOT change which tab is active or open new tabs. Tabs of files that no longer exist SHALL close, as on a manual refresh.

#### Scenario: No loading flash
- **WHEN** a file's diff is displayed and an automatic update reloads it
- **THEN** the previous diff stays visible until the new diff is drawn, with no "Loading…" message in between

#### Scenario: Scroll position kept
- **WHEN** the user has scrolled halfway down a displayed diff and an unrelated file changes on disk
- **THEN** after the automatic update the displayed diff is at the same scroll position

#### Scenario: Displayed file deleted
- **WHEN** the file shown in the active tab is deleted from disk and it has no remaining change against the base
- **THEN** its tab closes and the nearest remaining tab is shown

### Requirement: Watching unavailable notice
When the open repository cannot be watched, the toolbar SHALL show that automatic updates are unavailable, with the reason, and the Refresh action SHALL keep working. No notice SHALL be shown while watching works.

#### Scenario: Watching unavailable
- **WHEN** the open repository cannot be watched
- **THEN** the toolbar shows that automatic updates are unavailable and why, and Refresh still works

#### Scenario: Watching works
- **WHEN** a repository is open and being watched normally
- **THEN** no notice about automatic updates is shown
