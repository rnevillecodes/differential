# Spec Delta

## Purpose

Lists a git repository's commits with their parents and ref labels, in topological order and in pages, so the history can be drawn as a graph without modifying the repository.

## ADDED Requirements

### Requirement: List commits of all refs
The system SHALL list the commits reachable from every local branch, remote-tracking branch, tag, and `HEAD`. Each entry SHALL carry its full SHA, its parents' full SHAs in order (first parent first), its subject line, its author name, and its author date.

#### Scenario: Commits on two branches
- **WHEN** `main` has commits A and B, and `feature` branches from A with commit C
- **THEN** the list contains A, B, and C, and both B's and C's parent list is `[A]`

#### Scenario: Merge commit
- **WHEN** commit M merges `feature` (tip C) into `main` (tip B)
- **THEN** M's parent list is `[B, C]`

#### Scenario: Detached HEAD on an unreferenced commit
- **WHEN** `HEAD` is detached at a commit that no branch or tag contains
- **THEN** that commit is listed

### Requirement: Topological order
The system SHALL list commits so that no commit appears before any of its children, with newer commits first where the topology allows.

#### Scenario: Child before parent
- **WHEN** commit B has parent A
- **THEN** B is listed before A

### Requirement: Ref labels on commits
Each commit SHALL carry the local branches, remote-tracking branches, and tags that point at it, each with its short name and kind, plus a marker when `HEAD` points at it. Symbolic remote refs such as `origin/HEAD` SHALL NOT be listed as labels.

#### Scenario: Branch and tag on one commit
- **WHEN** `main` and tag `v1.0` both point at commit B, and `main` is checked out
- **THEN** B carries labels `main` (local) and `v1.0` (tag), and is marked as `HEAD`

#### Scenario: Remote HEAD alias omitted
- **WHEN** `origin/HEAD` points to `origin/main`
- **THEN** the commit carries the label `origin/main` and not `origin/HEAD`

### Requirement: Paged listing
The system SHALL return commits in pages of a caller-given size starting at a caller-given offset in the topological order, and SHALL report whether more commits follow the page.

#### Scenario: First page of a long history
- **WHEN** a repository has 1200 commits and the first page of 500 is requested
- **THEN** 500 commits are returned and more commits are reported to follow

#### Scenario: Last page
- **WHEN** the page starting at offset 1000 with size 500 is requested from that repository
- **THEN** 200 commits are returned and no more commits are reported to follow

### Requirement: Repository with no commits
The system SHALL return an empty list, not an error, for a repository that has no commits yet.

#### Scenario: Freshly initialized repository
- **WHEN** commits are listed for a repository created with `git init` and nothing committed
- **THEN** the list is empty, no more commits are reported, and no error is reported

### Requirement: Read-only history listing
The system SHALL NOT modify the repository when listing commits: no changes to the working tree, the index, refs, config, or stash.

#### Scenario: Status unchanged after listing
- **WHEN** commits are listed for a repository with staged, unstaged, and untracked changes
- **THEN** the output of `git status` and the index file are identical before and after
