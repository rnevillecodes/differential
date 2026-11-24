# Spec Delta

## MODIFIED Requirements

### Requirement: Tree follows refresh and repository changes
The tree SHALL be rebuilt when the repository, base, or diff is refreshed, manually or by an automatic update, keeping expanded folders that still exist, the selected file if it still exists, and the tree's scroll position. Opening a different repository SHALL show that repository's tree with all folders collapsed.

#### Scenario: New file after refresh
- **WHEN** a file is created on disk and the user triggers refresh
- **THEN** the file appears in the tree with the untracked indicator, and previously expanded folders stay expanded

#### Scenario: New file appears automatically
- **WHEN** an agent creates a file in an expanded folder
- **THEN** the file appears in the tree with the untracked indicator without the user acting, and the tree's expanded folders and scroll position are unchanged

## ADDED Requirements

### Requirement: Open unchanged files stay current
An unchanged file shown in the main pane SHALL be re-read when the working tree changes, keeping its current contents and scroll position on screen until the new contents arrive. If the file becomes changed against the base, its tab SHALL show the file's diff instead.

#### Scenario: Viewed file edited
- **WHEN** an unchanged file is shown and another program edits it
- **THEN** the view updates to show the file's diff, without a loading message in between

#### Scenario: Other file edited
- **WHEN** an unchanged file is shown, scrolled down, and a different file changes on disk
- **THEN** the shown file stays at the same scroll position
