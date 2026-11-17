//! Vault scanning and link resolution.
//!
//! A vault is a folder of Markdown files. Links may be written as `[[Note]]`,
//! `[[folder/Note]]`, `[[Note|alias]]` or via a frontmatter alias, which is why
//! resolution builds a lookup table of ids, file stems, titles and aliases.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::dates;
use crate::error::{Error, Result};
use crate::markdown::{self, Heading, Link};

pub const INBOX_FOLDER: &str = "Inbox";
const MAX_UNRESOLVED: usize = 300;
const MAX_TAGS_PER_NOTE: usize = 64;

#[derive(Debug, Clone, Copy)]
pub struct ScanOptions {
    pub max_notes: usize,
    pub max_note_bytes: u64,
    pub max_depth: usize,
    pub max_total_bytes: u64,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_notes: 8_000,
            max_note_bytes: 1 << 20,
            max_depth: 24,
            max_total_bytes: 256 << 20,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Note {
    pub id: String,
    pub file_name: String,
    pub title: String,
    pub folder: String,
    pub body: String,
    pub excerpt: String,
    pub tags: Vec<String>,
    /// Frontmatter `type`: `research`/`idea` means Cortex wrote this as a
    /// structure note. Other values are preserved but not classified.
    pub kind: Option<String>,
    /// Frontmatter `status`, normalised by the parser.
    pub status: Option<String>,
    pub aliases: Vec<String>,
    pub headings: Vec<Heading>,
    pub links: Vec<Link>,
    pub words: usize,
    pub created: String,
    pub created_days: i64,
    pub modified_ms: u64,
    pub bytes: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Edge {
    pub from: usize,
    pub to: usize,
    pub weight: u32,
}

#[derive(Debug, Clone)]
pub struct Vault {
    pub root: PathBuf,
    pub title: String,
    pub notes: Vec<Note>,
    pub edges: Vec<Edge>,
    pub unresolved: Vec<String>,
    pub warnings: Vec<String>,
    pub fingerprint: String,
    pub total_words: usize,
    lookup: HashMap<String, Vec<usize>>,
}

struct FileRef {
    id: String,
    path: PathBuf,
    modified_ms: u64,
    size: u64,
}

impl Vault {
    pub fn load(root: &Path, title: impl Into<String>, opts: ScanOptions) -> Result<Vault> {
        Vault::load_with(root, title, opts, None)
    }

    /// Reloads a vault, re-parsing only the files whose size or mtime changed.
    /// The watcher uses this, so an edit costs one file instead of the vault.
    pub fn load_with(
        root: &Path,
        title: impl Into<String>,
        opts: ScanOptions,
        previous: Option<&Vault>,
    ) -> Result<Vault> {
        let canonical = fs::canonicalize(root).map_err(Error::Io)?;
        if !canonical.is_dir() {
            return Err(Error::Vault("vault path is not a directory".into()));
        }

        let (files, mut warnings) = collect_files(&canonical, opts)?;
        let fingerprint = fingerprint(&files);

        let reusable: HashMap<&str, &Note> = previous
            .map(|vault| {
                vault
                    .notes
                    .iter()
                    .map(|note| (note.id.as_str(), note))
                    .collect()
            })
            .unwrap_or_default();

        let mut notes = Vec::with_capacity(files.len());
        for file in &files {
            if let Some(old) = reusable.get(file.id.as_str()) {
                if old.modified_ms == file.modified_ms && old.bytes as u64 == file.size {
                    notes.push((*old).clone());
                    continue;
                }
            }
            let raw = match fs::read(&file.path) {
                Ok(bytes) => bytes,
                Err(_) => {
                    warnings.push(format!("unreadable note skipped: {}", file.id));
                    continue;
                }
            };
            if raw.len() as u64 > opts.max_note_bytes {
                warnings.push(format!("oversized note skipped: {}", file.id));
                continue;
            }
            let text = String::from_utf8_lossy(&raw);
            let parsed = markdown::parse(&text);
            let stem = file.id.rsplit('/').next().unwrap_or(&file.id);
            let title = parsed
                .frontmatter
                .title
                .clone()
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty())
                .or_else(|| {
                    parsed
                        .headings
                        .iter()
                        .find(|h| h.level == 1)
                        .map(|h| h.text.trim().to_string())
                })
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| stem.to_string());

            let hint = parsed.frontmatter.date.clone();
            let created_days = hint
                .as_deref()
                .and_then(dates::parse_iso_date)
                .or_else(|| dates::parse_iso_date(stem))
                .unwrap_or_else(|| dates::from_unix_millis(file.modified_ms));

            let mut tags = parsed.tags;
            tags.truncate(MAX_TAGS_PER_NOTE);

            notes.push(Note {
                id: file.id.clone(),
                file_name: file
                    .path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("note.md")
                    .to_string(),
                title,
                folder: top_folder(&file.id),
                body: parsed.body,
                excerpt: parsed.excerpt,
                tags,
                kind: parsed.frontmatter.kind,
                status: parsed.frontmatter.status,
                aliases: parsed.frontmatter.aliases,
                headings: parsed.headings,
                links: parsed.links,
                words: parsed.words,
                created: dates::iso_date(created_days),
                created_days,
                modified_ms: file.modified_ms,
                bytes: raw.len(),
            });
        }

        notes.sort_by(|a, b| a.id.cmp(&b.id));
        if notes.len() < files.len() {
            warnings.push(format!(
                "{} notes skipped while indexing",
                files.len() - notes.len()
            ));
        }

        let lookup = build_lookup(&notes);
        let mut edge_weights: BTreeMap<(usize, usize), u32> = BTreeMap::new();
        let mut unresolved = HashSet::new();

        for (index, note) in notes.iter().enumerate() {
            for link in &note.links {
                match resolve_key(&notes, &lookup, &link.target) {
                    Some(target) if target != index => {
                        let weight = edge_weights.entry((index, target)).or_insert(0);
                        *weight = (*weight + 1).min(8);
                    }
                    Some(_) => {}
                    None => {
                        if unresolved.len() < MAX_UNRESOLVED {
                            unresolved.insert(link.target.clone());
                        }
                    }
                }
            }
        }

        let edges = edge_weights
            .into_iter()
            .map(|((from, to), weight)| Edge { from, to, weight })
            .collect();
        let mut unresolved: Vec<String> = unresolved.into_iter().collect();
        unresolved.sort();
        let total_words = notes.iter().map(|n| n.words).sum();

        Ok(Vault {
            root: canonical,
            title: title.into(),
            notes,
            edges,
            unresolved,
            warnings,
            fingerprint,
            total_words,
            lookup,
        })
    }

