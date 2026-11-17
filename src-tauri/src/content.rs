//! Shared helpers for reading file contents: size limits, binary detection,
//! line-ending normalization and safe path joining.

use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, Result};

/// Thresholds above which a file is "large" and its contents are only produced on request.
pub mod limits {
    /// Added + removed lines.
    pub const MAX_CHANGED_LINES: u32 = 10_000;
    /// Size of either version, in bytes.
    pub const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
    /// Bytes inspected for a NUL to classify a file as binary (git's heuristic).
    pub const BINARY_SNIFF_BYTES: usize = 8000;
}

/// Whether `bytes` look binary: a NUL within the first `BINARY_SNIFF_BYTES`.
pub fn is_binary_bytes(bytes: &[u8]) -> bool {
    bytes[..bytes.len().min(limits::BINARY_SNIFF_BYTES)].contains(&0)
}

/// Binary check that reads only the start of the file at `path`.
pub fn sniff_binary(path: &Path) -> Result<bool> {
    use std::io::Read;
    let mut buf = vec![0u8; limits::BINARY_SNIFF_BYTES];
    let n = std::fs::File::open(path)?.read(&mut buf)?;
    Ok(buf[..n].contains(&0))
}

/// Decode as (lossy) UTF-8 with `\r\n` normalized to `\n`.
pub fn to_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).replace("\r\n", "\n")
}

/// Join a repo-relative path onto `root`, rejecting absolute paths and `..`.
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel);
    if p.components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(AppError::Invalid(format!("invalid path: {rel}")));
    }
    Ok(root.join(p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escaping_paths() {
        let root = Path::new("C:/repo");
        assert!(safe_join(root, "../x").is_err());
        assert!(safe_join(root, "a/../../x").is_err());
        assert!(safe_join(root, "C:/Windows/x").is_err());
        assert!(safe_join(root, "/etc/passwd").is_err());
        assert!(safe_join(root, "src/a.rs").is_ok());
    }

    #[test]
    fn detects_binary_and_normalizes_text() {
        assert!(is_binary_bytes(b"ab\0cd"));
        assert!(!is_binary_bytes(b"plain"));
        assert_eq!(to_text(b"a\r\nb\n"), "a\nb\n");
    }
}
