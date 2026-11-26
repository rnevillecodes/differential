//! Browsing the working tree: listing every project file, reading one for display, and
//! reading an image's bytes for rendered Markdown.
//!
//! Read-only: `git ls-files` plus plain file-system reads.

use std::collections::HashSet;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::content::{is_binary_bytes, limits, safe_join, sniff_binary, to_text};
use crate::error::{AppError, Result};
use crate::git::Git;

/// A working-tree file prepared for display.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export)]
pub enum FileView {
    /// Full contents, `\r\n` normalized to `\n`.
    Text { content: String },
    Binary,
    /// Over the size limit; request again with `force` to read it.
    Large {
        #[ts(type = "number")]
        size: u64,
    },
    /// The path no longer exists.
    Missing,
    /// A directory (e.g. a submodule) or other non-regular file.
    NotAFile,
}

/// Every tracked file present on disk plus every untracked, non-ignored file,
/// as repo-relative `/`-separated paths, each once, in git's order.
pub fn list_files(git: &Git, root: &Path) -> Result<Vec<String>> {
    let out = git.run(
        root,
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    )?;
    let text = String::from_utf8_lossy(&out);
    let mut seen = HashSet::new();
    let mut files = Vec::new();
    for path in text.split('\0').filter(|p| !p.is_empty()) {
        if !seen.insert(path) {
            continue; // unmerged entries are listed once per stage
        }
        // Tracked files deleted from disk are still in the index; skip them.
        // `symlink_metadata` keeps broken symlinks, which do exist as entries.
        if std::fs::symlink_metadata(root.join(path)).is_err() {
            continue;
        }
        files.push(path.to_string());
    }
    Ok(files)
}

/// Read one working-tree file for display. Large files are only read with `force`.
pub fn view_file(root: &Path, path: &str, force: bool) -> Result<FileView> {
    let full = safe_join(root, path)?;
    let meta = match std::fs::metadata(&full) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(FileView::Missing),
        Err(e) => return Err(e.into()),
    };
    if !meta.is_file() {
        return Ok(FileView::NotAFile);
    }
    if meta.len() > limits::MAX_FILE_BYTES && !force {
        return Ok(if sniff_binary(&full)? {
            FileView::Binary
        } else {
            FileView::Large { size: meta.len() }
        });
    }
    let bytes = match std::fs::read(&full) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(FileView::Missing),
        Err(e) => return Err(e.into()),
    };
    if is_binary_bytes(&bytes) {
        return Ok(FileView::Binary);
    }
    Ok(FileView::Text { content: to_text(&bytes) })
}

/// Extensions of the image formats `read_image` serves.
pub const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"];

/// The bytes of the working-tree image at repo-relative `path`, for display in rendered Markdown.
///
/// Refuses paths that are absolute or contain `..`, files that are not an allowed image type,
/// files whose real location (after symbolic links) is outside the repository, anything that is
/// not a regular file, and files over `limits::MAX_IMAGE_BYTES`.
pub fn read_image(root: &Path, path: &str) -> Result<Vec<u8>> {
    let full = safe_join(root, path)?;
    let ext = full.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(AppError::Invalid(format!("not a supported image: {path}")));
    }
    // A symbolic link inside the repository may point anywhere; only serve what really lives here.
    let real = full.canonicalize()?;
    if !real.starts_with(root.canonicalize()?) {
        return Err(AppError::Invalid(format!("image is outside the repository: {path}")));
    }
    let meta = std::fs::metadata(&real)?;
    if !meta.is_file() {
        return Err(AppError::Invalid(format!("not a file: {path}")));
    }
    if meta.len() > limits::MAX_IMAGE_BYTES {
        return Err(AppError::Invalid(format!("image is too large: {path}")));
    }
    Ok(std::fs::read(&real)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_kind_tag() {
        let v = serde_json::to_value(FileView::Large { size: 5 }).unwrap();
        assert_eq!(v, serde_json::json!({ "kind": "large", "size": 5 }));
        let v = serde_json::to_value(FileView::NotAFile).unwrap();
        assert_eq!(v, serde_json::json!({ "kind": "notAFile" }));
    }
}
