# Spec Delta

## Purpose

Defines how the `differential` command starts: by default it runs the app in the background, detached from the terminal that launched it, so the terminal is free and can be closed.

## ADDED Requirements

### Requirement: Detach from the launching terminal
By default, running `differential` SHALL start the app as a background process that is independent of the launching terminal, and the command SHALL return control to the terminal immediately with exit status 0. This SHALL hold from Git Bash, PowerShell, and cmd on Windows, and from common shells on macOS and Linux.

#### Scenario: Launch from Git Bash
- **WHEN** the user runs `differential C:/code/my-project` in Git Bash
- **THEN** the prompt returns immediately and the Differential window opens on that repository

#### Scenario: Close the launching terminal
- **WHEN** the app was launched from a terminal and the user closes that terminal window
- **THEN** the app keeps running

#### Scenario: Ctrl+C in the launching terminal
- **WHEN** the app was launched from a terminal and the user presses Ctrl+C in that terminal
- **THEN** the app keeps running

### Requirement: Arguments preserved across detaching
The background app SHALL receive the same repository path and base as given on the command line, with a relative path resolved against the directory the command was run in.

#### Scenario: Relative path and base
- **WHEN** the user runs `differential . --base main` in `C:/code/my-project`
- **THEN** the app opens `C:/code/my-project` compared against `main`

### Requirement: Foreground opt-out
Running `differential --wait` SHALL NOT detach: the app SHALL run as the process the shell started, so a shell that waits for its programs, such as Git Bash, waits until the app exits.

#### Scenario: Launch with --wait from Git Bash
- **WHEN** the user runs `differential --wait` in Git Bash
- **THEN** the prompt returns only after the Differential window is closed

### Requirement: Fallback when detaching fails
If the app cannot be relaunched in the background, it SHALL run in the foreground instead of failing to start.

#### Scenario: Background relaunch refused
- **WHEN** the operating system refuses to start the background process
- **THEN** the app opens in the foreground in the launching terminal
