//! Parser for git's unified diff output (`git diff` without `--binary`).

use super::model::{Hunk, Line, LineKind};

/// One file section of a patch.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedFile {
    /// Path at the base, `None` when the file is new.
    pub old_path: Option<String>,
    /// Path in the working tree, `None` when the file was deleted.
    pub new_path: Option<String>,
    pub is_new: bool,
    pub is_deleted: bool,
    pub is_rename: bool,
    pub is_binary: bool,
    pub hunks: Vec<Hunk>,
    pub old_no_eof_newline: bool,
    pub new_no_eof_newline: bool,
}

impl ParsedFile {
    pub fn additions(&self) -> u32 {
        self.count(LineKind::Added)
    }

    pub fn deletions(&self) -> u32 {
        self.count(LineKind::Removed)
    }

    fn count(&self, kind: LineKind) -> u32 {
        self.hunks
            .iter()
            .flat_map(|h| &h.lines)
            .filter(|l| l.kind == kind)
            .count() as u32
    }
}

/// Parse a whole patch (one or more `diff --git` sections).
pub fn parse_patch(input: &str) -> Vec<ParsedFile> {
    let mut files: Vec<ParsedFile> = Vec::new();
    let mut lines = input.split('\n').peekable();

    while let Some(raw) = lines.next() {
        let Some(rest) = raw.strip_prefix("diff --git ") else {
            continue;
        };
        let mut file = ParsedFile::default();
        if let Some((a, b)) = split_git_header_paths(rest.trim_end_matches('\r')) {
            file.old_path = Some(a);
            file.new_path = Some(b);
        }

        // Extended headers, up to the first hunk or the next file.
        while let Some(&next) = lines.peek() {
            let line = next.trim_end_matches('\r');
            if line.starts_with("diff --git ") || line.starts_with("@@ ") {
                break;
            }
            lines.next();
            if line.starts_with("new file mode") {
                file.is_new = true;
            } else if line.starts_with("deleted file mode") {
                file.is_deleted = true;
            } else if let Some(p) = line.strip_prefix("rename from ") {
                file.is_rename = true;
                file.old_path = Some(unquote(p));
            } else if let Some(p) = line.strip_prefix("rename to ") {
                file.is_rename = true;
                file.new_path = Some(unquote(p));
            } else if let Some(p) = line.strip_prefix("--- ") {
                file.old_path = strip_side_prefix(&unquote(p), "a/");
            } else if let Some(p) = line.strip_prefix("+++ ") {
                file.new_path = strip_side_prefix(&unquote(p), "b/");
            } else if (line.starts_with("Binary files ") && line.ends_with(" differ"))
                || line == "GIT binary patch"
            {
                file.is_binary = true;
            }
        }
        if file.is_new {
            file.old_path = None;
        }
        if file.is_deleted {
            file.new_path = None;
        }

        // Hunks.
        while let Some(&next) = lines.peek() {
            let Some(mut hunk) = parse_hunk_header(next.trim_end_matches('\r')) else {
                break;
            };
            lines.next();
            let mut old_left = hunk.old_lines;
            let mut new_left = hunk.new_lines;
            let mut old_no = hunk.old_start;
            let mut new_no = hunk.new_start;

            while let Some(&body) = lines.peek() {
                if body.starts_with('\\') {
                    // "\ No newline at end of file" refers to the previous line.
                    lines.next();
                    match hunk.lines.last().map(|l| l.kind) {
                        Some(LineKind::Removed) => file.old_no_eof_newline = true,
                        Some(LineKind::Added) => file.new_no_eof_newline = true,
                        Some(LineKind::Context) => {
                            file.old_no_eof_newline = true;
                            file.new_no_eof_newline = true;
                        }
                        None => {}
                    }
                    continue;
                }
                if old_left == 0 && new_left == 0 {
                    break;
                }
                lines.next();
                let (marker, text) = match body.chars().next() {
                    Some(c @ ('+' | '-' | ' ')) => (c, &body[1..]),
                    // Some tools strip the space from empty context lines.
                    None => (' ', ""),
                    Some(_) => break,
                };
                let line = match marker {
                    '+' if new_left > 0 => {
                        new_left -= 1;
                        new_no += 1;
                        line(LineKind::Added, text, None, Some(new_no - 1))
                    }
                    '-' if old_left > 0 => {
                        old_left -= 1;
                        old_no += 1;
                        line(LineKind::Removed, text, Some(old_no - 1), None)
                    }
                    ' ' if old_left > 0 && new_left > 0 => {
                        old_left -= 1;
                        new_left -= 1;
                        old_no += 1;
                        new_no += 1;
                        line(LineKind::Context, text, Some(old_no - 1), Some(new_no - 1))
                    }
                    _ => break, // malformed: counts exhausted for this side
                };
                hunk.lines.push(line);
            }
            file.hunks.push(hunk);
        }
        files.push(file);
    }
    files
}

