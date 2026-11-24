# Spec Delta

## MODIFIED Requirements

### Requirement: No automatic actions
The application SHALL NOT type into, run commands in, or read input from a terminal on the user's behalf. Files changed by commands run in a terminal SHALL be shown through the application's normal automatic updates, like any other change on disk.

#### Scenario: Files change from a terminal command
- **WHEN** a command run in the terminal modifies a file in the repository
- **THEN** the displayed diff updates to show the change without the user refreshing, and nothing is typed into the terminal by the application
