# Spec Delta

## MODIFIED Requirements

### Requirement: View an unchanged file
Selecting an unchanged file in the tree SHALL show its current working-tree contents in the main pane, read-only. Markdown files (`.md`, `.markdown`) SHALL be shown rendered by default, with a toggle to show their source (see the markdown-preview capability). All other files, and Markdown files switched to source, SHALL be shown with line numbers and syntax highlighting according to the file's language. Lines in the source view SHALL NOT wrap. Binary files SHALL show a placeholder instead of contents. Large files SHALL show a placeholder with an action to load the contents anyway. A file that no longer exists on disk SHALL show a message suggesting a refresh. While an unchanged file is shown, no file SHALL be selected in the Changes list, and the next-file shortcut SHALL show the first changed file.

#### Scenario: Unchanged source file
- **WHEN** the user selects an unchanged `.ts` file in the tree
- **THEN** its full contents are shown with line numbers and TypeScript highlighting, and no diff coloring

#### Scenario: Unchanged Markdown file
- **WHEN** the user selects an unchanged `README.md` in the tree
- **THEN** it is shown rendered, with a button to view its source

#### Scenario: Unchanged binary file
- **WHEN** the user selects an unchanged image file
- **THEN** a placeholder states that the file is binary and its contents are not shown

#### Scenario: Unchanged large file
- **WHEN** the user selects an unchanged file over the size limit and chooses to load it
- **THEN** its contents are shown
