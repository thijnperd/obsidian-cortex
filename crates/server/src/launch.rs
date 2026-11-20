//! Starting, finding and stopping an instance.
//!
//! `cortex` with no subcommand detaches `cortex app`, so the terminal comes
//! back and closing it changes nothing. `cortex app` is the one process that
//! owns the server in-process and opens the window — a native WebView2/WKWebView
//! window on Windows and macOS, the browser on Linux. Its life is the window's.

use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

#[cfg(any(windows, target_os = "macos"))]
use std::path::PathBuf;

use anyhow::{Context, Result};
use tokio::sync::{oneshot, watch};

use crate::app::{self, Config};
use crate::{desktop, instance, version};

/// `cortex`: hand the app a detached process and return the prompt.
pub fn detach() -> Result<()> {
    if let Some((_, live)) = instance::live() {
        println!("[cortex] already running on port {}", live.port);
        desktop::open_url(&format!("http://127.0.0.1:{}/", live.port));
        return Ok(());
    }

    let exe = std::env::current_exe().context("could not find the cortex binary")?;
    let log = instance::log_path();
    let mut command = Command::new(exe);
    command.arg("app");
    if let Some(log) = &log {
        if let Some(parent) = log.parent() {
            std::fs::create_dir_all(parent)?;
        }
        rotate(log);
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(log)?;
        command.stdout(Stdio::from(file.try_clone()?));
        command.stderr(Stdio::from(file));
    }
    command.stdin(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // DETACHED_PROCESS | CREATE_NO_WINDOW: no console, and no console flash.
        command.creation_flags(0x0000_0008 | 0x0800_0000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so a closing terminal does not take it down.
        command.process_group(0);
    }

    let child = command.spawn().context("could not start Cortex")?;
    println!("[cortex] starting in the background (pid {})", child.id());
    if let Some(log) = log {
        println!("[cortex] log: {}", log.display());
    }
    Ok(())
}

fn rotate(log: &Path) {
    if let Ok(meta) = std::fs::metadata(log) {
        if meta.len() > 1024 * 1024 {
            let _ = std::fs::rename(log, log.with_extension("log.1"));
        }
    }
}

/// `cortex app`: the instance.
pub fn run_app() -> Result<()> {
    hide_console();

    if let Some((_, live)) = instance::live() {
        println!("[cortex] already running on port {}", live.port);
        desktop::open_url(&format!("http://127.0.0.1:{}/", live.port));
        return Ok(());
    }

    let token = instance::token();
    let (stop_tx, _) = watch::channel(false);
    let (ready_tx, ready_rx) = oneshot::channel::<u16>();
    let server_stop = stop_tx.clone();
    let config = Config {
        roots: Vec::new(),
        title: None,
        read_only: false,
        allow_any_origin: false,
        allow_framing: false,
        open_browser: false,
        app_window: false,
        bind: "127.0.0.1".to_string(),
        port: 3000,
        port_fallback: true,
        offline: std::env::var("CORTEX_OFFLINE").is_ok_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        }),
        stop_token: token.clone(),
    };

    let server = std::thread::Builder::new()
        .name("cortex-server".to_string())
        .spawn(move || -> Result<()> {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()?;
            runtime.block_on(app::serve_with(config, Some(ready_tx), Some(server_stop)))
        })?;

    let port = match ready_rx.blocking_recv() {
        Ok(port) => port,
        Err(_) => {
            let _ = server.join();
            anyhow::bail!(
                "Cortex could not start; see {}",
                instance::log_path()
                    .map(|path| path.display().to_string())
                    .unwrap_or_else(|| "the log".into())
            );
        }
    };

    let discovery = instance::Discovery {
        port,
        pid: std::process::id(),
        version: version::VERSION.to_string(),
        build: version::build().to_string(),
        started_ms: instance::now_ms(),
        token: token.clone(),
    };
    let file = instance::path();
    if let Some(file) = &file {
        instance::write_to(file, &discovery)?;
    }

    let url = format!("http://127.0.0.1:{port}/");
    let (_, agents) = instance::active_agent();

    #[cfg(any(windows, target_os = "macos"))]
    {
        let log = instance::log_path().unwrap_or_else(|| PathBuf::from("cortex.log"));
        // Returns when the window closes or the tray asks to quit.
        let outcome = crate::native::run(
            &url,
            Some(crate::native::TrayOptions {
                log,
                agent_access: agents,
            }),
        );
        if let Err(error) = outcome {
            eprintln!("[cortex] the native window could not start: {error:#}");
            eprintln!("[cortex] opening the UI in your browser instead");
            desktop::open_url(&url);
            let _ = server.join();
        } else {
            let _ = stop_tx.send(true);
            let _ = server.join();
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        // No native webview on Linux: a chromeless browser window if one is
        // installed, otherwise a normal tab. The instance lives until
        // `cortex stop` ends the server.
        let _ = desktop::open_window(&url, 1440, 900);
        let _ = agents;
        let _ = server.join();
    }
    if let Some(file) = &file {
        let ours = instance::read_from(file)
            .map(|current| current.token == token)
            .unwrap_or(false);
        if ours {
            instance::clear(file);
        }
    }
    Ok(())
}

/// `cortex stop`: ask the live instance to exit and wait for the port to close.
pub fn stop() -> Result<()> {
    let Some((file, live)) = instance::live() else {
        if let Some(file) = instance::path() {
            if instance::read_from(&file).is_some() {
                instance::clear(&file);
                println!("[cortex] removed a stale discovery file; nothing was running");
                return Ok(());
            }
        }
        println!("[cortex] no running instance");
        return Ok(());
    };
    instance::stop(&live).map_err(anyhow::Error::msg)?;
    for _ in 0..30 {
        std::thread::sleep(Duration::from_millis(200));
        if instance::probe(live.port).is_none() {
            instance::clear(&file);
            println!("[cortex] stopped");
            return Ok(());
        }
    }
    anyhow::bail!("Cortex was asked to stop but is still listening; run `cortex doctor`")
}

/// A console-subsystem binary shows a console window even for the app. Detach
/// from it: when launched from a terminal the terminal stays, and when
/// launched from Explorer the window closes.
#[cfg(windows)]
fn hide_console() {
    extern "system" {
        fn FreeConsole() -> i32;
    }
    unsafe {
        FreeConsole();
    }
}

#[cfg(not(windows))]
fn hide_console() {}