    pub fn note(&self, id: &str) -> Option<&Note> {
        let want = normalize_key(id);
        self.notes
            .iter()
            .find(|note| note.id.to_lowercase() == want)
    }

    pub fn index_of(&self, id: &str) -> Option<usize> {
        self.note(id)
            .and_then(|note| self.notes.iter().position(|n| n.id == note.id))
    }

    pub fn resolve(&self, target: &str) -> Option<usize> {
        resolve_key(&self.notes, &self.lookup, target)
    }

    /// Incoming links per note, sorted by weight then source title.
    pub fn backlinks(&self) -> Vec<Vec<(usize, u32)>> {
        let mut out = vec![Vec::new(); self.notes.len()];
        for edge in &self.edges {
            out[edge.to].push((edge.from, edge.weight));
        }
        for list in &mut out {
            list.sort_by_key(|(index, weight)| {
                (std::cmp::Reverse(*weight), self.notes[*index].title.clone())
            });
        }
        out
    }

    /// Notes that mention `needle` in their body without linking to it.
    pub fn unlinked_mentions(&self, target: usize, needle: &str, limit: usize) -> Vec<usize> {
        let needle = needle.trim().to_lowercase();
        if needle.chars().count() < 3 {
            return Vec::new();
        }
        let linked: HashSet<usize> = self
            .edges
            .iter()
            .filter(|edge| edge.from == target)
            .map(|edge| edge.to)
            .collect();
        let mut hits = Vec::new();
        for (index, note) in self.notes.iter().enumerate() {
            if index == target || linked.contains(&index) {
                continue;
            }
            if note.body.to_lowercase().contains(&needle) {
                hits.push(index);
                if hits.len() >= limit {
                    break;
                }
            }
        }
        hits
    }

    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
}

fn top_folder(id: &str) -> String {
    match id.split_once('/') {
        Some((folder, _)) if !folder.is_empty() => folder.to_string(),
        _ => INBOX_FOLDER.to_string(),
    }
}

fn normalize_key(target: &str) -> String {
    let trimmed = target.trim().trim_start_matches("./").replace('\\', "/");
    let trimmed = trimmed.trim_end_matches('/');
    // Obsidian-style anchors: `[[Note#Heading]]` and `[[Note^block]]` both point
    // at the note. Without this, half the links in a real Obsidian vault would
    // resolve to nothing.
    let trimmed = trimmed.split(['#', '^']).next().unwrap_or(trimmed).trim();
    let without_ext = trimmed
        .strip_suffix(".md")
        .or_else(|| trimmed.strip_suffix(".MD"))
        .unwrap_or(trimmed);
    without_ext.to_lowercase()
}

