# Proposal

## Why

Reviewers often want to see how their current checkout differs from another branch (for example "what does my working tree have that `main` doesn't?"). The Base field already accepts a branch name, but it is a bare text box: the user has to know and type exact branch names, and nothing shows which branches exist. The alternative, switching branches, would modify the repository, which this tool must never do.

## What Changes

- The toolbar's **Base** text input becomes a searchable dropdown. Opening it lists the repository's local branches, remote-tracking branches, and tags, grouped by kind, with the current branch marked.
- Typing in the dropdown filters the list. Any revision git can resolve (a SHA, `HEAD~3`, etc.) can still be typed and applied, so nothing the text box allowed today is lost.
- Picking a branch sets it as the base and recomputes the diff of the **current working tree** against that branch's **tip** commit. The checked-out branch, index, and files are not touched.
- A new read-only backend command lists the repository's branches and tags.
- The base's existing behaviour is unchanged: invalid revisions show the inline error and keep the previous diff, the base can still be passed at launch, and refresh re-resolves it.

Out of scope: switching or checking out branches; diffing two refs without the working tree (branch vs branch); diffing from the merge-base (fork point) of a branch; showing each branch's ahead/behind counts or last commit details; listing commits; creating or deleting refs.

## Capabilities

### New Capabilities
- `repo-refs`: Listing a repository's local branches, remote-tracking branches, and tags (with the current branch identified), read-only through the `git` CLI.
- `base-picker`: Choosing the diff base from a searchable list of the repository's branches and tags in the toolbar, while still accepting any typed revision.

### Modified Capabilities
<!-- None. The `diff-viewer` capability that owns "Choose the base ref" is still in the in-flight `core-diff-viewer` change and not yet in `openspec/specs/`. This change builds on that requirement without changing it: typing a revision keeps working exactly as specified there. -->

## Impact

- Depends on the `core-diff-viewer` change (toolbar, base handling, store). Build on the same branch.
- Backend: new `list_refs` Tauri command in `src-tauri/src/commands.rs`, implemented in a new `src-tauri/src/git/refs.rs` using `git for-each-ref`; a new ts-rs type for a ref; integration tests in `src-tauri/tests/`.
- Frontend: a new `BasePicker` component replacing the base `<input>` in `src/components/Toolbar.tsx`; store state for the ref list; a new `Api.listRefs` method and fake in `src/test/fixtures.ts`.
- No new dependencies.
