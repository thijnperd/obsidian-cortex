//! The discovery file: how a second launch, `cortex stop` and `cortex doctor`
//! find the instance that is already running.
//!
//! It is advisory, not a lock. The health probe decides whether the file is
//! current; a stale file is removed and ignored.

use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Discovery {
    pub port: u16,
    pub pid: u32,
    pub version: String,
    pub build: String,
    pub started_ms: u64,
    /// Accepted only by `POST /api/stop`, and only from loopback.
    pub token: String,
}

pub fn config_dir() -> Option<PathBuf> {
    cortex_core::registry::config_path().and_then(|path| path.parent().map(Path::to_path_buf))
}

/// `server.json` beside `vaults.json`.
pub fn path() -> Option<PathBuf> {
    config_dir().map(|dir| dir.join("server.json"))
}

pub fn log_path() -> Option<PathBuf> {
    config_dir().map(|dir| dir.join("cortex.log"))
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// A per-run secret for the stop route. Not a password: it only has to be
/// unguessable to a web page, and it never leaves the config directory.
pub fn token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in nanos
        .to_le_bytes()
        .iter()
        .chain(std::process::id().to_le_bytes().iter())
    {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}{:016x}", nanos as u64)
}

pub fn read_from(file: &Path) -> Option<Discovery> {
    let raw = fs::read(file).ok()?;
    serde_json::from_slice(&raw).ok()
}

pub fn write_to(file: &Path, discovery: &Discovery) -> std::io::Result<()> {
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_vec_pretty(discovery).unwrap_or_default();
    let temp = file.with_extension("json.tmp");
    fs::write(&temp, json)?;
    replace(&temp, file)
}

pub fn clear(file: &Path) {
    let _ = fs::remove_file(file);
}

/// Rename `temp` onto `target`, working around Windows refusing to replace.
fn replace(temp: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        let _ = fs::remove_file(target);
    }
    fs::rename(temp, target)
}

#[derive(Debug, Deserialize)]
pub struct Health {
    pub ok: bool,
    pub app: Option<String>,
}

/// Is something Cortex-shaped listening on `port`?
pub fn probe(port: u16) -> Option<Health> {
    let (status, body) = get(port, "/api/health", Duration::from_millis(500))?;
    if status != 200 {
        return None;
    }
    let health: Health = serde_json::from_str(&body).ok()?;
    (health.ok && health.app.as_deref() == Some("cortex")).then_some(health)
}

fn get(port: u16, path: &str, timeout: Duration) -> Option<(u16, String)> {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&address, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    write!(
        stream,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"
    )
    .ok()?;
    let mut raw = String::new();
    stream.read_to_string(&mut raw).ok()?;
    let status = raw.split_whitespace().nth(1)?.parse().ok()?;
    let body = raw.split("\r\n\r\n").nth(1).unwrap_or_default().to_string();
    Some((status, body))
}

/// The running instance, if the file points at a live Cortex.
pub fn live() -> Option<(PathBuf, Discovery)> {
    let file = path()?;
    let discovery = read_from(&file)?;
    probe(discovery.port).map(|_| (file, discovery))
}

/// Ask the instance to shut down. Loopback only, with the per-run token.
pub fn stop(discovery: &Discovery) -> Result<(), String> {
    let address = SocketAddr::from(([127, 0, 0, 1], discovery.port));
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_millis(800))
        .map_err(|error| format!("nothing is listening on port {} ({error})", discovery.port))?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).ok();
    write!(
        stream,
        "POST /api/stop HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nx-cortex-stop: {}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
        discovery.port, discovery.token
    )
    .map_err(|error| error.to_string())?;
    let mut response = String::new();
    stream.read_to_string(&mut response).ok();
    let status: u16 = response
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    if status == 200 {
        Ok(())
    } else {
        Err(format!(
            "the server refused to stop (HTTP {status}); run `cortex doctor`"
        ))
    }
}

/// The tray label for the active vault.
pub fn active_agent() -> (String, bool) {
    let registry = cortex_core::registry::Registry::load();
    match registry.active.clone() {
        Some(path) => (
            cortex_core::registry::name_for(&path),
            registry.agents(&path).unwrap_or(false),
        ),
        None => ("no vault".to_string(), false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn discovery_round_trips_through_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("server.json");
        let discovery = Discovery {
            port: 4123,
            pid: 99,
            version: "0.2.0".into(),
            build: "v0.2.0".into(),
            started_ms: 7,
            token: token(),
        };
        write_to(&file, &discovery).unwrap();
        assert_eq!(read_from(&file), Some(discovery));
    }

    #[test]
    fn tokens_are_long_and_different() {
        let first = token();
        let second = token();
        assert_eq!(first.len(), 32);
        assert_ne!(first, second);
    }

    #[test]
    fn a_closed_port_is_not_an_instance() {
        assert!(probe(1).is_none());
    }

    #[test]
    fn a_corrupt_file_is_not_an_instance() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("server.json");
        fs::write(&file, b"nope").unwrap();
        assert!(read_from(&file).is_none());
    }
}
