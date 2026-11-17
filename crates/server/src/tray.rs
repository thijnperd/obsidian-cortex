//! The tray: a launcher and a status surface, not a daemon.
//!
//! The window is the clock. When the Chromium child exits, the app exits; the
//! tray menu's Quit does the same thing deliberately.

#![cfg(any(windows, target_os = "macos"))]

use std::path::PathBuf;
use std::process::Child;
use std::time::{Duration, Instant};

use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::TrayIcon;
use winit::application::ApplicationHandler;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};

use crate::desktop;

pub enum Exit {
    WindowClosed,
    Quit,
}

struct App {
    url: String,
    log: PathBuf,
    agent_label: String,
    child: Option<Child>,
    started: Instant,
    tray: Option<TrayIcon>,
    open: Option<tray_icon::menu::MenuId>,
    show_log: Option<tray_icon::menu::MenuId>,
    quit: Option<tray_icon::menu::MenuId>,
    exit: Option<Exit>,
}

impl App {
    fn build_tray(&mut self) {
        if self.tray.is_some() {
            return;
        }
        let menu = Menu::new();
        let open = MenuItem::new("Open Cortex", true, None);
        let show_log = MenuItem::new("Show log", true, None);
        let agent = MenuItem::new(format!("Agent access: {}", self.agent_label), false, None);
        let quit = MenuItem::new("Quit Cortex", true, None);
        let separator = PredefinedMenuItem::separator();
        if menu
            .append_items(&[&open, &show_log, &agent, &separator, &quit])
            .is_err()
        {
            return;
        }
        self.open = Some(open.id().clone());
        self.show_log = Some(show_log.id().clone());
        self.quit = Some(quit.id().clone());
        self.tray = tray_icon::TrayIconBuilder::new()
            .with_menu(Box::new(menu))
            .with_tooltip("Cortex")
            .with_icon(icon())
            .build()
            .ok();
    }

    fn quit(&mut self, event_loop: &ActiveEventLoop, exit: Exit) {
        if matches!(exit, Exit::Quit) {
            if let Some(mut child) = self.child.take() {
                let _ = child.kill();
            }
        }
        self.exit = Some(exit);
        event_loop.exit();
    }
}

impl ApplicationHandler for App {
    fn resumed(&mut self, _event_loop: &ActiveEventLoop) {}

    fn window_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _id: winit::window::WindowId,
        _event: winit::event::WindowEvent,
    ) {
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        self.build_tray();

        while let Ok(event) = MenuEvent::receiver().try_recv() {
            if Some(&event.id) == self.quit.as_ref() {
                self.quit(event_loop, Exit::Quit);
                return;
            }
            if Some(&event.id) == self.open.as_ref() {
                let _ = desktop::open_window(&self.url, 1440, 900);
            }
            if Some(&event.id) == self.show_log.as_ref() {
                if !self.log.as_os_str().is_empty() {
                    let _ = desktop::reveal(&self.log, true);
                }
            }
        }

        // Give the browser a moment to hand the window over to its own process
        // before treating an exit as "the window was closed".
        if self.started.elapsed() > Duration::from_secs(3) {
            if let Some(child) = &mut self.child {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    self.quit(event_loop, Exit::WindowClosed);
                    return;
                }
            }
        }

        event_loop.set_control_flow(ControlFlow::WaitUntil(
            Instant::now() + Duration::from_millis(300),
        ));
    }
}

pub fn run(
    url: &str,
    log: PathBuf,
    agent_label: &str,
    child: Option<Child>,
) -> anyhow::Result<Exit> {
    let event_loop = EventLoop::new()?;
    event_loop.set_control_flow(ControlFlow::Wait);
    let mut app = App {
        url: url.to_string(),
        log,
        agent_label: agent_label.to_string(),
        child,
        started: Instant::now(),
        tray: None,
        open: None,
        show_log: None,
        quit: None,
        exit: None,
    };
    event_loop.run_app(&mut app)?;
    Ok(app.exit.unwrap_or(Exit::Quit))
}

/// A ring, drawn rather than shipped: no icon file to find at runtime.
fn icon() -> tray_icon::Icon {
    const SIZE: u32 = 32;
    let mut rgba = vec![0u8; (SIZE * SIZE * 4) as usize];
    let centre = (SIZE as f32 - 1.0) / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let dx = x as f32 - centre;
            let dy = y as f32 - centre;
            let distance = (dx * dx + dy * dy).sqrt();
            if (9.0..=13.0).contains(&distance) {
                let index = ((y * SIZE + x) * 4) as usize;
                rgba[index] = 232;
                rgba[index + 1] = 208;
                rgba[index + 2] = 154;
                rgba[index + 3] = 255;
            }
        }
    }
    tray_icon::Icon::from_rgba(rgba, SIZE, SIZE).expect("32x32 icon")
}
