# ADR 0004 — A window, a folder button, and an agent switch

Status: accepted (2026-11-17)

## Context

Three complaints, one shape: the app sat behind a browser and did not feel like
it belonged on the desktop.

1. "The app should be able to open file explorer." The vault is a real folder the
   user thinks about in Explorer terms, but the only way to reach it was to copy
   the path out of the toolbar.
2. "Cortex and graph and timeline aren't working with the Dragonlance vault."
   Not a rendering fault in the usual sense: the vault has no frontmatter dates,
   so every note carried the same date, `buildAppearValues` filled every birth
   time with `1`, and `smoothstep(1, 1.05, reveal)` is `0` for every reveal a
   session can reach — the stars and arcs were drawn-but-transparent in all
   three 3D views. The atlas, which never uses that value, was unaffected.
3. "MCP should be a thing that can be turned on and off." Agent access was
   all-or-nothing: if the binary was on the machine, any client could drive any
   vault.

## Decision

**App window, not an embedded webview.** `cortex` (and `serve --app`) launches
Chrome, Edge or Brave with `--app=<url>`, `--user-data-dir` pointed at
`<config>/app-profile`, and a 1440×900 window. It looks like an app — no tabs,
no address bar, its own dock/taskbar identity — and costs one `Command::spawn`
instead of a Tauri toolchain, a second build target per platform and a webview
version matrix. The fallback is a normal tab, and nothing breaks when no
Chromium-family browser exists. A real embedded window stays on the table, but
it is a distribution change, not a UI change, and this ADR should be reopened
rather than quietly grown into one.

**Reveal goes through the write guard.** `POST /api/reveal` needs the
`x-cortex: write` header and the same-origin check like every mutation, and the
note id it accepts is resolved by `store::note_path`, so `..` and dotfolders are
refused before anything reaches a process. The route spawns `explorer`,
`open -R` or `xdg-open` with the path as a single argument; a failure to start
one is a 500 the UI toasts, not silence. "Show in folder" appears in vault
settings and beside each vault in the sidebar, because that is where the user
looks when they want the folder, not the app.

**Agent access is a per-vault switch in the registry, deny by default.**
`vaults.json` carries `agents: bool` per entry; absent means off. That matters:
"unregistered means allowed" would have let a client bypass the switch by naming
a path. Opening a vault in Cortex, or `cortex agents <folder> --on`, creates the
switch. The MCP server checks it at startup *and* on every tool call, so turning
it off stops a session that is already connected — the client gets
`agents_off`, never a partial write. `cortex agents` reports and flips it from
the command line for when the app is closed.

**Birth times degrade to index order.** When a vault has no usable chronology —
no dates, or all the same — `buildAppearValues` now spreads `appear` across the
note index instead of filling with `1`, and undated notes in a partly-dated
vault are born at the start rather than never. The timeline scrubber says "No
dates in this vault" instead of inventing a year of history. The invariant to
keep: **every reachable reveal value must make every note's alpha non-zero.**

## Consequences

- The switch is stored per user and per machine, next to the vault list. It is
  not inside the vault, so it cannot be committed, and it does not travel with
  the folder. That is deliberate: it describes this machine's opinion about an
  agent, not a property of the notes.
- A folder Cortex has never opened cannot be driven by MCP until one command
  allows it. Slightly more friction, no bypass.
- `--app` depends on a browser being installed. With none, `cortex` opens a tab;
  the window feature is a nicety, never a requirement.
- The reveal route is another way to make the process spawn something, so it
  stays on the throttled write path and only ever receives `store`-validated
  paths.
