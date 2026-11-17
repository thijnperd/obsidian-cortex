# ADR 0006 — Ship a per-user installer, unsigned, with a real version

Status: accepted (2026-11-17)

## Context

The download was a zip containing one executable that reported `0.1.0`
forever. There was no install or uninstall story, SmartScreen called the
unsigned binary suspicious, and the repository is private — which means the
release archive needs a signed-in collaborator to download it, and GitHub build
attestations are unavailable on a private repository outside Enterprise Cloud.

## Decision

**The version comes from the git tag.** CI passes the tag as `CORTEX_VERSION`;
`--version` and the About panel show it. `Cargo.toml` is bumped to the same
number at release time, so a binary built from source still reports something
honest. Rolling `latest` builds show the version plus the short commit; local
builds show `dev`.

**Windows ships an Inno Setup installer, per-user, no admin:**
`%LOCALAPPDATA%\Programs\Cortex`, a Start Menu entry, an uninstaller, an
optional (off by default) start-at-login entry, and an App Paths registration
so `cortex` resolves from any terminal. The portable zip stays for people who
want it. Every asset gets a `SHA256SUMS` file.

**No code signing for now.** The executable will still warn. Downloads carry
SHA-256, and build provenance attestation is added at the moment the repository
becomes public, because it is not available to this repository while private.
The Windows documentation owns the SmartScreen instructions instead of
pretending the warning away.

**No auto-update.** "Check for updates" compares the running version with the
newest release and opens the release page. A silent updater needs signing and a
swap-on-exit helper on Windows; it is its own decision, not a checkbox here.

**The repository becomes public at the first tagged release**, so the download
and the attestation exist at all. History is scanned for secrets before the
flip — the flip is not reversible in practice.

**`mcp-config --write` touches only Claude Desktop and Cursor.** It backs up
the original, merges under `mcpServers.cortex`, writes atomically, and leaves
the rest of the file byte-identical. Zed's settings are JSON5 with comments, so
Zed — and every other client — gets the printed snippet instead.

## Consequences

- Unsigned is a documentation problem, not a solved one; the first run still
  requires "More info → Run anyway", and that sentence belongs in the README.
- Making the repository public exposes the full history and turns the release
  into a real download. That is the point, and it is also the risk.
- No auto-update means users must click. Acceptable while the release cadence
  is one maintainer; revisit with signing.
- The installer and the zip can drift if only one is exercised. The release
  checklist requires running both.
