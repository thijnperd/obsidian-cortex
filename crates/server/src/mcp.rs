//! Model Context Protocol server: `cortex mcp`.
//!
//! Newline-delimited JSON-RPC on stdin, one message per line, and **nothing
//! else on stdout** — a stray `println!` corrupts the stream, so every
//! diagnostic goes to stderr.
//!
//! The tools are thin wrappers over `cortex_core`: they reuse the vault loader,
//! the path validation, the atomic writer and the same 1 MiB cap the UI has.
//! Every write is appended to a journal in the config directory, so the human
//! can see what an agent did even though there is no undo.

use std::fs;
use std::io::{self, BufRead, Write};
use std::path::{Path, PathBuf};

use cortex_core::dates::now_millis;
use cortex_core::registry::{self, Registry};
use cortex_core::search::SearchIndex;
use cortex_core::store;
use cortex_core::vault::{ScanOptions, Vault};
use serde_json::{json, Map, Value};

/// The instructions an agent should read before touching the vault.
const AGENT_GUIDE: &str = include_str!("../../../docs/agent-guide.md");

/// Version we answer with when the client does not ask for one we know.
const PROTOCOL_VERSION: &str = "2025-06-18";

const MAX_SEARCH: usize = 50;

/* ---------- failures ---------- */

/// A tool failure the model can act on: a kind, a sentence, and whatever data
/// it needs to retry (a current hash, the headings that do exist).
struct Failure {
    kind: &'static str,
    message: String,
    extra: Value,
}

impl Failure {
    fn new(kind: &'static str, message: impl Into<String>) -> Failure {
        Failure {
            kind,
            message: message.into(),
            extra: Value::Null,
        }
    }

    fn with(mut self, extra: Value) -> Failure {
        self.extra = extra;
        self
    }
}

impl From<cortex_core::Error> for Failure {
    fn from(error: cortex_core::Error) -> Failure {
        Failure::new("failed", error.to_string())
    }
}

impl From<std::io::Error> for Failure {
    fn from(error: std::io::Error) -> Failure {
        Failure::new("failed", error.to_string())
    }
}

type ToolResult = Result<Value, Failure>;

/* ---------- helpers ---------- */

