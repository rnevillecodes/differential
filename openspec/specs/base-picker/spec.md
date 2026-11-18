# base-picker Specification

## Purpose

Lets the user choose the diff base from the repository's branches and tags in the toolbar, so the current checkout can be compared against another branch without switching to it.

## Requirements

### Requirement: Base dropdown
The toolbar SHALL show the current base in a control that opens a dropdown listing the repository's branches and tags, grouped as local branches, remote branches, and tags. The checked-out branch SHALL be marked, and the entry matching the current base SHALL be indicated.

#### Scenario: Open the dropdown
- **WHEN** the user opens the base control in a repository with branches `main` and `feature` (checked out) and tag `v1.0`
- **THEN** the dropdown lists `feature` (marked as current) and `main` under local branches and `v1.0` under tags

#### Scenario: No repository open
- **WHEN** no repository is open
- **THEN** the base control is disabled

### Requirement: Diff the working tree against a picked branch
Picking a branch or tag SHALL set it as the base and recompute the diff of the current working tree against that ref's tip commit. Picking SHALL NOT switch branches or modify the repository.

#### Scenario: Pick another branch
- **WHEN** `feature` is checked out with uncommitted edits and the user picks `main`
- **THEN** the file list and diff show every difference between `main`'s tip and the working tree, including the uncommitted edits
- **AND** `feature` is still checked out and `git status` is unchanged

#### Scenario: Pick a tag
- **WHEN** the user picks tag `v1.0`
- **THEN** the base becomes `v1.0` and the diff is recomputed against it

### Requirement: Search refs
Typing in the dropdown SHALL filter the listed refs to those whose names contain every typed word, ignoring case.

#### Scenario: Filter by words
- **WHEN** the user types `orig ma`
- **THEN** only refs whose names contain both `orig` and `ma` (such as `origin/main`) are listed

### Requirement: Typed revisions still accepted
The dropdown SHALL let the user apply any typed text as the base even when it matches no listed ref, so revisions such as a commit SHA or `HEAD~3` keep working.

#### Scenario: Apply a relative revision
- **WHEN** the user types `HEAD~3` and confirms it
- **THEN** the base becomes `HEAD~3` and the diff is recomputed

#### Scenario: Typed revision does not resolve
- **WHEN** the user types `no-such-ref` and confirms it
- **THEN** an inline error is shown and the previously displayed diff remains

### Requirement: Keyboard operation
The dropdown SHALL be operable from the keyboard: moving through entries with the arrow keys, choosing with Enter, and closing without changes with Escape.

#### Scenario: Choose with the keyboard
- **WHEN** the user opens the dropdown, presses the down arrow to reach `main`, and presses Enter
- **THEN** the base becomes `main` and the dropdown closes

#### Scenario: Dismiss with Escape
- **WHEN** the user opens the dropdown, types some text, and presses Escape
- **THEN** the dropdown closes and the base is unchanged

### Requirement: Ref list stays current
The listed refs SHALL be loaded when a repository is opened and reloaded when the user refreshes. A failure to list refs SHALL NOT block applying a typed revision.

#### Scenario: Branch created outside the app
- **WHEN** a new branch is created in a terminal and the user refreshes
- **THEN** the new branch appears in the dropdown

#### Scenario: Listing fails
- **WHEN** listing the refs fails
- **THEN** the dropdown says the branches could not be listed, and a typed revision can still be applied
