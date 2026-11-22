# Spec Delta

## Purpose

Gives the reviewer interactive shells inside Differential, rooted in the open repository, so they can run tests, inspect code, or drive an agent without leaving the review window.

## ADDED Requirements

### Requirement: Toggle the terminal panel
The application SHALL provide a terminal panel docked below the main file pane that the user can show and hide with a toolbar control and the `` Ctrl+` `` shortcut. The shortcut SHALL work whether or not a terminal has keyboard focus.

#### Scenario: Show the panel
- **WHEN** a repository is open, the panel is hidden, and the user presses `` Ctrl+` ``
- **THEN** the terminal panel appears below the file pane and the active terminal receives keyboard focus

#### Scenario: Hide the panel from inside a terminal
- **WHEN** a terminal has keyboard focus and the user presses `` Ctrl+` ``
- **THEN** the panel is hidden, its shells keep running, and showing it again displays them with their output intact

#### Scenario: No repository open
- **WHEN** no repository is open
- **THEN** the panel cannot be shown and the toolbar control is disabled

### Requirement: First terminal opens automatically
When the panel is shown and contains no terminals, the application SHALL start a new terminal in it.

#### Scenario: First show
- **WHEN** the user shows the panel for the first time in a session
- **THEN** one terminal tab is created with a running shell

### Requirement: Remember panel visibility and height
The panel's visibility and its height SHALL persist across application restarts. The user SHALL be able to resize the panel by dragging its top edge, within limits that keep both the panel and the file pane usable.

#### Scenario: Restart with panel open
- **WHEN** the panel is open at a custom height and the application is restarted with a repository
- **THEN** the panel is open at the same height with one new terminal

#### Scenario: Resize bounds
- **WHEN** the user drags the panel edge far toward the top of the window
- **THEN** the panel stops growing while a minimum height of the file pane remains visible

### Requirement: Maximize the terminal panel
The user SHALL be able to maximize the terminal panel from its header so that it fills the area of the file pane, hiding the file pane, and restore it to its previous height. While maximized the panel SHALL NOT be resizable by dragging. Hiding and showing the panel SHALL keep it maximized.

#### Scenario: Maximize
- **WHEN** the panel is open at 260px and the user activates the maximize control
- **THEN** the terminal fills the space below the toolbar beside the sidebar, the file pane is hidden, and the terminal is resized to the new area

#### Scenario: Restore
- **WHEN** the panel is maximized and the user activates the restore control
- **THEN** the file pane is shown again and the panel returns to 260px

#### Scenario: Hidden while maximized
- **WHEN** the panel is maximized and the user hides it
- **THEN** the file pane is shown at full height, and showing the panel again shows it maximized

### Requirement: Interactive shell session
Each terminal SHALL run the user's default shell attached to a pseudo-terminal, so interactive and full-screen programs work, colors and cursor control are rendered, and control keys such as `Ctrl+C` reach the running program.

#### Scenario: Run a command
- **WHEN** the user types `git status` and presses Enter
- **THEN** the command's output appears in the terminal, including its colors

#### Scenario: Interrupt a program
- **WHEN** a long-running command is running and the user presses `Ctrl+C`
- **THEN** the program receives the interrupt and the shell prompt returns

#### Scenario: Full-screen program
- **WHEN** the user runs a full-screen program such as a pager or editor
- **THEN** it renders in the terminal's area and responds to keyboard input

### Requirement: Default shell per platform
On Windows the shell SHALL be PowerShell (PowerShell 7 when installed, otherwise Windows PowerShell). On other platforms it SHALL be the shell named by the `SHELL` environment variable, falling back to `/bin/sh`.

#### Scenario: Windows without PowerShell 7
- **WHEN** a terminal is created on Windows and `pwsh` is not on `PATH`
- **THEN** the terminal runs Windows PowerShell

### Requirement: Shells start in the repository root
A new terminal's shell SHALL start with its working directory set to the root of the repository open at the moment it is created, and SHALL inherit the application's environment.

#### Scenario: Working directory
- **WHEN** the user creates a terminal while `C:/code/my-project` is open and runs `pwd`
- **THEN** the output is the repository root

### Requirement: Terminal size follows the panel
The pseudo-terminal's columns and rows SHALL match the visible terminal area, and SHALL be updated whenever the panel or window is resized.

#### Scenario: Resize the window
- **WHEN** the user widens the window while a full-screen program is running
- **THEN** the program redraws to the new width

### Requirement: Multiple terminals as tabs
The panel SHALL show its terminals as tabs and let the user create a new terminal, switch between terminals, and close a terminal. Only the active terminal's output is visible; the others keep running.

#### Scenario: Second terminal
- **WHEN** one terminal is open and the user activates the new-terminal control
- **THEN** a second tab appears, becomes active with a fresh shell, and the first terminal's shell keeps running

#### Scenario: Background output preserved
- **WHEN** a command prints output in an inactive terminal and the user switches to it
- **THEN** the output is shown as if the terminal had been visible

### Requirement: Closing a terminal ends its shell
Closing a terminal tab SHALL end its shell and every program the shell started in that terminal. Closing the last tab SHALL hide the panel.

#### Scenario: Close a tab with a running program
- **WHEN** a terminal is running a long-running command and the user closes its tab
- **THEN** the tab disappears and the shell and the command are terminated

#### Scenario: Close the last tab
- **WHEN** the panel has one terminal and the user closes it
- **THEN** the panel is hidden

### Requirement: Shell exit closes the tab
When a terminal's shell exits on its own, whatever its exit code, its tab SHALL close as if the user had closed it, including hiding the panel when it was the last terminal.

#### Scenario: User types exit
- **WHEN** two terminals are open and the user types `exit` in one of them
- **THEN** that terminal's tab closes and the other terminal becomes active

#### Scenario: Last shell exits
- **WHEN** the only terminal's shell exits
- **THEN** its tab closes and the panel is hidden

### Requirement: Shell start failure is reported
If a terminal's shell cannot be started, the terminal tab SHALL show an error describing the failure instead of a prompt.

#### Scenario: Shell missing
- **WHEN** the configured shell executable cannot be found
- **THEN** the tab shows an error naming the shell, and other terminals are unaffected

### Requirement: Keyboard input goes to the focused terminal
While a terminal has keyboard focus, all keystrokes SHALL be delivered to its shell, and the application's own keyboard shortcuts SHALL NOT act, except the panel toggle. Copy and paste SHALL be available through `Ctrl+Shift+C` / `Ctrl+Shift+V` and the context menu.

#### Scenario: Ctrl+R in a terminal
- **WHEN** a terminal has focus and the user presses `Ctrl+R`
- **THEN** the shell receives `Ctrl+R` and the diff is not refreshed

#### Scenario: Brackets in a terminal
- **WHEN** a terminal has focus and the user types `]`
- **THEN** the character is typed into the shell and the selected file does not change

#### Scenario: Shortcuts after leaving the terminal
- **WHEN** the user clicks in the file pane and presses `Ctrl+R`
- **THEN** the diff is refreshed

### Requirement: Terminals survive repository switches
Switching to a different repository SHALL NOT end existing terminals. Terminals created afterwards SHALL start in the newly opened repository's root.

#### Scenario: Switch repository
- **WHEN** a terminal is open in repository A and the user opens repository B
- **THEN** the terminal keeps running in A's directory, and a newly created terminal starts in B's root

### Requirement: Terminal theme
Terminals SHALL follow the application's light or dark theme, with default foreground, background, cursor, and selection colors legible in both.

#### Scenario: Dark mode
- **WHEN** the operating system is in dark mode
- **THEN** the terminal renders light text on a dark background matching the application

### Requirement: No automatic actions
The application SHALL NOT type into, run commands in, or read input from a terminal on the user's behalf, and terminal activity SHALL NOT trigger a diff refresh.

#### Scenario: Files change from a terminal command
- **WHEN** a command run in the terminal modifies a file in the repository
- **THEN** the displayed diff is unchanged until the user refreshes

### Requirement: Shells end with the application
When the application exits, it SHALL terminate every shell it started and their programs.

#### Scenario: Quit with a running command
- **WHEN** a terminal is running a long-running command and the user closes the application window
- **THEN** no shell or program started from the terminal panel remains running
