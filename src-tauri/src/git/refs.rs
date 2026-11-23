//! Listing a repository's branches and tags.

use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::runner::Git;
use crate::error::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RefKind {
    Local,
    Remote,
    Tag,
}

/// One branch or tag.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RefInfo {
    /// Name without its kind prefix, for display: `main`, `origin/main`, `v1.0`.
    pub name: String,
    /// Unambiguous revision to use as a base (git's short refname, e.g. `heads/main`
    /// when a tag `main` also exists).
    pub rev: String,
    pub kind: RefKind,
    /// Whether this is the checked-out branch.
    pub current: bool,
}

const FORMAT: &str = "--format=%(refname)%00%(refname:short)%00%(symref)%00%(HEAD)";

/// Local branches, remote-tracking branches and tags, most recently created first.
/// Symbolic refs such as `origin/HEAD` are left out.
pub fn list_refs(git: &Git, root: &Path) -> Result<Vec<RefInfo>> {
    let out = git.run(
        root,
        &[
            "for-each-ref",
            "--sort=-creatordate",
            FORMAT,
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ],
    )?;
    Ok(parse_refs(&String::from_utf8_lossy(&out)))
}

/// The kind and display name of a full refname, or `None` when it is not a branch or tag, or is a
/// symbolic ref (non-empty `symref`, e.g. `origin/HEAD`) that only aliases another listed ref.
pub(crate) fn classify_ref<'a>(full: &'a str, symref: &str) -> Option<(RefKind, &'a str)> {
    if !symref.is_empty() {
        return None;
    }
    if let Some(n) = full.strip_prefix("refs/heads/") {
        Some((RefKind::Local, n))
    } else if let Some(n) = full.strip_prefix("refs/remotes/") {
        Some((RefKind::Remote, n))
    } else if let Some(n) = full.strip_prefix("refs/tags/") {
        Some((RefKind::Tag, n))
    } else {
        None
    }
}

fn parse_refs(text: &str) -> Vec<RefInfo> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.split('\0');
            let (full, short, symref, head) = (f.next()?, f.next()?, f.next()?, f.next()?);
            let (kind, name) = classify_ref(full, symref)?;
            Some(RefInfo {
                name: name.to_string(),
                rev: short.to_string(),
                kind,
                current: kind == RefKind::Local && head == "*",
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(full: &str, short: &str, symref: &str, head: &str) -> String {
        format!("{full}\0{short}\0{symref}\0{head}\n")
    }

    #[test]
    fn parses_kinds_names_and_current() {
        let text = [
            line("refs/heads/feat/login", "feat/login", "", "*"),
            line("refs/heads/main", "heads/main", "", " "),
            line("refs/remotes/origin/main", "origin/main", "", " "),
            line("refs/tags/v1.0", "v1.0", "", " "),
            line("refs/tags/main", "tags/main", "", " "),
        ]
        .concat();
        let refs = parse_refs(&text);
        let summary: Vec<_> = refs
            .iter()
            .map(|r| (r.name.as_str(), r.rev.as_str(), r.kind, r.current))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("feat/login", "feat/login", RefKind::Local, true),
                ("main", "heads/main", RefKind::Local, false),
                ("origin/main", "origin/main", RefKind::Remote, false),
                ("v1.0", "v1.0", RefKind::Tag, false),
                ("main", "tags/main", RefKind::Tag, false),
            ]
        );
    }

    #[test]
    fn drops_symbolic_refs() {
        let text = [
            line(
                "refs/remotes/origin/HEAD",
                "origin",
                "refs/remotes/origin/main",
                " ",
            ),
            line("refs/remotes/origin/main", "origin/main", "", " "),
        ]
        .concat();
        let names: Vec<_> = parse_refs(&text).into_iter().map(|r| r.name).collect();
        assert_eq!(names, vec!["origin/main"]);
    }

    #[test]
    fn empty_output_is_empty_list() {
        assert!(parse_refs("").is_empty());
    }
}
