# Spec Delta

## Purpose

Shows the open repository's project structure in the sidebar as a navigable folder tree, marks where the changes are, and lets the reviewer open any file: changed files as diffs, unchanged files as read-only contents.

## ADDED Requirements

### Requirement: Sidebar tabs
The sidebar SHALL offer two tabs: **Changes**, showing the changed-file list, and **Files**, showing the project tree. Switching tabs SHALL NOT change the file shown in the main pane. The selected tab SHALL persist across application restarts.

#### Scenario: Switch to the project tree
- **WHEN** the Changes tab is active and the user selects the Files tab
- **THEN** the sidebar shows the project tree and the main pane keeps showing the same file

#### Scenario: Persisted tab
- **WHEN** the user selects the Files tab and restarts the application
- **THEN** the sidebar opens on the Files tab

### Requirement: Project tree
The Files tab SHALL show every project file as a tree of folders and files built from their paths. The tree SHALL also include files deleted relative to the base. Within each folder, subfolders SHALL be listed before files, and each group SHALL be sorted by name, ignoring case. Folders SHALL be collapsible, and when a repository is opened all folders SHALL start collapsed except those containing the selected file (see "Reveal the selection").

#### Scenario: Tree structure
- **WHEN** the project contains `README.md`, `src/main.ts`, and `src/ui/App.tsx`
- **THEN** the top level shows the folder `src` followed by the file `README.md`, and expanding `src` shows the folder `ui` followed by `main.ts`

#### Scenario: Deleted file appears
- **WHEN** `old.ts` exists at the base and has been deleted from the working tree
- **THEN** `old.ts` appears in the tree with the deleted status indicator

#### Scenario: Collapse a folder
- **WHEN** the user collapses an expanded folder
- **THEN** its descendants are hidden and the folder is shown as collapsed

### Requirement: Change markers in the tree
Each changed file in the tree SHALL show the same status indicator it has in the Changes list. Each folder that contains changed files at any depth SHALL be marked as changed and SHALL show how many changed files it contains. Unchanged files and folders SHALL have no marker.

#### Scenario: Folder with nested changes
- **WHEN** `src/a.ts` is modified and `src/ui/b.tsx` is untracked
- **THEN** `src` shows 2 changed files, `src/ui` shows 1, `a.ts` shows the modified indicator, and `b.tsx` shows the untracked indicator

#### Scenario: Renamed file
- **WHEN** `src/old.ts` was renamed to `lib/new.ts`
- **THEN** `lib/new.ts` appears with the renamed indicator and `src/old.ts` does not appear

### Requirement: Open a changed file from the tree
Selecting a changed file in the tree SHALL show its diff in the main pane, the same as selecting it in the Changes list. The Changes list and the tree SHALL show the same file as selected. The next-file and previous-file shortcuts SHALL keep moving through the changed files in Changes-list order.

#### Scenario: Select from the tree
- **WHEN** the user selects a modified file in the tree
- **THEN** its diff is shown and that file is selected in the Changes list too

#### Scenario: Reveal the selection
- **WHEN** a changed file inside collapsed folders is selected in the Changes list and the user switches to the Files tab
- **THEN** that file's ancestor folders are expanded and the file is scrolled into view and selected

### Requirement: View an unchanged file
Selecting an unchanged file in the tree SHALL show its current working-tree contents in the main pane, read-only, with line numbers and syntax highlighting according to the file's language. Lines SHALL NOT wrap. Binary files SHALL show a placeholder instead of contents. Large files SHALL show a placeholder with an action to load the contents anyway. A file that no longer exists on disk SHALL show a message suggesting a refresh. While an unchanged file is shown, no file SHALL be selected in the Changes list, and the next-file shortcut SHALL show the first changed file.

#### Scenario: Unchanged source file
- **WHEN** the user selects an unchanged `.ts` file in the tree
- **THEN** its full contents are shown with line numbers and TypeScript highlighting, and no diff coloring

#### Scenario: Unchanged binary file
- **WHEN** the user selects an unchanged image file
- **THEN** a placeholder states that the file is binary and its contents are not shown

#### Scenario: Unchanged large file
- **WHEN** the user selects an unchanged file over the size limit and chooses to load it
- **THEN** its contents are shown

### Requirement: Keyboard navigation in the tree
When the tree has focus, the Up and Down arrow keys SHALL move the highlighted row, Right SHALL expand a collapsed folder or move into an expanded one, Left SHALL collapse an expanded folder or move to the parent folder, and Enter SHALL toggle a folder or open a file.

#### Scenario: Expand and open with the keyboard
- **WHEN** a collapsed folder is highlighted and the user presses Right, then Down, then Enter
- **THEN** the folder expands, its first child is highlighted, and that child opens (or toggles, if it is a folder)

### Requirement: Tree follows refresh and repository changes
The tree SHALL be rebuilt when the repository, base, or diff is refreshed, keeping expanded folders that still exist and the selected file if it still exists. Opening a different repository SHALL show that repository's tree with all folders collapsed.

#### Scenario: New file after refresh
- **WHEN** a file is created on disk and the user triggers refresh
- **THEN** the file appears in the tree with the untracked indicator, and previously expanded folders stay expanded

### Requirement: Large project trees
The tree SHALL stay smooth to scroll and expand for a project with 50,000 files.

#### Scenario: Very large project
- **WHEN** a repository with 50,000 files is open and its folders are expanded
- **THEN** the tree scrolls smoothly and expanding or collapsing a folder responds without a visible stall

### Requirement: Read-only explorer
The explorer SHALL NOT offer any action that creates, renames, moves, edits, or deletes files, or that changes git state.

#### Scenario: No mutating actions
- **WHEN** the user interacts with any folder or file in the tree or the file view
- **THEN** no control exists that would change files or git state
