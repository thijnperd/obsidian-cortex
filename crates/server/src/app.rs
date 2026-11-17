//! HTTP layer: a local-first vault server.
//!
//! Security posture:
//! - binds to loopback unless the operator opts into a wider bind;
//! - mutations need a custom header (defeats simple-form CSRF) and a
//!   same-origin `Origin` check;
//! - every note id is validated by `cortex_core::store` (no traversal, no
//!   symlinks, size caps);
//! - strict CSP, no inline script, no CORS, no directory listing.
//!
//! Multiple vaults can be open at once. Each one owns its snapshot and its own
//! watcher; `?vault=<id>` selects one, and the last opened is the default.

use std::collections::{HashMap, HashSet};
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::Context;
use axum::extract::{DefaultBodyLimit, Query, State};
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, StatusCode, Uri};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::{watch, RwLock};

use cortex_core::graph::GraphData;
use cortex_core::layout::LayoutOptions;
use cortex_core::registry::{self, Registry};
use cortex_core::search::{Hit, SearchIndex};
use cortex_core::store::{self, MAX_NOTE_BYTES};
use cortex_core::synthesis::{self, Evidence, Template, MAX_EVIDENCE};
use cortex_core::vault::{fingerprint_of, ScanOptions};
use cortex_core::Vault;

use crate::assets;
use crate::desktop;

const MAX_BODY: usize = MAX_NOTE_BYTES as usize + 64 * 1024;
/// Stat-only check. Cheap enough to feel instant without an OS watcher crate,
/// and it behaves the same on network shares and every platform.
const WATCH_INTERVAL: Duration = Duration::from_millis(400);
const EVENT_WAIT: Duration = Duration::from_secs(25);

#[derive(Debug, Clone)]
pub struct Config {
    /// Vaults named on the command line. Empty means "use the remembered one".
    pub roots: Vec<PathBuf>,
    pub title: Option<String>,
    pub read_only: bool,
    pub allow_any_origin: bool,
    pub allow_framing: bool,
    /// Open the UI in the default browser once the listener is up.
    pub open_browser: bool,
    /// Prefer a chromeless Chromium window over a browser tab.
    pub app_window: bool,
    pub bind: String,
    pub port: u16,
}

#[derive(Clone)]
pub struct AppState {
    config: Config,
    vaults: Arc<RwLock<Vec<Arc<VaultHandle>>>>,
    registry: Arc<RwLock<Registry>>,
    active: Arc<RwLock<Option<String>>>,
    revision: watch::Sender<u64>,
    last_write: Arc<RwLock<Instant>>,
}

pub struct VaultHandle {
    id: String,
    root: PathBuf,
    name: String,
    snapshot: RwLock<Arc<Snapshot>>,
    alive: AtomicBool,
}

impl VaultHandle {
    async fn current(&self) -> Arc<Snapshot> {
        self.snapshot.read().await.clone()
    }
}

pub struct Snapshot {
    vault: Vault,
    search: SearchIndex,
    graph_json: String,
    positions: HashMap<String, [f32; 3]>,
    version: String,
}

#[derive(Serialize)]
struct VersionInfo {
    version: String,
    notes: usize,
    live: bool,
}

#[derive(Serialize)]
struct VaultSummary {
    id: String,
    name: String,
    path: String,
    notes: Option<usize>,
    loaded: bool,
    active: bool,
    missing: bool,
    /// True when the folder carries an `.obsidian/` directory: it can be opened
    /// as-is, and Cortex writes plain Markdown that Obsidian will pick up.
    obsidian: bool,
    /// AI clients may operate this vault: the MCP switch, kept in the registry.
    agents: bool,
}

#[derive(Serialize)]
struct VaultList {
    vaults: Vec<VaultSummary>,
    active: Option<String>,
    read_only: bool,
}

#[derive(Deserialize)]
struct VaultQuery {
    vault: Option<String>,
}

#[derive(Deserialize)]
struct AgentsRequest {
    id: String,
    enabled: bool,
}

#[derive(Deserialize)]
struct RevealRequest {
    vault: Option<String>,
    /// A note id to highlight, or nothing for the vault folder itself.
    note: Option<String>,
}

