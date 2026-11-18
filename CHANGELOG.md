# Changelog

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
