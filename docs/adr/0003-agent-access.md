# ADR 0003 — Agent access over MCP

Status: accepted (2026-11-17)

## Context

The vault is the user's own folder of Markdown, and the assistant they already
use — Claude Desktop, Cursor, Zed — has no idea it exists. Anything an agent
does inside Cortex today has to be typed by a human. The request was explicit:
an AI should be able to inspect the filesystem, create notes, and reformat
existing ones from the desktop app, without a second account or a model key.

Two products were possible: an assistant that lives inside the Cortex window
(needs an API key, streaming UI, spend limits, a model allowlist), or a server
that lets the user's own AI client operate the vault. The user chose the second.

## Decision

**MCP over stdio, as a `cortex mcp` subcommand of the shipped binary.** No new
runtime, no Node package, no network listener, one archive installs everything.
`cortex mcp <vault>` pins a folder; without an argument it binds to the vault
opened last. `cortex mcp-config` prints the exact JSON a client needs.

**Thirteen tools, all thin wrappers over `cortex_core`.** The vault loader, path
validation, atomic writer and 1 MiB cap are the same code the UI uses, so an
agent cannot reach a place the UI could not: no dotfolders, no escapes, no
symlink tricks. Reads: guide, stats, search, read, links, orphans, list vaults.
Writes: create, write, replace_section, append, move, use_vault.

**No delete.** There is no tool that removes a note. `move` is the only
operation that unlinks a file, and it does so only after the new copy is
written. An agent that thinks a note should go has to say so to the human.

**Preconditions, not last-writer-wins.** `read_note` returns an FNV-1a hash of
the body; every write must pass it back as `expect`. A mismatch returns a
`conflict` with the *current* hash, so the model can re-read and redo the edit.
This matters because the vault is usually open in Obsidian at the same time —
Cortex writes whole files, and Obsidian reloads them the moment they land.

**`replace_section` exists because whole-file writes are lossy.** Rewriting a
note to change one paragraph is how agents quietly delete the rest. The narrow
tool is the default recommendation in the guide and in the tool description.

**House style is an instruction, not a formatter.** The user's call: the model
is told the rules (one H1 matching the file name, ATX headings, `[[wikilinks]]`,
frontmatter keys Cortex reads, whitespace discipline) rather than being given a
deterministic `cortex format`. This is cheaper and keeps the guide in one place,
at the cost of drift: two models will format the same note slightly differently,
and nothing enforces the rules. If drift becomes visible, a `format --check`
tool is the natural follow-up, and this ADR should be revised rather than
quietly contradicting it.

**Every write is journalled.** One JSON line per mutation in
`agent-writes.jsonl` next to `vaults.json`: timestamp, tool, vault, note id,
bytes. Not an undo log — there is no undo — but enough for the human to see
what an agent touched after the fact.

**Evals are committed.** `evals/agent-evals.xml` holds ten read-only questions
whose answers were verified against the deterministic demo vault. They are run
by hand before a release; they are not in CI because they need a model client.

## Consequences

- stdout is the protocol. Any stray `println!` in this path corrupts the
  session, so diagnostics go to stderr; the module says so at the top.
- One client process = one session = one bound vault at a time. Switching
  vaults mid-session is `cortex_use_vault`, not a second connection.
- Remote access is out of scope. The HTTP server stays human-facing, with its
  own origin and header checks; MCP clients speak stdio to a local process.
- Edits made by an agent land in the running app within ~400 ms through the
  existing watcher, with no special case.
- The FNV hash is a change detector, not a security primitive. It stops
  accidental clobbering; it does not authenticate anything, because the agent
  already has the same filesystem access as the process.
