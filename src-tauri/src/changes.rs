//! Producing a repository's changes from a base commit to the working tree.
//!
//! Everything here is read-only: it runs `git diff`, `git ls-files`, `git cat-file`
//! and reads files from disk, and never touches the index, refs or working tree.

use std::collections::HashMap;
use std::path::Path;

use crate::diff::intraline::annotate_hunk;
use crate::diff::model::{
    ChangeSet, FileDiff, FileStatus, FileSummary, Hunk, Line, LineKind, Side, Totals,
};
use crate::diff::parser::parse_patch;
use crate::content::{is_binary_bytes, safe_join, sniff_binary, to_text};
use crate::error::{AppError, Result};
use crate::git::{resolve_base, Git};

pub use crate::content::limits;

const DIFF_FLAGS: [&str; 3] = ["--no-color", "--no-ext-diff", "-M"];

/// One record from `git diff --raw -z`.
#[derive(Debug)]
struct RawEntry {
    status: char,
    src_blob: String,
    old_path: String,
    new_path: String,
}

/// List every changed file from `base` to the working tree, including untracked files.
pub fn list_changes(git: &Git, root: &Path, base: &str) -> Result<ChangeSet> {
    let base_sha = resolve_base(git, root, base)?;
    let mut args: Vec<&str> = vec!["diff", "-z", "--raw", "--numstat", "--no-abbrev"];
    args.extend(DIFF_FLAGS);
    args.extend([base_sha.as_str(), "--"]);
    let out = git.run(root, &args)?;
    let (raw, numstat) = parse_raw_numstat(&out)?;

    let base_sizes = blob_sizes(git, root, raw.iter().map(|r| r.src_blob.as_str()))?;

    let mut files = Vec::with_capacity(raw.len());
    for (entry, stat) in raw.iter().zip(numstat.iter()) {
        let status = match entry.status {
            'A' | 'C' => FileStatus::Added,
            'D' => FileStatus::Deleted,
            'R' => FileStatus::Renamed,
            _ => FileStatus::Modified, // M, T (type change), U (unmerged)
        };
        let old_path = (status != FileStatus::Added).then(|| entry.old_path.clone());
        let new_path = (status != FileStatus::Deleted).then(|| entry.new_path.clone());
        let (additions, deletions, is_binary) = match stat {
            Some((a, d)) => (*a, *d, false),
            None => (0, 0, true),
        };
        let worktree_size = new_path
            .as_ref()
            .and_then(|p| std::fs::metadata(root.join(p)).ok())
            .map(|m| m.len())
            .unwrap_or(0);
        let base_size = base_sizes.get(&entry.src_blob).copied().unwrap_or(0);
        files.push(FileSummary {
            id: 0,
            status,
            old_path,
            new_path,
            additions,
            deletions,
            is_binary,
            is_large: !is_binary
                && is_large(additions + deletions, base_size.max(worktree_size)),
        });
    }

    files.extend(untracked_files(git, root)?);
    for (i, f) in files.iter_mut().enumerate() {
        f.id = i as u32;
    }
    let totals = Totals {
        files: files.len() as u32,
        additions: files.iter().map(|f| f.additions).sum(),
        deletions: files.iter().map(|f| f.deletions).sum(),
    };
    Ok(ChangeSet {
        repo_root: root.to_string_lossy().replace('\\', "/"),
        base_ref: if base.trim().is_empty() { "HEAD".into() } else { base.trim().into() },
        base_sha,
        files,
        totals,
    })
}

fn is_large(changed_lines: u32, max_size: u64) -> bool {
    changed_lines > limits::MAX_CHANGED_LINES || max_size > limits::MAX_FILE_BYTES
}

