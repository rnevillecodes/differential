//! Listing a repository's commit history, in pages, for the commit graph.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use super::refs::{classify_ref, RefKind};
use super::runner::Git;
use crate::error::Result;

/// A branch or tag pointing at a commit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RefLabel {
    /// Name without its kind prefix, for display: `main`, `origin/main`, `v1.0`.
    pub name: String,
    /// Unambiguous revision to use as a base (git's short refname).
    pub rev: String,
    pub kind: RefKind,
}

/// One commit in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitInfo {
    pub sha: String,
    /// Abbreviated SHA, unambiguous in the repository when listed.
    pub short_sha: String,
    /// Parent SHAs, first parent first. Empty for a root commit.
    pub parents: Vec<String>,
    pub author: String,
    /// Author date, ISO 8601.
    pub date: String,
    pub subject: String,
    /// Local branches, then remote branches, then tags pointing at this commit.
    pub labels: Vec<RefLabel>,
    /// Whether `HEAD` points at this commit.
    pub head: bool,
}

/// One page of the history in topological order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommitPage {
    pub commits: Vec<CommitInfo>,
    /// Whether more commits follow this page.
    pub has_more: bool,
}

const LOG_FORMAT: &str = "--format=%H%x00%h%x00%P%x00%an%x00%aI%x00%s";
const REF_FORMAT: &str = "--format=%(refname)%00%(refname:short)%00%(symref)%00%(objectname)%00%(*objectname)";

/// Commits reachable from all branches, remote branches, tags and `HEAD`, in topological order,
/// starting `offset` commits in and at most `limit` long. Read-only.
pub fn list_commits(git: &Git, root: &Path, offset: usize, limit: usize) -> Result<CommitPage> {
    let limit = limit.max(1);
    let head = head_commit(git, root)?;
    let refs = String::from_utf8_lossy(&git.run(
        root,
        &["for-each-ref", REF_FORMAT, "refs/heads", "refs/remotes", "refs/tags"],
    )?)
    .into_owned();
    if head.is_none() && refs.trim().is_empty() {
        // Nothing committed yet: `git log` would fail on the unborn branch.
        return Ok(CommitPage { commits: Vec::new(), has_more: false });
    }

    let skip = format!("--skip={offset}");
    let max = format!("--max-count={}", limit + 1);
    let mut args = vec![
        "log",
        "--no-show-signature",
        "--encoding=UTF-8",
        "--topo-order",
        skip.as_str(),
        max.as_str(),
        LOG_FORMAT,
        "--branches",
        "--remotes",
        "--tags",
    ];
    if head.is_some() {
        args.push("HEAD");
    }
    args.push("--");
    let out = git.run(root, &args)?;

    let mut commits = parse_log(&String::from_utf8_lossy(&out));
    let has_more = commits.len() > limit;
    commits.truncate(limit);
    let mut labels = parse_labels(&refs);
    for c in &mut commits {
        c.labels = labels.remove(&c.sha).unwrap_or_default();
        c.head = head.as_deref() == Some(c.sha.as_str());
    }
    Ok(CommitPage { commits, has_more })
}

fn head_commit(git: &Git, root: &Path) -> Result<Option<String>> {
    let out = git.run_raw(root, &["rev-parse", "--verify", "--quiet", "HEAD^{commit}"])?;
    let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok((out.success && !sha.is_empty()).then_some(sha))
}

/// Parse `git log` output in [`LOG_FORMAT`], one commit per line. Labels and `head` are left empty.
fn parse_log(text: &str) -> Vec<CommitInfo> {
    text.lines()
        .filter_map(|line| {
            let mut f = line.splitn(6, '\0');
            let (sha, short, parents, author, date, subject) =
                (f.next()?, f.next()?, f.next()?, f.next()?, f.next()?, f.next()?);
            if sha.is_empty() {
                return None;
            }
            Some(CommitInfo {
                sha: sha.to_string(),
                short_sha: short.to_string(),
                parents: parents.split_whitespace().map(str::to_string).collect(),
                author: author.to_string(),
                date: date.to_string(),
                subject: subject.to_string(),
                labels: Vec::new(),
                head: false,
            })
        })
        .collect()
}

fn kind_rank(kind: RefKind) -> u8 {
    match kind {
        RefKind::Local => 0,
        RefKind::Remote => 1,
        RefKind::Tag => 2,
    }
}