#[derive(Deserialize)]
struct NoteQuery {
    id: String,
    vault: Option<String>,
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    limit: Option<usize>,
    vault: Option<String>,
}

#[derive(Deserialize)]
struct EventsQuery {
    vault: Option<String>,
    since: Option<String>,
}

#[derive(Deserialize)]
struct AddVaultRequest {
    path: String,
}

#[derive(Deserialize)]
struct ForgetVaultRequest {
    id: String,
}

#[derive(Deserialize)]
struct SaveRequest {
    id: Option<String>,
    title: Option<String>,
    content: String,
}

#[derive(Serialize)]
struct SaveResponse {
    id: String,
    version: String,
}

#[derive(Deserialize)]
struct SynthesizeRequest {
    title: String,
    template: String,
    notes: Vec<String>,
    vault: Option<String>,
}

#[derive(Serialize)]
struct NoteDetail {
    id: String,
    title: String,
    folder: String,
    created: String,
    words: usize,
    tags: Vec<String>,
    markdown: String,
    /// Full file (frontmatter included) for the editor. Live mode only.
    raw: Option<String>,
    backlinks: Vec<NoteRef>,
    mentions: Vec<NoteRef>,
    related: Vec<NoteRef>,
}

#[derive(Serialize)]
struct NoteRef {
    id: String,
    title: String,
    folder: String,
    weight: u32,
}

/// Builds the app, the remembered vault (if any) and one watcher per vault.
pub async fn serve(config: Config) -> anyhow::Result<()> {
    let mut registry = Registry::load();
    let mut wanted: Vec<(PathBuf, String)> = Vec::new();

    for (index, root) in config.roots.iter().enumerate() {
        let canonical = std::fs::canonicalize(root)
            .with_context(|| format!("vault not found: {}", root.display()))?;
        if !canonical.is_dir() {
            anyhow::bail!("vault path is not a directory: {}", canonical.display());
        }
        registry.add(&canonical);
        let name = if index == 0 {
            config
                .title
                .clone()
                .unwrap_or_else(|| registry::name_for(&canonical))
        } else {
            registry::name_for(&canonical)
        };
        wanted.push((canonical, name));
    }

    if wanted.is_empty() {
        // No path on the command line: reopen whatever was open last.
        let remembered = registry
            .active
            .clone()
            .or_else(|| registry.recent().first().map(|entry| entry.path.clone()));
        if let Some(path) = remembered.filter(|path| path.is_dir()) {
            let name = registry
                .active
                .as_ref()
                .filter(|active| **active == path)
                .and_then(|_| config.title.clone())
                .unwrap_or_else(|| registry::name_for(&path));
            wanted.push((path, name));
        }
    }

    let (revision, _) = watch::channel(0u64);
    let mut handles: Vec<Arc<VaultHandle>> = Vec::new();
    for (root, name) in &wanted {
        match open_vault(root, name, None).await {
            Ok(snapshot) => {
                println!(
                    "[cortex] indexed {} notes, {} links from {}",
                    snapshot.vault.notes.len(),
                    snapshot.vault.edges.len(),
                    root.display()
                );
                handles.push(Arc::new(VaultHandle {
                    id: vault_id(root),
                    root: root.clone(),
                    name: name.clone(),
                    snapshot: RwLock::new(Arc::new(snapshot)),
                    alive: AtomicBool::new(true),
                }));
            }
            Err(error) => eprintln!("[cortex] could not open {}: {error}", root.display()),
        }
    }

    let active = handles.first().map(|handle| handle.id.clone());
    registry.active = handles
        .first()
        .map(|handle| handle.root.clone())
        .or(registry.active);
    if registry.save().is_err() {
        eprintln!("[cortex] warning: could not save the vault list");
    }

    let state = AppState {
        config: config.clone(),
        vaults: Arc::new(RwLock::new(handles.clone())),
        registry: Arc::new(RwLock::new(registry)),
        active: Arc::new(RwLock::new(active)),
        revision,
        last_write: Arc::new(RwLock::new(Instant::now() - Duration::from_secs(60))),
    };
    for handle in &handles {
        tokio::spawn(watch(handle.clone(), state.revision.clone()));
    }

    let csp = if config.allow_framing {
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors *"
    } else {
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
    };
    let csp = HeaderValue::from_str(csp)
        .unwrap_or_else(|_| HeaderValue::from_static("default-src 'none'"));

    let app = Router::new()
        .route("/api/vaults", get(api_vaults).post(api_add_vault))
        .route("/api/vaults/forget", post(api_forget_vault))
        .route("/api/vaults/agents", post(api_vault_agents))
        .route("/api/reveal", post(api_reveal))
        .route("/api/events", get(api_events))
        .route("/api/graph", get(api_graph))
        .route("/api/note", get(api_note))
        .route("/api/search", get(api_search))
        .route("/api/version", get(api_version))
        .route("/api/note", post(api_save))
        .route("/api/synthesize", post(api_synthesize))
        .route("/api/health", get(api_health))
        .fallback(static_asset)
        .layer(DefaultBodyLimit::max(MAX_BODY))
        .layer(middleware::from_fn(move |request, next| {
            security_headers(csp.clone(), request, next)
        }))
        .with_state(state.clone());

    let address: SocketAddr = format!("{}:{}", config.bind, config.port)
        .parse()
        .map_err(|_| anyhow::anyhow!("invalid bind address: {}:{}", config.bind, config.port))?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("[cortex] listening on http://{address}");
    if !address.ip().is_loopback() {
        println!("[cortex] note: bound beyond loopback; ensure the network is trusted");
    }
    if config.open_browser {
        let url = if address.ip().is_unspecified() {
            format!("http://127.0.0.1:{}", address.port())
        } else {
            format!("http://{address}")
        };
        if !(config.app_window && desktop::open_app_window(&url, 1440, 900)) {
            desktop::open_url(&url);
        }
    }
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    println!("[cortex] shutting down");
}