/// Split `git diff -z --raw --numstat` output into raw records and numstat counts
/// (`None` for binary files), in the same order.
fn parse_raw_numstat(out: &[u8]) -> Result<(Vec<RawEntry>, Vec<Option<(u32, u32)>>)> {
    let bad = || AppError::Git("unexpected `git diff --raw` output".into());
    let text = String::from_utf8_lossy(out);
    let mut fields = text.split('\0').filter(|s| !s.is_empty()).peekable();
    let mut raw = Vec::new();
    while let Some(f) = fields.next_if(|f| f.starts_with(':')) {
        // ":100644 100644 <src> <dst> M"
        let parts: Vec<&str> = f[1..].split(' ').collect();
        let [_, _, src, _, status] = parts[..] else {
            return Err(bad());
        };
        let status = status.chars().next().ok_or_else(bad)?;
        let old_path = fields.next().ok_or_else(bad)?.to_string();
        let new_path = if matches!(status, 'R' | 'C') {
            fields.next().ok_or_else(bad)?.to_string()
        } else {
            old_path.clone()
        };
        raw.push(RawEntry {
            status,
            src_blob: src.to_string(),
            old_path,
            new_path,
        });
    }
    let mut numstat = Vec::with_capacity(raw.len());
    while let Some(f) = fields.next() {
        // "a\td\tpath" or, for renames, "a\td\t" followed by two path fields.
        let mut parts = f.splitn(3, '\t');
        let (a, d, path) = (
            parts.next().ok_or_else(bad)?,
            parts.next().ok_or_else(bad)?,
            parts.next().unwrap_or(""),
        );
        if path.is_empty() {
            fields.next();
            fields.next();
        }
        numstat.push(match (a.parse(), d.parse()) {
            (Ok(a), Ok(d)) => Some((a, d)),
            _ => None, // "-\t-" marks binary
        });
    }
    if numstat.len() != raw.len() {
        return Err(bad());
    }
    Ok((raw, numstat))
}

/// Sizes of the given blobs (null IDs skipped), via one `git cat-file --batch-check`.
fn blob_sizes<'a>(
    git: &Git,
    root: &Path,
    ids: impl Iterator<Item = &'a str>,
) -> Result<HashMap<String, u64>> {
    let ids: Vec<&str> = ids.filter(|id| id.bytes().any(|b| b != b'0')).collect();
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let input = ids.join("\n") + "\n";
    let out = git.run_with_stdin(
        root,
        &["cat-file", "--batch-check=%(objectname) %(objectsize)"],
        input.as_bytes(),
    )?;
    Ok(String::from_utf8_lossy(&out)
        .lines()
        .filter_map(|l| {
            let (id, size) = l.split_once(' ')?;
            Some((id.to_string(), size.parse().ok()?))
        })
        .collect())
}

/// Untracked, non-ignored files as `FileSummary` records (ids assigned by the caller).
fn untracked_files(git: &Git, root: &Path) -> Result<Vec<FileSummary>> {
    let out = git.run(root, &["ls-files", "-z", "--others", "--exclude-standard"])?;
    let text = String::from_utf8_lossy(&out);
    let mut files = Vec::new();
    for path in text.split('\0').filter(|p| !p.is_empty()) {
        let full = root.join(path);
        let Ok(meta) = std::fs::metadata(&full) else {
            continue; // vanished since listing
        };
        if !meta.is_file() {
            continue;
        }
        let (is_binary, lines) = if meta.len() > limits::MAX_FILE_BYTES {
            (sniff_binary(&full)?, 0)
        } else {
            let bytes = std::fs::read(&full)?;
            let binary = is_binary_bytes(&bytes);
            (binary, if binary { 0 } else { count_lines(&bytes) })
        };
        files.push(FileSummary {
            id: 0,
            status: FileStatus::Untracked,
            old_path: None,
            new_path: Some(path.to_string()),
            additions: lines,
            deletions: 0,
            is_binary,
            is_large: !is_binary && is_large(lines, meta.len()),
        });
    }
    Ok(files)
}



fn count_lines(bytes: &[u8]) -> u32 {
    let newlines = bytes.iter().filter(|&&b| b == b'\n').count() as u32;
    newlines + u32::from(!bytes.is_empty() && !bytes.ends_with(b"\n"))
}