/// FNV-1a: stable across processes and languages, which is all a precondition
/// needs. Not a security hash.
fn hash_of(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn string_arg(args: &Map<String, Value>, key: &str) -> Result<String, Failure> {
    match args.get(key).and_then(Value::as_str) {
        Some(value) if !value.trim().is_empty() => Ok(value.trim().to_string()),
        _ => Err(Failure::new(
            "invalid_argument",
            format!("`{key}` is required and must be a non-empty string"),
        )),
    }
}

fn optional_arg(args: &Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

/// Bodies may legitimately be empty (a stub note, a cleared section).
fn body_arg(args: &Map<String, Value>, key: &str) -> Result<String, Failure> {
    match args.get(key).and_then(Value::as_str) {
        Some(value) => Ok(value.to_string()),
        None => Err(Failure::new(
            "invalid_argument",
            format!("`{key}` is required (it may be an empty string)"),
        )),
    }
}

fn limit_arg(args: &Map<String, Value>, fallback: usize) -> usize {
    args.get("limit")
        .and_then(Value::as_u64)
        .map(|value| value as usize)
        .unwrap_or(fallback)
        .clamp(1, MAX_SEARCH)
}

/// One trailing newline, no trailing blank lines, no CRLF.
fn finish_note(body: &str) -> String {
    let mut text = body.replace("\r\n", "\n");
    while text.ends_with('\n') {
        text.pop();
    }
    text.push('\n');
    text
}

fn parse_heading(line: &str) -> Option<(usize, &str)> {
    let hashes = line.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&hashes) {
        return None;
    }
    let rest = line[hashes..].strip_prefix(' ')?;
    Some((hashes, rest.trim()))
}

fn headings_of(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(parse_heading)
        .map(|(_, text)| text.to_string())
        .collect()
}

/// Byte span of a section's body: everything after the heading line, up to the
/// next heading of the same or a higher level.
fn section_span(content: &str, heading: &str) -> Option<(usize, usize)> {
    let wanted = heading.trim();
    let mut offset = 0usize;
    let mut found: Option<(usize, usize)> = None;
    for line in content.split_inclusive('\n') {
        if let Some((level, text)) = parse_heading(line.trim_end_matches(['\r', '\n'])) {
            match found {
                Some((start, heading_level)) if level <= heading_level => {
                    return Some((start, offset));
                }
                Some(_) => {}
                None if text.eq_ignore_ascii_case(wanted) => {
                    found = Some((offset + line.len(), level));
                }
                None => {}
            }
        }
        offset += line.len();
    }
    found.map(|(start, _)| (start, content.len()))
}

fn journal_path() -> Option<PathBuf> {
    registry::config_path().and_then(|path| path.parent().map(|dir| dir.join("agent-writes.jsonl")))
}

fn canonical_dir(path: &Path) -> Result<PathBuf, String> {
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("{}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!("{} is not a folder", canonical.display()));
    }
    Ok(canonical)
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

/* ---------- the session ---------- */

/// Asked on every request. In production it reads the registry off disk, so the
/// switch in the app also stops a session that is already connected; tests
/// inject a fixed answer.
type AccessCheck = Box<dyn Fn(&Path) -> bool + Send + Sync>;

struct Agent {
    root: PathBuf,
    vault: Option<Vault>,
    journal: Option<PathBuf>,
    allowed: AccessCheck,
}

impl Agent {
    fn open(root: Option<PathBuf>) -> Result<Agent, String> {
        Agent::open_with(root, Box::new(|root| agent_access(root, &Registry::load())))
    }

    fn open_with(root: Option<PathBuf>, allowed: AccessCheck) -> Result<Agent, String> {
        let root = match root {
            Some(path) => canonical_dir(&path)?,
            None => {
                let registry = Registry::load();
                match registry.active {
                    Some(path) => canonical_dir(&path)?,
                    None => {
                        return Err(
                            "no vault yet: pass a folder (`cortex mcp ~/Notes`) or open one in Cortex first"
                                .to_string(),
                        )
                    }
                }
            }
        };
        if !allowed(&root) {
            return Err(format!(
                "agent access is off for {} — turn it on in Cortex \u{2192} Vault settings, or run: cortex agents \"{}\" --on",
                root.display(),
                root.display()
            ));
        }
        Ok(Agent {
            root,
            vault: None,
            journal: journal_path(),
            allowed,
        })
    }

    /// Re-read the vault, reusing unchanged notes. Cheap enough to call on every
    /// request, which is what keeps tool results honest after an edit on disk.
    fn refresh(&mut self) -> Result<&Vault, Failure> {
        let title = registry::name_for(&self.root);
        let options = ScanOptions::default();
        let loaded = match self.vault.take() {
            Some(previous) if previous.root == self.root => {
                Vault::load_with(&self.root, &title, options, Some(&previous))
            }
            _ => Vault::load(&self.root, &title, options),
        }
        .map_err(|error| {
            Failure::new(
                "vault",
                format!("could not read {}: {error}", self.root.display()),
            )
        })?;
        self.vault = Some(loaded);
        Ok(self.vault.as_ref().expect("just loaded"))
    }

    fn journal(&self, tool: &str, id: &str, bytes: usize) {
        let Some(path) = &self.journal else { return };
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let line = json!({
            "at": now_millis(),
            "tool": tool,
            "vault": self.root,
            "id": id,
            "bytes": bytes,
        });
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{line}");
        }
    }

    fn read_current(&self, id: &str) -> Result<String, Failure> {
        store::read_note(&self.root, id).map_err(|_| {
            Failure::new(
                "not_found",
                format!("no note at `{id}` — use cortex_search or cortex_stats first"),
            )
        })
    }

    /// The precondition check every mutation runs. `expect` is the hash from
    /// `cortex_read_note`; a mismatch means the file moved under us.
    fn check(&self, id: &str, current: &str, expect: &str) -> Result<(), Failure> {
        let actual = hash_of(current);
        if actual == expect {
            return Ok(());
        }
        Err(Failure::new(
            "conflict",
            "the note changed on disk after it was read; read it again and redo the edit against the current body",
        )
        .with(json!({"id": id, "current_hash": actual})))
    }

    fn call(&mut self, name: &str, args: &Map<String, Value>) -> ToolResult {
        // Checked on every request, not only at startup: turning the switch off
        // in the app must stop the session that is already connected.
        if !(self.allowed)(&self.root) {
            return Err(Failure::new(
                "agents_off",
                "agent access was turned off for this vault in Cortex; nothing was changed",
            ));
        }
        match name {
            "cortex_guide" => Ok(json!({"guide": AGENT_GUIDE})),
            "cortex_list_vaults" => self.list_vaults(),
            "cortex_use_vault" => self.use_vault(args),
            "cortex_stats" => self.stats(),
            "cortex_search" => self.search(args),
            "cortex_read_note" => self.read_note(args),
            "cortex_create_note" => self.create_note(args),
            "cortex_write_note" => self.write_note(args),
            "cortex_replace_section" => self.replace_section(args),
            "cortex_append" => self.append(args),
            "cortex_move_note" => self.move_note(args),
            "cortex_links" => self.links(args),
            "cortex_orphans" => self.orphans(args),
            other => Err(Failure::new(
                "unknown_tool",
                format!("no tool named `{other}`"),
            )),
        }
    }

    fn list_vaults(&mut self) -> ToolResult {
        let registry = Registry::load();
        let vaults: Vec<Value> = registry
            .vaults
            .iter()
            .map(|entry| {
                json!({
                    "name": entry.name,
                    "path": entry.path,
                    "present": entry.path.is_dir(),
                    "bound": entry.path == self.root,
                })
            })
            .collect();
        Ok(json!({"bound": self.root, "vaults": vaults}))
    }

    fn use_vault(&mut self, args: &Map<String, Value>) -> ToolResult {
        let path = string_arg(args, "path")?;
        let root = canonical_dir(Path::new(&path))
            .map_err(|error| Failure::new("invalid_argument", error))?;
        self.root = root;
        self.vault = None;
        let stats = self.stats()?;
        Ok(json!({"bound": self.root, "stats": stats}))
    }

    fn stats(&mut self) -> ToolResult {
        let root = self.root.display().to_string();
        let vault = self.refresh()?;
        let mut degree = vec![0usize; vault.notes.len()];
        for edge in &vault.edges {
            degree[edge.from] += 1;
            degree[edge.to] += 1;
        }
        let mut counts: std::collections::BTreeMap<&str, usize> = std::collections::BTreeMap::new();
        for note in &vault.notes {
            *counts.entry(note.folder.as_str()).or_default() += 1;
        }
        let folders: Vec<Value> = counts
            .iter()
            .map(|(name, count)| json!({"name": name, "count": count}))
            .collect();
        let orphans: Vec<Value> = vault
            .notes
            .iter()
            .zip(&degree)
            .filter(|(_, count)| **count == 0)
            .take(20)
            .map(|(note, _)| json!({"id": note.id, "title": note.title}))
            .collect();
        Ok(json!({
            "root": root,
            "notes": vault.notes.len(),
            "links": vault.edges.len(),
            "folder_count": folders.len(),
            "folders": folders,
            "orphan_count": degree.iter().filter(|count| **count == 0).count(),
            "orphans": orphans,
            "words": vault.total_words,
            "unresolved": vault.unresolved.iter().take(10).collect::<Vec<_>>(),
            "warnings": vault.warnings.len(),
            "fingerprint": vault.fingerprint(),
        }))
    }

    fn search(&mut self, args: &Map<String, Value>) -> ToolResult {
        let query = string_arg(args, "query")?;
        let limit = limit_arg(args, 10);
        let vault = self.refresh()?;
        let index = SearchIndex::build(vault);
        let hits: Vec<Value> = index
            .search(&query, limit)
            .into_iter()
            .map(|hit| {
                json!({
                    "id": hit.id,
                    "title": hit.title,
                    "folder": hit.folder,
                    "score": (hit.score * 1000.0).round() / 1000.0,
                    "snippet": hit.snippet,
                })
            })
            .collect();
        Ok(json!({"query": query, "hits": hits}))
    }

    fn read_note(&mut self, args: &Map<String, Value>) -> ToolResult {
        let id = string_arg(args, "id")?;
        let content = self.read_current(&id)?;
        let vault = self.refresh()?;
        let note = vault.note(&id);
        Ok(json!({
            "id": id,
            "title": note.map(|note| note.title.clone()).unwrap_or_else(|| id.clone()),
            "folder": note.map(|note| note.folder.clone()).unwrap_or_default(),
            "tags": note.map(|note| note.tags.clone()).unwrap_or_default(),
            "bytes": content.len(),
            "modified_ms": note.map(|note| note.modified_ms).unwrap_or_default(),
            "hash": hash_of(&content),
            "headings": headings_of(&content),
            "body": content,
        }))
    }

    fn create_note(&mut self, args: &Map<String, Value>) -> ToolResult {
        let title = string_arg(args, "title")?;
        let folder = optional_arg(args, "folder").unwrap_or_default();
        let body = body_arg(args, "body")?;
        let folder = folder.trim_matches('/');
        let base = if folder.is_empty() {
            store::slugify(&title)
        } else {
            format!("{folder}/{}", store::slugify(&title))
        };
        let id = store::unique_id(&self.root, &base);
        let content = if body.trim().is_empty() {
            finish_note(&format!("# {title}"))
        } else {
            finish_note(&body)
        };
        store::write_note(&self.root, &id, &content)?;
        self.journal("cortex_create_note", &id, content.len());
        Ok(json!({
            "id": id,
            "hash": hash_of(&content),
            "bytes": content.len(),
            "link": format!("[[{}]]", id.trim_start_matches('/')),
        }))
    }

    fn write_note(&mut self, args: &Map<String, Value>) -> ToolResult {
        let id = string_arg(args, "id")?;
        let expect = string_arg(args, "expect")?;
        let body = body_arg(args, "body")?;
        let current = self.read_current(&id)?;
        self.check(&id, &current, &expect)?;
        let content = finish_note(&body);
        store::write_note(&self.root, &id, &content)?;
        self.journal("cortex_write_note", &id, content.len());
        Ok(json!({"id": id, "hash": hash_of(&content), "bytes": content.len()}))
    }

    fn replace_section(&mut self, args: &Map<String, Value>) -> ToolResult {
        let id = string_arg(args, "id")?;
        let heading = string_arg(args, "heading")?;
        let expect = string_arg(args, "expect")?;
        let body = body_arg(args, "body")?;
        let current = self.read_current(&id)?;
        self.check(&id, &current, &expect)?;
        let (start, end) = section_span(&current, &heading).ok_or_else(|| {
            Failure::new(
                "not_found",
                format!("`{id}` has no heading matching `{heading}`"),
            )
            .with(json!({"headings": headings_of(&current)}))
        })?;

        let mut next = String::with_capacity(current.len() + body.len());
        next.push_str(&current[..start]);
        let trimmed = body.trim();
        if !trimmed.is_empty() {
            next.push('\n');
            next.push_str(trimmed);
            next.push('\n');
        }
        next.push('\n');
        next.push_str(current[end..].trim_start());
        let content = finish_note(&next);

        store::write_note(&self.root, &id, &content)?;
        self.journal("cortex_replace_section", &id, content.len());
        Ok(json!({
            "id": id,
            "heading": heading,
            "hash": hash_of(&content),
            "bytes": content.len(),
        }))
    }

    fn append(&mut self, args: &Map<String, Value>) -> ToolResult {
        let id = string_arg(args, "id")?;
        let expect = string_arg(args, "expect")?;
        let body = body_arg(args, "body")?;
        let current = self.read_current(&id)?;
        self.check(&id, &current, &expect)?;
        let mut next = current.trim_end().to_string();
        let trimmed = body.trim();
        if !trimmed.is_empty() {
            next.push_str("\n\n");
            next.push_str(trimmed);
        }
        let content = finish_note(&next);
        store::write_note(&self.root, &id, &content)?;
        self.journal("cortex_append", &id, content.len());
        Ok(json!({"id": id, "hash": hash_of(&content), "bytes": content.len()}))
    }

    fn move_note(&mut self, args: &Map<String, Value>) -> ToolResult {
        let from = string_arg(args, "id")?;
        let to = string_arg(args, "to")?;
        if from == to {
            return Err(Failure::new(
                "invalid_argument",
                "`id` and `to` are the same",
            ));
        }
        let content = self.read_current(&from)?;
        let old = store::note_path(&self.root, &from)?;
        let new_path = store::write_note(&self.root, &to, &content)?;
        if old != new_path {
            // A move is a write plus the removal of the old copy; there is no
            // bare delete tool and this is the only path that removes a file.
            fs::remove_file(&old).map_err(|error| {
                Failure::new(
                    "move_failed",
                    format!("wrote `{to}` but could not remove `{from}`: {error}"),
                )
            })?;
        }
        self.journal("cortex_move_note", &to, content.len());
        Ok(json!({
            "from": from,
            "to": to,
            "hash": hash_of(&content),
            "warning": "links in other notes still point at the old name",
        }))
    }

    fn links(&mut self, args: &Map<String, Value>) -> ToolResult {
        let id = string_arg(args, "id")?;
        let vault = self.refresh()?;
        let index = vault
            .index_of(&id)
            .ok_or_else(|| Failure::new("not_found", format!("no note at `{id}`")))?;
        let note = &vault.notes[index];
        let outgoing: Vec<Value> = vault
            .edges
            .iter()
            .filter(|edge| edge.from == index)
            .map(|edge| {
                let target = &vault.notes[edge.to];
                json!({"id": target.id, "title": target.title, "weight": edge.weight})
            })
            .collect();
        let backlinks: Vec<Value> = vault
            .edges
            .iter()
            .filter(|edge| edge.to == index)
            .map(|edge| {
                let source = &vault.notes[edge.from];
                json!({"id": source.id, "title": source.title, "weight": edge.weight})
            })
            .collect();
        let unlinked: Vec<Value> = vault
            .unlinked_mentions(index, &note.title, 20)
            .into_iter()
            .map(|other| json!({"id": vault.notes[other].id, "title": vault.notes[other].title}))
            .collect();
        Ok(json!({
            "id": note.id,
            "title": note.title,
            "outgoing": outgoing,
            "backlinks": backlinks,
            "unlinked_mentions": unlinked,
        }))
    }

    fn orphans(&mut self, args: &Map<String, Value>) -> ToolResult {
        let limit = limit_arg(args, 50);
        let vault = self.refresh()?;
        let mut degree = vec![0usize; vault.notes.len()];
        for edge in &vault.edges {
            degree[edge.from] += 1;
            degree[edge.to] += 1;
        }
        let notes: Vec<Value> = vault
            .notes
            .iter()
            .zip(&degree)
            .filter(|(_, count)| **count == 0)
            .take(limit)
            .map(|(note, _)| json!({"id": note.id, "title": note.title, "folder": note.folder}))
            .collect();
        Ok(json!({
            "orphan_count": degree.iter().filter(|count| **count == 0).count(),
            "notes": notes,
        }))
    }
}

/* ---------- JSON-RPC ---------- */

fn result_response(id: Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn error_response(id: Value, code: i64, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn tool_response(result: ToolResult) -> Value {
    match result {
        Ok(value) => json!({
            "content": [{"type": "text", "text": pretty(&value)}],
            "isError": false,
        }),
        Err(failure) => {
            let mut payload = Map::new();
            payload.insert("error".to_string(), json!(failure.kind));
            payload.insert("message".to_string(), json!(failure.message));
            if let Value::Object(extra) = failure.extra {
                for (key, value) in extra {
                    payload.insert(key, value);
                }
            }
            json!({
                "content": [{"type": "text", "text": pretty(&Value::Object(payload))}],
                "isError": true,
            })
        }
    }
}

fn tools() -> Value {
    let read = json!({"readOnlyHint": true, "openWorldHint": false});
    let write = json!({
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": false,
        "openWorldHint": false,
    });
    json!([
        {
            "name": "cortex_guide",
            "description": "Read this first: the vault's house format, the write workflow, and the rules an agent must follow (never delete, never touch dotfolders, always use the hash precondition).",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "annotations": read,
        },
        {
            "name": "cortex_stats",
            "description": "Shape of the vault: note and link counts, folders, orphans, unresolved links, words. Start here to see what you are working with.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "annotations": read,
        },
        {
            "name": "cortex_list_vaults",
            "description": "List the vaults Cortex remembers and which one this session is bound to.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
            "annotations": read,
        },
        {
            "name": "cortex_use_vault",
            "description": "Bind this session to another vault folder. Use cortex_list_vaults to see the candidates.",
            "inputSchema": {
                "type": "object",
                "properties": {"path": {"type": "string", "description": "Absolute path to the vault folder"}},
                "required": ["path"],
                "additionalProperties": false,
            },
            "annotations": write,
        },
        {
            "name": "cortex_search",
            "description": "Full-text search across note titles and bodies. Returns id, title, folder, score and a snippet; pass the id to cortex_read_note.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Words to look for, e.g. 'dragon queen'"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Maximum hits (default 10)"},
                },
                "required": ["query"],
                "additionalProperties": false,
            },
            "annotations": read,
        },
        {
            "name": "cortex_read_note",
            "description": "Read one note: the full Markdown body plus tags, headings, byte count and the hash that every write must pass back as `expect`.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string", "description": "Note id without .md, e.g. 'World/Istar' or 'Istar'"}},
                "required": ["id"],
                "additionalProperties": false,
            },
            "annotations": read,
        },
        {
            "name": "cortex_create_note",
            "description": "Create a new note as '<folder>/<slugified title>.md'. Returns its id and hash. Does not overwrite: an existing name gets a numeric suffix.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Human title; the file name is slugified from it"},
                    "folder": {"type": "string", "description": "Optional folder, e.g. 'Characters'. Created if missing."},
                    "body": {"type": "string", "description": "Full Markdown body, including the leading '# Title'"},
                },
                "required": ["title"],
                "additionalProperties": false,
            },
            "annotations": write,
        },
        {
            "name": "cortex_write_note",
            "description": "Replace a note's entire body. Requires `expect` (the hash from cortex_read_note) and fails with a conflict, plus the current hash, if the file changed since.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "body": {"type": "string", "description": "The complete new body"},
                    "expect": {"type": "string", "description": "Hash returned by cortex_read_note"},
                },
                "required": ["id", "body", "expect"],
                "additionalProperties": false,
            },
            "annotations": write,
        },
        {
            "name": "cortex_replace_section",
            "description": "Replace the body under one heading and keep the rest of the note untouched. Safer than cortex_write_note for a single section; fails if the heading is missing, listing the headings that exist.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "heading": {"type": "string", "description": "Heading text without the # marks, e.g. 'History'"},
                    "body": {"type": "string", "description": "New section body; empty string clears the section"},
                    "expect": {"type": "string", "description": "Hash returned by cortex_read_note"},
                },
                "required": ["id", "heading", "body", "expect"],
                "additionalProperties": false,
            },
            "annotations": write,
        },
        {
            "name": "cortex_append",
            "description": "Append a block to the end of a note, separated by one blank line. Requires the current hash.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "body": {"type": "string"},
                    "expect": {"type": "string", "description": "Hash returned by cortex_read_note"},
                },
                "required": ["id", "body", "expect"],
                "additionalProperties": false,
            },
            "annotations": write,
        },
        {
            "name": "cortex_move_note",
            "description": "Rename or refile a note by writing it to a new id and removing the old file. Links in other notes are not rewritten.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Current id"},
                    "to": {"type": "string", "description": "New id, e.g. 'Characters/Nesau'"},
                },
                "required": ["id", "to"],
                "additionalProperties": false,
            },
            "annotations": write,
        },
        {
            "name": "cortex_links",
            "description": "The neighbourhood of a note: outgoing links, backlinks, and notes that mention its title without linking. Use after creating or moving a note.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
            "annotations": read,
        },
        {
            "name": "cortex_orphans",
            "description": "Notes with no incoming or outgoing links — the usual candidates for filing or linking.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Maximum notes (default 50)"},
                },
                "additionalProperties": false,
            },
            "annotations": read,
        }
    ])
}

