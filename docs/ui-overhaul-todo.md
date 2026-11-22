# Cortex UI Overhaul — "Quiet Editorial Studio" (v2.5.0)

This document captures the design vision, technical invariants, and phased implementation checklist for Cortex's UI overhaul. Update checkboxes (`[ ]` -> `[x]`) as each phase completes so any resuming contributor or AI assistant can pick up immediately with full context.

---

## 1. Design Vision ("Quiet Editorial Studio — Cortex 2.5")

1. **Single source of truth for left navigation:**
   - Never display two left sidebars simultaneously.
   - On desktop (`> 760px`) in **Notes** mode, `.notes-list-pane` IS the sole left sidebar and the global `.sidebar` stays hidden (`--left: 0px`).
   - Top-left `#sidebar-toggle` (and keyboard shortcut `[`) universally toggles whichever left sidebar belongs to the active view (`#notes-list-pane` in Notes mode; `#sidebar` in all other views).
2. **Calm 4-control desktop top bar:**
   - Keep only high-frequency controls directly visible on desktop: `#search-button` (`Search ⌘K`), `#open-vault` (static/Pages) or `#new-note` (`+`, live), `#toolbar-more-btn` (`⋯` Utilities menu), and `#settings-button` (`⚙`).
   - Move low-frequency utilities (`#today-note`, `#surprise-note`, `#tour-button`, `#theme-toggle`, `#shortcuts-button`) into the light-dismiss `#toolbar-more-menu` popover (`role="menu"`).
   - Never keep a loud amber `Replay` tour pill permanently in the top bar.