/// Stable id for a vault path: FNV-1a, so the UI can bookmark one without
/// exposing the filesystem path as a key.
fn vault_id(root: &Path) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in root.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{hash:016x}")
}

fn build_snapshot(
    root: &Path,
    title: &str,
    previous: Option<&Snapshot>,
) -> anyhow::Result<Snapshot> {
    let vault = Vault::load_with(
        root,
        title,
        ScanOptions::default(),
        previous.map(|snapshot| &snapshot.vault),
    )?;
    let graph = GraphData::build_with_positions(
        &vault,
        "live",
        &LayoutOptions::default(),
        previous.map(|snapshot| &snapshot.positions),
    );
    let positions = graph
        .nodes
        .iter()
        .map(|node| (node.id.clone(), [node.x, node.y, node.z]))
        .collect();
    Ok(Snapshot {
        version: vault.fingerprint().to_string(),
        graph_json: graph.to_json(),
        positions,
        search: SearchIndex::build(&vault),
        vault,
    })
}

async fn open_vault(
    root: &Path,
    title: &str,
    previous: Option<Arc<Snapshot>>,
) -> anyhow::Result<Snapshot> {
    let root = root.to_path_buf();
    let title = title.to_string();
    tokio::task::spawn_blocking(move || {
        build_snapshot(&root, &title, previous.as_deref()).context("index failed")
    })
    .await?
}

async fn rebuild(handle: &Arc<VaultHandle>) -> anyhow::Result<String> {
    let previous = handle.current().await;
    let root = handle.root.clone();
    let title = handle.name.clone();
    let built = open_vault(&root, &title, Some(previous)).await?;
    let version = built.version.clone();
    *handle.snapshot.write().await = Arc::new(built);
    Ok(version)
}

async fn watch(handle: Arc<VaultHandle>, revision: watch::Sender<u64>) {
    loop {
        tokio::time::sleep(WATCH_INTERVAL).await;
        if !handle.alive.load(Ordering::Relaxed) {
            break;
        }
        let root = handle.root.clone();
        let fingerprint =
            tokio::task::spawn_blocking(move || fingerprint_of(&root, ScanOptions::default()))
                .await;
        let Ok(Ok(fingerprint)) = fingerprint else {
            continue;
        };
        let current = handle.current().await;
        if current.version == fingerprint {
            continue;
        }
        match open_vault(&handle.root, &handle.name, Some(current)).await {
            Ok(snapshot) => {
                *handle.snapshot.write().await = Arc::new(snapshot);
                revision.send_modify(|value| *value = value.wrapping_add(1));
                println!("[cortex] {} changed — reindexed", handle.name);
            }
            Err(error) => eprintln!("[cortex] reindex failed for {}: {error}", handle.name),
        }
    }
}