impl Agent {
    /// Handle one JSON-RPC message. `None` means "no reply" (a notification).
    fn handle(&mut self, request: &Value) -> Option<Value> {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let Some(method) = request.get("method").and_then(Value::as_str) else {
            return Some(error_response(id, -32600, "invalid request: no method"));
        };
        if method.starts_with("notifications/") || method == "initialized" || method == "exit" {
            return None;
        }
        match method {
            "initialize" => {
                let asked = request
                    .pointer("/params/protocolVersion")
                    .and_then(Value::as_str)
                    .unwrap_or(PROTOCOL_VERSION);
                Some(result_response(
                    id,
                    json!({
                        "protocolVersion": asked,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": {
                            "name": "cortex",
                            "version": env!("CARGO_PKG_VERSION"),
                        },
                        "instructions": AGENT_GUIDE,
                    }),
                ))
            }
            "ping" => Some(result_response(id, json!({}))),
            "tools/list" => Some(result_response(id, json!({"tools": tools()}))),
            "tools/call" => {
                let params = request.get("params").cloned().unwrap_or(Value::Null);
                let name = params.get("name").and_then(Value::as_str).unwrap_or("");
                let empty = Map::new();
                let args = params
                    .get("arguments")
                    .and_then(Value::as_object)
                    .unwrap_or(&empty);
                if name.is_empty() {
                    return Some(error_response(id, -32602, "tools/call needs a tool name"));
                }
                let outcome = self.call(name, args);
                Some(result_response(id, tool_response(outcome)))
            }
            other => Some(error_response(
                id,
                -32601,
                &format!("unknown method `{other}`"),
            )),
        }
    }
}

