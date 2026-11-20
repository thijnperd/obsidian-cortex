# Changelog

## 2.4.0 — Source comparison, offline mode & CI smoke gate

- **Deterministic source comparison in Research Brief:** extracts shared tags/references, direct cross-links, unlinked phrase overlaps, line-cited key claims (`(L#)`), contrast/caveat tensions, and open questions across selected sources.
- **Populated Decisions view:** added a live decision status summary strip (`#open`, `#refining`, `#accepted`, `#superseded`, overdue review alerts) and seeded six worked decisions across all four columns in the default demo vault.
- **Strict offline mode:** added `--offline` / `CORTEX_OFFLINE` and a Settings toggle (`Check GitHub releases on launch`) to disable the startup update probe.
- **Headless UI smoke gate & repo checks:** added `tools/check-repo.mjs` (archive/leak check, version parity, OG metadata check, static ES export verification), `tests/web.test.mjs`, and `tests/smoke.mjs` (Playwright boot, all views, edit/save persistence), wired into CI and releases.
- **Landing site & repo hygiene:** added Open Graph / Twitter metadata cards, documented Agent-safe MCP as a dedicated feature section, removed committed vault archive `Dragonlance.zip`, and fixed escaped-pipe wikilinks (`\|`).

## 2.3.1 — Universe layout

- **Folder galaxies spread over a sphere at every vault size:** vaults with 12 folders or fewer now use the same spherical universe layout as larger vaults instead of two offset crowns; the journal folder keeps its tilted orbit.

## 2.3.0 — Folder explorer

- **Notes tab folder explorer:** collapsible tree of the real vault hierarchy with note counts, single-line note rows, and a Folders/List toggle. Filtering opens matching folders and the open note's folders expand automatically.
- **Calmer Notes layout:** copy link, reveal, locate in graph and zen mode grouped into one `…` menu; flat list hides excerpts until hover; active tab scrolls into view.
- Version 2.3.0 across the binary, installer, README, and landing site.

## 2.2.1 — Boot fix

- **Fixed boot overlay never hiding:** restored UI helper exports (`toast`, `setBootStatus`, `hideBoot`, `setCrumbs`, `setModeButtons`, `showTooltip`, `hideTooltip`, `renderPaletteHits`) that were dropped in 2.2.0.
- Restored post-boot in-app update check and banner.

## 2.2.0 — Notes studio

- **Notes studio tab:** filterable, sortable, pinnable note list; editor; connections pane with snippets for backlinks, mentions and related notes.
- **Slash menu and editor shortcuts:** `/` inserts headings, tasks, tally boxes, callouts, tables, math, code, quotes, dividers, today's date and wikilinks; `Ctrl L` toggles tasks, `Ctrl Shift D` duplicates a line, `Alt Up/Down` moves it; `?` opens a shortcut cheat sheet.
- **Quick capture** into the Inbox and a **Create note** option for unresolved links.
- Server: note connections now carry a `snippet` field.
- Version 2.2.0 across the binary, installer, README, landing site.

## 2.1.0 — Tallies, Medieval roads, Atlas biomes & 3D styles

- **Tally board:** inline `☐`/`☑` ballot trackers and custom sidebar counters synced directly back to Markdown notes.
- **Atlas biomes & medieval roads:** woodland, highlands, wastes, wetlands, tundra, and steppe layers plus bridges, mountain tunnels, and trade routes, with cached atlas layer rendering.
- **Star styles & Brain modes:** switch between Glow, Anime impact, and Dots star rendering and Cortical shell vs Notes-form-brain views.
- **Full-span graph edges & Markdown upgrades:** fixed `appear=1.0` dot culling, added full-span graph edges, and added Markdown tables, LaTeX math, callouts, and an updated emblem icon.

## 2.0.0 — Precision Editorial Studio

### Studio shell & themes

- **Precision Editorial Studio visual language:** refined tonal layering, hairline depth, tabular numerals, and upgraded card craft across Launch, Decisions, Bento, Timeline, and Settings.
- **Dark, Warm Light, and System appearance:** three-way theme control in Vault settings plus a one-click toolbar toggle, backed by a zero-FOUC CSP-safe bootstrap. Atlas keeps its signature cartographic parchment look in every theme; 3D WebGL views retain their deep obsidian canvas for contrast.
- **Collapsible & drag-resizable shell:** collapse the sidebar from the toolbar or with `[`, drag-resize both the sidebar and the note panel (double-click any handle to reset), and enjoy a calmer centered toolbar with vault stats moved to a quiet bottom-left status pill.

### Studio Reader & Unified Command Palette

