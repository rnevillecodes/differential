# Design

## Context

- The base is already a free-form revision. `git::resolve_base` runs `rev-parse --verify --end-of-options <rev>^{commit}`, and `list_changes` diffs that SHA against the working tree. A branch typed into Base therefore already works; this change adds discovery, not a new diff mode.
- The toolbar's Base is an `<input>` in `src/components/Toolbar.tsx`, with a local draft, Enter to apply via `setBase`, Escape to revert, and an inline `baseError`.
- `src/components/RepoPicker.tsx` already implements a searchable dropdown: trigger button, popover with a combobox input and listbox, word-based filtering, arrow/Home/End/Enter/Escape, and close on outside click. Its store flag `repoPickerOpen` exists so that Ctrl+O can open it.
- All git access runs with `GIT_OPTIONAL_LOCKS=0` through `git::Git`, and commands are `blocking(...)` wrappers in `commands.rs` with ts-rs types exported to `src/model/`.

## Goals / Non-Goals

**Goals:**
- One read-only git call lists everything the picker needs.
- The value applied as the base always resolves to the ref the user picked, even when a branch and a tag share a name.
- The picker stays responsive in repositories with thousands of remote branches or tags.

**Non-Goals:**
- Fetching from remotes. Remote-tracking branches are shown as of the user's last fetch; the app never touches the network or refs.
- A shared generic combobox component. The two pickers differ in items and actions; extracting a shared one can happen later if a third appears.

## Decisions

### One `for-each-ref` call
`git for-each-ref --sort=-creatordate --format=<fields> refs/heads refs/remotes refs/tags`, with fields separated by `%00`: `%(refname)`, `%(refname:short)`, `%(symref)`, `%(HEAD)`.
- `creatordate` sorts commits and annotated tags alike (`committerdate` is empty for tag objects).
- Kind comes from the `refs/heads/`, `refs/remotes/`, or `refs/tags/` prefix of the full refname.
- Entries with a non-empty `%(symref)` (such as `refs/remotes/origin/HEAD`) are dropped.
- `%(HEAD)` is `*` for the checked-out branch, which gives "current" for free and no mark on a detached HEAD.
- Alternatives: `git branch -a` plus `git tag` means two calls, output meant for humans, and no tag dates. Reading `.git/refs` directly misses packed refs and worktree rules.

### Display name vs. applied revision
Each ref is returned as `{ name, rev, kind, current }`:
- `name` is the full refname minus its kind prefix (`main`, `origin/main`, `v1.0`). This is what the list shows and what the filter matches.
- `rev` is `%(refname:short)`. Git makes it unambiguous (`heads/main` if a tag `main` also exists), and it is what gets applied as the base. Without this, picking branch `main` could resolve to a tag `main`, because `rev-parse` prefers tags over branches.
- The toolbar shows the base as applied (`rev`), which matches what the user would type.

### Loading the ref list
The store gains `refs: Ref[] | null` and `refsError`. Refs load in parallel with the change set on `openPath` and `refresh`, using the same generation guard so stale responses are dropped. They do not reload on `setBase`, since changing the base does not change the refs. A ref-list failure is stored and shown inside the dropdown only, and never becomes the blocking `error`.

### `BasePicker` component
It replaces the base `<input>` and follows `RepoPicker`'s structure and keyboard model:
- **Trigger:** shows the current base, with the existing inline error kept beside it.
- **Popover:** a search input and a grouped listbox (Local, Remote, Tags; empty groups hidden).
- **Typed revision:** when the search text is non-empty and not exactly a listed name, a final **Use "<text>"** option applies the text as typed. When nothing matches, it is the only option, so Enter applies it. This keeps `HEAD~3` and SHAs working.
- **Initial highlight:** opening highlights the entry matching the current base, if any.
- **Picking:** calls the existing `setBase(rev)` and closes. Errors flow through the existing `baseError` path, which keeps the previous diff.
- **Open/closed state:** kept locally in the component, because no shortcut opens it (unlike Ctrl+O for the repo picker).

### Rendering many refs
Filtering runs over the full list in memory, which is cheap even for 10,000 entries. Rendering is capped at the first 200 matches, followed by a "N more, keep typing to narrow" row. A virtualized list is unnecessary for a popover the user filters by typing.

## Risks / Trade-offs

- [Remote branches may be stale] → Shown as of the last fetch, as `git branch -r` would show them. The app stays read-only and offline; a hint is not needed for v1.
- [Huge ref counts slow the git call] → `for-each-ref` reads packed refs efficiently; the call runs on a blocking thread in parallel with the diff, so it never delays the change list.
- [Users expect the base to be "since I branched off"] → Out of scope by decision (merge-base mode); picking a branch compares against its tip, matching what typing its name does today.
- [Ambiguous short names] → Handled by applying `rev` (`%(refname:short)`), which git disambiguates.
