# Spec Delta

## Purpose

Shows Markdown files opened from the project tree as formatted, readable documents in the main pane, with the raw source one click away, so reviewers can read docs and notes without parsing markup.

## ADDED Requirements

### Requirement: Markdown files open rendered
An unchanged file whose name ends in `.md` or `.markdown` (ignoring case) SHALL be shown rendered when it is opened from the project tree. Other files, including `.mdx`, SHALL NOT be rendered. Changed Markdown files SHALL keep showing their diff. Binary, large, missing and not-a-file placeholders SHALL be shown exactly as for any other file; a large Markdown file loaded anyway SHALL be shown rendered.

#### Scenario: Open a README
- **WHEN** the user selects an unchanged `README.md` in the Files tree
- **THEN** the main pane shows the document rendered, with no line numbers

#### Scenario: Upper-case extension
- **WHEN** the user opens an unchanged `NOTES.MARKDOWN`
- **THEN** it is shown rendered

#### Scenario: Changed Markdown file
- **WHEN** the user selects a modified `docs/guide.md`
- **THEN** its diff is shown, not a rendered view

#### Scenario: MDX is not rendered
- **WHEN** the user opens an unchanged `page.mdx`
- **THEN** it is shown as source with line numbers

### Requirement: Supported Markdown syntax
The rendered view SHALL support CommonMark and these GitHub-flavoured extensions: tables (with column alignment), task-list items (shown as checkboxes that cannot be toggled), strikethrough, and bare URL autolinks. Fenced code blocks SHALL be syntax highlighted when their info string names a known language and shown as plain monospace text otherwise. Code blocks and tables wider than the pane SHALL scroll horizontally instead of widening the page; prose SHALL wrap to the pane's width.

#### Scenario: Common elements
- **WHEN** a file contains a `#` heading, a paragraph with `**bold**` and `` `code` ``, a bulleted list and a `>` quote
- **THEN** they are shown as a heading, a paragraph with bold and inline code, a list and a block quote

#### Scenario: Table and task list
- **WHEN** a file contains a GFM table with a right-aligned column and the items `- [x] done` and `- [ ] todo`
- **THEN** the table is shown with that column right-aligned, and the items show a checked and an unchecked checkbox that do not change when clicked

#### Scenario: Highlighted fenced code
- **WHEN** a file contains a fenced block with the info string `ts`
- **THEN** the block is shown in monospace with TypeScript highlighting

#### Scenario: Unknown fence language
- **WHEN** a fenced block's info string is `nosuchlang`
- **THEN** the block is shown as plain monospace text

### Requirement: Switch between rendered and source
The file header of a Markdown file SHALL show a toggle button that switches the tab between the rendered view and the source view. The source view SHALL be the same read-only, line-numbered, highlighted view used for other unchanged files. The button SHALL indicate which view it switches to. The choice SHALL apply only to that tab, SHALL survive switching to other tabs and back, and SHALL NOT be remembered once the tab is closed: a Markdown file opened in a new tab SHALL start rendered. Non-Markdown files SHALL NOT show the button.

#### Scenario: View the source
- **WHEN** a rendered `README.md` is shown and the user clicks the toggle button
- **THEN** the tab shows the file's source with line numbers, and the button offers to switch back to the rendered view

#### Scenario: Choice is per tab
- **WHEN** `a.md` is switched to source, the user opens `b.md`, and then returns to the `a.md` tab
- **THEN** `b.md` is shown rendered and `a.md` is still shown as source

#### Scenario: Reopened tab starts rendered
- **WHEN** `a.md` is switched to source, its tab is closed, and `a.md` is opened again
- **THEN** it is shown rendered

#### Scenario: No toggle for other files
- **WHEN** the user opens an unchanged `main.ts`
- **THEN** no rendered/source toggle is shown

