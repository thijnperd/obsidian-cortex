//! Remembered vaults.
//!
//! A one-file registry so `cortex` can offer a picker on launch instead of
//! demanding a path every time. It stores paths only — never note contents.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const MAX_VAULTS: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultEntry {
    pub path: PathBuf,
    #[serde(default)]
    pub name: String,
    /// Milliseconds since the epoch, used only for ordering.
    #[serde(default)]
    pub opened_ms: u64,
    /// Whether AI clients may operate this vault over MCP. Off is a deliberate
    /// choice the user can make in vault settings; files written before the
    /// switch existed keep working, hence the default.
    #[serde(default = "agents_default")]
    pub agents: bool,
}

fn agents_default() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Registry {
    #[serde(default)]
    pub vaults: Vec<VaultEntry>,
    #[serde(default)]
    pub active: Option<PathBuf>,
}

impl Registry {
    pub fn load() -> Registry {
        config_path()
            .map(|path| Registry::load_from(&path))
            .unwrap_or_default()
    }

    pub fn load_from(path: &Path) -> Registry {
        let Ok(raw) = fs::read(path) else {
            return Registry::default();
        };
        serde_json::from_slice(&raw).unwrap_or_default()
    }

    pub fn save(&self) -> std::io::Result<()> {
        match config_path() {
            Some(path) => self.save_to(&path),
            None => Ok(()),
        }
    }

    pub fn save_to(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_vec_pretty(self).unwrap_or_else(|_| b"{}".to_vec());
        let temp = path.with_extension("json.tmp");
        fs::write(&temp, json)?;
        crate::replace_file(&temp, path)
    }

    /// Adds or refreshes a vault and makes it the active one. The agent switch
    /// survives: reopening a vault must not quietly turn access back on.
    pub fn add(&mut self, path: &Path) -> VaultEntry {
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let agents = self
            .get(&canonical)
            .map(|entry| entry.agents)
            .unwrap_or(true);
        let entry = VaultEntry {
            name: name_for(&canonical),
            path: canonical.clone(),
            opened_ms: now_ms(),
            agents,
        };
        self.vaults.retain(|existing| existing.path != canonical);
        self.vaults.insert(0, entry.clone());
        self.vaults.truncate(MAX_VAULTS);
        self.active = Some(canonical);
        entry
    }

    pub fn remove(&mut self, path: &Path) {
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        self.vaults.retain(|entry| entry.path != canonical);
        if self.active.as_deref() == Some(canonical.as_path()) {
            self.active = self.vaults.first().map(|entry| entry.path.clone());
        }
    }

    /// Most recently opened first.
    pub fn recent(&self) -> Vec<&VaultEntry> {
        let mut entries: Vec<&VaultEntry> = self.vaults.iter().collect();
        entries.sort_by(|a, b| b.opened_ms.cmp(&a.opened_ms).then(a.name.cmp(&b.name)));
        entries
    }

    pub fn get(&self, path: &Path) -> Option<&VaultEntry> {
        self.vaults.iter().find(|entry| entry.path == path)
    }

    /// The agent switch for a vault, or `None` when the folder is not one of
    /// ours (in which case the caller decides; MCP allows it, because pointing
    /// a client at a folder by hand is itself the opt-in).
    pub fn agents(&self, path: &Path) -> Option<bool> {
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        self.get(&canonical).map(|entry| entry.agents)
    }

    /// Flips the agent switch. Returns false when the vault is unknown.
    pub fn set_agents(&mut self, path: &Path, enabled: bool) -> bool {
        let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        match self.vaults.iter_mut().find(|entry| entry.path == canonical) {
            Some(entry) => {
                entry.agents = enabled;
                true
            }
            None => false,
        }
    }
}

/// `$CORTEX_CONFIG_DIR`, else the platform convention.
pub fn config_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CORTEX_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join("vaults.json"));
    }
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else if cfg!(target_os = "macos") {
        std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Library/Application Support"))
    } else {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
    }?;
    Some(base.join("cortex").join("vaults.json"))
}

/// Expands `~`, trims quotes and whitespace. Returns `None` for empty input.
/// The path is not required to exist yet; callers validate that.
pub fn expand(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim().trim_matches('"').trim_matches('\'').trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed == "~" || trimmed.starts_with("~/") || trimmed.starts_with("~\\") {
        let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
        let rest = trimmed
            .trim_start_matches('~')
            .trim_start_matches(['/', '\\']);
        let mut path = PathBuf::from(home);
        if !rest.is_empty() {
            path.push(rest);
        }
        return Some(path);
    }
    Some(PathBuf::from(trimmed))
}

pub fn name_for(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.replace(['-', '_'], " "))
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Vault".to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adding_twice_keeps_one_entry() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = Registry::default();
        registry.add(dir.path());
        registry.add(dir.path());
        assert_eq!(registry.vaults.len(), 1);
        assert_eq!(
            registry.active.as_deref(),
            Some(dir.path().canonicalize().unwrap().as_path())
        );
    }

    #[test]
    fn recent_orders_by_opened_time() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut registry = Registry::default();
        registry.add(a.path());
        std::thread::sleep(std::time::Duration::from_millis(5));
        registry.add(b.path());
        assert_eq!(registry.recent()[0].path, b.path().canonicalize().unwrap());
    }

    #[test]
    fn removes_and_reassigns_active() {
        let a = tempfile::tempdir().unwrap();
        let b = tempfile::tempdir().unwrap();
        let mut registry = Registry::default();
        registry.add(a.path());
        registry.add(b.path());
        registry.remove(b.path());
        assert_eq!(registry.vaults.len(), 1);
        assert_eq!(registry.active, Some(a.path().canonicalize().unwrap()));
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested/vaults.json");
        let mut registry = Registry::default();
        registry.add(dir.path());
        registry.save_to(&file).unwrap();
        let loaded = Registry::load_from(&file);
        assert_eq!(loaded.vaults.len(), 1);
        assert_eq!(loaded.vaults[0].path, registry.vaults[0].path);
    }

    #[test]
    fn agent_access_is_on_by_default_and_survives_reopening() {
        let dir = tempfile::tempdir().unwrap();
        let mut registry = Registry::default();
        let entry = registry.add(dir.path());
        assert!(entry.agents);
        assert_eq!(registry.agents(dir.path()), Some(true));

        assert!(registry.set_agents(dir.path(), false));
        registry.add(dir.path());
        assert_eq!(registry.agents(dir.path()), Some(false));

        let file = dir.path().join("vaults.json");
        registry.save_to(&file).unwrap();
        assert_eq!(Registry::load_from(&file).agents(dir.path()), Some(false));
    }

    #[test]
    fn unknown_vaults_have_no_agent_switch() {
        let known = tempfile::tempdir().unwrap();
        let unknown = tempfile::tempdir().unwrap();
        let mut registry = Registry::default();
        registry.add(known.path());
        assert_eq!(registry.agents(unknown.path()), None);
        assert!(!registry.set_agents(unknown.path(), false));
    }

    #[test]
    fn corrupt_registry_is_empty_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("vaults.json");
        fs::write(&file, b"not json").unwrap();
        assert!(Registry::load_from(&file).vaults.is_empty());
    }

    #[test]
    fn expands_tilde_and_rejects_blank() {
        std::env::set_var("HOME", "/home/tester");
        assert_eq!(expand("~"), Some(PathBuf::from("/home/tester")));
        assert_eq!(
            expand("~/Notes/"),
            Some(PathBuf::from("/home/tester/Notes"))
        );
        assert_eq!(expand("   "), None);
        assert_eq!(expand(""), None);
    }
}
