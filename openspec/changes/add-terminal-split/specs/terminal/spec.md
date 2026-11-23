# Spec Delta

## ADDED Requirements

### Requirement: Split the panel into terminal groups
The terminal panel SHALL hold one or more terminal groups laid out side by side in a single row. Each group SHALL have its own tab strip, its own active terminal, and SHALL show its active terminal. Each group SHALL offer a split control that creates a new terminal, started like any new terminal, in a new group placed directly to the right of that group. The new group SHALL become the active group, and its terminal SHALL receive keyboard focus. The panel SHALL hold at most 4 groups, and the split control SHALL be disabled while it holds 4.

#### Scenario: Split the panel
- **WHEN** the panel has one group with one running terminal and the user activates that group's split control
- **THEN** a second group appears to its right with a new terminal that has keyboard focus, and both terminals are visible and keep running

#### Scenario: Split a middle group
- **WHEN** the panel has groups A and B and the user activates A's split control
- **THEN** the new group appears between A and B

#### Scenario: Group limit
- **WHEN** the panel holds 4 groups
- **THEN** the split control is disabled in every group

#### Scenario: Single group looks unchanged
- **WHEN** the panel has never been split
- **THEN** it shows one tab strip and one terminal area, as it did before splitting was available

### Requirement: New terminals open in their group
The new-terminal control in a group's header SHALL create the terminal in that group and make it that group's active terminal. A terminal created any other way (such as when an empty panel is shown) SHALL open in the active group.

#### Scenario: New terminal in the right-hand group
- **WHEN** the panel has groups A and B and the user activates B's new-terminal control
- **THEN** the new terminal's tab appears in B's tab strip and is shown in B, and A is unchanged

### Requirement: Active terminal group
Exactly one group SHALL be active whenever the panel has terminals. A group SHALL become active when one of its terminals receives keyboard focus or when the user clicks its tab strip or one of its tabs. The active group SHALL be visibly marked when more than one group exists. Showing the panel SHALL put keyboard focus in the active group's active terminal.

#### Scenario: Click into another group
- **WHEN** group A is active and the user clicks in the terminal shown in group B
- **THEN** group B becomes active, is marked as active, and its terminal receives keystrokes

#### Scenario: Show the panel focuses the active group
- **WHEN** group B was active when the panel was hidden and the user shows it again
- **THEN** group B's active terminal receives keyboard focus

### Requirement: Resize terminal groups
The user SHALL be able to change the widths of adjacent groups by dragging the divider between them. No group SHALL be dragged narrower than a minimum width that keeps it usable. A new group SHALL take half the width of the group it was split from. When a group is removed, its width SHALL go to an adjacent group. Group widths SHALL keep their proportions when the panel or window is resized, and SHALL NOT persist across application restarts.

#### Scenario: Drag a divider
- **WHEN** two groups share the panel equally and the user drags the divider between them to the right
- **THEN** the left group widens, the right group narrows by the same amount, and both terminals resize to their new areas

#### Scenario: Minimum width
- **WHEN** the user drags a divider far toward one edge
- **THEN** the shrinking group stops at its minimum width

#### Scenario: Split halves the source group
- **WHEN** the panel has groups A and B at equal widths and the user splits B
- **THEN** A keeps half the panel and B and the new group each take a quarter

### Requirement: Empty groups are removed
When a group's last terminal is closed, whether by the user or because its shell exited, the group SHALL be removed. If the removed group was active, the adjacent group that receives its width SHALL become active.

#### Scenario: Close the only terminal in a group
- **WHEN** the panel has groups A and B, B has one terminal, and the user closes it
- **THEN** group B disappears, A fills the panel, and A becomes active

#### Scenario: Shell exits in a single-terminal group
- **WHEN** the panel has groups A and B and the only shell in A exits
- **THEN** group A disappears and B fills the panel

### Requirement: Panel restarts with a single group
After an application restart, a panel that was open SHALL show a single group with one new terminal, regardless of how it was split before.

#### Scenario: Restart after splitting
- **WHEN** the panel is open with 3 groups and the application is restarted with a repository
- **THEN** the panel is open with one group holding one new terminal

## MODIFIED Requirements

### Requirement: Multiple terminals as tabs
Each terminal group SHALL show its terminals as tabs and let the user create a new terminal, switch between the group's terminals, and close a terminal. Within a group only the active terminal's output is visible; the others keep running. Switching tabs in one group SHALL NOT change any other group.

#### Scenario: Second terminal
- **WHEN** one terminal is open and the user activates the new-terminal control
- **THEN** a second tab appears, becomes active with a fresh shell, and the first terminal's shell keeps running

#### Scenario: Background output preserved
- **WHEN** a command prints output in an inactive terminal and the user switches to it
- **THEN** the output is shown as if the terminal had been visible

#### Scenario: Switch tabs in one group
- **WHEN** the panel has groups A and B, each with two terminals, and the user switches tabs in A
- **THEN** A shows the newly selected terminal and B still shows the same terminal as before

### Requirement: Closing a terminal ends its shell
Closing a terminal tab SHALL end its shell and every program the shell started in that terminal. Closing a group's last tab SHALL remove that group. Closing the last tab in the panel SHALL hide the panel.

#### Scenario: Close a tab with a running program
- **WHEN** a terminal is running a long-running command and the user closes its tab
- **THEN** the tab disappears and the shell and the command are terminated

#### Scenario: Close the last tab
- **WHEN** the panel has one terminal and the user closes it
- **THEN** the panel is hidden

### Requirement: Shell exit closes the tab
When a terminal's shell exits on its own, whatever its exit code, its tab SHALL close as if the user had closed it. That includes removing its group when it was the group's last terminal, and hiding the panel when it was the panel's last terminal.

#### Scenario: User types exit
- **WHEN** two terminals are open in the same group and the user types `exit` in one of them
- **THEN** that terminal's tab closes and the other terminal becomes active

#### Scenario: Last shell exits
- **WHEN** the only terminal's shell exits
- **THEN** its tab closes and the panel is hidden

### Requirement: Terminal size follows the panel
Each visible terminal's pseudo-terminal columns and rows SHALL match that terminal's visible area, and SHALL be updated whenever the panel, the window, or the terminal's group is resized.

#### Scenario: Resize the window
- **WHEN** the user widens the window while a full-screen program is running
- **THEN** the program redraws to the new width

#### Scenario: Split while a program runs
- **WHEN** a full-screen program is running in a terminal and the user splits its group
- **THEN** the program redraws to the narrower width of its group
