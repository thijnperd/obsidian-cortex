# ADR 0007 — Check the release feed, update Windows from a verified installer

Status: accepted (2026-11-18)

## Context

ADR 0006 shipped a real installer but left updates manual: **Check for updates**
compared versions and opened the release page. That was acceptable for a
one-maintainer cadence, but it is the first thing a non-technical user gets
wrong — they download a new setup while the old Cortex is still running, or they
stay on a version with a known bug because nothing told them.

The updater cannot assume a signing certificate. It also cannot assume a second
binary, an installer framework runtime, or an authenticated GitHub token on a
user's machine. What it does have is HTTPS to GitHub and `curl`, which ships with
Windows 10+, macOS and every supported Linux.

## Decision

**The release Atom feed is the source of truth.**
`https://github.com/thijnperd/obsidian-cortex/releases.atom` lists published
tags with no anonymous rate limit. The updater takes the newest tag that parses
as a plain `vX.Y.Z`, ignoring the rolling `latest` tag and prereleases. Asset
names are deterministic (`CortexSetup-<version>.exe`, `SHA256SUMS.txt`), so the
feed plus the version is enough to build the download URLs. The REST API is not
used: its anonymous quota is per IP and is exhausted by shared networks.

**The check is automatic, the install is not.**
The UI asks once per launch and whenever About opens; the server caches the
answer for 30 minutes. A newer version becomes a small, dismissible notice above
the graph. Nothing downloads or replaces a binary until the user presses
**Update** and confirms. Auto-downloading an unsigned installer without that
step would be a feature nobody asked for and a surprising use of bandwidth.

**Windows installs; macOS and Linux download.**
On Windows the updater fetches the setup, reads the release's `SHA256SUMS.txt`,
computes SHA-256 itself, and refuses to run anything that does not match. It
then starts the installer with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART
/CLOSEAPPLICATIONS`, exits after the HTTP response has been sent, and the
installer's silent `[Run]` entry reopens Cortex. The installer also sets
`CloseApplications=yes` for the case where a console `cortex serve` still holds
the binary. On macOS and Linux the notice opens the release page: replacing a
live Unix binary has no equivalent hand-off, and a half-working updater is worse
than an honest download link.

**A checksum is integrity, not identity.**
HTTPS plus the published SHA-256 proves the file arrived intact and matches the
release the feed named. It is not code signing, and the README still owns the
SmartScreen instructions. Signing remains its own decision.

## Consequences

- A user on a current version sees nothing; a failed check is silent at launch
  and only reported when they ask in About.
- The feed is public, so the repository must keep publishing stable tags with
  `CortexSetup-<version>.exe` and `SHA256SUMS.txt`; CI already does both.
- An update runs one process to completion and exits the app. Unsaved editor
  state is not at risk because edits are explicit saves, but the 1.5 s delay
  before exit is deliberate: it lets the "Installing…" response reach the page.
- If `curl` is missing, the check reports that plainly instead of failing open.
  No update is ever installed on a failed check.
