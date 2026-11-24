# Spec Delta

## Purpose

Observes an open repository's working tree and git metadata and notifies the application when something that can affect the displayed diff, files, branch, or history has changed, so views stay current without manual refresh.

## ADDED Requirements

### Requirement: Watch the open repository
While a repository is open, the system SHALL watch its whole working tree (recursively, from the repository's top-level directory) and its git metadata for changes. Only one repository SHALL be watched at a time: opening another repository SHALL stop watching the previous one, and closing the application SHALL stop watching.

#### Scenario: File edited on disk
- **WHEN** a repository is open and a tracked file in a subfolder is saved by another program
- **THEN** the application is notified of a working-tree change

#### Scenario: Switching repositories
- **WHEN** repository A is open and the user opens repository B, and a file in A then changes
- **THEN** no change notification is delivered for A

### Requirement: Classify changes
Each notification SHALL say whether the working tree changed, the git metadata changed, or both. Git metadata changes SHALL be those to `HEAD`, branches, tags, remote-tracking refs, packed refs, or the index. Changes to other paths inside the git directory (objects, logs, lock files, hooks, and similar) SHALL NOT cause a notification on their own.

#### Scenario: Commit made in a terminal
- **WHEN** the user commits in a terminal
- **THEN** a notification reports a git metadata change

#### Scenario: Object database activity only
- **WHEN** only files under the git directory's `objects/` folder are written (for example by `git gc` or a fetch that moves no refs)
- **THEN** no notification is delivered

### Requirement: Ignore ignored files
Changes only to paths that git's ignore rules exclude SHALL NOT cause a notification. A change to an ignore file itself (such as `.gitignore`) SHALL be reported as a working-tree change.

#### Scenario: Build output written
- **WHEN** a build writes thousands of files under an ignored `target/` folder and nothing else changes
- **THEN** no notification is delivered

#### Scenario: Ignored and relevant changes together
- **WHEN** a burst of writes touches both an ignored folder and a tracked source file
- **THEN** one working-tree notification is delivered

### Requirement: Coalesce bursts of changes
Changes SHALL be coalesced so a burst of file-system activity produces a single notification after the activity settles, delivered within 1 second of the last change. During continuous activity, a notification SHALL still be delivered at least every 3 seconds.

#### Scenario: Agent writes many files
- **WHEN** 200 files are written within half a second
- **THEN** exactly one notification is delivered, within 1 second after the last write

#### Scenario: Sustained activity
- **WHEN** files keep changing continuously for 10 seconds
- **THEN** notifications are delivered at intervals of no more than 3 seconds during that time

### Requirement: Own activity does not trigger notifications
The application's own reads of the repository (listing changes, diffing, reading files, listing refs and commits) SHALL NOT cause change notifications.

#### Scenario: No refresh loop
- **WHEN** a notification causes the application to recompute the diff and nothing else changes on disk
- **THEN** no further notification follows

### Requirement: Watch failure is reported, not fatal
If watching cannot be started or stops working (for example because the file system does not support change notifications or an operating-system watch limit is reached), the system SHALL report the failure with a message, and the repository SHALL remain usable with manual refresh.

#### Scenario: Watch limit reached
- **WHEN** the operating system refuses to watch more folders while a repository is opened
- **THEN** the application is told watching is unavailable, with the reason, and the diff still loads and can be refreshed manually

### Requirement: Read-only watching
Watching SHALL NOT create, modify, or delete any file in the working tree or git directory, and SHALL NOT take git locks.

#### Scenario: Repository unchanged by watching
- **WHEN** a repository is watched for a period while files change and are reloaded
- **THEN** `git status` and the index are exactly as the other programs left them