fn build_lookup(notes: &[Note]) -> HashMap<String, Vec<usize>> {
    let mut lookup: HashMap<String, Vec<usize>> = HashMap::new();
    let mut insert = |key: String, index: usize| {
        if key.chars().count() < 2 {
            return;
        }
        lookup.entry(key).or_default().push(index);
    };
    for (index, note) in notes.iter().enumerate() {
        insert(note.id.to_lowercase(), index);
        if let Some((_, stem)) = note.id.rsplit_once('/') {
            insert(stem.to_lowercase(), index);
        }
        insert(note.title.to_lowercase(), index);
        for alias in &note.aliases {
            insert(alias.to_lowercase(), index);
        }
    }
    lookup
}

fn resolve_key(
    notes: &[Note],
    lookup: &HashMap<String, Vec<usize>>,
    target: &str,
) -> Option<usize> {
    let key = normalize_key(target);
    if key.is_empty() {
        return None;
    }
    let pick = |candidates: &Vec<usize>| -> Option<usize> {
        candidates
            .iter()
            .copied()
            .min_by_key(|index| (notes[*index].id.len(), notes[*index].id.clone()))
    };
    if let Some(found) = lookup.get(&key).and_then(pick) {
        return Some(found);
    }
    if let Some((_, tail)) = key.rsplit_once('/') {
        if let Some(found) = lookup.get(tail).and_then(pick) {
            return Some(found);
        }
    }
    None
}

fn collect_files(root: &Path, opts: ScanOptions) -> Result<(Vec<FileRef>, Vec<String>)> {
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped_symlinks = 0usize;
    let mut skipped_large = 0usize;
    let mut depth_limited = 0usize;
    let mut stack = vec![(root.to_path_buf(), 0usize)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > opts.max_depth {
            depth_limited += 1;
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(entries) => entries,
            Err(_) => {
                warnings.push(format!("unreadable folder skipped: {}", dir.display()));
                continue;
            }
        };
        let mut entries: Vec<_> = entries.filter_map(|entry| entry.ok()).collect();
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            if files.len() >= opts.max_notes {
                warnings.push(format!("note limit of {} reached", opts.max_notes));
                return Ok((files, warnings));
            }
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if file_type.is_symlink() {
                skipped_symlinks += 1;
                continue;
            }
            if file_type.is_dir() {
                if name.starts_with('.') || name == "node_modules" || name == "target" {
                    continue;
                }
                stack.push((entry.path(), depth + 1));
                continue;
            }
            if !file_type.is_file() || !name.to_ascii_lowercase().ends_with(".md") {
                continue;
            }
            let absolute = entry.path();
            let relative = match absolute.strip_prefix(root) {
                Ok(path) => path,
                Err(_) => continue,
            };
            let rel_string = relative
                .components()
                .filter_map(|c| c.as_os_str().to_str())
                .collect::<Vec<_>>()
                .join("/");
            if rel_string.is_empty() {
                continue;
            }
            let id = rel_string[..rel_string.len() - 3].to_string();
            let meta = match entry.metadata() {
                Ok(meta) => meta,
                Err(_) => continue,
            };
            if meta.len() > opts.max_note_bytes {
                skipped_large += 1;
                continue;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
                .map(|duration| duration.as_millis() as u64)
                .unwrap_or(0);
            files.push(FileRef {
                id,
                path: absolute,
                modified_ms,
                size: meta.len(),
            });
        }
    }

    if skipped_symlinks > 0 {
        warnings.push(format!("{skipped_symlinks} symlinks skipped"));
    }
    if skipped_large > 0 {
        warnings.push(format!("{skipped_large} oversized notes skipped"));
    }
    if depth_limited > 0 {
        warnings.push(format!("{depth_limited} folders below depth limit skipped"));
    }

    let total: u64 = files.iter().map(|f| f.size).sum();
    if total > opts.max_total_bytes {
        return Err(Error::Vault("vault exceeds total size limit".into()));
    }

    files.sort_by(|a, b| a.id.cmp(&b.id));
    Ok((files, warnings))
}

/// Cheap stat-only fingerprint used by the watcher.
pub fn fingerprint_of(root: &Path, opts: ScanOptions) -> Result<String> {
    let canonical = fs::canonicalize(root).map_err(Error::Io)?;
    let (files, _) = collect_files(&canonical, opts)?;
    Ok(fingerprint(&files))
}