async fn find_vault(state: &AppState, id: Option<&str>) -> Option<Arc<VaultHandle>> {
    let vaults = state.vaults.read().await.clone();
    if let Some(id) = id {
        return vaults.iter().find(|handle| handle.id == id).cloned();
    }
    let active = state.active.read().await.clone();
    if let Some(active) = active {
        if let Some(handle) = vaults.iter().find(|handle| handle.id == active) {
            return Some(handle.clone());
        }
    }
    vaults.first().cloned()
}

/// Best-effort hand-off to the desktop's file manager. The note id is
/// validated exactly like a write, so a request cannot turn into "open any path
/// on this machine".
async fn api_reveal(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<RevealRequest>,
) -> Response {
    if let Some(rejection) = begin_admin(&state, &headers).await {
        return rejection;
    }
    let Some(handle) = find_vault(&state, payload.vault.as_deref()).await else {
        return bad_request("no vault is open");
    };
    match desktop::reveal_target(&handle.root, payload.note.as_deref()) {
        Ok((path, select)) => {
            if desktop::reveal(&path, select) {
                json_response(StatusCode::OK, r#"{"opened":true}"#.to_string())
            } else {
                json_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    r#"{"error":"no file manager could be started","code":"no_opener"}"#
                        .to_string(),
                )
            }
        }
        Err(error) => bad_request(&error.to_string()),
    }
}

/// The MCP switch. A separate route from a note write: it changes Cortex's own
/// settings, not the vault, so `--read-only` does not block it.
async fn api_vault_agents(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AgentsRequest>,
) -> Response {
    if let Some(rejection) = begin_admin(&state, &headers).await {
        return rejection;
    }
    let root = {
        let registry = state.registry.read().await;
        registry
            .vaults
            .iter()
            .find(|entry| vault_id(&entry.path) == payload.id)
            .map(|entry| entry.path.clone())
    };
    let Some(root) = root else {
        return bad_request("unknown vault");
    };
    let applied = {
        let mut registry = state.registry.write().await;
        let applied = registry.set_agents(&root, payload.enabled);
        if applied && registry.save().is_err() {
            eprintln!("[cortex] warning: could not save the agent switch");
        }
        applied
    };
    if !applied {
        return bad_request("unknown vault");
    }
    println!(
        "[cortex] agent access {} for {}",
        if payload.enabled { "on" } else { "off" },
        registry::name_for(&root)
    );
    json_response(
        StatusCode::OK,
        json!({"id": payload.id, "agents": payload.enabled}).to_string(),
    )
}

async fn api_vaults(State(state): State<AppState>) -> Response {
    let handles = state.vaults.read().await.clone();
    let registry = state.registry.read().await.clone();
    let active = state.active.read().await.clone();

    let mut vaults = Vec::new();
    for entry in registry.recent() {
        let handle = handles.iter().find(|handle| handle.root == entry.path);
        let notes = match handle {
            Some(handle) => Some(handle.current().await.vault.notes.len()),
            None => None,
        };
        let id = handle
            .map(|handle| handle.id.clone())
            .unwrap_or_else(|| vault_id(&entry.path));
        vaults.push(VaultSummary {
            active: active.as_deref() == Some(id.as_str()),
            id,
            name: entry.name.clone(),
            path: entry.path.display().to_string(),
            notes,
            loaded: handle.is_some(),
            missing: !entry.path.is_dir(),
            obsidian: entry.path.join(".obsidian").is_dir(),
            agents: entry.agents,
        });
    }
    // A vault opened by flag but missing from the registry should still appear.
    for handle in &handles {
        if vaults.iter().any(|vault| vault.id == handle.id) {
            continue;
        }
        vaults.push(VaultSummary {
            id: handle.id.clone(),
            name: handle.name.clone(),
            path: handle.root.display().to_string(),
            notes: Some(handle.current().await.vault.notes.len()),
            loaded: true,
            active: active.as_deref() == Some(handle.id.as_str()),
            missing: false,
            obsidian: handle.root.join(".obsidian").is_dir(),
            agents: registry
                .get(&handle.root)
                .map(|entry| entry.agents)
                .unwrap_or(true),
        });
    }

    json_response(
        StatusCode::OK,
        serde_json::to_string(&VaultList {
            vaults,
            active,
            read_only: state.config.read_only,
        })
        .unwrap_or_default(),
    )
}

