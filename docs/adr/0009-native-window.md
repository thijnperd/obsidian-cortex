# ADR 0009 — A native window owns the UI

Status: accepted (2026-11-19). Supersedes the window transport in ADR 0004 and
ADR 0005; the one-process, one-lifetime decision still stands.

## Context

ADR 0005 parked the native webview because a Chromium `--app` window was the
smallest change that removed the browser tab. It left three problems:

- the window belongs to Chrome, Edge or Brave, so the app has no icon, no
  single taskbar identity and no control over the profile;
- a machine without a Chromium-family browser gets a normal tab, and closing
  that tab cannot end the instance;
- `--app` plus a private profile is visibly a browser wearing a coat: first-run
  chrome, profile directories and a second process whose lifetime has to be
  guessed from outside.

v1.2 is the release where "a real app" is the point. The UI is still served by
the in-process axum server; only the host of that origin changes.

## Decision

**On Windows and macOS the UI runs in the system webview.**

- `wry` creates a WebView2 window on Windows and a WKWebView window on macOS,
  inside a `tao` event loop that also owns the tray.
- The window loads `http://127.0.0.1:<port>/` from the existing server. The
  origin, CSP, write header and same-origin guards are unchanged.
- The window may only navigate inside that origin. Any other http(s) URL is
  handed to the user's browser.
- Closing the window ends the app; tray Quit does the same. The tray keeps
  Open Cortex, Open in browser, Show log, agent status and Quit.
- If the webview cannot start (for example WebView2 is missing), Cortex logs
  the error and falls back to the browser instead of failing silently.
- The window and tray use the brain-spiral mark from `assets/icons/`. The
  Windows exe embeds `cortex.ico`; the macOS bundle carries `cortex.icns`.

**Linux keeps the browser path.** Wry links WebKitGTK 4.1, GTK 3 and libsoup 3;
a missing library stops the binary before `main`. v1.2 does not trade the
self-contained Linux build for a native window. It keeps the chromeless
Chromium window when one exists, a normal tab otherwise.

## Considered options

- **Tauri.** Same webviews plus a framework, plugins and a bundler. Cortex
  already has a server, installer and updater, so the framework would mostly be
  bypassed. Rejected for v1.2; see `docs/research/v1.2-native-window.md`.
- **Keep `--app`.** It works, but it is the exact complaint this release
  answers, and it cannot provide a real app identity.
- **Native window on Linux too.** Correct eventually, wrong for this release:
  it would make the Linux download depend on a WebKitGTK version that is not
  universal.

## Consequences

- `rust-version` moves to 1.85 (wry's MSRV).
- Windows and macOS now need a webview runtime: WebView2 on Windows, the system
  WebKit on macOS 12+.
- The macOS archive becomes `Cortex.app`, ad-hoc signed. A Developer ID
  certificate and notarization are still the only way to remove the Gatekeeper
  prompt for downloaded copies.
- Linux behaviour is unchanged and documented as such instead of implied.
- `cortex doctor` reports "WebView2 (native window)" or "WKWebView (native
  window)" on the platforms that use one, and the browser path elsewhere.
