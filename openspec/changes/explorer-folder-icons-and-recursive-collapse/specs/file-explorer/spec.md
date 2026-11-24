# Spec Delta

## MODIFIED Requirements

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

#### Scenario: Plain collapse remembers subfolders
- **WHEN** `src` and `src/ui` are expanded, and the user collapses `src` and then expands it again
- **THEN** `src/ui` is shown expanded

## ADDED Requirements

### Requirement: Folder icons in the tree
Each folder row SHALL show a folder icon before its name, in place of a disclosure caret: a closed-folder icon when the folder is collapsed and an open-folder icon when it is expanded. File rows SHALL show no icon, and file names SHALL be indented so they align with folder names at the same depth.

#### Scenario: Collapsed and expanded folders
- **WHEN** `src` is expanded and `docs` is collapsed
- **THEN** `src` shows the open-folder icon, `docs` shows the closed-folder icon, and neither shows a caret

#### Scenario: Files have no icon
- **WHEN** a folder contains the subfolder `ui` and the file `main.ts`
- **THEN** `main.ts` shows no icon, and its name starts at the same horizontal position as `ui`'s name

### Requirement: Recursive collapse of a folder
The tree SHALL let the user collapse a folder together with every folder below it, so that expanding that folder again shows all its subfolders collapsed. Folders outside that folder SHALL keep their state.

#### Scenario: Collapse a subtree
- **WHEN** `src`, `src/ui`, and `src/ui/widgets` are expanded and the user uses the collapse-subtree control on `src`
- **THEN** `src` is collapsed, and expanding `src` again shows `src/ui` collapsed, and expanding `src/ui` shows `src/ui/widgets` collapsed

#### Scenario: Other folders untouched
- **WHEN** `src/ui` and `lib/core` are expanded and the user collapses the `src` subtree
- **THEN** `lib/core` stays expanded

### Requirement: Collapse-subtree control
An expanded folder with at least one expanded folder anywhere below it, including remembered ones inside a collapsed subfolder, SHALL show a collapse-subtree control at the right end of its row while the row is hovered or is the highlighted row of the focused tree. The control SHALL NOT appear on other rows. Using it SHALL collapse the subtree and SHALL NOT open, select, or toggle the row.

#### Scenario: Using the control
- **WHEN** `src` and `src/ui` are expanded, `README.md` is selected, and the user uses the control on `src`
- **THEN** the `src` subtree is collapsed and `README.md` stays selected and shown

#### Scenario: Control shown on hover
- **WHEN** `src` and `src/ui` are expanded and the pointer is over the `src` row
- **THEN** the collapse-subtree control is visible on the `src` row

#### Scenario: Control hidden when it would do nothing extra
- **WHEN** the pointer is over an expanded folder with no expanded folder anywhere below it, or over a collapsed folder, or over a file
- **THEN** no collapse-subtree control is shown on that row

#### Scenario: Control hidden when not hovered
- **WHEN** `src` and `src/ui` are expanded, the pointer is not over the `src` row, and `src` is not the highlighted row of the focused tree
- **THEN** no collapse-subtree control is shown on the `src` row

### Requirement: Keyboard recursive collapse
When the tree has focus and a folder is highlighted, Shift+Left SHALL collapse that folder and every folder below it, the same as its collapse-subtree control, whether or not the control is currently visible. When a file is highlighted, Shift+Left SHALL do nothing.

#### Scenario: Shift+Left on a folder
- **WHEN** `src` and `src/ui` are expanded, `src` is highlighted, and the user presses Shift+Left
- **THEN** `src` is collapsed and expanding it again shows `src/ui` collapsed

#### Scenario: Shift+Left on a file
- **WHEN** a file is highlighted and the user presses Shift+Left
- **THEN** no folder changes state and the highlighted row does not change

### Requirement: Tree highlights follow focus
The highlight marking the keyboard cursor's row SHALL be shown only while the tree has focus. The highlight marking the selected file SHALL remain while the tree does not have focus, in a muted style distinct from its focused style.

#### Scenario: Tree loses focus
- **WHEN** the user moves the keyboard cursor in the tree and then clicks in the main pane
- **THEN** no row shows the keyboard-cursor highlight, and the selected file's row is still highlighted in the muted style

#### Scenario: Tree regains focus
- **WHEN** the tree regains focus
- **THEN** the keyboard-cursor highlight reappears on its row and the selected file's highlight returns to its focused style