fn line(kind: LineKind, text: &str, old_no: Option<u32>, new_no: Option<u32>) -> Line {
    Line {
        kind,
        text: text.to_string(),
        old_no,
        new_no,
        intraline: None,
    }
}

/// Parse `@@ -a[,b] +c[,d] @@ section`.
fn parse_hunk_header(line: &str) -> Option<Hunk> {
    let rest = line.strip_prefix("@@ -")?;
    let (ranges, header) = rest.split_once(" @@")?;
    let (old, new) = ranges.split_once(" +")?;
    let (old_start, old_lines) = parse_range(old)?;
    let (new_start, new_lines) = parse_range(new)?;
    Some(Hunk {
        old_start,
        old_lines,
        new_start,
        new_lines,
        header: header.strip_prefix(' ').unwrap_or(header).to_string(),
        lines: Vec::new(),
    })
}

fn parse_range(s: &str) -> Option<(u32, u32)> {
    match s.split_once(',') {
        Some((start, len)) => Some((start.parse().ok()?, len.parse().ok()?)),
        None => Some((s.parse().ok()?, 1)),
    }
}

fn strip_side_prefix(path: &str, prefix: &str) -> Option<String> {
    if path == "/dev/null" {
        None
    } else {
        Some(path.strip_prefix(prefix).unwrap_or(path).to_string())
    }
}

/// Best-effort split of `a/<old> b/<new>` from a `diff --git` line. The `---`/`+++`
/// and `rename` headers override this when present.
fn split_git_header_paths(rest: &str) -> Option<(String, String)> {
    if rest.starts_with('"') {
        let (a, remainder) = take_quoted(rest)?;
        let b = unquote(remainder.trim_start());
        return Some((strip_side_prefix(&a, "a/")?, strip_side_prefix(&b, "b/")?));
    }
    // Unquoted: paths are equal for non-renames, so split in the middle.
    let bytes = rest.len();
    if bytes % 2 == 1 {
        let mid = bytes / 2;
        if rest.is_char_boundary(mid) && &rest[mid..mid + 1] == " " {
            let (a, b) = (&rest[..mid], &rest[mid + 1..]);
            if let (Some(a2), Some(b2)) = (a.strip_prefix("a/"), b.strip_prefix("b/")) {
                if a2 == b2 {
                    return Some((a2.to_string(), b2.to_string()));
                }
            }
        }
    }
    let idx = rest.find(" b/")?;
    Some((
        rest[..idx].strip_prefix("a/")?.to_string(),
        rest[idx + 3..].to_string(),
    ))
}

/// Take a leading C-quoted string, returning it unquoted plus the remainder.
fn take_quoted(s: &str) -> Option<(String, &str)> {
    let bytes = s.as_bytes();
    let mut i = 1;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'"' => return Some((unquote(&s[..=i]), &s[i + 1..])),
            _ => i += 1,
        }
    }
    None
}

