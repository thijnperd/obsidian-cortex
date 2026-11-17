//! MCP setup: the snippet a client needs, the two configs we may write, and a
//! real handshake test.
//!
//! The handshake matters more than the snippet: it is the only way to tell
//! "configured" from "works", and it names the agent switch when it refuses.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use cortex_core::registry;

use crate::version;

pub fn binary() -> PathBuf {
    std::env::current_exe().unwrap_or_else(|_| PathBuf::from("cortex"))
}

/// The exact JSON a client needs, with this binary and this vault.
pub fn snippet(vault: &Path) -> Value {
    let mut args = vec![json!("mcp")];
    args.push(json!(vault.display().to_string()));
    json!({
        "mcpServers": {
            "cortex": {
                "command": binary().display().to_string(),
                "args": args,
            }
        }
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct ClientStatus {
    pub name: &'static str,
    pub path: Option<String>,
    /// The folder that would hold the config exists, so a write is meaningful.
    pub present: bool,
    /// The config already mentions a server called cortex.
    pub configured: bool,
}

pub struct Client {
    pub name: &'static str,
    pub path: Option<PathBuf>,
}

pub fn clients() -> Vec<Client> {
    vec![
        Client {
            name: "Claude Desktop",
            path: claude_config(),
        },
        Client {
            name: "Cursor",
            path: home().map(|home| home.join(".cursor").join("mcp.json")),
        },
    ]
}

pub fn status(vault: &Path) -> Vec<ClientStatus> {
    clients()
        .into_iter()
        .map(|client| {
            let present = client
                .path
                .as_ref()
                .and_then(|path| path.parent())
                .map(Path::is_dir)
                .unwrap_or(false);
            let configured = client
                .path
                .as_ref()
                .and_then(|path| std::fs::read(path).ok())
                .map(|raw| mentions_cortex(&raw, vault))
                .unwrap_or(false);
            ClientStatus {
                name: client.name,
                path: client.path.map(|path| path.display().to_string()),
                present,
                configured,
            }
        })
        .collect()
}

fn mentions_cortex(raw: &[u8], vault: &Path) -> bool {
    let Ok(value) = serde_json::from_slice::<Value>(raw) else {
        return false;
    };
    let needle = vault.display().to_string();
    value
        .pointer("/mcpServers/cortex/args")
        .and_then(Value::as_array)
        .map(|args| args.iter().any(|arg| arg.as_str() == Some(needle.as_str())))
        .unwrap_or(false)
}

#[derive(Debug)]
pub enum Outcome {
    Written(PathBuf),
    Skipped(String),
    Failed(String),
}

impl Outcome {
    pub fn describe(&self) -> String {
        match self {
            Outcome::Written(path) => format!("wrote {}", path.display()),
            Outcome::Skipped(why) => format!("skipped: {why}"),
            Outcome::Failed(why) => format!("failed: {why}"),
        }
    }
}

/// Merge `mcpServers.cortex` into one client config.
///
/// Only plain JSON is touched, the original is backed up, and every other key
/// survives. A config we cannot parse is left alone rather than rewritten.
pub fn write_client(client: &Client, vault: &Path) -> Outcome {
    let Some(path) = &client.path else {
        return Outcome::Skipped("no known config path on this platform".into());
    };
    let Some(parent) = path.parent() else {
        return Outcome::Skipped("config has no parent folder".into());
    };
    if !parent.is_dir() {
        return Outcome::Skipped(format!("{} does not exist", parent.display()));
    }
    let mut root: Value = match std::fs::read(path) {
        Ok(raw) => match serde_json::from_slice(&raw) {
            Ok(value) => value,
            Err(_) => {
                return Outcome::Failed(format!(
                    "{} is not plain JSON; leaving it alone",
                    path.display()
                ))
            }
        },
        Err(_) => json!({}),
    };
    let Some(object) = root.as_object_mut() else {
        return Outcome::Failed("top-level value is not an object".into());
    };
    let servers = object.entry("mcpServers").or_insert_with(|| json!({}));
    let Some(servers) = servers.as_object_mut() else {
        return Outcome::Failed("mcpServers is not an object".into());
    };
    let Some(entry) = snippet(vault).pointer("/mcpServers/cortex").cloned() else {
        return Outcome::Failed("could not build the snippet".into());
    };
    servers.insert("cortex".to_string(), entry);

    if path.exists() {
        let backup = path.with_extension("json.cortex-backup");
        if let Err(error) = std::fs::copy(path, &backup) {
            return Outcome::Failed(format!("could not back up {}: {error}", path.display()));
        }
    }
    let pretty = serde_json::to_vec_pretty(&root).unwrap_or_default();
    let temp = path.with_extension("json.tmp");
    if let Err(error) = std::fs::write(&temp, pretty) {
        return Outcome::Failed(format!("could not write {}: {error}", path.display()));
    }
    #[cfg(windows)]
    {
        let _ = std::fs::remove_file(path);
    }
    match std::fs::rename(&temp, path) {
        Ok(()) => Outcome::Written(path.clone()),
        Err(error) => Outcome::Failed(error.to_string()),
    }
}

// ---------- handshake ----------

pub struct Handshake {
    pub server: String,
    pub tools: Vec<String>,
}

/// Start `cortex mcp <vault>`, initialize it and list its tools.
///
/// This is exactly what the client does, so a success here means the snippet
/// works. A refusal (agent access off) comes back as the server's own message.
pub fn handshake(vault: &Path) -> Result<Handshake, String> {
    let mut child = Command::new(binary())
        .arg("mcp")
        .arg(vault)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start cortex mcp: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or("could not open the server's stdin")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("could not open the server's stdout")?;
    let mut stderr = child.stderr.take();

    let (sender, receiver) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    let initialize = json!({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": { "name": "cortex-doctor", "version": version::VERSION },
        }
    });
    let ready = json!({"jsonrpc": "2.0", "method": "notifications/initialized"});
    let list = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"});
    writeln!(stdin, "{initialize}")
        .and_then(|_| writeln!(stdin, "{ready}"))
        .and_then(|_| writeln!(stdin, "{list}"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("could not talk to cortex mcp: {error}"))?;

    let mut server = None;
    let mut tools = None;
    let deadline = Instant::now() + Duration::from_secs(10);
    while server.is_none() || tools.is_none() {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            break;
        }
        let Ok(line) = receiver.recv_timeout(left) else {
            break;
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(error) = value.get("error") {
            let message = error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("the server returned an error");
            let _ = child.kill();
            let _ = child.wait();
            return Err(message.to_string());
        }
        match value.get("id").and_then(Value::as_u64) {
            Some(1) => {
                server = value
                    .pointer("/result/serverInfo/version")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .or_else(|| Some(version::VERSION.to_string()));
            }
            Some(2) => {
                tools = Some(
                    value
                        .pointer("/result/tools")
                        .and_then(Value::as_array)
                        .map(|tools| {
                            tools
                                .iter()
                                .filter_map(|tool| tool["name"].as_str().map(str::to_string))
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default(),
                );
            }
            _ => {}
        }
    }

    let _ = child.kill();
    let _ = child.wait();
    match (server, tools) {
        (Some(server), Some(tools)) if !tools.is_empty() => Ok(Handshake { server, tools }),
        _ => {
            let mut message = String::new();
            if let Some(stderr) = stderr.as_mut() {
                let _ = stderr.read_to_string(&mut message);
            }
            let message = message.trim();
            Err(if message.is_empty() {
                "cortex mcp did not answer the handshake".to_string()
            } else {
                message.to_string()
            })
        }
    }
}

// ---------- paths ----------

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

fn claude_config() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(|base| {
            PathBuf::from(base)
                .join("Claude")
                .join("claude_desktop_config.json")
        })
    } else if cfg!(target_os = "macos") {
        home().map(|home| {
            home.join("Library")
                .join("Application Support")
                .join("Claude")
                .join("claude_desktop_config.json")
        })
    } else {
        home().map(|home| {
            home.join(".config")
                .join("Claude")
                .join("claude_desktop_config.json")
        })
    }
}

/// `cortex mcp-config`: print it, and optionally write the clients we know.
pub fn print_and_write(vault: Option<PathBuf>, write: bool) -> anyhow::Result<()> {
    let mut registry = cortex_core::registry::Registry::load();
    let root = match vault {
        Some(path) => std::fs::canonicalize(&path)
            .map_err(|_| anyhow::anyhow!("vault not found: {}", path.display()))?,
        None => registry
            .active
            .clone()
            .or_else(|| registry.recent().first().map(|entry| entry.path.clone()))
            .ok_or_else(|| {
                anyhow::anyhow!(
                    "no vault yet: run `cortex`, or `cortex mcp-config --vault <folder>`"
                )
            })?,
    };
    if !root.is_dir() {
        anyhow::bail!("vault path is not a directory: {}", root.display());
    }

    match registry.agents(&root) {
        Some(false) => anyhow::bail!(
            "agent access is off for {}; turn it on first:\n  cortex agents \"{}\" --on",
            root.display(),
            root.display()
        ),
        Some(true) => {}
        None => {
            // Naming a folder here is an explicit choice, so it registers the
            // vault with access on instead of failing with "no vault yet".
            registry.add(&root);
            registry
                .save()
                .map_err(|error| anyhow::anyhow!("could not save the vault list: {error}"))?;
            eprintln!(
                "[cortex] added {} with agent access on",
                registry::name_for(&root)
            );
        }
    }

    println!("{}", serde_json::to_string_pretty(&snippet(&root))?);
    eprintln!(
        "[cortex] restart the client after adding the server — most clients read this file only at startup"
    );

    if write {
        for client in clients() {
            let outcome = write_client(&client, &root);
            eprintln!("[cortex] {}: {}", client.name, outcome.describe());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Note.md"), "# Note\n").unwrap();
        dir
    }

    #[test]
    fn the_snippet_names_the_binary_and_the_vault() {
        let dir = vault();
        let snippet = snippet(dir.path());
        let args = snippet
            .pointer("/mcpServers/cortex/args")
            .and_then(Value::as_array)
            .unwrap();
        assert_eq!(args[0], "mcp");
        assert_eq!(args[1], dir.path().display().to_string());
    }

    #[test]
    fn writing_merges_and_keeps_other_servers() {
        let dir = vault();
        let config = dir.path().join("mcp.json");
        std::fs::write(
            &config,
            r#"{"mcpServers":{"other":{"command":"other"}},"theme":"dark"}"#,
        )
        .unwrap();
        let client = Client {
            name: "Test",
            path: Some(config.clone()),
        };
        assert!(matches!(
            write_client(&client, dir.path()),
            Outcome::Written(_)
        ));
        let written: Value = serde_json::from_slice(&std::fs::read(&config).unwrap()).unwrap();
        assert!(written.pointer("/mcpServers/other").is_some());
        assert!(written.pointer("/mcpServers/cortex").is_some());
        assert_eq!(written["theme"], "dark");
        assert!(config.with_extension("json.cortex-backup").exists());
    }

    #[test]
    fn invalid_json_is_left_alone() {
        let dir = vault();
        let config = dir.path().join("mcp.json");
        std::fs::write(&config, "{not json").unwrap();
        let client = Client {
            name: "Test",
            path: Some(config.clone()),
        };
        assert!(matches!(
            write_client(&client, dir.path()),
            Outcome::Failed(_)
        ));
        assert_eq!(std::fs::read_to_string(&config).unwrap(), "{not json");
    }

    #[test]
    fn a_missing_client_folder_is_skipped() {
        let dir = vault();
        let client = Client {
            name: "Test",
            path: Some(dir.path().join("nope/mcp.json")),
        };
        assert!(matches!(
            write_client(&client, dir.path()),
            Outcome::Skipped(_)
        ));
    }
}
