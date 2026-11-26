# Spec Delta

## ADDED Requirements

### Requirement: Read a working-tree image
Given a repository-relative path, the system SHALL return the raw bytes of an image file in the working tree, for displaying images in rendered documents. It SHALL refuse, with an error and without returning any bytes, a path that is absolute or contains `..`, a path whose real location after following symbolic links is outside the repository, a file whose extension is not one of `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `bmp`, `ico` or `svg` (ignoring case), a file larger than 10 MB, and a path that does not exist or is not a regular file. Reading an image SHALL NOT modify the repository.

#### Scenario: PNG image
- **WHEN** the caller requests `docs/arch.png`, a 40 KB PNG in the working tree
- **THEN** its exact bytes are returned

#### Scenario: Not an image
- **WHEN** the caller requests `src/main.ts`
- **THEN** an error is returned and no contents

#### Scenario: Symbolic link leaving the repository
- **WHEN** `logo.png` is a symbolic link to `/etc/passwd` and the caller requests it
- **THEN** an error is returned and the target is not read

#### Scenario: Too large
- **WHEN** the caller requests a 12 MB `photo.jpg`
- **THEN** an error is returned and no contents
