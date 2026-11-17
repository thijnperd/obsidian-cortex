mod app;
mod assets;

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
    /// With no subcommand, Cortex reopens the vault you used last.
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Serve a vault and its universe in the browser.
    Serve {
        /// Folder to open. Omit it to reopen the last vault.
        vault: Option<PathBuf>,
        #[arg(long, default_value = "127.0.0.1")]
        bind: String,
        #[arg(long, default_value_t = 3000)]
        port: u16,
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
}

#[tokio::main]
async fn main() -> Result<()> {
    match Cli::parse().command {
        None => {
            app::serve(app::Config {
                roots: Vec::new(),
                title: None,
                read_only: false,
                allow_any_origin: false,
                allow_framing: false,
                open_browser: true,
                bind: "127.0.0.1".to_string(),
                port: 3000,
            })
            .await
        }
        Some(Command::Serve {
            vault,
            bind,
            port,
            title,
            read_only,
            allow_any_origin,
            allow_framing,
            open,
        }) => {
            let roots = match vault {
                Some(path) => {
                    let canonical = fs::canonicalize(&path)
                        .with_context(|| format!("vault not found: {}", path.display()))?;
                    vec![canonical]
                }
                None => Vec::new(),
            };
            app::serve(app::Config {
                roots,
                title,
                read_only,
                allow_any_origin,
                allow_framing,
                open_browser: open,
                bind,
                port,
            })
            .await
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
        Some(Command::Export { vault, out, title }) => export(&vault, &out, title),
        Some(Command::Index { vault }) => index(&vault),
    }
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
