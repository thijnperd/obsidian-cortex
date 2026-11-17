# ADR 0005 — One process owns the window, the server and the tray

Status: accepted (2026-11-17)

## Context

`cortex` was a server with a UI attached: it ran in the foreground, so closing
the terminal killed it; on Windows a second launch died on `os error 10048`
before it could open anything; there was no tray, no `cortex stop`, and no way
to end it except Task Manager. The window itself is a Chromium `--app` window
(ADR 0004), which belongs to Chrome, Edge or Brave — not to us — so anything
that needs a lifetime has to be owned by a process we control.

## Decision

**The tray app owns everything.** `cortex` with no subcommand, and the Start
Menu shortcut, start one process that:

1. starts the axum server **in-process**, on a worker thread with its own tokio
   runtime;
2. writes the discovery file (`<config>/server.json`: port, pid, version,
   started-at, per-run stop token);
3. launches the app window and waits for that child process;
4. shows a tray icon on Windows and macOS with Open window, Show log, MCP
   status and Quit.

**The window's life is the app's life.** When the Chromium child exits, the app
stops the server, removes the discovery file and exits. Tray Quit does the same
thing. There is no minimize-to-tray, no Windows service, and no login item
unless the installer's "start at login" box was ticked. The tray is a launcher
and a status surface, not a daemon.

**A second launch hands off instead of binding.** It reads the discovery file,
probes the health endpoint for this instance's identity, and opens a window
against the running server. Only when there is no live instance does it bind:
port 3000 first, then the next free port, always recorded and printed. The file
is advisory — the health probe decides whether it is current.

**Console mode stays.** `cortex serve` is unchanged for every platform:
foreground, Ctrl+C, no tray. Linux has no tray (it would drag GTK and
appindicator into a binary that is currently self-contained), so it gets
`cortex stop`, which reads the discovery file and asks the server to exit over
loopback with the stop token. `cortex doctor` prints the config directory, the
discovery file, the vaults and their agent switches, the chosen port, whether a
Chromium browser was found, the log path and the last error. Logs go to
`<config>/cortex.log`, rotated once at 1 MiB.

## Considered options

- **Supervised child server.** Crash isolation, but two lifetimes to reconcile
  on Quit and a real chance of an orphaned server holding the port. Rejected:
  a server panic taking the app down is acceptable when the log has the panic.
- **Detached server plus a control panel.** Survives closing the window, which
  is exactly what the user asked not to happen.
- **Native embedded webview (Tauri).** The only option that also removes the
  browser dependency, tray plugins and updater included; parked rather than
  rejected, because it changes three webview targets and the origin guard, and
  is recorded here so nobody assumes the Chromium window is permanent.

## Consequences

- A crash in the server is now a crash of the app. That is the price of one
  process and an atomic Quit.
- Without a Chromium-family browser the app falls back to a normal tab, and a
  closed tab cannot be observed: that instance ends from the tray or
  `cortex stop`, not by closing the tab. Documented, not hidden.
- `server.json` contains a stop token, so it lives in the config directory
  (user-private) and never in the vault. `cortex stop` is loopback-only.
- `cortex doctor` becomes the first thing support asks for, so it must not
  depend on a running server.
