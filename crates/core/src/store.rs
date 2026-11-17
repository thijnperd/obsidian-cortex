//! Filesystem boundary for notes.
//!
//! Every path that comes from a client passes through [`note_path`], which
//! rejects absolute paths, dot segments, control characters, non-Markdown
//! extensions and symlinks. Writes are atomic (temp file + rename).

use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Component, Path, PathBuf};

use crate::error::{Error, Result};

pub const MAX_NOTE_BYTES: u64 = 1_048_576;
const MAX_ID_LEN: usize = 400;
const MAX_SEGMENT_LEN: usize = 120;

/// Validates a vault-relative note id (no `.md`) and returns the file path.
pub fn note_path(root: &Path, id: &str) -> Result<PathBuf> {
    let relative = validate_id(id)?;
    let mut current = root.to_path_buf();
    let total = relative.components().count();
    let mut missing = false;
    for (index, component) in relative.components().enumerate() {
        let Component::Normal(name) = component else {
            return Err(Error::InvalidPath("unexpected path component".into()));
        };
        current.push(name);
        // Keep building the full path even after the first missing component,
        // otherwise `a/b/c` would resolve to `a` on a cold vault.
        if missing {
            continue;
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) => {
                let is_last = index + 1 == total;
                if meta.file_type().is_symlink() {
                    return Err(Error::InvalidPath("symlinks are not followed".into()));
                }
                if !is_last && !meta.is_dir() {
                    return Err(Error::InvalidPath("path crosses a file".into()));
                }
            }
            Err(err) if err.kind() == ErrorKind::NotFound => missing = true,
            Err(err) => return Err(Error::Io(err)),
        }
    }
    Ok(current)
}

/// Returns a safe relative `PathBuf` ending in `.md`.
fn validate_id(id: &str) -> Result<PathBuf> {
    let id = id.trim();
    if id.is_empty() {
        return Err(Error::InvalidPath("empty id".into()));
    }
    if id.len() > MAX_ID_LEN || id.contains('\0') || id.contains('\\') {
        return Err(Error::InvalidPath("illegal characters".into()));
    }
    if id.starts_with('/') || id.starts_with('~') || id.contains(':') {
        return Err(Error::InvalidPath("path must be vault-relative".into()));
    }
    if id.split('/').any(|segment| segment.len() > MAX_SEGMENT_LEN) {
        return Err(Error::InvalidPath("path segment too long".into()));
    }
    let mut segments: Vec<String> = Vec::new();
    for segment in id.split('/') {
        // Hidden segments are refused too: otherwise a save could write into
        // `.obsidian/` (or `.git/`) where the vault index would never see it.
        if segment.is_empty() || segment.starts_with('.') {
            return Err(Error::InvalidPath("dot segments are not allowed".into()));
        }
        if segment.chars().any(|c| c.is_control()) {
            return Err(Error::InvalidPath("control characters".into()));
        }
        segments.push(segment.to_string());
    }
    // Append `.md` instead of replacing an unknown extension so a title like
    // "notes.txt" maps to `notes.txt.md` and never overwrites another file type.
    if let Some(last) = segments.last_mut() {
        if !last.to_ascii_lowercase().ends_with(".md") {
            last.push_str(".md");
        }
    }
    let mut relative = PathBuf::new();
    for segment in &segments {
        relative.push(segment);
    }
    Ok(relative)
}

/// Removes the `.md` suffix so ids match the ones in the graph payload.
pub fn strip_md(id: &str) -> &str {
    let lower_ok = id.len() > 3 && id[id.len() - 3..].eq_ignore_ascii_case(".md");
    if lower_ok {
        &id[..id.len() - 3]
    } else {
        id
    }
}

pub fn read_note(root: &Path, id: &str) -> Result<String> {
    let path = note_path(root, id)?;
    let meta = fs::metadata(&path).map_err(|err| {
        if err.kind() == ErrorKind::NotFound {
            Error::NotFound
        } else {
            Error::Io(err)
        }
    })?;
    if !meta.is_file() {
        return Err(Error::NotFound);
    }
    if meta.len() > MAX_NOTE_BYTES {
        return Err(Error::TooLarge {
            limit: MAX_NOTE_BYTES,
        });
    }
    fs::read_to_string(path).map_err(Error::Io)
}

