# repo-files Specification

## Purpose

Lists every file in a repository's working tree and reads a single working-tree file for display, without modifying the repository, so the UI can present the project's structure and show files that have no changes.

## Requirements

### Requirement: List project files
The system SHALL list the repository-relative path of every file in the working tree that git tracks, plus every untracked file that is not ignored. Ignored files SHALL be excluded. Paths SHALL use `/` as the separator on every platform, and each path SHALL appear once.

#### Scenario: Tracked and untracked files
- **WHEN** the repository tracks `src/a.ts` and the working tree also contains a new, non-ignored file `src/b.ts`
- **THEN** the listing contains both `src/a.ts` and `src/b.ts`

#### Scenario: Ignored files are excluded
- **WHEN** `dist/out.js` exists in the working tree and matches a `.gitignore` rule
- **THEN** the listing does not contain `dist/out.js`

#### Scenario: Staged file listed once
- **WHEN** a file is tracked and has both staged and unstaged edits
- **THEN** it appears exactly once in the listing

#### Scenario: File removed from disk
- **WHEN** a tracked file has been deleted from the working tree but the deletion is not committed
- **THEN** the listing does not contain that file

### Requirement: Read a working-tree file for viewing
Given a repository-relative path, the system SHALL return the file's current working-tree contents as text, with `\r\n` line endings shown as `\n`. Instead of the contents it SHALL report that the file is **missing** when it no longer exists, **binary** when it holds binary data, and that it is **large** when it is bigger than the large-file size limit, unless the caller explicitly asks for a large file's contents. Binary detection and the size limit SHALL be the same as for diffs.

#### Scenario: Text file
- **WHEN** the caller requests `src/a.ts`, a small text file
- **THEN** its full contents are returned as text

#### Scenario: Binary file
- **WHEN** the caller requests a PNG image
- **THEN** the result says the file is binary and has no contents

#### Scenario: Large file without and with force
- **WHEN** the caller requests a text file over the size limit
- **THEN** the result says the file is large and gives its size
- **WHEN** the caller requests the same file and asks for its contents anyway
- **THEN** its full contents are returned as text

#### Scenario: Missing file
- **WHEN** the requested path no longer exists in the working tree
- **THEN** the result says the file is missing, without raising an error

### Requirement: Paths stay inside the repository
The system SHALL refuse to read a path that is absolute or that leaves the repository root (for example, one containing `..`), and SHALL report an invalid-path error instead.

#### Scenario: Path traversal rejected
- **WHEN** the caller requests `../secrets.txt`
- **THEN** no file is read and an invalid-path error is returned

### Requirement: Read-only file access
Listing and reading files SHALL NOT modify the repository's working tree, index, or refs.

#### Scenario: Index unchanged after browsing
- **WHEN** the project files are listed and several files are read
- **THEN** the repository's index file and `git status` output are unchanged
