# Security

Cortex is a local-first desktop app: it reads a folder you choose, binds to
loopback by default, has no account system, no telemetry and no cloud service.

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** flow on the repository's Security
tab. Do not open a public issue for a suspected vulnerability, and do not attach
a real vault or credentials. If the private flow is unavailable, open a minimal
issue asking for a private channel; it will be moved out of public view.

Include the affected version (`cortex --version`), platform, reproduction steps
and the smallest note/folder that demonstrates the problem. You should receive
an acknowledgement within a few days.

## Supported versions

Security fixes are shipped on the latest stable release. Pre-1.0 releases are
not maintained after the next stable tag.

## Relevant boundaries

- **Local files only.** Note ids pass through `store::note_path`, which rejects
  absolute paths, dot segments, symlinks, control characters and non-Markdown
  extensions. Writes are atomic and size-capped.
- **Loopback by default.** Exposing the server on a LAN (`--bind 0.0.0.0`)
  requires the operator to opt in; `--allow-any-origin` further relaxes the
  browser boundary and should not be used on an untrusted network.
- **Write guard.** Mutations require the `x-cortex` header and a same-origin
  check. `--read-only` removes the write routes.
- **Agents are deny-by-default.** MCP access is per-vault and off for a folder
  Cortex has never opened. Writes carry a precondition hash and never delete.
- **No secrets in the vault.** Cortex has no API keys, accounts or embedded
  model. AI clients run outside the process and receive only the tools the user
  enables.

The full reasoning is in `docs/adr/0003-agent-access.md` and
`docs/adr/0001-vault-binding-and-live-updates.md`.