/// Writes a note atomically, creating missing folders inside the vault.
pub fn write_note(root: &Path, id: &str, content: &str) -> Result<PathBuf> {
    if content.len() as u64 > MAX_NOTE_BYTES {
        return Err(Error::TooLarge {
            limit: MAX_NOTE_BYTES,
        });
    }
    let path = note_path(root, id)?;
    ensure_parents(root, &path)?;

    // Re-validate after folder creation: closes the window where a symlinked
    // directory could have been introduced between the two calls.
    let verified = note_path(root, strip_md(id))?;
    if verified != path {
        return Err(Error::InvalidPath("path changed during write".into()));
    }

    let unique = format!(
        ".{}.{}.tmp",
        path.file_stem().and_then(|s| s.to_str()).unwrap_or("note"),
        crate::dates::now_millis()
    );
    let temp = path.with_file_name(unique);

    let write_result = (|| -> Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        crate::replace_file(&temp, &path)?;
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    write_result?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

fn ensure_parents(root: &Path, path: &Path) -> Result<()> {
    let Some(parent) = path.parent() else {
        return Err(Error::InvalidPath("note needs a parent folder".into()));
    };
    if parent == root {
        return Ok(());
    }
    let relative = parent
        .strip_prefix(root)
        .map_err(|_| Error::InvalidPath("outside vault".into()))?;

    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(name) = component else {
            return Err(Error::InvalidPath("unexpected path component".into()));
        };
        current.push(name);
        match fs::symlink_metadata(&current) {
            Ok(meta) => {
                if meta.file_type().is_symlink() || !meta.is_dir() {
                    return Err(Error::InvalidPath("unsafe folder in path".into()));
                }
            }
            Err(err) if err.kind() == ErrorKind::NotFound => {
                fs::create_dir(&current)?;
            }
            Err(err) => return Err(Error::Io(err)),
        }
    }
    Ok(())
}

/// URL/file friendly slug: lowercase ASCII, dashes for separators.
pub fn slugify(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut dash = false;
    for c in title.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if (c.is_whitespace() || matches!(c, '-' | '_' | '/' | '\\'))
            && !dash
            && !out.is_empty()
        {
            out.push('-');
            dash = true;
        }
        if out.len() >= 80 {
            break;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "note".to_string()
    } else {
        trimmed
    }
}

/// Picks `title`, `title-2`, ... until the id is free.
pub fn unique_id(root: &Path, base: &str) -> String {
    for attempt in 1..128 {
        let candidate = if attempt == 1 {
            base.to_string()
        } else {
            format!("{base}-{attempt}")
        };
        if note_path(root, &candidate)
            .map(|p| !p.exists())
            .unwrap_or(false)
        {
            return candidate;
        }
    }
    format!("{base}-{}", crate::dates::now_millis())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("Ideas")).unwrap();
        fs::write(dir.path().join("Ideas/Deep Work.md"), "# Deep Work\n").unwrap();
        dir
    }

    #[test]
    fn accepts_nested_ids() {
        let dir = vault();
        let path = note_path(dir.path(), "Ideas/Deep Work").unwrap();
        assert!(path.ends_with("Ideas/Deep Work.md"));
        assert_eq!(
            read_note(dir.path(), "Ideas/Deep Work").unwrap(),
            "# Deep Work\n"
        );
    }

    #[test]
    fn rejects_traversal_and_absolute_paths() {
        let dir = vault();
        for id in [
            "../escape",
            "Ideas/../../escape",
            "/etc/passwd",
            "Ideas/./x",
            "Ideas//x",
            "C:/windows",
            "~/.ssh/id_rsa",
            "Ideas\\x",
        ] {
            assert!(note_path(dir.path(), id).is_err(), "should reject {id}");
        }
    }

    #[test]
    fn rejects_non_markdown_extensions() {
        let dir = vault();
        let path = note_path(dir.path(), "Ideas/../../x.sh").unwrap_err();
        assert!(matches!(path, Error::InvalidPath(_)));
        // A harmless non-md name is rewritten to .md instead of written raw.
        let rewritten = note_path(dir.path(), "Ideas/ok.txt").unwrap();
        assert!(rewritten.ends_with("Ideas/ok.txt.md"));
    }

    #[test]
    fn rejects_oversized_content() {
        let dir = vault();
        let big = "x".repeat(MAX_NOTE_BYTES as usize + 1);
        assert!(matches!(
            write_note(dir.path(), "big", &big),
            Err(Error::TooLarge { .. })
        ));
    }

    #[test]
    fn creates_nested_folders_on_cold_vaults() {
        let dir = vault();
        write_note(dir.path(), "Projects/2026/Alpha", "# Alpha\n").unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("Projects/2026/Alpha.md")).unwrap(),
            "# Alpha\n"
        );
        // Regression: a cold path used to resolve to its first missing segment.
        assert!(!dir.path().join("Projects").is_file());
        assert!(dir.path().join("Projects").is_dir());
    }

    #[test]
    fn writes_atomically_and_cleans_up() {
        let dir = vault();
        write_note(dir.path(), "Ideas/New", "# New\n").unwrap();
        assert_eq!(
            fs::read_to_string(dir.path().join("Ideas/New.md")).unwrap(),
            "# New\n"
        );
        let leftovers: Vec<_> = fs::read_dir(dir.path().join("Ideas"))
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn refuses_hidden_targets() {
        let dir = vault();
        for id in [".obsidian/app", ".git/hooks/pre-commit", "notes/.env"] {
            assert!(
                write_note(dir.path(), id, "x").is_err(),
                "{id} should be rejected"
            );
        }
    }

    // Windows needs developer mode or an elevated token to create symlinks, so
    // the escape check is exercised on Unix only; `note_path` itself is shared.
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_escape() {
        let dir = vault();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), dir.path().join("link")).unwrap();
        assert!(note_path(dir.path(), "link/secret").is_err());
    }

    #[test]
    fn overwrites_an_existing_note() {
        let dir = vault();
        write_note(dir.path(), "Ideas/Deep Work", "one").unwrap();
        write_note(dir.path(), "Ideas/Deep Work", "two").unwrap();
        let body = fs::read_to_string(dir.path().join("Ideas/Deep Work.md")).unwrap();
        assert_eq!(body, "two");
        let leftovers: Vec<_> = fs::read_dir(dir.path().join("Ideas"))
            .unwrap()
            .filter_map(|entry| entry.ok())
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty());
    }

    #[test]
    fn slug_and_unique_ids() {
        assert_eq!(slugify("Deep Work: rules"), "deep-work-rules");
        assert_eq!(slugify("  "), "note");
        let dir = vault();
        assert_eq!(
            unique_id(dir.path(), "Ideas/Deep Work"),
            "Ideas/Deep Work-2"
        );
    }
}
