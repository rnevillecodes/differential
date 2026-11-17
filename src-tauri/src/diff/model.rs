//! The diff model: the stable seam between producing a diff and presenting it.
//!
//! These types are the source of truth; TypeScript bindings are generated into
//! `src/model/` by ts-rs when `cargo test` runs.

use serde::Serialize;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
}

/// One changed file, without its hunks.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileSummary {
    /// Index of this file within its `ChangeSet`.
    pub id: u32,
    pub status: FileStatus,
    /// Path at the base (`None` for added/untracked files).
    pub old_path: Option<String>,
    /// Path in the working tree (`None` for deleted files).
    pub new_path: Option<String>,
    pub additions: u32,
    pub deletions: u32,
    pub is_binary: bool,
    pub is_large: bool,
}

impl FileSummary {
    /// The path to show for this file (new path, or old path if deleted).
    pub fn display_path(&self) -> &str {
        self.new_path
            .as_deref()
            .or(self.old_path.as_deref())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Totals {
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

/// All changes from a base commit to the working tree.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ChangeSet {
    pub repo_root: String,
    /// The revision as the user typed it (e.g. `HEAD~3`).
    pub base_ref: String,
    /// The commit it resolved to; all per-file requests use this.
    pub base_sha: String,
    pub files: Vec<FileSummary>,
    pub totals: Totals,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum LineKind {
    Context,
    Added,
    Removed,
}

/// A half-open range `[start, end)` of UTF-16 code units within a line's text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct Range {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Line {
    pub kind: LineKind,
    /// The line's exact text, without the diff marker or line terminator.
    pub text: String,
    /// Line number at the base (context and removed lines).
    pub old_no: Option<u32>,
    /// Line number in the working tree (context and added lines).
    pub new_no: Option<u32>,
    /// Sub-ranges that differ from the paired line, if computed.
    pub intraline: Option<Vec<Range>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Hunk {
    pub old_start: u32,
    pub old_lines: u32,
    pub new_start: u32,
    pub new_lines: u32,
    /// Section text after the `@@ ... @@` header (often the enclosing function).
    pub header: String,
    pub lines: Vec<Line>,
}

/// One file's hunks.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FileDiff {
    pub file_id: u32,
    pub is_binary: bool,
    pub hunks: Vec<Hunk>,
    /// The base version's last line has no trailing newline.
    pub old_no_eof_newline: bool,
    /// The working-tree version's last line has no trailing newline.
    pub new_no_eof_newline: bool,
}

/// Which version of a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Side {
    Base,
    Worktree,
}
