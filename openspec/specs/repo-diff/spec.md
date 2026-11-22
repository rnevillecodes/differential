# repo-diff Specification

## Purpose

Produces the set of changes in a git repository between a chosen base ref and the working tree, without modifying the repository, as a structured diff that viewers and future review features consume.

## Requirements

### Requirement: Diff base ref against working tree
The system SHALL compute the diff from a base ref to the current working tree, so that both committed and uncommitted changes since the base are included. When no base ref is given, the base SHALL be `HEAD`.

#### Scenario: Default base is HEAD
- **WHEN** a repository is opened without specifying a base ref
- **THEN** the diff shows the working tree's changes relative to `HEAD`

#### Scenario: Custom base includes commits and uncommitted edits
- **WHEN** the base ref is a commit two commits behind `HEAD` and the working tree also has uncommitted edits
- **THEN** the diff includes changes from both intervening commits and the uncommitted edits, as one combined diff per file

#### Scenario: Staged and unstaged changes are combined
- **WHEN** a file has both staged and unstaged modifications
- **THEN** the diff for that file reflects the working tree content against the base, regardless of staging

### Requirement: Accept any resolvable git revision as base
The system SHALL accept any revision expression that git can resolve to a commit (branch, tag, commit SHA or prefix, or relative form such as `HEAD~3`) as the base ref, and SHALL report a clear error when it does not resolve.

#### Scenario: Branch name as base
- **WHEN** the base ref is `main`
- **THEN** the diff is computed against the commit `main` points to

#### Scenario: Unresolvable base
- **WHEN** the base ref is `no-such-branch`
- **THEN** no diff is produced and an error states that the ref could not be resolved

### Requirement: Include untracked files
The system SHALL include untracked files that are not ignored by git's ignore rules, presented as added files whose entire content is added lines.

#### Scenario: New file created by an agent
- **WHEN** a new, non-ignored file exists in the working tree that has never been added to git
- **THEN** the file appears in the diff with status `untracked` and all of its lines as additions

#### Scenario: Ignored files are excluded
- **WHEN** an untracked file matches a `.gitignore` rule
- **THEN** the file does not appear in the diff

### Requirement: Read-only repository access
The system SHALL NOT modify the repository: no changes to the working tree, the index, refs, config, or stash, including when computing diffs for untracked files.

#### Scenario: Index unchanged after diffing
- **WHEN** a repository with untracked and modified files is opened and diffed
- **THEN** the output of `git status` is identical before and after

### Requirement: File change classification
Each changed file SHALL be classified as exactly one of `added`, `modified`, `deleted`, `renamed`, or `untracked`. Renames SHALL be detected using git's default rename detection and reported with both old and new paths.

#### Scenario: Renamed file with edits
- **WHEN** a file is moved to a new path and lightly edited
- **THEN** it is reported as one `renamed` file with old path, new path, and only the edited lines as changes

#### Scenario: Deleted file
- **WHEN** a file present at the base is removed from the working tree
- **THEN** it is reported as `deleted` with all of its lines as removals

### Requirement: Per-file line statistics
For each text file the system SHALL report the number of added and removed lines.

#### Scenario: Stats match the hunks
- **WHEN** a file's diff contains 12 added lines and 4 removed lines
- **THEN** its statistics report 12 additions and 4 deletions

### Requirement: Structured diff model
The diff SHALL be exposed as structured data: a list of files, each with its classification, paths, statistics, and hunks; each hunk with its old/new start and length; each line with its kind (`context`, `added`, `removed`), its text, and its old and/or new line number. Lines SHALL preserve their exact text, including whitespace, and SHALL indicate when the file has no trailing newline.

#### Scenario: Line numbers per side
- **WHEN** a hunk contains a context line, a removed line, and an added line
- **THEN** the context line has both old and new numbers, the removed line only an old number, and the added line only a new number

#### Scenario: Missing trailing newline
- **WHEN** a file's last line has no newline at the base or in the working tree
- **THEN** the model marks that side as lacking a trailing newline

### Requirement: On-demand per-file detail
The system SHALL provide the list of changed files with their classifications and statistics without requiring every file's hunks to be produced, and SHALL produce an individual file's hunks on request.

#### Scenario: Large change set opens quickly
- **WHEN** a diff touches 1,000 files
- **THEN** the file list is available without waiting for all 1,000 files' hunks

### Requirement: Binary file detection
Files that git treats as binary SHALL be classified as binary and SHALL NOT have line hunks.

#### Scenario: Image changed
- **WHEN** a PNG file is modified
- **THEN** it appears in the file list marked as binary, with no hunks

### Requirement: Large file guard
Text files whose diff exceeds a size threshold SHALL be marked as large, and their hunks SHALL only be produced when explicitly requested.

#### Scenario: Lockfile churn
- **WHEN** a lockfile's diff exceeds the threshold
- **THEN** it is marked as large in the file list and its hunks are produced only on explicit request

### Requirement: Full file content for context expansion
The system SHALL provide the full content of a changed text file at the base and in the working tree, so context lines hidden between hunks can be revealed.

#### Scenario: Reveal hidden lines between hunks
- **WHEN** lines 40–80 of a modified file are unchanged and hidden between two hunks
- **THEN** their text and line numbers can be retrieved for display

### Requirement: Repository validation and git availability
The system SHALL report a clear error when the selected path is not inside a git repository, when the repository has no commits and no base ref can be resolved, or when the `git` executable cannot be found.

#### Scenario: Not a repository
- **WHEN** the user opens a folder that is not inside a git repository
- **THEN** an error states that the folder is not a git repository

#### Scenario: Git missing
- **WHEN** no `git` executable is available on the system path
- **THEN** an error states that git is required and could not be found

#### Scenario: Subfolder of a repository
- **WHEN** the user opens a subfolder of a repository
- **THEN** the diff covers the whole repository from its top-level directory
