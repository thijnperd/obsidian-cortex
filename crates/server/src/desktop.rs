//! Handing work to the desktop: a window for the app, a window for the vault
//! folder, and "show me this file" in the platform file manager.
//!
//! Every call spawns a detached process with the URL or path as a single
//! argument. No shell, no string interpolation, and a failure to launch is
//! returned to the caller instead of being swallowed.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use cortex_core::registry;
use cortex_core::store;

/// Opens `url` in whatever the desktop treats as the default browser.
pub fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("cmd");
        // `start` reads the first quoted argument as a window title.
        command.args(["/C", "start", "", url]);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(url);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(url);
        command
    };
    spawn(&mut command);
}

/// Opens the UI as a chromeless app window instead of a browser tab: Chrome,
/// Edge or Brave with `--app`, in a profile of its own so it does not disturb
/// the browser session and does not hit "already running".
///
/// Returns the window's process when one was started; the caller keeps it to
/// know when the window closed. `None` means no Chromium-family browser exists.
pub fn open_app_window(url: &str, width: u32, height: u32) -> Option<Child> {
    let profile = app_profile();
    let _ = std::fs::create_dir_all(&profile);
    for executable in chromium_candidates() {
        let mut command = Command::new(&executable);
        command
            .arg(format!("--app={url}"))
            .arg(format!("--window-size={width},{height}"))
            .arg(format!("--user-data-dir={}", profile.display()))
            .arg("--no-first-run")
            .arg("--no-default-browser-check");
        command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        if let Ok(child) = command.spawn() {
            return Some(child);
        }
    }
    None
}

/// A chromeless window if possible, a normal browser tab otherwise.
pub fn open_window(url: &str, width: u32, height: u32) -> Option<Child> {
    match open_app_window(url, width, height) {
        Some(child) => Some(child),
        None => {
            open_url(url);
            None
        }
    }
}

/// Pick a folder with the platform's own dialog.
///
/// Windows gets the real file dialog; macOS and Linux have no in-process GUI
/// here, so they ask their picker command rather than linking a toolkit into a
/// binary that is otherwise self-contained. `None` means cancelled, or no
/// picker available — the typed path still works.
pub async fn pick_folder() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        return tokio::task::spawn_blocking(|| {
            rfd::FileDialog::new()
                .set_title("Open a Markdown folder")
                .pick_folder()
        })
        .await
        .ok()
        .flatten();
    }
    #[cfg(target_os = "macos")]
    {
        let output = tokio::process::Command::new("osascript")
            .args([
                "-e",
                "POSIX path of (choose folder with prompt \"Open a Markdown folder\")",
            ])
            .output()
            .await
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return (!path.is_empty()).then(|| PathBuf::from(path));
    }
    #[cfg(target_os = "linux")]
    {
        for (program, args) in [
            (
                "zenity",
                vec![
                    "--file-selection",
                    "--directory",
                    "--title=Open a Markdown folder",
                ],
            ),
            (
                "kdialog",
                vec!["--getexistingdirectory", ".", "Open a Markdown folder"],
            ),
        ] {
            let Ok(output) = tokio::process::Command::new(program)
                .args(args)
                .output()
                .await
            else {
                continue;
            };
            if !output.status.success() {
                return None;
            }
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(PathBuf::from(path));
            }
        }
        None
    }
}

/// For `cortex doctor`: which browser would host the window.
pub fn browser_label() -> String {
    match chromium_candidates().first() {
        Some(path) => path.display().to_string(),
        None => "no Chromium browser found — the UI opens as a normal tab".to_string(),
    }
}

/// Resource directory for the app window: `vaults.json` lives in the config
/// directory, so the profile sits beside it.
fn app_profile() -> PathBuf {
    registry::config_path()
        .and_then(|path| path.parent().map(|dir| dir.join("app-profile")))
        .unwrap_or_else(|| std::env::temp_dir().join("cortex-app-profile"))
}

fn chromium_candidates() -> Vec<PathBuf> {
    let mut found = Vec::new();
    #[cfg(target_os = "windows")]
    {
        const RELATIVE: [&str; 3] = [
            "Microsoft\\Edge\\Application\\msedge.exe",
            "Google\\Chrome\\Application\\chrome.exe",
            "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
        ];
        for base in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            let Ok(root) = std::env::var(base) else {
                continue;
            };
            for relative in RELATIVE {
                found.push(Path::new(&root).join(relative));
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        for relative in [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ] {
            found.push(PathBuf::from(relative));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        for name in [
            "google-chrome",
            "google-chrome-stable",
            "chromium",
            "chromium-browser",
            "microsoft-edge",
            "brave-browser",
        ] {
            if let Some(path) = on_path(name) {
                found.push(path);
            }
        }
    }
    found.retain(|path| path.is_file());
    found
}

#[cfg(all(unix, not(target_os = "macos")))]
fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(name))
        .find(|candidate| candidate.is_file())
}

/// Shows `path` in Explorer, Finder or the desktop file manager. `select`
/// highlights the file itself where the platform supports it.
pub fn reveal(path: &Path, select: bool) -> bool {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        if select && path.is_file() {
            // One argument: `/select,<path>`.
            command.arg(format!("/select,{}", path.display()));
        } else {
            command.arg(path);
        }
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        if select && path.is_file() {
            command.arg("-R");
        }
        command.arg(path);
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        // xdg-open has no "select", so a note reveals its folder.
        let target = match (select, path.parent()) {
            (true, Some(parent)) => parent,
            _ => path,
        };
        let mut command = Command::new("xdg-open");
        command.arg(target);
        command
    };
    spawn(&mut command)
}

/// What a reveal request turns into: the folder, or a note inside it.
///
/// The note id goes through `store::note_path`, so the same rules as a write
/// apply — no `..`, no dotfolders, no symlink escapes. A bad id is an error,
/// never a path handed to the file manager.
pub fn reveal_target(
    root: &Path,
    note: Option<&str>,
) -> Result<(PathBuf, bool), cortex_core::Error> {
    match note {
        Some(id) if !id.trim().is_empty() => Ok((store::note_path(root, id)?, true)),
        _ => Ok((root.to_path_buf(), false)),
    }
}

fn spawn(command: &mut Command) -> bool {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reveals_the_folder_when_no_note_is_named() {
        let dir = tempfile::tempdir().unwrap();
        let (path, select) = reveal_target(dir.path(), None).unwrap();
        assert_eq!(path, dir.path());
        assert!(!select);
    }

    #[test]
    fn reveals_a_note_inside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("World")).unwrap();
        std::fs::write(dir.path().join("World/Istar.md"), "# Istar\n").unwrap();
        let (path, select) = reveal_target(dir.path(), Some("World/Istar")).unwrap();
        assert!(path.ends_with("World/Istar.md"));
        assert!(select);
    }

    #[test]
    fn refuses_to_reveal_outside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        assert!(reveal_target(dir.path(), Some("../../etc/passwd")).is_err());
        assert!(reveal_target(dir.path(), Some(".obsidian/app")).is_err());
    }
}
