//! `cortex doctor`: everything a bug report needs, without starting a server.

use cortex_core::registry::Registry;

use crate::{desktop, instance, mcp_setup, version};

pub fn run() -> anyhow::Result<()> {
    println!("cortex {} ({})", version::VERSION, version::build());
    println!(
        "config   {}",
        instance::config_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "unknown".into())
    );
    println!(
        "log      {}",
        instance::log_path()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| "unknown".into())
    );

    match instance::live() {
        Some((_, discovery)) => println!(
            "running  port {} · pid {} · started {} · {}",
            discovery.port, discovery.pid, discovery.started_ms, discovery.build
        ),
        None => println!("running  no live instance"),
    }

    println!("browser  {}", desktop::browser_label());

    let registry = Registry::load();
    if registry.vaults.is_empty() {
        println!("vaults   none yet — run `cortex` and pick a folder");
    } else {
        println!("vaults");
        for entry in registry.recent() {
            println!(
                "  {}  agents {}  {}{}",
                entry.name,
                if entry.agents { "on " } else { "off" },
                entry.path.display(),
                if entry.path.is_dir() {
                    ""
                } else {
                    "  (missing)"
                }
            );
        }
    }

    println!("mcp clients");
    let active = registry
        .active
        .clone()
        .or_else(|| registry.recent().first().map(|entry| entry.path.clone()));
    match active {
        Some(root) => {
            for client in mcp_setup::status(&root) {
                println!(
                    "  {}  {}  {}",
                    client.name,
                    if client.configured {
                        "configured"
                    } else if client.present {
                        "not configured"
                    } else {
                        "not installed"
                    },
                    client.path.unwrap_or_default()
                );
            }
        }
        None => println!("  no vault, so nothing to configure"),
    }
    Ok(())
}
