//! Word-level highlights of what changed between a removed line and its paired added line.

use similar::{capture_diff_slices, Algorithm, DiffTag};

use super::model::{Hunk, LineKind, Range};

/// Lines longer than this (in bytes) get no intraline highlights.
pub const MAX_LINE_LEN: usize = 1000;
/// Pairs less similar than this get no intraline highlights (it would be noise).
pub const MIN_SIMILARITY: f32 = 0.4;

/// Split into runs of word characters, runs of whitespace, and single other characters.
fn tokenize(s: &str) -> Vec<&str> {
    #[derive(PartialEq, Clone, Copy)]
    enum Class {
        Word,
        Space,
        Other,
    }
    let class = |c: char| {
        if c.is_alphanumeric() || c == '_' {
            Class::Word
        } else if c.is_whitespace() {
            Class::Space
        } else {
            Class::Other
        }
    };
    let mut tokens = Vec::new();
    let mut start = 0;
    let mut prev: Option<Class> = None;
    for (i, c) in s.char_indices() {
        let cl = class(c);
        if let Some(p) = prev {
            if p != cl || cl == Class::Other {
                tokens.push(&s[start..i]);
                start = i;
            }
        }
        prev = Some(cl);
    }
    if start < s.len() {
        tokens.push(&s[start..]);
    }
    tokens
}

/// UTF-16 offset of byte offset `byte` in `s`.
fn utf16_offset(s: &str, byte: usize) -> u32 {
    s[..byte].encode_utf16().count() as u32
}

/// Changed ranges on each side, or `None` when highlighting would not help.
pub fn line_ranges(old: &str, new: &str) -> Option<(Vec<Range>, Vec<Range>)> {
    if old.len() > MAX_LINE_LEN || new.len() > MAX_LINE_LEN || old == new {
        return None;
    }
    let a = tokenize(old);
    let b = tokenize(new);
    let ops = capture_diff_slices(Algorithm::Myers, &a, &b);

    let starts = |toks: &[&str]| {
        let mut v = Vec::with_capacity(toks.len() + 1);
        let mut pos = 0;
        for t in toks {
            v.push(pos);
            pos += t.len();
        }
        v.push(pos);
        v
    };
    let (sa, sb) = (starts(&a), starts(&b));

    let mut equal = 0usize;
    let mut ra: Vec<Range> = Vec::new();
    let mut rb: Vec<Range> = Vec::new();
    for op in &ops {
        let (tag, or, nr) = op.as_tag_tuple();
        match tag {
            DiffTag::Equal => equal += sa[or.end] - sa[or.start],
            _ => {
                push_range(&mut ra, old, sa[or.start], sa[or.end]);
                push_range(&mut rb, new, sb[nr.start], sb[nr.end]);
            }
        }
    }
    let total = old.len() + new.len();
    if total == 0 || (2 * equal) as f32 / (total as f32) < MIN_SIMILARITY {
        return None;
    }
    Some((ra, rb))
}

fn push_range(ranges: &mut Vec<Range>, s: &str, start: usize, end: usize) {
    if start == end {
        return;
    }
    let (start, end) = (utf16_offset(s, start), utf16_offset(s, end));
    match ranges.last_mut() {
        Some(last) if last.end == start => last.end = end,
        _ => ranges.push(Range { start, end }),
    }
}

/// Pair removed/added lines by position within each change block and attach their ranges.
pub fn annotate_hunk(hunk: &mut Hunk) {
    let lines = &mut hunk.lines;
    let mut i = 0;
    while i < lines.len() {
        if lines[i].kind != LineKind::Removed {
            i += 1;
            continue;
        }
        let rem_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Removed {
            i += 1;
        }
        let add_start = i;
        while i < lines.len() && lines[i].kind == LineKind::Added {
            i += 1;
        }
        let pairs = (add_start - rem_start).min(i - add_start);
        for k in 0..pairs {
            let (r, a) = (rem_start + k, add_start + k);
            if let Some((rr, ar)) = line_ranges(&lines[r].text, &lines[a].text) {
                lines[r].intraline = Some(rr);
                lines[a].intraline = Some(ar);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::parser::parse_patch;

    fn r(start: u32, end: u32) -> Range {
        Range { start, end }
    }

    #[test]
    fn single_number_changed() {
        let (a, b) = line_ranges("const timeout = 30;", "const timeout = 60;").unwrap();
        assert_eq!(a, vec![r(16, 18)]);
        assert_eq!(b, vec![r(16, 18)]);
    }

    #[test]
    fn tokenizer_splits_words_space_and_punctuation() {
        assert_eq!(tokenize("foo(bar,  baz);"), vec!["foo", "(", "bar", ",", "  ", "baz", ")", ";"]);
    }

    #[test]
    fn adjacent_changes_merge() {
        let (a, b) = line_ranges("call(a, b)", "call(x, y)").unwrap();
        assert_eq!(a, vec![r(5, 6), r(8, 9)]);
        assert_eq!(b, vec![r(5, 6), r(8, 9)]);
        let (a, _) = line_ranges("let a = 1;", "let a = 1 + 2;").unwrap();
        assert!(a.is_empty(), "pure insertion highlights nothing on the old side");
    }

    #[test]
    fn dissimilar_lines_get_nothing() {
        assert_eq!(line_ranges("completely different", "nothing alike here!"), None);
    }

    #[test]
    fn identical_and_too_long_lines_get_nothing() {
        assert_eq!(line_ranges("same", "same"), None);
        let long = "x".repeat(MAX_LINE_LEN + 1);
        assert_eq!(line_ranges(&long, &format!("{long}y")), None);
    }

    #[test]
    fn offsets_are_utf16() {
        // "é" is 2 bytes in UTF-8 but 1 UTF-16 unit; "😀" is 4 bytes / 2 units.
        let (_, b) = line_ranges("é 😀 a", "é 😀 b").unwrap();
        assert_eq!(b, vec![r(5, 6)]);
    }

    #[test]
    fn annotates_pairs_in_change_blocks() {
        let p = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1,3 +1,4 @@\n-let x = 1;\n-let y = 2;\n+let x = 10;\n+let y = 2 ;\n+extra line\n ctx\n";
        let mut f = parse_patch(p).remove(0);
        annotate_hunk(&mut f.hunks[0]);
        let l = &f.hunks[0].lines;
        assert_eq!(l[0].intraline, Some(vec![r(8, 9)]));
        assert_eq!(l[2].intraline, Some(vec![r(8, 10)]));
        assert!(l[1].intraline.is_some() && l[3].intraline.is_some());
        assert_eq!(l[4].intraline, None, "unpaired added line");
        assert_eq!(l[5].intraline, None, "context line");
    }
}
