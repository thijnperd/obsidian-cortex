# Notes for coding agents

Cortex is a Rust binary that serves a Markdown vault and its UI. Read
`GLOSSARY.md` first if a term is unclear; `docs/adr/` records why things are the
way they are.

## Commands

```bash
cargo test --workspace --all-targets     # 95+ tests, fast
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
cargo run -q -p cortex -- seed-demo demo # deterministic 174-note vault
cargo run -q -p cortex -- serve demo --open
cargo run -q -p cortex -- export demo --out dist
cargo run -q -p cortex -- mcp demo       # MCP server on stdio
cargo run -q -p cortex -- mcp-config --vault demo --write
cargo run -q -p cortex -- agents --off   # the per-vault MCP switch
cargo run -q -p cortex -- doctor         # no server needed
cargo run -q -p cortex -- stop           # ask the background instance to exit
node --check web/js/*.js                 # no build step for the UI
```

`cargo` may not be on `PATH` in a fresh shell: `export PATH="$HOME/.cargo/bin:$PATH"`.

## Layout

| Path | What lives there |
| --- | --- |
| `crates/core` | Vault scan, Markdown parsing, links, graph, layout, store, registry, search, demo generator. No I/O beyond the vault scan. |
| `crates/server/src/app.rs` | The axum app: multi-vault state, watcher, long poll, write guards. |
| `crates/server/src/mcp.rs` | `cortex mcp`: JSON-RPC over stdio, 13 tools, journal. |
| `crates/server/src/assets.rs` | Embeds `web/` into the binary (debug builds read from disk). |
| `web/` | Hand-written UI: no framework, no bundler, ES modules. |
| `docs/` | ADRs, the UI audit, the agent guide. |
| `evals/` | Read-only MCP evaluations, run by hand before a release. |

## Rules that bite

- **Determinism.** Layout and atlas geometry come from the graph, a fixed
  golden angle, or a position-keyed hash. Never `Math.random()` or time.
- **stdout is the MCP protocol.** In `mcp.rs`, log to stderr only.
- **Writes go through `store`.** It validates paths, writes atomically via
  `replace_file` (Windows refuses rename-onto-existing) and caps size.
- **The UI has no build step.** Edit `web/` and reload; do not add a bundler.
- **Tokens, not magic numbers,** in `web/styles.css`; a mode swaps custom
  properties (`body.mode-atlas`), it does not restyle components.
- **Never weaken a guard to make a test pass** — path checks, origin checks and
  the write header all have tests.
- **Revealing a file is a write-class action.** `/api/reveal` takes a note id and
  resolves it with `store::note_path`; never pass a raw path to a process.
- **Agent access is deny-by-default.** A vault with no `agents` entry in the
  registry has no access; do not "fix" that by defaulting to allowed.
- **One process owns an instance.** `cortex app` runs the server in-process and
  its life is the window's; `serve` is the console path. `server.json` is a
  discovery file, not a lock — the health probe decides whether it is current.
- **The window belongs to the browser.** It is Chromium `--app` with a private
  profile; the app waits on that child. Do not "improve" this into a webview
  without reopening ADR 0005.
- **Every note must survive the reveal animation.** `appear` values feed
  `smoothstep(appear, appear + 0.05, reveal)`; a value at or above 1 hides the
  note in every 3D view.

## Vault agents (different from you)

If you are asked to *edit notes* rather than code, use `cortex mcp` and follow
`docs/agent-guide.md`. That path writes to the user's real vault; the rules
there (no delete, preconditions, house format) are not optional.