async fn api_add_vault(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<AddVaultRequest>,
) -> Response {
    if let Some(rejection) = begin_admin(&state, &headers).await {
        return rejection;
    }
    let Some(path) = registry::expand(&payload.path) else {
        return bad_request("enter a folder path");
    };
    let root = match std::fs::canonicalize(&path) {
        Ok(root) => root,
        Err(_) => return bad_request("that folder does not exist"),
    };
    if !root.is_dir() {
        return bad_request("that path is not a folder");
    }

    let id = vault_id(&root);
    let existing = state
        .vaults
        .read()
        .await
        .iter()
        .find(|handle| handle.id == id)
        .cloned();
    let name = {
        let mut registry = state.registry.write().await;
        let entry = registry.add(&root);
        if registry.save().is_err() {
            eprintln!("[cortex] warning: could not save the vault list");
        }
        entry.name
    };
    *state.active.write().await = Some(id.clone());

    if let Some(handle) = existing {
        return json_response(
            StatusCode::OK,
            serde_json::json!({
                "id": id,
                "name": handle.name,
                "path": handle.root.display().to_string(),
                "notes": handle.current().await.vault.notes.len(),
            })
            .to_string(),
        );
    }

    let snapshot = match open_vault(&root, &name, None).await {
        Ok(snapshot) => snapshot,
        Err(error) => {
            eprintln!("[cortex] could not open {}: {error}", root.display());
            return bad_request("Cortex could not read that folder");
        }
    };
    let notes = snapshot.vault.notes.len();
    let handle = Arc::new(VaultHandle {
        id: id.clone(),
        root,
        name,
        snapshot: RwLock::new(Arc::new(snapshot)),
        alive: AtomicBool::new(true),
    });
    state.vaults.write().await.push(handle.clone());
    tokio::spawn(watch(handle.clone(), state.revision.clone()));
    println!("[cortex] opened {} ({notes} notes)", handle.root.display());

    json_response(
        StatusCode::OK,
        serde_json::json!({
            "id": id,
            "name": handle.name,
            "path": handle.root.display().to_string(),
            "notes": notes,
        })
        .to_string(),
    )
}

async fn api_forget_vault(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<ForgetVaultRequest>,
) -> Response {
    if let Some(rejection) = begin_admin(&state, &headers).await {
        return rejection;
    }
    let mut vaults = state.vaults.write().await;
    if let Some(position) = vaults.iter().position(|handle| handle.id == payload.id) {
        let handle = vaults.remove(position);
        handle.alive.store(false, Ordering::Relaxed);
        let mut registry = state.registry.write().await;
        registry.remove(&handle.root);
        if registry.save().is_err() {
            eprintln!("[cortex] warning: could not save the vault list");
        }
    }
    let remaining = vaults.first().map(|handle| handle.id.clone());
    drop(vaults);
    *state.active.write().await = remaining;
    json_response(StatusCode::OK, r#"{"ok":true}"#.to_string())
}

async fn api_events(State(state): State<AppState>, Query(query): Query<EventsQuery>) -> Response {
    let Some(handle) = find_vault(&state, query.vault.as_deref()).await else {
        return no_vault();
    };
    let mut receiver = state.revision.subscribe();
    let current = handle.current().await;
    if query.since.as_deref() != Some(current.version.as_str()) {
        return events_response(&handle, &current);
    }
    // Long poll: the connection parks here until something in this vault (or
    // any other) changes, then the client asks for the new graph.
    let _ = tokio::time::timeout(EVENT_WAIT, receiver.changed()).await;
    let latest = handle.current().await;
    events_response(&handle, &latest)
}

fn events_response(handle: &VaultHandle, snapshot: &Snapshot) -> Response {
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "vault": handle.id,
            "version": snapshot.version,
            "notes": snapshot.vault.notes.len(),
            "links": snapshot.vault.edges.len(),
        })
        .to_string(),
    )
}

