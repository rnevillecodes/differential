# Spec Delta

## Purpose

Lists the branches and tags of a git repository so the user can pick one as the diff base, without modifying the repository.

## ADDED Requirements

### Requirement: List branches and tags
The system SHALL list the repository's local branches, remote-tracking branches, and tags. Each entry SHALL carry its short name (for example `main`, `origin/main`, `v1.0`) and its kind (local, remote, or tag).

#### Scenario: Repository with all kinds of refs
- **WHEN** a repository has local branches `main` and `feature`, a remote-tracking branch `origin/main`, and a tag `v1.0`
- **THEN** the list contains `main` and `feature` as local, `origin/main` as remote, and `v1.0` as tag

#### Scenario: Branch names with slashes
- **WHEN** a local branch is named `feat/login`
- **THEN** it is listed with the short name `feat/login` as a local branch

### Requirement: Identify the current branch
The system SHALL mark the local branch that is currently checked out. When `HEAD` is detached, no branch SHALL be marked.

#### Scenario: On a branch
- **WHEN** `feature` is checked out
- **THEN** `feature` is marked as current and no other entry is

#### Scenario: Detached HEAD
- **WHEN** `HEAD` points directly at a commit
- **THEN** no entry is marked as current

### Requirement: Omit symbolic remote HEADs
The system SHALL NOT list a remote's symbolic `HEAD` (for example `origin/HEAD`), because it only aliases another listed branch.

#### Scenario: Remote with a default-branch pointer
- **WHEN** `origin/HEAD` points to `origin/main`
- **THEN** `origin/main` is listed and `origin/HEAD` is not

### Requirement: Order by recency
The system SHALL list entries within each kind with the most recently committed first.

#### Scenario: Two local branches
- **WHEN** `feature` has a newer commit than `main`
- **THEN** `feature` is listed before `main` among local branches

### Requirement: Repository with no refs
The system SHALL return an empty list, not an error, for a repository that has no branches or tags yet.

#### Scenario: Freshly initialized repository
- **WHEN** a repository has no commits
- **THEN** the list is empty and no error is reported

### Requirement: Read-only ref listing
The system SHALL NOT modify the repository when listing refs: no changes to the working tree, the index, refs, config, or stash.

#### Scenario: Status unchanged after listing
- **WHEN** refs are listed for a repository with staged, unstaged, and untracked changes
- **THEN** the output of `git status` and the index file are identical before and after