/// Produce one file's hunks. Large files are refused unless `force` is set.
pub fn file_diff(
    git: &Git,
    root: &Path,
    base_sha: &str,
    file: &FileSummary,
    force: bool,
) -> Result<FileDiff> {
    let empty = |is_binary| FileDiff {
        file_id: file.id,
        is_binary,
        hunks: Vec::new(),
        old_no_eof_newline: false,
        new_no_eof_newline: false,
    };
    if file.is_binary {
        return Ok(empty(true));
    }
    if file.is_large && !force {
        return Err(AppError::Invalid(format!(
            "{} is too large to show by default",
            file.display_path()
        )));
    }

    if file.status == FileStatus::Untracked {
        let path = safe_join(root, file.display_path())?;
        let bytes = std::fs::read(path)?;
        if is_binary_bytes(&bytes) {
            return Ok(empty(true));
        }
        return Ok(synthesize_added(file.id, &String::from_utf8_lossy(&bytes)));
    }

    let mut args: Vec<&str> = vec!["diff"];
    args.extend(DIFF_FLAGS);
    args.extend([base_sha, "--"]);
    for p in [file.old_path.as_deref(), file.new_path.as_deref()]
        .into_iter()
        .flatten()
    {
        if !args.contains(&p) {
            args.push(p);
        }
    }
    let out = git.run(root, &args)?;
    let parsed = parse_patch(&String::from_utf8_lossy(&out));
    let Some(mut pf) = parsed.into_iter().next() else {
        return Ok(empty(false));
    };
    for h in &mut pf.hunks {
        annotate_hunk(h);
    }
    Ok(FileDiff {
        file_id: file.id,
        is_binary: pf.is_binary,
        hunks: pf.hunks,
        old_no_eof_newline: pf.old_no_eof_newline,
        new_no_eof_newline: pf.new_no_eof_newline,
    })
}

/// A diff showing every line of `content` as added.
fn synthesize_added(file_id: u32, content: &str) -> FileDiff {
    let no_eof = !content.is_empty() && !content.ends_with('\n');
    let body = content.strip_suffix('\n').unwrap_or(content);
    let lines: Vec<Line> = if content.is_empty() {
        Vec::new()
    } else {
        body.split('\n')
            .enumerate()
            .map(|(i, text)| Line {
                kind: LineKind::Added,
                text: text.to_string(),
                old_no: None,
                new_no: Some(i as u32 + 1),
                intraline: None,
            })
            .collect()
    };
    let n = lines.len() as u32;
    FileDiff {
        file_id,
        is_binary: false,
        hunks: if n == 0 {
            Vec::new()
        } else {
            vec![Hunk {
                old_start: 0,
                old_lines: 0,
                new_start: 1,
                new_lines: n,
                header: String::new(),
                lines,
            }]
        },
        old_no_eof_newline: false,
        new_no_eof_newline: no_eof,
    }
}

/// Full content of one version of a file, with `\r\n` normalized to `\n`.
/// Returns `None` when that version does not exist (e.g. the base of an added file).
pub fn file_content(
    git: &Git,
    root: &Path,
    base_sha: &str,
    path: &str,
    side: Side,
) -> Result<Option<String>> {
    let bytes = match side {
        Side::Base => {
            let spec = format!("{base_sha}:{path}");
            let out = git.run_raw(root, &["cat-file", "blob", &spec])?;
            if !out.success {
                return Ok(None);
            }
            out.stdout
        }
        Side::Worktree => match std::fs::read(safe_join(root, path)?) {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.into()),
        },
    };
    Ok(Some(to_text(&bytes)))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_raw_and_numstat_including_renames_and_binaries() {
        let z = ":000000 100644 0000 8ba3 A\0added.txt\0:100644 100644 bdc9 0000 M\0bin.dat\0:100644 100644 0fdf e031 R083\0ren.txt\0moved.txt\0\
                 1\t0\tadded.txt\0-\t-\tbin.dat\0\x31\t1\t\0ren.txt\0moved.txt\0";
        let (raw, num) = parse_raw_numstat(z.as_bytes()).unwrap();
        assert_eq!(raw.len(), 3);
        assert_eq!(raw[2].status, 'R');
        assert_eq!((raw[2].old_path.as_str(), raw[2].new_path.as_str()), ("ren.txt", "moved.txt"));
        assert_eq!(raw[1].src_blob, "bdc9");
        assert_eq!(num, vec![Some((1, 0)), None, Some((1, 1))]);
    }

    #[test]
    fn empty_output_is_no_changes() {
        let (raw, num) = parse_raw_numstat(b"").unwrap();
        assert!(raw.is_empty() && num.is_empty());
    }

    #[test]
    fn counts_lines() {
        assert_eq!(count_lines(b""), 0);
        assert_eq!(count_lines(b"a"), 1);
        assert_eq!(count_lines(b"a\n"), 1);
        assert_eq!(count_lines(b"a\nb"), 2);
    }

    #[test]
    fn synthesizes_added_file() {
        let d = synthesize_added(3, "one\ntwo");
        assert_eq!(d.hunks[0].new_lines, 2);
        assert_eq!(d.hunks[0].lines[1].new_no, Some(2));
        assert!(d.new_no_eof_newline);
        assert!(synthesize_added(0, "").hunks.is_empty());
    }
}