/// Parse `for-each-ref` output in [`REF_FORMAT`] into labels keyed by the commit they point at
/// (annotated tags peeled to their target). Symbolic refs are dropped.
fn parse_labels(text: &str) -> HashMap<String, Vec<RefLabel>> {
    let mut map: HashMap<String, Vec<RefLabel>> = HashMap::new();
    for line in text.lines() {
        let mut f = line.split('\0');
        let (Some(full), Some(short), Some(symref), Some(object), Some(peeled)) =
            (f.next(), f.next(), f.next(), f.next(), f.next())
        else {
            continue;
        };
        let Some((kind, name)) = classify_ref(full, symref) else {
            continue;
        };
        let target = if peeled.is_empty() { object } else { peeled };
        map.entry(target.to_string()).or_default().push(RefLabel {
            name: name.to_string(),
            rev: short.to_string(),
            kind,
        });
    }
    for labels in map.values_mut() {
        labels.sort_by(|a, b| kind_rank(a.kind).cmp(&kind_rank(b.kind)).then_with(|| a.name.cmp(&b.name)));
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    fn log_line(sha: &str, short: &str, parents: &str, subject: &str) -> String {
        format!("{sha}\0{short}\0{parents}\0Ada\x002026-01-02T03:04:05+00:00\0{subject}\n")
    }

    fn ref_line(full: &str, short: &str, symref: &str, object: &str, peeled: &str) -> String {
        format!("{full}\0{short}\0{symref}\0{object}\0{peeled}\n")
    }

    #[test]
    fn parses_root_linear_and_merge_commits() {
        let text = [
            log_line("m", "m1", "b c", "Merge branch 'feature'"),
            log_line("b", "b1", "a", "second"),
            log_line("a", "a1", "", "root"),
        ]
        .concat();
        let commits = parse_log(&text);
        let summary: Vec<_> = commits
            .iter()
            .map(|c| (c.sha.as_str(), c.short_sha.as_str(), c.parents.clone(), c.subject.as_str()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("m", "m1", vec!["b".to_string(), "c".to_string()], "Merge branch 'feature'"),
                ("b", "b1", vec!["a".to_string()], "second"),
                ("a", "a1", vec![], "root"),
            ]
        );
        assert_eq!(commits[0].author, "Ada");
        assert_eq!(commits[0].date, "2026-01-02T03:04:05+00:00");
    }

    #[test]
    fn subject_keeps_separator_like_text() {
        let commits = parse_log(&log_line("a", "a1", "", "fix: a -> b, tag: v1 (HEAD -> main)"));
        assert_eq!(commits[0].subject, "fix: a -> b, tag: v1 (HEAD -> main)");
    }

    #[test]
    fn empty_log_is_empty() {
        assert!(parse_log("").is_empty());
    }

    #[test]
    fn labels_peel_annotated_tags_and_drop_symrefs() {
        let text = [
            ref_line("refs/heads/main", "main", "", "c1", ""),
            ref_line("refs/remotes/origin/HEAD", "origin", "refs/remotes/origin/main", "c1", ""),
            ref_line("refs/remotes/origin/main", "origin/main", "", "c1", ""),
            ref_line("refs/tags/v1.0", "v1.0", "", "tagobj", "c1"),
            ref_line("refs/tags/light", "light", "", "c2", ""),
        ]
        .concat();
        let map = parse_labels(&text);
        let names = |sha: &str| -> Vec<(String, RefKind)> {
            map.get(sha).map(|v| v.iter().map(|l| (l.name.clone(), l.kind)).collect()).unwrap_or_default()
        };
        assert_eq!(
            names("c1"),
            vec![
                ("main".to_string(), RefKind::Local),
                ("origin/main".to_string(), RefKind::Remote),
                ("v1.0".to_string(), RefKind::Tag),
            ]
        );
        assert_eq!(names("c2"), vec![("light".to_string(), RefKind::Tag)]);
        assert!(!map.contains_key("tagobj"));
    }

    #[test]
    fn labels_carry_unambiguous_revs() {
        let text = [
            ref_line("refs/heads/main", "heads/main", "", "c1", ""),
            ref_line("refs/tags/main", "tags/main", "", "c1", ""),
        ]
        .concat();
        let revs: Vec<_> = parse_labels(&text)["c1"].iter().map(|l| l.rev.clone()).collect();
        assert_eq!(revs, vec!["heads/main", "tags/main"]);
    }

    #[test]
    fn several_local_branches_sorted_by_name() {
        let text = [
            ref_line("refs/heads/zeta", "zeta", "", "c1", ""),
            ref_line("refs/heads/alpha", "alpha", "", "c1", ""),
        ]
        .concat();
        let names: Vec<_> = parse_labels(&text)["c1"].iter().map(|l| l.name.clone()).collect();
        assert_eq!(names, vec!["alpha", "zeta"]);
    }
}
