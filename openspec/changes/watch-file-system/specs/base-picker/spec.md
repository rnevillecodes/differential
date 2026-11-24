# Spec Delta

## MODIFIED Requirements

### Requirement: Ref list stays current
The listed refs SHALL be loaded when a repository is opened and reloaded when the user refreshes and whenever the repository reports a git metadata change. A failure to list refs SHALL NOT block applying a typed revision.

#### Scenario: Branch created outside the app
- **WHEN** a new branch is created in a terminal and the user refreshes
- **THEN** the new branch appears in the dropdown

#### Scenario: Branch created without refreshing
- **WHEN** a new branch is created in a terminal
- **THEN** the new branch appears in the dropdown without the user refreshing

#### Scenario: Listing fails
- **WHEN** listing the refs fails
- **THEN** the dropdown says the branches could not be listed, and a typed revision can still be applied