fn fingerprint(files: &[FileRef]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for file in files {
        file.id.hash(&mut hasher);
        file.modified_ms.hash(&mut hasher);
        file.size.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(root: &Path, id: &str, body: &str) {
        let path = root.join(format!("{id}.md"));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, body).unwrap();
    }

    fn sample() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "Ideas/Deep Work",
            "# Deep Work\nSee [[Attention]] and [[focus]].",
        );
        write(
            dir.path(),
            "Ideas/Attention",
            "---\ntitle: Attention Economy\naliases: [focus]\ntags: [mind]\n---\n",
        );
        write(
            dir.path(),
            "Journal/2026-01-02",
            "---\ndate: 2026-01-02\ntags: [journal]\n---\nToday: [[Deep Work]].",
        );
        write(dir.path(), "Loose", "No links here.");
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::write(dir.path().join(".obsidian/config.md"), "[[hidden]]").unwrap();
        dir
    }

    #[test]
    fn resolves_links_titles_and_aliases() {
        let dir = sample();
        let vault = Vault::load(dir.path(), "Test", ScanOptions::default()).unwrap();
        assert_eq!(vault.notes.len(), 4);
        assert!(vault.notes.iter().all(|n| !n.id.starts_with('.')));
        // `[[Attention]]` and `[[focus]]` (an alias) resolve to the same note
        // and collapse into one weighted edge.
        assert_eq!(vault.edges.len(), 2);
        let deep = vault.index_of("Ideas/Deep Work").unwrap();
        let attention = vault.index_of("Ideas/Attention").unwrap();
        let edge = vault
            .edges
            .iter()
            .find(|e| e.from == deep && e.to == attention)
            .expect("edge exists");
        assert_eq!(edge.weight, 2);
        assert!(vault.resolve("focus").is_some());
        assert!(vault.resolve("Attention Economy").is_some());
        assert_eq!(vault.resolve("missing"), None);
        assert!(vault.unresolved.is_empty());
    }

    #[test]
    fn resolves_obsidian_anchors() {
        let dir = tempfile::tempdir().unwrap();
        write(
            dir.path(),
            "Index",
            "[[Attention#Definition]] and [[Attention^abc123]] and [[Attention|alias]]",
        );
        write(
            dir.path(),
            "Attention",
            "# Attention\n\n## Definition\n\nFocus.",
        );
        let vault = Vault::load(dir.path(), "Test", ScanOptions::default()).unwrap();
        assert!(vault.unresolved.is_empty(), "{:?}", vault.unresolved);
        assert_eq!(vault.edges.len(), 1);
        assert_eq!(vault.edges[0].weight, 3);
    }

    #[test]
    fn folders_and_dates_are_derived() {
        let dir = sample();
        let vault = Vault::load(dir.path(), "Test", ScanOptions::default()).unwrap();
        let journal = vault.note("Journal/2026-01-02").unwrap();
        assert_eq!(journal.folder, "Journal");
        assert_eq!(journal.created, "2026-01-02");
        let loose = vault.note("Loose").unwrap();
        assert_eq!(loose.folder, INBOX_FOLDER);
    }

    #[test]
    fn duplicate_stems_resolve_deterministically() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "A/Note", "one");
        write(dir.path(), "B/Note", "two");
        write(dir.path(), "Index", "[[Note]]");
        let vault = Vault::load(dir.path(), "Test", ScanOptions::default()).unwrap();
        assert_eq!(vault.notes.len(), 3);
        let target = vault.edges[0].to;
        assert_eq!(vault.notes[target].id, "A/Note");
    }

    #[test]
    fn empty_vault_is_valid() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::load(dir.path(), "Empty", ScanOptions::default()).unwrap();
        assert!(vault.notes.is_empty());
        assert!(vault.edges.is_empty());
        assert_eq!(vault.total_words, 0);
    }

    #[test]
    fn fingerprint_changes_with_content() {
        let dir = sample();
        let first = Vault::load(dir.path(), "Test", ScanOptions::default()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        write(dir.path(), "Ideas/New", "fresh");
        let second = Vault::load(dir.path(), "Test", ScanOptions::default()).unwrap();
        assert_ne!(first.fingerprint, second.fingerprint);
        assert_eq!(second.notes.len(), 5);
    }

    #[test]
    fn reload_reuses_unchanged_notes_and_picks_up_edits() {
        let dir = sample();
        let first = Vault::load(dir.path(), "Test", ScanOptions::default()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        write(dir.path(), "Ideas/New", "fresh");
        let second =
            Vault::load_with(dir.path(), "Test", ScanOptions::default(), Some(&first)).unwrap();
        assert_eq!(second.notes.len(), 5);
        assert_ne!(second.fingerprint, first.fingerprint);

        std::thread::sleep(std::time::Duration::from_millis(10));
        write(
            dir.path(),
            "Ideas/Deep Work",
            "# Deep Work\nRewritten. See [[Attention]].",
        );
        let third =
            Vault::load_with(dir.path(), "Test", ScanOptions::default(), Some(&second)).unwrap();
        let deep = third.note("Ideas/Deep Work").unwrap();
        assert!(deep.body.contains("Rewritten"));
        assert_eq!(third.notes.len(), 5);
    }

    #[test]
    fn rejects_missing_vault() {
        let err = Vault::load(
            Path::new("/definitely/not/here"),
            "x",
            ScanOptions::default(),
        );
        assert!(err.is_err());
    }
}