fn no_vault() -> Response {
    json_response(
        StatusCode::NOT_FOUND,
        r#"{"error":"no vault is open","code":"no_vault"}"#.to_string(),
    )
}

fn json_response(status: StatusCode, body: String) -> Response {
    let mut response = (status, body).into_response();
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json; charset=utf-8"),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn bad_request(message: &str) -> Response {
    json_response(
        StatusCode::BAD_REQUEST,
        serde_json::json!({ "error": message, "code": "invalid_request" }).to_string(),
    )
}

fn error_response(error: cortex_core::Error) -> Response {
    let status = match error.code() {
        "invalid_path" => StatusCode::BAD_REQUEST,
        "too_large" => StatusCode::PAYLOAD_TOO_LARGE,
        "not_found" => StatusCode::NOT_FOUND,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    let body =
        serde_json::json!({ "error": error.public_message(), "code": error.code() }).to_string();
    json_response(status, body)
}

async fn api_health() -> Response {
    json_response(StatusCode::OK, r#"{"ok":true}"#.to_string())
}

async fn api_graph(State(state): State<AppState>, Query(query): Query<VaultQuery>) -> Response {
    let Some(handle) = find_vault(&state, query.vault.as_deref()).await else {
        return no_vault();
    };
    let snapshot = handle.current().await;
    let mut response = json_response(StatusCode::OK, snapshot.graph_json.clone());
    if let Ok(value) = HeaderValue::from_str(&snapshot.version) {
        response.headers_mut().insert("x-cortex-version", value);
    }
    response
}

async fn api_version(State(state): State<AppState>, Query(query): Query<VaultQuery>) -> Response {
    let Some(handle) = find_vault(&state, query.vault.as_deref()).await else {
        return no_vault();
    };
    let snapshot = handle.current().await;
    let info = VersionInfo {
        version: snapshot.version.clone(),
        notes: snapshot.vault.notes.len(),
        live: true,
    };
    json_response(
        StatusCode::OK,
        serde_json::to_string(&info).unwrap_or_default(),
    )
}

async fn api_search(State(state): State<AppState>, Query(query): Query<SearchQuery>) -> Response {
    let Some(handle) = find_vault(&state, query.vault.as_deref()).await else {
        return no_vault();
    };
    let snapshot = handle.current().await;
    let limit = query.limit.unwrap_or(24).clamp(1, 50);
    let hits: Vec<Hit> = snapshot.search.search(&query.q, limit);
    json_response(
        StatusCode::OK,
        serde_json::to_string(&hits).unwrap_or_default(),
    )
}

async fn api_note(State(state): State<AppState>, Query(query): Query<NoteQuery>) -> Response {
    let Some(handle) = find_vault(&state, query.vault.as_deref()).await else {
        return no_vault();
    };
    let snapshot = handle.current().await;
    let Some(index) = snapshot.vault.index_of(&query.id) else {
        return error_response(cortex_core::Error::NotFound);
    };
    let note = &snapshot.vault.notes[index];

    let backlinks = snapshot
        .vault
        .backlinks()
        .into_iter()
        .nth(index)
        .unwrap_or_default()
        .into_iter()
        .take(16)
        .map(|(source, weight)| NoteRef {
            id: snapshot.vault.notes[source].id.clone(),
            title: snapshot.vault.notes[source].title.clone(),
            folder: snapshot.vault.notes[source].folder.clone(),
            weight,
        })
        .collect::<Vec<_>>();

    let mentions = snapshot
        .vault
        .unlinked_mentions(index, &note.title, 6)
        .into_iter()
        .map(|source| NoteRef {
            id: snapshot.vault.notes[source].id.clone(),
            title: snapshot.vault.notes[source].title.clone(),
            folder: snapshot.vault.notes[source].folder.clone(),
            weight: 0,
        })
        .collect::<Vec<_>>();

    let related = related_notes(&snapshot.vault, index, 6);

    // Read the raw file for editing so frontmatter survives a save.
    let root = handle.root.clone();
    let note_id = note.id.clone();
    let raw = tokio::task::spawn_blocking(move || store::read_note(&root, &note_id))
        .await
        .ok()
        .and_then(|result| result.ok());

    let detail = NoteDetail {
        id: note.id.clone(),
        title: note.title.clone(),
        folder: note.folder.clone(),
        created: note.created.clone(),
        words: note.words,
        tags: note.tags.clone(),
        markdown: note.body.clone(),
        raw,
        backlinks,
        mentions,
        related,
    };
    json_response(
        StatusCode::OK,
        serde_json::to_string(&detail).unwrap_or_default(),
    )
}

fn related_notes(vault: &Vault, target: usize, limit: usize) -> Vec<NoteRef> {
    let mut neighbours: HashMap<usize, HashSet<usize>> = HashMap::new();
    for edge in &vault.edges {
        neighbours.entry(edge.from).or_default().insert(edge.to);
        neighbours.entry(edge.to).or_default().insert(edge.from);
    }
    let Some(base) = neighbours.get(&target) else {
        return Vec::new();
    };
    let mut scored: Vec<(usize, f32)> = Vec::new();
    for (candidate, other) in &neighbours {
        if *candidate == target {
            continue;
        }
        let intersection = base.intersection(other).count() as f32;
        let union = (base.len() + other.len()).max(1) as f32 - intersection;
        let score = intersection / union.max(1.0);
        if score > 0.0 {
            scored.push((*candidate, score));
        }
    }
    scored.sort_by(|a, b| {
        b.1.partial_cmp(&a.1)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.0.cmp(&b.0))
    });
    scored
        .into_iter()
        .take(limit)
        .map(|(index, _)| NoteRef {
            id: vault.notes[index].id.clone(),
            title: vault.notes[index].title.clone(),
            folder: vault.notes[index].folder.clone(),
            weight: 0,
        })
        .collect()
}

fn has_write_header(headers: &HeaderMap) -> bool {
    headers
        .get("x-cortex")
        .and_then(|value| value.to_str().ok())
        == Some("write")
}

/// CSRF defence in depth: a browser always sends `Origin` for cross-site POSTs,
/// so the host must match exactly. Suffix matching would accept look-alikes.
fn same_origin(state: &AppState, headers: &HeaderMap) -> bool {
    if state.config.allow_any_origin {
        return true;
    }
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return true;
    };
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let origin_host = origin
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(origin)
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("");
    let host_name = host.split(':').next().unwrap_or("");
    origin_host.eq_ignore_ascii_case(host_name)
}

