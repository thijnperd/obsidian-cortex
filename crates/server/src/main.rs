mod app;
mod assets;
mod desktop;
mod doctor;
mod instance;
mod launch;
mod mcp;
mod mcp_setup;
#[cfg(any(windows, target_os = "macos"))]
mod tray;
mod version;

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use cortex_core::demo;
use cortex_core::graph::GraphData;
use cortex_core::layout::LayoutOptions;
use cortex_core::registry;
use cortex_core::vault::{ScanOptions, Vault};

#[derive(Parser)]
#[command(
    name = "cortex",
    version,
    about = "A Markdown vault rendered as a 3D knowledge universe"
)]
struct Cli {
    /// With no subcommand, Cortex starts in the background and opens its window.
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Serve a vault in the foreground (Ctrl+C stops it).
    Serve {
        /// Folder to open. Omit it to reopen the last vault.
        vault: Option<PathBuf>,
        #[arg(long, default_value = "127.0.0.1")]
        bind: String,
        /// Default 3000; the next free port is used when it is busy.
        #[arg(long)]
        port: Option<u16>,
        #[arg(long)]
        title: Option<String>,
        /// Disable all writes to the vault.
        #[arg(long)]
        read_only: bool,
        /// Trust proxies that rewrite the Host header (needed behind some tunnels).
        #[arg(long)]
        allow_any_origin: bool,
        /// Allow the UI to be embedded in an iframe (cloud previews).
        #[arg(long)]
        allow_framing: bool,
        /// Open the UI in the default browser once the server is listening.
        #[arg(long)]
        open: bool,
        /// Open a chromeless app window (Chrome, Edge or Brave) instead of a tab.
        #[arg(long)]
        app: bool,
    },
    /// The instance: server, window and tray in one process.
    #[command(hide = true)]
    App,
    /// Stop the instance that is running in the background.
    Stop,
    /// Print a diagnostic report without starting anything.
    Doctor,
    /// Show or change whether AI clients may operate a vault over MCP.
    Agents {
        /// Vault to look at. Omit it to use the vault you opened last.
        vault: Option<PathBuf>,
        /// Allow agent access.
        #[arg(long, conflicts_with = "off")]
        on: bool,
        /// Refuse agent access.
        #[arg(long)]
        off: bool,
    },
    /// Generate the bundled demo vault (concepts + two years of journal).
    SeedDemo {
        #[arg(default_value = "demo")]
        vault: PathBuf,
        #[arg(long)]
        force: bool,
    },
    /// Export a fully static build for GitHub Pages.
    Export {
        #[arg(default_value = ".")]
        vault: PathBuf,
        #[arg(long, default_value = "dist")]
        out: PathBuf,
        #[arg(long)]
        title: Option<String>,
    },
    /// Print index statistics without starting a server.
    Index {
        #[arg(default_value = ".")]
        vault: PathBuf,
    },
    /// Serve the vault to AI clients over the Model Context Protocol (stdio).
    Mcp {
        /// Vault to bind to. Omit it to use the vault you opened last.
        vault: Option<PathBuf>,
    },
    /// Print the MCP client configuration for this binary and vault.
    McpConfig {
        /// Vault the client should open. Omit it to use the last vault.
        #[arg(long)]
        vault: Option<PathBuf>,
        /// Merge the server into Claude Desktop and Cursor configs.
        #[arg(long)]
        write: bool,
    },
}

fn main() -> Result<()> {
    #[cfg(unix)]
    restore_sigpipe();

    match Cli::parse().command {
        None => launch::detach(),
        Some(Command::App) => launch::run_app(),
        Some(Command::Stop) => launch::stop(),
        Some(Command::Doctor) => doctor::run(),
        Some(Command::Serve {
            vault,
            bind,
            port,
            title,
            read_only,
            allow_any_origin,
            allow_framing,
            open,
            app,
        }) => {
            let roots = match vault {
                Some(path) => {
                    let canonical = fs::canonicalize(&path)
                        .with_context(|| format!("vault not found: {}", path.display()))?;
                    vec![canonical]
                }
                None => Vec::new(),
            };
            let config = app::Config {
                roots,
                title,
                read_only,
                allow_any_origin,
                allow_framing,
                open_browser: open || app,
                app_window: app,
                bind,
                port: port.unwrap_or(3000),
                port_fallback: port.is_none(),
                stop_token: instance::token(),
            };
            let runtime = tokio::runtime::Runtime::new()?;
            runtime.block_on(app::serve(config))
        }
        Some(Command::SeedDemo { vault, force }) => {
            let count = demo::seed(&vault, force).context("could not seed demo vault")?;
            println!("[cortex] wrote {count} notes to {}", vault.display());
            println!(
                "[cortex] next: cargo run -p cortex -- serve {}",
                vault.display()
            );
            Ok(())
        }
        Some(Command::Agents { vault, on, off }) => agent_switch(vault, on, off),
        Some(Command::Export { vault, out, title }) => export(&vault, &out, title),
        Some(Command::Index { vault }) => index(&vault),
        Some(Command::Mcp { vault }) => {
            let code = mcp::serve(vault);
            std::process::exit(code);
        }
        Some(Command::McpConfig { vault, write }) => mcp_setup::print_and_write(vault, write),
    }
}