/// Undo git's C-style path quoting (`"a\tb\303\251"`); unquoted input is returned as-is.
pub fn unquote(s: &str) -> String {
    let s = s.trim_end_matches('\r');
    let Some(inner) = s.strip_prefix('"').and_then(|x| x.strip_suffix('"')) else {
        // Unquoted `---`/`+++` paths may carry a trailing tab before a timestamp.
        return s.strip_suffix('\t').unwrap_or(s).to_string();
    };
    let mut out: Vec<u8> = Vec::with_capacity(inner.len());
    let b = inner.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'\\' || i + 1 >= b.len() {
            out.push(b[i]);
            i += 1;
            continue;
        }
        let c = b[i + 1];
        i += 2;
        match c {
            b'n' => out.push(b'\n'),
            b't' => out.push(b'\t'),
            b'r' => out.push(b'\r'),
            b'a' => out.push(7),
            b'b' => out.push(8),
            b'f' => out.push(12),
            b'v' => out.push(11),
            b'0'..=b'7' => {
                let mut v = (c - b'0') as u32;
                let mut n = 1;
                while n < 3 && i < b.len() && (b'0'..=b'7').contains(&b[i]) {
                    v = v * 8 + (b[i] - b'0') as u32;
                    i += 1;
                    n += 1;
                }
                out.push(v as u8);
            }
            other => out.push(other),
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(f: &ParsedFile) -> Vec<(LineKind, &str, Option<u32>, Option<u32>)> {
        f.hunks
            .iter()
            .flat_map(|h| &h.lines)
            .map(|l| (l.kind, l.text.as_str(), l.old_no, l.new_no))
            .collect()
    }

    use LineKind::{Added as A, Context as C, Removed as R};

    #[test]
    fn simple_modify() {
        let p = "diff --git a/src/a.rs b/src/a.rs
index 1111111..2222222 100644
--- a/src/a.rs
+++ b/src/a.rs
@@ -1,3 +1,3 @@ fn main() {
 one
-two
+TWO
 three
";
        let files = parse_patch(p);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.old_path.as_deref(), Some("src/a.rs"));
        assert_eq!(f.new_path.as_deref(), Some("src/a.rs"));
        assert_eq!(f.hunks[0].header, "fn main() {");
        assert_eq!(
            kinds(f),
            vec![
                (C, "one", Some(1), Some(1)),
                (R, "two", Some(2), None),
                (A, "TWO", None, Some(2)),
                (C, "three", Some(3), Some(3)),
            ]
        );
        assert_eq!((f.additions(), f.deletions()), (1, 1));
        assert!(!f.old_no_eof_newline && !f.new_no_eof_newline);
    }

    #[test]
    fn multiple_hunks_and_files() {
        let p = "diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -2,2 +2,3 @@
 b
+b2
 c
@@ -20 +21 @@ section
-t
+T
diff --git a/y.txt b/y.txt
--- a/y.txt
+++ b/y.txt
@@ -1 +1 @@
-y
+Y
";
        let files = parse_patch(p);
        assert_eq!(files.len(), 2);
        let x = &files[0];
        assert_eq!(x.hunks.len(), 2);
        assert_eq!((x.hunks[1].old_start, x.hunks[1].old_lines), (20, 1));
        assert_eq!((x.hunks[1].new_start, x.hunks[1].new_lines), (21, 1));
        assert_eq!(x.hunks[1].header, "section");
        assert_eq!(kinds(x)[1], (A, "b2", None, Some(3)));
        assert_eq!(kinds(x)[3], (R, "t", Some(20), None));
        assert_eq!(files[1].new_path.as_deref(), Some("y.txt"));
    }

    #[test]
    fn added_file() {
        let p = "diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
";
        let f = &parse_patch(p)[0];
        assert!(f.is_new);
        assert_eq!(f.old_path, None);
        assert_eq!(f.new_path.as_deref(), Some("new.txt"));
        assert_eq!(
            kinds(f),
            vec![(A, "hello", None, Some(1)), (A, "world", None, Some(2))]
        );
    }

    #[test]
    fn deleted_file() {
        let p = "diff --git a/old.txt b/old.txt
deleted file mode 100644
index 3b18e51..0000000
--- a/old.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-hello
-world
";
        let f = &parse_patch(p)[0];
        assert!(f.is_deleted);
        assert_eq!(f.new_path, None);
        assert_eq!(f.old_path.as_deref(), Some("old.txt"));
        assert_eq!(f.deletions(), 2);
    }

    #[test]
    fn rename_with_edits() {
        let p = "diff --git a/src/old name.rs b/lib/new name.rs
similarity index 90%
rename from src/old name.rs
rename to lib/new name.rs
index 1111111..2222222 100644
--- a/src/old name.rs
+++ b/lib/new name.rs
@@ -1,2 +1,2 @@
 keep
-old
+new
";
        let f = &parse_patch(p)[0];
        assert!(f.is_rename);
        assert_eq!(f.old_path.as_deref(), Some("src/old name.rs"));
        assert_eq!(f.new_path.as_deref(), Some("lib/new name.rs"));
        assert_eq!((f.additions(), f.deletions()), (1, 1));
    }

    #[test]
    fn pure_rename_has_no_hunks() {
        let p = "diff --git a/a.txt b/b.txt
similarity index 100%
rename from a.txt
rename to b.txt
";
        let f = &parse_patch(p)[0];
        assert!(f.is_rename);
        assert!(f.hunks.is_empty());
        assert_eq!(f.new_path.as_deref(), Some("b.txt"));
    }

    #[test]
    fn no_newline_on_old_side() {
        let p = "diff --git a/a b/a
--- a/a
+++ b/a
@@ -1 +1 @@
-x
\\ No newline at end of file
+x
";
        let f = &parse_patch(p)[0];
        assert!(f.old_no_eof_newline);
        assert!(!f.new_no_eof_newline);
        assert_eq!(f.hunks[0].lines.len(), 2);
    }

    #[test]
    fn no_newline_on_new_side() {
        let p = "diff --git a/a b/a
--- a/a
+++ b/a
@@ -1 +1 @@
-x
+y
\\ No newline at end of file
";
        let f = &parse_patch(p)[0];
        assert!(!f.old_no_eof_newline);
        assert!(f.new_no_eof_newline);
    }

    #[test]
    fn no_newline_on_both_sides_context() {
        let p = "diff --git a/a b/a
--- a/a
+++ b/a
@@ -1,2 +1,2 @@
-x
+y
 last
\\ No newline at end of file
";
        let f = &parse_patch(p)[0];
        assert!(f.old_no_eof_newline && f.new_no_eof_newline);
        assert_eq!(f.hunks[0].lines[2].text, "last");
    }

    #[test]
    fn binary_file() {
        let p = "diff --git a/img.png b/img.png
index 1111111..2222222 100644
Binary files a/img.png and b/img.png differ
";
        let f = &parse_patch(p)[0];
        assert!(f.is_binary);
        assert!(f.hunks.is_empty());
        assert_eq!(f.new_path.as_deref(), Some("img.png"));
    }

    #[test]
    fn crlf_content_is_preserved() {
        let p = "diff --git a/w.txt b/w.txt\n--- a/w.txt\n+++ b/w.txt\n@@ -1,2 +1,2 @@\n keep\r\n-old\r\n+new\r\n";
        let f = &parse_patch(p)[0];
        assert_eq!(f.new_path.as_deref(), Some("w.txt"));
        assert_eq!(f.hunks[0].lines[0].text, "keep\r");
        assert_eq!(f.hunks[0].lines[2].text, "new\r");
    }

    #[test]
    fn unicode_and_quoted_paths() {
        // quotepath=false leaves UTF-8 alone, but tabs/quotes are still C-quoted.
        let p = "diff --git a/caf\u{e9}.txt b/caf\u{e9}.txt
--- a/caf\u{e9}.txt
+++ b/caf\u{e9}.txt
@@ -1 +1 @@
-a
+b
diff --git \"a/tab\\there.txt\" \"b/tab\\there.txt\"
--- \"a/tab\\there.txt\"
+++ \"b/tab\\there.txt\"
@@ -1 +1 @@
-a
+b
";
        let files = parse_patch(p);
        assert_eq!(files[0].new_path.as_deref(), Some("caf\u{e9}.txt"));
        assert_eq!(files[1].old_path.as_deref(), Some("tab\there.txt"));
        assert_eq!(files[1].new_path.as_deref(), Some("tab\there.txt"));
        assert_eq!(unquote("\"caf\\303\\251\""), "caf\u{e9}");
    }

    #[test]
    fn whitespace_only_lines_preserved() {
        let p = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,3 +1,3 @@\n \n-  \t\n+    \n \n";
        let f = &parse_patch(p)[0];
        assert_eq!(
            kinds(f),
            vec![
                (C, "", Some(1), Some(1)),
                (R, "  \t", Some(2), None),
                (A, "    ", None, Some(2)),
                (C, "", Some(3), Some(3)),
            ]
        );
    }

    #[test]
    fn empty_input() {
        assert!(parse_patch("").is_empty());
    }

    #[test]
    fn lines_that_look_like_headers_inside_hunks() {
        // A removed line whose content is "-- a" must not be mistaken for a header.
        let p = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,2 +1,1 @@\n--- a\n-+++ b\n+x\n";
        let f = &parse_patch(p)[0];
        assert_eq!(
            kinds(f),
            vec![(R, "-- a", Some(1), None), (R, "+++ b", Some(2), None), (A, "x", None, Some(1))]
        );
    }
}
