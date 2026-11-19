//! The native window on Windows and macOS.
//!
//! The UI is still served by the in-process axum server, but it is hosted by
//! the system webview (WebView2 on Windows, WKWebView on macOS) instead of a
//! chromeless Chrome process. There is no browser profile, no `--app` flag and
//! no second application to install.
//!
//! Linux keeps the browser path: linking WebKitGTK into the otherwise
//! self-contained binary is a bigger compatibility decision than v1.2 makes.

#![cfg(any(windows, target_os = "macos"))]

use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, Theme, WindowBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuId, MenuItem, PredefinedMenuItem};
use tray_icon::TrayIcon;
use wry::{WebContext, WebViewBuilder};

use crate::desktop;

const TRAY_LIGHT: &[u8] = include_bytes!("../../../assets/icons/tray-light-32.rgba");
const TRAY_DARK: &[u8] = include_bytes!("../../../assets/icons/tray-dark-32.rgba");
const WINDOW_ICON: &[u8] = include_bytes!("../../../assets/icons/cortex-window-64.rgba");

/// What the tray needs to stay useful: the log path and the per-vault switch.
pub struct TrayOptions {
    pub log: PathBuf,
    pub agent_access: bool,
}

struct MenuIds {
    open: MenuId,
    browser: MenuId,
    log: MenuId,
    quit: MenuId,
}

/// Owns the main thread until the window closes or the tray quits.
pub fn run(url: &str, tray: Option<TrayOptions>) -> Result<()> {
    let event_loop = EventLoopBuilder::new().build();

    let mut window_builder = WindowBuilder::new()
        .with_title("Cortex")
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(880.0, 620.0));
    if let Some(icon) = window_icon() {
        window_builder = window_builder.with_window_icon(Some(icon));
    }
    let window = window_builder
        .build(&event_loop)
        .context("could not create the Cortex window")?;

    let origin = url.trim_end_matches('/').to_string();
    let navigation_origin = origin.clone();
    let mut context = WebContext::new(Some(profile_dir()));
    let webview = WebViewBuilder::new_with_web_context(&mut context)
        .with_url(url)
        // The app is the loopback UI. Anything else belongs in the user's
        // browser, not in the app's only frame.
        .with_navigation_handler(move |target| {
            if target.starts_with(&navigation_origin) {
                return true;
            }
            if target.starts_with("http://") || target.starts_with("https://") {
                desktop::open_url(&target);
            }
            false
        })
        .build(&window)
        .context("could not create the Cortex webview")?;

    let tray_icon_bytes: &[u8] = if matches!(window.theme(), Some(Theme::Dark)) {
        TRAY_LIGHT
    } else {
        TRAY_DARK
    };

    let mut tray_icon: Option<TrayIcon> = None;
    let mut menu_ids: Option<MenuIds> = None;
    let mut tray_built = false;
    let url_owned = url.to_string();

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(250));

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                *control_flow = ControlFlow::Exit;
            }
            Event::MainEventsCleared => {
                if !tray_built {
                    tray_built = true;
                    if let Some(options) = &tray {
                        let built = build_tray(options, tray_icon_bytes);
                        tray_icon = built.0;
                        menu_ids = built.1;
                    }
                }

                while let Ok(event) = MenuEvent::receiver().try_recv() {
                    let Some(ids) = &menu_ids else { break };
                    if event.id == ids.quit {
                        *control_flow = ControlFlow::Exit;
                    } else if event.id == ids.open {
                        window.set_visible(true);
                        window.set_minimized(false);
                        window.set_focus();
                    } else if event.id == ids.browser {
                        desktop::open_url(&url_owned);
                    } else if event.id == ids.log {
                        if let Some(options) = &tray {
                            let _ = desktop::reveal(&options.log, true);
                        }
                    }
                }
            }
            _ => {}
        }

        // The webview and context are not Send; keeping them in the closure is
        // what guarantees they live as long as the window.
        let _ = (&window, &webview, &mut context, &tray_icon);
    });

    #[allow(unreachable_code)]
    Ok(())
}

fn build_tray(options: &TrayOptions, icon_bytes: &[u8]) -> (Option<TrayIcon>, Option<MenuIds>) {
    let menu = Menu::new();
    let open = MenuItem::new("Open Cortex", true, None);
    let browser = MenuItem::new("Open in browser", true, None);
    let show_log = MenuItem::new("Show log", true, None);
    let agent = MenuItem::new(
        format!(
            "Agent access: {}",
            if options.agent_access { "on" } else { "off" }
        ),
        false,
        None,
    );
    let quit = MenuItem::new("Quit Cortex", true, None);
    let separator = PredefinedMenuItem::separator();
    if menu
        .append_items(&[
            &open, &browser, &separator, &show_log, &agent, &separator, &quit,
        ])
        .is_err()
    {
        return (None, None);
    }
    let ids = MenuIds {
        open: open.id().clone(),
        browser: browser.id().clone(),
        log: show_log.id().clone(),
        quit: quit.id().clone(),
    };
    let icon = tray_icon::Icon::from_rgba(icon_bytes.to_vec(), 32, 32).ok();
    let mut builder = tray_icon::TrayIconBuilder::new()
        .with_menu(Box::new(menu))
        .with_tooltip("Cortex")
        .with_autosave_name("cortex");
    if let Some(icon) = icon {
        builder = builder.with_icon(icon);
    }
    (builder.build().ok(), Some(ids))
}

fn window_icon() -> Option<Icon> {
    Icon::from_rgba(WINDOW_ICON.to_vec(), 64, 64).ok()
}

/// WebView2 refuses to write beside an installed exe under Program Files, so
/// every user gets a data directory of their own.
fn profile_dir() -> PathBuf {
    cortex_core::registry::config_path()
        .and_then(|path| path.parent().map(|dir| dir.join("window-profile")))
        .unwrap_or_else(|| std::env::temp_dir().join("cortex-window-profile"))
}