3. **Clean single-line vault header:**
   - Strip Windows verbatim path prefixes (`\\?\` and `\\?\UNC\`) via `cleanDisplayPath()` before rendering tooltips, Settings paths, or vault lists.
   - Render `#vault-button` as a crisp single-line `vault ▾` control in the top bar (hide `.vault-path` from `.toolbar` while keeping the cleaned full path in `title` and Vault Settings).
4. **Progressive disclosure & quiet sidebars:**
   - Collapse the Notes right-hand Inspector by default (`state.studio.inspectorCollapsed = true`, persisted in `localStorage`) and surface a subtle connection count badge (`#notes-inspector-badge`) on `#notes-toggle-inspector`.
   - In the global `.sidebar`, wrap `Vaults` and `Tallies` inside native `<details class="sidebar-disclosure">` elements (closed by default; `Tallies` auto-opens when the vault has tallies or custom counters).
   - Hide `Pinned` when empty (`showEmptyHint: false`) and hide the cluttered `.sidebar-hint` shortcut footer.
5. **Zero floating overlap over clickable lists:**
   - Restrict `.canvas-status` (`#stats`) strictly to 3D WebGL views (`universe`, `brain`, `replay`).
   - Hide `.canvas-status` in `notes`, `atlas`, `bento`, and `decisions`, and pad scrollable lists (`.notes-feed` with `calc(var(--s7) + var(--s4))` bottom padding and matching `scroll-padding-bottom`) so bottom-most notes are always unobstructed and clickable.
6. **Content-first editorial canvas:**
   - Remove redundant `+ New` controls in Notes Studio (`#notes-tab-new` hidden; `#notes-new-btn` simplified to a quiet compact `+` icon button hidden in read-only/static mode).
   - Visually merge `.notes-tabs-bar` into the document canvas background so top chrome stays calm, preserving all 4 editor modes (`Live`, `Source`, `Read`, `Split`) and mobile two-step navigation.

---

## 2. Invariants for Any Resuming Contributor / AI

- **Zero bundler, zero framework:** Pure ES modules under `web/js/*.js` loaded directly by `web/index.html`. Run `node --check web/js/*.js` or `node tools/check-repo.mjs`.
- **Strict CSP:** No inline `<script>` or inline `onclick=` attributes.
- **Token-based CSS:** Use design tokens in `web/styles.css`; preserve Dark, Warm Light, System, and Atlas parchment themes cleanly.
- **Preserve DOM IDs & selectors:** Keep all existing IDs (`#today-note`, `#surprise-note`, `#tour-button`, `#shortcuts-button`, `#theme-toggle`, `#sidebar`, `#sidebar-toggle`, `#notes-studio`, `#notes-feed`, `#notes-inspector-pane`, `#notes-toggle-inspector`, `#notes-inspector-close`, `#notes-export-md`, `#mobile-more-btn`, `#mobile-more-sheet`, `#open-vault`, `#vault-button`, `#local-vault`, etc.) intact so shortcuts, Playwright smoke tests, and scripts never break.
- **Rust / CI Lockfile rule:** No local Rust toolchain is required here (`cargo` runs in GitHub Actions); whenever `Cargo.toml` version bumps, update **only** the `cortex` and `cortex-core` package version lines in `Cargo.lock` so `cargo ... --locked` succeeds in CI.
- **Version parity (`tools/check-repo.mjs`):** Keep versions aligned across `Cargo.toml`, `Cargo.lock`, `installer/cortex.iss`, `README.md`, `CHANGELOG.md`, `docs/releases/v2.5.0.md`, `site/index.html`, `site/main.js`, `web/index.html`, and `web/sw.js`.

---

## 3. File Map

| File | Purpose in Overhaul |
| --- | --- |
| `docs/ui-overhaul-todo.md` | Persistent design vision, invariants, and checklist (this file) |
| `web/index.html` | Top bar Utilities popover (`#toolbar-more-menu`), collapsible sidebar `<details>`, quiet Notes icons & inspector badge |
| `web/styles.css` | Tokens, single-line `#vault-button`, popover menu styling, disclosure styling, unobstructed `.notes-feed`, `.canvas-status` scoping |
| `web/js/main.js` | `cleanDisplayPath()`, Utilities popover wiring, unified `syncSidebar()`/`toggleSidebar()`, collapsed-by-default Inspector, disclosure state sync |
| `web/js/ui.js` | Clean Windows paths in vault lists & `#notes-inspector-badge` counter update |
| `web/sw.js` | Service worker cache version bump (`cortex-v2.5.0-1`) |
| `tests/smoke.mjs` | Desktop & mobile UI-overhaul regression assertions (no double sidebar, unobstructed bottom note, Utilities menu, single toggle) |
| Release parity files | `Cargo.toml`, `Cargo.lock`, `installer/cortex.iss`, `README.md`, `CHANGELOG.md`, `docs/releases/v2.5.0.md`, `site/index.html`, `site/main.js` |

---

## 4. Phased Task Checklist

### Phase 1 — Persistent Vision & Tracker
- [x] Create `docs/ui-overhaul-todo.md` with vision, invariants, file map, and phased checklist.

### Phase 2 — Calm Top Bar, Clean Windows Paths & Utilities Popover
- [x] Add `cleanDisplayPath()` in `web/js/ui.js` / `web/js/main.js` (strip `\\?\` / `\\?\UNC\`) and apply to `#vault-button` tooltip, `#settings-path`, and vault lists (`web/js/ui.js`).
- [x] Hide `.vault-path` in the top `.toolbar` CSS so `#vault-button` stays a crisp single line.
- [x] Consolidate secondary top-right actions (`#today-note`, `#surprise-note`, `#tour-button`, `#theme-toggle`, `#shortcuts-button`) into `#toolbar-more-menu` under `#toolbar-more-btn`.
- [x] Wire open/toggle/light-dismiss/Escape handling for `#toolbar-more-menu` and update `syncTourButton()` + tour step target (`#toolbar-more-btn`).
- [x] Refine `.toolbar`, `.views`, and `@media (max-width: 760px)` styles (hide `.toolbar-more` on mobile where `#mobile-more-sheet` takes over).

### Phase 3 — Single Left Sidebar, Quiet Disclosures, Collapsed Inspector & Unobstructed Lists
- [x] Hide global `#sidebar` in desktop Notes mode inside `syncSidebar()`, invoke `syncSidebar()` inside `setMode()`, and route `#sidebar-toggle` (plus `[`) to toggle `#notes-list-pane` in desktop Notes mode.
- [x] Default `state.studio.inspectorCollapsed = true` (persisted in `localStorage`) and add `#notes-inspector-badge` connection counter.
- [x] Replace loud amber `#notes-new-btn` with a quiet icon button, hide `#notes-tab-new`, and hide desktop `#notes-toggle-list`.
- [x] Wrap `Vaults` and `Tallies` in collapsible `<details class="sidebar-disclosure">` elements, set `showEmptyHint: false` on `renderSidebarPinned()`, and hide `.sidebar-hint`.
- [x] Hide `.canvas-status` (`#stats`) in `notes`, `atlas`, `bento`, and `decisions` modes; add generous bottom padding (`64px`) to `.notes-feed` and `.folders`.

### Phase 4 — Service Worker & Playwright Smoke Regression Checks
- [x] Bump `web/sw.js` cache version to `cortex-v2.5.0-1`.
- [x] Add desktop regression tests in `tests/smoke.mjs` checking single sidebar in Notes, collapsed Inspector default, `#sidebar-toggle` behavior, `#toolbar-more-menu` open/Escape close, `#stats` hidden in non-3D modes, and bottom-most note clickability via `elementFromPoint`.

### Phase 5 — Version Bump (`2.5.0`), Verification, Commit & Tag
- [x] Bump `2.4.1` -> `2.5.0` across `Cargo.toml`, `Cargo.lock` (`cortex` & `cortex-core`), `installer/cortex.iss`, `README.md`, `CHANGELOG.md`, `docs/releases/v2.5.0.md`, `site/index.html`, `site/main.js`, and `web/index.html`.
- [x] Run `node tools/check-repo.mjs`, `node --test tests/web.test.mjs tests/localvault.test.mjs`, and `node tests/smoke.mjs --mock` with 0 failures.
- [x] Commit, push `main`, create & push tag `v2.5.0`, and verify GitHub Actions runs trigger via `gh run list`.