### Requirement: Links
Clicking a link in the rendered view SHALL NOT navigate the application window. A link starting with `#` SHALL scroll the rendered view to the heading with that anchor. A relative link to a path inside the repository SHALL open that file the same way as selecting it in the project tree (ignoring any `#fragment`), resolved against the Markdown file's folder; if no such file exists the tab SHALL show the usual file-not-found message. A relative link that resolves outside the repository root SHALL open nothing. Links with the `http`, `https` or `mailto` scheme SHALL open in the operating system's default handler. Links with any other scheme SHALL do nothing. Every link SHALL show its target as a tooltip.

#### Scenario: Link to another repository file
- **WHEN** `docs/guide.md` contains `[setup](../SETUP.md)` and the user clicks it
- **THEN** `SETUP.md` at the repository root opens in a tab

#### Scenario: Link to a changed file
- **WHEN** a link targets a file that has changes against the base
- **THEN** that file's diff opens, the same as selecting it in the tree

#### Scenario: Anchor link
- **WHEN** the user clicks `[Usage](#usage)` and the document has a `## Usage` heading
- **THEN** the rendered view scrolls to that heading

#### Scenario: Web link
- **WHEN** the user clicks a link to `https://example.com`
- **THEN** it opens in the default browser and the application window stays on the document

#### Scenario: Disallowed scheme
- **WHEN** the user clicks a link to `javascript:alert(1)` or `file:///etc/passwd`
- **THEN** nothing happens

#### Scenario: Link to a missing file
- **WHEN** the user clicks `[old](gone.md)` and `gone.md` does not exist
- **THEN** a tab opens showing the file-not-found message

#### Scenario: Link escaping the repository
- **WHEN** the user clicks a relative link that resolves outside the repository root
- **THEN** no file is opened

### Requirement: Raw HTML and images are not rendered
HTML written in the Markdown source SHALL NOT be interpreted; it SHALL appear as literal text. Images SHALL NOT be fetched or displayed, whether local or remote; each image SHALL be shown as a placeholder containing its alt text (or the word "image" when it has none) and its source as a tooltip.

#### Scenario: Embedded HTML
- **WHEN** a file contains `<script>alert(1)</script>` or `<img src=x onerror=alert(1)>`
- **THEN** no script runs and the markup appears as text

#### Scenario: Image placeholder
- **WHEN** a file contains `![Architecture diagram](docs/arch.png)`
- **THEN** a placeholder reading "Architecture diagram" is shown and no request for `docs/arch.png` is made

### Requirement: Find in the rendered view
The find bar SHALL search the rendered view's visible text (not the Markdown markup) while it is shown, with the same matching rules, match count, highlighting, and next/previous navigation as in other views. Moving to a match SHALL scroll it into view. Switching between rendered and source SHALL re-run the current query against the newly shown view.

#### Scenario: Markup is not matched
- **WHEN** the rendered view shows `**bold** text` and the user searches for `**`
- **THEN** the find bar reports no results

#### Scenario: Match in rendered text
- **WHEN** the user searches for a word that appears three times in the rendered document
- **THEN** the count shows 3 matches, all are highlighted, and pressing Enter scrolls to each in turn

### Requirement: Rendered view follows file changes
When the shown Markdown file changes on disk, the rendered view SHALL update in place without leaving the rendered mode and SHALL keep its scroll position as far as the new content allows.

#### Scenario: Agent edits the open README
- **WHEN** `README.md` is open rendered, scrolled halfway, and the file is changed on disk
- **THEN** the new content is shown rendered and the view stays scrolled near the same place

### Requirement: Rendered view in light and dark themes
The rendered view SHALL follow the application's light or dark theme, with text, links, code blocks, tables and quotes legible in both, and SHALL scale with the UI zoom.

#### Scenario: Dark mode
- **WHEN** the operating system is in dark mode and a Markdown file is shown rendered
- **THEN** the document renders with a dark background and legible text, links and code

### Requirement: Rendered view is read-only
The rendered view SHALL NOT offer any control that changes the file or git state; task-list checkboxes SHALL NOT be toggleable.

#### Scenario: Clicking a checkbox
- **WHEN** the user clicks a task-list checkbox
- **THEN** its state does not change and the file is not modified