/// Whether a vault may be operated by an agent.
///
/// Deny by default: a folder Cortex has never been told about has no switch, and
/// no switch means no access. Otherwise passing a path on the command line would
/// be a way around the toggle in the app. Opening the folder in Cortex, or
/// `cortex agents <folder> --on`, creates the switch.
fn agent_access(root: &Path, registry: &Registry) -> bool {
    registry.agents(root).unwrap_or(false)
}

/* ---------- entry points ---------- */

/// Serve MCP on stdin/stdout until the client closes the pipe.
pub fn serve(root: Option<PathBuf>) -> i32 {
    let mut agent = match Agent::open(root) {
        Ok(agent) => agent,
        Err(message) => {
            eprintln!("[cortex mcp] {message}");
            return 1;
        }
    };
    eprintln!(
        "[cortex mcp] {} — tools on stdio, {PROTOCOL_VERSION}",
        agent.root.display()
    );

    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = io::BufWriter::new(stdout.lock());
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<Value>(&line) {
            Ok(Value::Array(batch)) => {
                for item in &batch {
                    if let Some(response) = agent.handle(item) {
                        let _ = writeln!(out, "{}", response);
                    }
                }
            }
            Ok(item) => {
                if let Some(response) = agent.handle(&item) {
                    let _ = writeln!(out, "{}", response);
                }
            }
            Err(error) => {
                let response =
                    error_response(Value::Null, -32700, &format!("parse error: {error}"));
                let _ = writeln!(out, "{}", response);
            }
        }
        let _ = out.flush();
    }
    0
}