fn forbidden() -> Response {
    json_response(
        StatusCode::FORBIDDEN,
        r#"{"error":"writes are disabled","code":"forbidden"}"#.to_string(),
    )
}

/// Note writes: read-only mode, CSRF header, origin and a ~20/s brake.
async fn begin_write(state: &AppState, headers: &HeaderMap) -> Option<Response> {
    if state.config.read_only || !has_write_header(headers) || !same_origin(state, headers) {
        return Some(forbidden());
    }
    throttle(state).await
}

/// Vault management: still needs the header and origin, but opening a folder is
/// not a note write, so `--read-only` does not block it.
async fn begin_admin(state: &AppState, headers: &HeaderMap) -> Option<Response> {
    if !has_write_header(headers) || !same_origin(state, headers) {
        return Some(forbidden());
    }
    throttle(state).await
}

async fn throttle(state: &AppState) -> Option<Response> {
    let mut last = state.last_write.write().await;
    if last.elapsed() < Duration::from_millis(50) {
        return Some(json_response(
            StatusCode::TOO_MANY_REQUESTS,
            r#"{"error":"slow down","code":"rate_limited"}"#.to_string(),
        ));
    }
    *last = Instant::now();
    None
}

async fn api_save(
    State(state): State<AppState>,
    Query(query): Query<VaultQuery>,
    headers: HeaderMap,
    Json(payload): Json<SaveRequest>,
) -> Response {
    if let Some(rejection) = begin_write(&state, &headers).await {
        return rejection;
    }
    let Some(handle) = find_vault(&state, query.vault.as_deref()).await else {
        return no_vault();
    };

    if payload.content.len() as u64 > MAX_NOTE_BYTES {
        return error_response(cortex_core::Error::TooLarge {
            limit: MAX_NOTE_BYTES,
        });
    }

    let SaveRequest { id, title, content } = payload;
    let root = handle.root.clone();
    let write = tokio::task::spawn_blocking(move || -> cortex_core::Result<String> {
        let id = match id.as_deref().map(str::trim).filter(|id| !id.is_empty()) {
            // Existing note: reuse its id. `write_note` validates it again.
            Some(existing) => store::strip_md(existing).to_string(),
            None => {
                let title = title.as_deref().unwrap_or("").trim();
                if title.is_empty() {
                    return Err(cortex_core::Error::InvalidPath("title required".into()));
                }
                let base = store::slugify(title);
                store::unique_id(&root, &base)
            }
        };
        store::write_note(&root, &id, &content)?;
        Ok(store::strip_md(&id).to_string())
    })
    .await;

    let id = match write {
        Ok(Ok(id)) => id,
        Ok(Err(error)) => return error_response(error),
        Err(_) => return error_response(cortex_core::Error::Vault("write task failed".into())),
    };

    match rebuild(&handle).await {
        Ok(version) => json_response(
            StatusCode::OK,
            serde_json::to_string(&SaveResponse { id, version }).unwrap_or_default(),
        ),
        Err(_) => error_response(cortex_core::Error::Vault("reindex failed".into())),
    }
}