- **Focus reader & tabbed connections:** expand the note reading panel to a centered editorial reading column, inspect decision trails with visual confidence meters, and switch cleanly between Sources, Backlinks, Mentions, and Related tabs.
- **Compact Edit formatting bar:** a minimal Markdown toolbar sits above the plain `<textarea>` in Edit mode, driving the same selection-safe undo-preserving helpers as keyboard shortcuts.
- **Unified Command Palette (`Ctrl K` / `⌘K`):** search notes and run app commands (switch views, toggle theme or sidebar, reframe camera, today's note, settings, tour) from one keyboard-first overlay; prefix with `>` to filter commands only.

### GitHub Pages landing site

- Dedicated zero-build landing page at `site/` deployed to `https://thijnperd.github.io/obsidian-cortex/`, with the live interactive demo at `/demo/` and automatic redirect for legacy `?view=` links.

### Release

- Version 2.0.0 across the binary, installer, README, and About panel.

## 1.3.0 — Your Notes, as a Brain

### The brain is the front door

- The README hero is now the Brain view of the 328-note seeded vault, with
  Decisions and the reasoning trail as the second beat instead of the banner.
- The repository social card is the same 1280×640 brain crop.
- `?view=brain` opens a vault or the static demo directly in a named view;
  the README and demo badge use it so the first click lands on the Brain.
- The positioning and its assumptions are written down in `docs/marketing.md`;
  the primary-source research is in `docs/research/v1.3-brain-first.md`.

### A mark that survives 16px

- The app icon is redrawn from the supplied mark: one solid, four-lobed brain
  silhouette, a vertical seam and a single double-band thinking trail. The
  scalloped “cloud” outline and hairline spiral artifacts are gone.
- The new geometry runs through the PNG set, `.ico`, `.icns`, tray glyphs,
  window icon, README mark and favicon.

### A UI that names your keys

- Toolbar and panel glyphs are now inline Tabler icons (MIT), bundled as a
  sprite with the notice in `THIRD_PARTY_NOTICES.md`.
- Shortcut hints are rendered for the host OS: `⌘K` on macOS, `Ctrl K` on
  Windows and Linux. The Mac glyph no longer appears on Windows, and the
  Windows modifier no longer appears on macOS.

### Release

- Version 1.3.0 across the binary, installer and About panel.

## 1.2.0 — The Native Window

### A real window

- Windows and macOS host the UI in the system webview through wry and tao:
  WebView2 on Windows, WKWebView on macOS. The Chromium `--app` window and its
  private profile are gone.
- The window owns its icon, minimum size and lifetime. External links leave for
  the user's browser; closing the window ends the instance.
- The tray moves into the same event loop: Open Cortex, Open in browser, Show
  log, agent status and Quit.
- Linux keeps the browser path: linking WebKitGTK into the self-contained
  binary is a separate decision, recorded in ADR 0009.

### A mark and a front door

- New brain-and-trail mark, generated by `tools/make-icons.py` into `.ico`,
  `.icns`, PNGs and tray glyphs. The Windows exe and installer embed it; the
  macOS bundle carries it.
- The launcher leads with the mark, a clearer promise, recent vaults with note
  counts and the folder field.

### Release

- Version 1.2.0 across the binary, installer and About panel.
- macOS ships `Cortex.app` inside the arm64 archive, with `Info.plist` and an
  ad-hoc signature.

## 1.1.1 — The Guided Tour

### Guided tour

- A finished tour is remembered in this browser. The toolbar button changes from
  **Tour** to **Replay**, so the fifteen-step walkthrough can be started again
  in one click.
- Closing the tour early does not mark it complete.

### Documentation

- The README graph screenshots now show the current folder-galaxy layout: local
  clusters of note dots on a sphere, plus a chronological ring for a large
  journal. The renderer already used this layout; the images were stale.
- The README now describes that layout directly instead of leaving readers to
  infer it from the old barrel-and-rings screenshots.

### Release

- Version 1.1.1 across the binary, installer and About panel.

## 1.1.0 — The Guided Tour

### Guided tour

- **Tour** in the toolbar starts a fifteen-step walkthrough of all six views,
  collection, Research brief, Refine idea, Decisions and the decision trail.
- The tour uses your own vault when it contains a research brief, an idea note
  and a decision trail; otherwise it generates a small **Cortex Tour** demo in
  the config folder. Finishing returns you to the vault you started in.
- The tour is a focus mode: it blocks app shortcuts, never submits a form, and
  restores your view and collection when it closes.

### Demo

- The small demo now ships with confidence, review dates, a due review and a
  superseded decision, so Decisions and the trail have something real to show.

### Release

- Version 1.1.0 across the binary, installer and About panel.

## 1.0.0 — Find the Why

The first public release.

### Decision trails

- Optional `confidence`, `review_on` and `supersedes` frontmatter on research
  briefs and idea notes.
- The Decisions board shows confidence, review dates and a **Review due** flag.
- The note panel shows the full trail: status, confidence, review date,
  supersession and linked sources. Press `y` to jump back to it.
- Missing fields degrade gracefully; existing vaults need no migration.

### Capture

- Press `t` or use the sun button to open or create
  `Journal/YYYY-MM-DD.md`. An existing daily note is opened, never overwritten.
- New daily notes start with Notes, Decisions and Tomorrow sections.

### Editor and Bento

- Bracket auto-pairing, type-over, empty-pair deletion and Obsidian-style
  formatting/list shortcuts.
- Bento readable type, spacing-token cleanup and no clipped note rows.
- Global functional UI text raised to 12px; the decorative boot pulse removed.

### Release

- MIT license, security policy, research record and decision-trail ADR.
- v1 documents its non-goals: no hosted sync, mobile app, real-time
  collaboration, plugin runtime or built-in AI.

## 0.9.0

- Note editor shortcuts, Bento readability and Impeccable detector fixes.

## 0.8.0

- Atlas power diagram, Bento board, auto-updates and the Windows installer.