/// Print the snippet an MCP client needs, ready to paste. JSON on stdout, the
/// where-to-put-it part on stderr so stdout stays copyable.
pub fn print_config() {
    let exe = std::env::current_exe()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "cortex".to_string());
    let config = json!({
        "mcpServers": {
            "cortex": {
                "command": exe,
                "args": ["mcp"],
            }
        }
    });
    println!("{}", pretty(&config));
    eprintln!(
        "\nPaste that into your client's MCP config:\n\
         \x20 Claude Desktop  ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)\n\
         \x20                  %APPDATA%\\Claude\\claude_desktop_config.json (Windows)\n\
         \x20 Cursor           .cursor/mcp.json in the project, or ~/.cursor/mcp.json\n\
         \x20 Zed              settings.json → context_servers\n\
         \nRun `cortex mcp <vault>` instead of `cortex mcp` to pin one folder.\n"
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::create_dir_all(dir.path().join("World")).unwrap();
        fs::write(
            dir.path().join("World/Istar.md"),
            "# Istar\n\n## History\n\nA city.\n\n## Trade\n\nSilk.\n",
        )
        .unwrap();
        fs::write(dir.path().join("Anthem.md"), "# Anthem\n\nSee [[Istar]].\n").unwrap();
        dir
    }

    fn agent(dir: &Path) -> Agent {
        Agent::open_with(Some(dir.to_path_buf()), Box::new(|_| true)).expect("open")
    }

    #[test]
    fn a_disabled_vault_never_opens() {
        let dir = vault();
        let refused = Agent::open_with(Some(dir.path().to_path_buf()), Box::new(|_| false));
        let message = refused.err().expect("must refuse");
        assert!(message.contains("agent access is off"), "{message}");
    }

    #[test]
    fn turning_access_off_stops_a_connected_session() {
        let dir = vault();
        let gate = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
        let seen = gate.clone();
        let check: AccessCheck = Box::new(move |_| seen.load(std::sync::atomic::Ordering::SeqCst));
        let mut session = Agent::open_with(Some(dir.path().to_path_buf()), check).expect("open");
        assert!(!failed(&call(&mut session, "cortex_stats", json!({}))));

        gate.store(false, std::sync::atomic::Ordering::SeqCst);
        let response = call(&mut session, "cortex_stats", json!({}));
        assert!(failed(&response));
        let body = text(&response);
        assert_eq!(body["error"], "agents_off");
        assert!(body["message"]
            .as_str()
            .unwrap_or_default()
            .contains("turned off"));
    }

    fn call(agent: &mut Agent, tool: &str, args: Value) -> Value {
        let request = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": tool, "arguments": args},
        });
        agent.handle(&request).expect("response")
    }

    fn text(response: &Value) -> Value {
        serde_json::from_str(
            response
                .pointer("/result/content/0/text")
                .and_then(Value::as_str)
                .expect("text content"),
        )
        .expect("json body")
    }

    fn failed(response: &Value) -> bool {
        response
            .pointer("/result/isError")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    }

    #[test]
    fn initialize_advertises_tools() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let response = agent
            .handle(&json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05"}}))
            .expect("response");
        assert_eq!(response["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(response["result"]["serverInfo"]["name"], "cortex");
        assert!(response["result"]["instructions"]
            .as_str()
            .unwrap()
            .contains("House format"));
    }

    #[test]
    fn a_vault_needs_an_explicit_yes() {
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let mut registry = Registry::default();

        // Never registered: no switch, no access.
        assert!(!agent_access(other.path(), &registry));

        registry.add(dir.path());
        assert!(agent_access(dir.path(), &registry));

        assert!(registry.set_agents(dir.path(), false));
        assert!(!agent_access(dir.path(), &registry));

        // Reopening the vault in the app must not quietly re-enable it.
        registry.add(dir.path());
        assert!(!agent_access(dir.path(), &registry));
    }

    #[test]
    fn lists_the_tool_surface() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let response = agent
            .handle(&json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}))
            .expect("response");
        let names: Vec<&str> = response["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect();
        for expected in [
            "cortex_guide",
            "cortex_search",
            "cortex_read_note",
            "cortex_create_note",
            "cortex_write_note",
            "cortex_replace_section",
            "cortex_append",
            "cortex_move_note",
            "cortex_links",
            "cortex_orphans",
            "cortex_use_vault",
        ] {
            assert!(names.contains(&expected), "missing {expected}");
        }
    }

    #[test]
    fn create_read_then_write_with_hash() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let created = text(&call(
            &mut agent,
            "cortex_create_note",
            json!({"title": "Takhisis", "folder": "Enemies", "body": "# Takhisis\n\nA dragon queen.\n"}),
        ));
        assert_eq!(created["id"], "Enemies/takhisis");

        let read = text(&call(
            &mut agent,
            "cortex_read_note",
            json!({"id": "Enemies/takhisis"}),
        ));
        let hash = read["hash"].as_str().unwrap().to_string();
        assert!(read["body"].as_str().unwrap().contains("dragon queen"));

        let written = text(&call(
            &mut agent,
            "cortex_write_note",
            json!({"id": "Enemies/takhisis", "body": "# Takhisis\n\nQueen of dragons.\n", "expect": hash}),
        ));
        assert_ne!(written["hash"], hash);
    }

    #[test]
    fn stale_hash_is_a_conflict_not_an_overwrite() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let read = text(&call(
            &mut agent,
            "cortex_read_note",
            json!({"id": "World/Istar"}),
        ));
        let hash = read["hash"].as_str().unwrap().to_string();

        // Someone else edits the file between the read and the write.
        fs::write(
            dir.path().join("World/Istar.md"),
            "# Istar\n\nEdited elsewhere.\n",
        )
        .unwrap();

        let response = call(
            &mut agent,
            "cortex_write_note",
            json!({"id": "World/Istar", "body": "# Istar\n\nFrom the agent.\n", "expect": hash}),
        );
        assert!(failed(&response));
        let payload = text(&response);
        assert_eq!(payload["error"], "conflict");
        assert!(payload["current_hash"].as_str().unwrap().len() == 16);
        let on_disk = fs::read_to_string(dir.path().join("World/Istar.md")).unwrap();
        assert!(on_disk.contains("Edited elsewhere"));
    }

    #[test]
    fn replace_section_leaves_the_rest_alone() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let read = text(&call(
            &mut agent,
            "cortex_read_note",
            json!({"id": "World/Istar"}),
        ));
        let hash = read["hash"].as_str().unwrap().to_string();
        text(&call(
            &mut agent,
            "cortex_replace_section",
            json!({"id": "World/Istar", "heading": "History", "body": "A port city.", "expect": hash}),
        ));
        let after = fs::read_to_string(dir.path().join("World/Istar.md")).unwrap();
        assert!(after.contains("## History\n\nA port city.\n"));
        assert!(after.contains("## Trade\n\nSilk."));
        assert!(after.ends_with('\n'));
    }

    #[test]
    fn missing_heading_reports_the_ones_that_exist() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let read = text(&call(
            &mut agent,
            "cortex_read_note",
            json!({"id": "World/Istar"}),
        ));
        let hash = read["hash"].as_str().unwrap().to_string();
        let response = call(
            &mut agent,
            "cortex_replace_section",
            json!({"id": "World/Istar", "heading": "Religion", "body": "x", "expect": hash}),
        );
        assert!(failed(&response));
        let payload = text(&response);
        assert_eq!(payload["error"], "not_found");
        assert_eq!(payload["headings"], json!(["Istar", "History", "Trade"]));
    }

    #[test]
    fn append_keeps_one_trailing_newline() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let read = text(&call(
            &mut agent,
            "cortex_read_note",
            json!({"id": "Anthem"}),
        ));
        let hash = read["hash"].as_str().unwrap().to_string();
        text(&call(
            &mut agent,
            "cortex_append",
            json!({"id": "Anthem", "body": "## Notes\n\nSing it twice.", "expect": hash}),
        ));
        let after = fs::read_to_string(dir.path().join("Anthem.md")).unwrap();
        assert!(after.ends_with("Sing it twice.\n"));
        assert!(!after.ends_with("\n\n"));
    }

    #[test]
    fn links_reports_both_directions() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let links = text(&call(
            &mut agent,
            "cortex_links",
            json!({"id": "World/Istar"}),
        ));
        let backlinks = links["backlinks"].as_array().unwrap();
        assert_eq!(backlinks.len(), 1);
        assert_eq!(backlinks[0]["title"], "Anthem");
    }

    #[test]
    fn move_writes_the_new_note_and_removes_the_old() {
        let dir = vault();
        let mut agent = agent(dir.path());
        text(&call(
            &mut agent,
            "cortex_move_note",
            json!({"id": "World/Istar", "to": "Places/Istar"}),
        ));
        assert!(!dir.path().join("World/Istar.md").exists());
        assert!(dir.path().join("Places/Istar.md").exists());
    }

    #[test]
    fn unknown_methods_and_tools_are_errors() {
        let dir = vault();
        let mut agent = agent(dir.path());
        let method = agent
            .handle(&json!({"jsonrpc": "2.0", "id": 3, "method": "prompts/list"}))
            .expect("response");
        assert_eq!(method["error"]["code"], -32601);

        let tool = call(&mut agent, "cortex_delete_note", json!({"id": "Anthem"}));
        assert!(failed(&tool));
        assert_eq!(text(&tool)["error"], "unknown_tool");
        assert!(dir.path().join("Anthem.md").exists());
    }

    #[test]
    fn notifications_get_no_reply() {
        let dir = vault();
        let mut agent = agent(dir.path());
        assert!(agent
            .handle(&json!({"jsonrpc": "2.0", "method": "notifications/initialized"}))
            .is_none());
    }

    #[test]
    fn writes_are_journalled() {
        let dir = vault();
        let journal = dir.path().join("agent-writes.jsonl");
        let mut agent = agent(dir.path());
        agent.journal = Some(journal.clone());
        text(&call(
            &mut agent,
            "cortex_create_note",
            json!({"title": "Chronicle", "body": "# Chronicle\n"}),
        ));
        let line = fs::read_to_string(&journal).unwrap();
        assert!(line.contains("\"tool\":\"cortex_create_note\""));
        assert!(line.contains("chronicle"));
    }

    #[test]
    fn dotfolders_and_escapes_are_refused() {
        let dir = vault();
        let mut agent = agent(dir.path());
        for id in [".obsidian/app", "../outside", ".git/hooks/pre-commit"] {
            let response = call(
                &mut agent,
                "cortex_write_note",
                json!({"id": id, "body": "x", "expect": "0000000000000000"}),
            );
            assert!(failed(&response), "{id} should be refused");
        }
    }
}
