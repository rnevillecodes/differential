# Spec Delta

## MODIFIED Requirements

### Requirement: Read-only presentation
The application SHALL NOT offer any action that edits file contents, stages, commits, discards, or otherwise changes the repository. Commands the user types into a terminal session are the user's own and are outside this rule; the application SHALL NOT issue such commands itself.

#### Scenario: No mutating actions
- **WHEN** the user inspects any file's diff
- **THEN** no control exists that would change files or git state

#### Scenario: User runs a command in a terminal
- **WHEN** the user types a command into a terminal that modifies a file
- **THEN** the change is made by that command, and the application's own controls remain read-only
