# ADR 0001 — Vault binding, multiple vaults, and live updates

Status: accepted (2026-11-17)

## Context

Cortex began as `cortex serve <path>`: one folder, chosen on the command line,
with a 2.5 s watcher that rebuilt the whole vault and recomputed the layout, and
a client that polled `/api/version` every 5 s. Opening a different folder meant
stopping the process.

Obsidian's model is the reference: launch, see your vaults, open one, and have
edits appear while you work. Three consequences: the vault has to be remembered,
several can be open at once, and a change must land without the graph jumping.

## Decision

**Registry on disk.** `vaults.json` under the platform config directory
(`$XDG_CONFIG_HOME/cortex`, `~/Library/Application Support/cortex`,
`%APPDATA%\cortex`, overridable with `CORTEX_CONFIG_DIR`). Paths, display names
and last-opened timestamps only — never note contents. Writes are atomic
(temp file + rename), a corrupt file reads as empty rather than failing.

**No native folder dialog yet.** A browser cannot hand a filesystem path to the
Rust process (the File System Access API yields a handle, not a path), and a
native dialog (`rfd`) drags GTK into the Linux build. The launch screen lists
recents and accepts a typed path, with `~` expansion. The dialog is a
progressive enhancement for the packaged binary, not a requirement for the flow.

**Several vaults, one process.** Each vault owns a `VaultHandle` (root, name,
snapshot, alive flag) and its own watcher. Requests select one with `?vault=`;
the last opened is the default. `GET /api/vaults` merges loaded handles with
registry entries so a folder that has been moved still appears, marked missing.

**Stat-poll instead of an OS watcher crate.** One blocking walk per 400 ms
comparing `(id, mtime, size)`. For 8 000 notes that is tens of milliseconds, is
identical on Windows, macOS, Linux, network shares and containers, and adds no
dependency. The real latency win is what happens *after* the change is noticed,
not how it is noticed.

**Incremental re-parse.** `Vault::load_with(previous)` reuses any note whose
size and mtime are unchanged, and re-resolves links. An edit costs one file.

**Pinned positions.** `GraphData::build_with_positions` keeps the previous
position of every note that still exists; only new notes get a computed
position. Without this the universe rearranges itself on every keystroke, which
makes places unmemorable and is the opposite of what the graph is for.

**Long poll instead of SSE.** `GET /api/events?vault=&since=<version>` parks on
a `tokio::sync::watch` receiver for up to 25 s and returns the current version.
The client reconnects immediately. Sub-second delivery with no extra
dependency, no event-stream parsing, and no proxy surprises.

**History in the panel.** Opening a note pushes onto a stack; `‹`/`›`
(`⌘[`/`⌘]`) move through it. A navigation token ensures a slow response cannot
overwrite a page the user has already left.

## Consequences

- Opening a folder from the UI is a **regular** mutation surface: it needs the
  `x-cortex: write` header and the same-origin check. It deliberately ignores
  `--read-only`, because reading a folder is not writing to it. Combined with
  `--allow-any-origin` this means anyone who can reach the server can point it
  at any folder the process can read — documented, and the reason loopback is
  the default.
- The registry is global to the user, not per project. Two servers share it;
  last write wins.
- `--read-only` still blocks note writes, synthesis and new notes.
- A vault whose folder disappears stays in the list until forgotten; the
  launch screen shows it struck through.
- Static export is unchanged and still demo-only on GitHub Pages: with no
  `/api/vaults`, the UI falls back to `graph.json` and the read-only path.