async fn api_synthesize(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(payload): Json<SynthesizeRequest>,
) -> Response {
    if let Some(rejection) = begin_write(&state, &headers).await {
        return rejection;
    }
    let Some(template) = Template::parse(&payload.template) else {
        return bad_request("template must be research or idea");
    };
    let title = payload.title.trim();
    let length = title.chars().count();
    if !(3..=120).contains(&length) || title.chars().any(char::is_control) {
        return bad_request("title must be 3-120 printable characters");
    }
    if payload.notes.len() < 2 {
        return bad_request("collect at least two notes first");
    }
    if payload.notes.len() > MAX_EVIDENCE {
        return bad_request("too many notes in one synthesis");
    }
    let Some(handle) = find_vault(&state, payload.vault.as_deref()).await else {
        return no_vault();
    };

    let snapshot = handle.current().await;
    let mut seen = HashSet::new();
    let mut evidence = Vec::new();
    for id in &payload.notes {
        let Some(index) = snapshot.vault.index_of(store::strip_md(id)) else {
            return bad_request("one of the selected notes no longer exists");
        };
        if !seen.insert(index) {
            continue;
        }
        let note = &snapshot.vault.notes[index];
        evidence.push(Evidence {
            title: note.title.clone(),
            folder: note.folder.clone(),
            excerpt: note.excerpt.clone(),
        });
    }
    if evidence.len() < 2 {
        return bad_request("collect at least two different notes first");
    }

    let markdown = synthesis::build(template, title, &evidence);
    let root = handle.root.clone();
    let title = title.to_string();
    let write = tokio::task::spawn_blocking(move || -> cortex_core::Result<String> {
        let base = format!("Synthesis/{}", store::slugify(&title));
        let id = store::unique_id(&root, &base);
        store::write_note(&root, &id, &markdown)?;
        Ok(store::strip_md(&id).to_string())
    })
    .await;

    let id = match write {
        Ok(Ok(id)) => id,
        Ok(Err(error)) => return error_response(error),
        Err(_) => return error_response(cortex_core::Error::Vault("write task failed".into())),
    };

    match rebuild(&handle).await {
        Ok(version) => json_response(
            StatusCode::OK,
            serde_json::to_string(&SaveResponse { id, version }).unwrap_or_default(),
        ),
        Err(_) => error_response(cortex_core::Error::Vault("reindex failed".into())),
    }
}

async fn static_asset(State(_state): State<AppState>, uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };
    let Some((bytes, mime)) = assets::get(path) else {
        return (StatusCode::NOT_FOUND, "not found").into_response();
    };
    let mut response = bytes.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    response
}

async fn security_headers(
    csp: HeaderValue,
    request: axum::extract::Request,
    next: Next,
) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_SECURITY_POLICY, csp);
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("cross-origin-resource-policy"),
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_ids_are_stable_and_distinct() {
        let a = vault_id(Path::new("/tmp/notes"));
        assert_eq!(a, vault_id(Path::new("/tmp/notes")));
        assert_ne!(a, vault_id(Path::new("/tmp/other")));
        assert_eq!(a.len(), 16);
    }
}