/// Rust ignores `SIGPIPE`, so `cortex doctor | head` would panic on the closed
/// pipe. A CLI should exit quietly instead.
#[cfg(unix)]
fn restore_sigpipe() {
    extern "C" {
        fn signal(signum: i32, handler: usize) -> usize;
    }
    const SIGPIPE: i32 = 13;
    const SIG_DFL: usize = 0;
    unsafe {
        signal(SIGPIPE, SIG_DFL);
    }
}

/// The MCP switch is stored per vault in the registry, next to the vault list,
/// so the app and the command line agree without either one running.
fn agent_switch(vault: Option<PathBuf>, on: bool, off: bool) -> Result<()> {
    let mut registry = registry::Registry::load();
    let root = match vault {
        Some(path) => fs::canonicalize(&path)
            .with_context(|| format!("vault not found: {}", path.display()))?,
        None => registry
            .active
            .clone()
            .or_else(|| registry.recent().first().map(|entry| entry.path.clone()))
            .context("no vault is open; name a folder")?,
    };

    if on || off {
        if !registry.set_agents(&root, on) {
            registry.add(&root);
            registry.set_agents(&root, on);
        }
        registry.save().context("could not save the vault list")?;
    }

    let enabled = registry.agents(&root).unwrap_or(false);
    println!(
        "{}: agent access is {}",
        registry::name_for(&root),
        if enabled { "on" } else { "off" }
    );
    println!(
        "  {}",
        if enabled {
            "cortex mcp lets a client read and write this vault"
        } else {
            "cortex mcp refuses to start until this is turned back on"
        }
    );
    Ok(())
}

fn export(vault_path: &Path, out: &Path, title: Option<String>) -> Result<()> {
    let root = fs::canonicalize(vault_path)
        .with_context(|| format!("vault not found: {}", vault_path.display()))?;
    let title = title.unwrap_or_else(|| registry::name_for(&root));
    let vault = Vault::load(&root, title, ScanOptions::default())?;
    if vault.notes.is_empty() {
        anyhow::bail!("vault contains no Markdown notes");
    }
    let graph = GraphData::build(&vault, "export", &LayoutOptions::default()).with_bodies(&vault);

    fs::create_dir_all(out)?;
    let mut written = 0usize;
    for name in assets::iter() {
        if assets::sanitize(&name).is_none() {
            continue;
        }
        let Some((bytes, _)) = assets::get(&name) else {
            continue;
        };
        let target = out.join(&name);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, bytes)?;
        written += 1;
    }
    fs::write(out.join("graph.json"), graph.to_json())?;
    println!(
        "[cortex] exported {written} assets and graph.json ({} notes, {} links) to {}",
        vault.notes.len(),
        vault.edges.len(),
        out.display()
    );
    Ok(())
}

fn index(vault_path: &Path) -> Result<()> {
    let root = fs::canonicalize(vault_path)
        .with_context(|| format!("vault not found: {}", vault_path.display()))?;
    let vault = Vault::load(&root, registry::name_for(&root), ScanOptions::default())?;
    let graph = GraphData::build(&vault, "index", &LayoutOptions::default());

    let mut ranked = graph.nodes.iter().collect::<Vec<_>>();
    ranked.sort_by(|a, b| {
        b.pagerank
            .partial_cmp(&a.pagerank)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    println!("vault      {}", root.display());
    println!("notes      {}", graph.meta.note_count);
    println!("links      {}", graph.meta.link_count);
    println!("folders    {}", graph.meta.folder_count);
    println!("clusters   {}", graph.meta.cluster_count);
    println!("orphans    {}", graph.meta.orphan_count);
    println!("words      {}", graph.meta.word_count);
    println!("unresolved {}", vault.unresolved.len());
    println!("\nmost connected:");
    for node in ranked.iter().take(8) {
        println!(
            "  {:>5.3}  {:>3} links  {}",
            node.pagerank, node.degree, node.title
        );
    }
    Ok(())
}
