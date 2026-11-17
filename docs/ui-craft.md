# Why Cortex looks generated, and what replaces it

An audit of the current UI against the known tells of machine-made interfaces,
plus the concrete rules this project should adopt. This is a working document:
the open decisions at the bottom are what the grilling round settles.

## The tells, and where this codebase has them

Ordered by how much they cost. Line references are to `web/styles.css` unless
noted.

### 1. Micro-caps everywhere

Fifteen separate rules set `font-size: 9–10px; text-transform: uppercase;
letter-spacing: 0.12–0.24em`: brand sub, stats, mode tabs, legend, hint, boot
line, note kicker, note meta, tags, relations heading, buttons, tray, palette
footer, toast, compose label. That is a costume — a starship HUD — not a
hierarchy. It is the single most recognisable marker here, because it means
*no* label is allowed to be plain, so nothing reads as a control and nothing
reads as data.

**Replace with:** sentence case, one real label size (12.5px, weight 500), one
meta size (11px, muted), uppercase reserved for at most one thing (nothing).

### 2. Every corner is rounded into a capsule

`border-radius: 999px` on the mode tabs, every button, the tray, the toast, the
replay bar, the tag chips, and the close button (50%). Panels get 14–16px.

**Replace with:** 6px for controls, 10px for panels and overlays, 4px for tags.
A radius should describe the object's size, not its mood.

### 3. Glass and glow as decoration

`backdrop-filter: blur()` on the mode bar, replay bar, tooltip, note panel,
palette, tray, compose overlay. `box-shadow: 0 0 10px currentColor` on legend
dots, `0 0 14px` on the slider thumb. The reading surface — the note panel — is
frosted, which is exactly wrong: a place you read for ten minutes should be
opaque.

**Replace with:** two opaque surfaces (`#0b0d12`, `#12151c`) and one hairline
border (`#1e222b`). Blur survives only on the ⌘K overlay, where it dims the
scene behind a focused task. Glow is removed from UI chrome entirely; the WebGL
scene keeps its own bloom, which is content.

### 4. Gradients that are not doing anything

The note panel and compose box use `linear-gradient(180deg, rgba(10,12,20,.94),
rgba(6,7,13,.96))` — two endpoints nine units apart. That is a gradient chosen
because gradients are the default, not to describe light.

**Replace with:** flat fills. If a surface needs depth, it gets a border.

### 5. The product narrates itself

`mapping your mind` on the boot screen. `knowledge universe` under the vault
name. `your notes as a universe` in the page title. A permanent instruction
line at the bottom: `drag to orbit · scroll to zoom · ⌘K search · ⌘-click to
collect for synthesis`.

**Replace with:** `Indexing 328 notes…` (a fact, with a number, that ends when
it is done). The vault's own folder path where the subtitle is. Discoverable
hints behind `?`, shown in full only on a first run.

### 6. Space words on top of data

`328 stars · 557 arcs · 7 galaxies · 16 clusters`. The graph *is* spatial; the
chrome does not need to keep insisting on it. A tool reports what the data is,
and lets the visual metaphor be the visual metaphor.

**Replace with:** `328 notes · 557 links · 7 folders · 16 clusters`.

### 7. Contrast is below the floor

`--faint` is `rgba(238,241,247,.32)`; composited on `#04050a` that is roughly
`#4e5054`, about **2.4:1**, and it is the colour of 9.5px text in eleven
places. The hint at `.26` is about 2.0:1. WCAG 2.1 AA wants 4.5:1 for body text
and 3:1 for large text; nothing at 10px qualifies as large. So the quietest —
and most load-bearing — labels are the least legible.

**Replace with:** a three-step ink scale that all clears 4.5:1: `#eef1f7`
(primary), `#b6bcc8` (secondary, ~9:1), `#8b929f` (meta, ~5.4:1).

### 8. No visible focus, and `outline: none`

`#palette-input` and `.replay-range` remove the outline with no replacement.
`.mode`, `.btn`, `.legend-item`, `.relation`, `.palette-hit`, `.tray-action`,
`.panel-close` and `.replay-play` define hover but never `:focus-visible`. The
keyboard path through this app is real (⌘K, arrows, `c`, `n`, `b`) and it is
invisible.

**Replace with:** one `:focus-visible` rule using a 2px accent ring at 2px
offset, applied by element role rather than repeated per component.

### 9. The interface is missing its quiet states

`panelHtml()` renders nothing where a note has no backlinks, no mentions and no
related notes — three headings simply vanish, so an orphan note looks broken
rather than new. The palette has an empty state; the panel and the graph do
not. Loading is a full-screen title card with a sweeping line, not a
representation of the work.

**Replace with:** "No backlinks yet — notes that link here will show up." One
empty-vault screen that names the fix (`cortex serve ~/Notes`). Loading that
counts.

### 10. One serif, one sans, one mono, and the serif does the decorating

Iowan/Palatino for the brand, note titles, tooltips and headings; mono for
labels; sans for prose. That split is defensible — it is close to how Obsidian
and Bear read. It only fails where the serif is used as ornament (the 58px
`CORTEX` wordmark at `letter-spacing: .42em`, the tooltip title).

**Replace with:** keep the serif for reading surfaces and the vault name; drop
it from transient chrome.

## What is already good, and must not be flattened

- **The accent.** Warm sand `#ffd9a0` on near-black is not the indigo default.
  Keep it, use it for one thing at a time.
- **The graph.** The 3D scene, the folder galaxies, the timeline ring, the
  brain morph are the product. They are content, not chrome; the audit above is
  about the frame.
- **The density.** Small type and tight leading over a big canvas is right for
  this app. The fix is legibility and hierarchy, not enlargement.

## Design rules for the rebuild

1. One accent, one accent placement per view (active control, or the link
   colour, not both at once).
2. Hierarchy comes from size and weight, never from a second colour.
3. Opaque surfaces for anything you read or type in. Blur only to dim.
4. No glow, no gradient fill, no shadow outside the ⌘K overlay.
5. Radius describes size: 4 / 6 / 10.
6. Spacing from a scale: 4, 8, 12, 16, 24, 32, 48, 64. No 7s and 9s.
7. Type scale: 11 / 12.5 / 14 / 16 / 20 / 25 / 32.
8. Sentence case for every control and label. No decorative uppercase.
9. Copy states facts and actions. Never the product admiring itself.
10. Every state is designed: empty, loading, error, long, first-run.

## Where these came from

The tell lists are consistent across current design writing — [AI UI design
tells](https://codexdesign.io/guides/ai-ui-design-tells), [reviewing
AI-generated interfaces](https://ralabs.org/blog/ai-design-slop-how-to-review-ai-generated-interfaces/),
[signs of AI design](https://github.com/febbhav/signs-of-ai-design/blob/main/design-rules.md),
and [slop patterns](https://impeccable.style/slop). The durable test from the
first of those: put the screen next to three unrelated products — if the same
treatment fits all four, nobody chose anything.

Contrast floors are WCAG 2.1 AA (1.4.3, 4.5:1 body / 3:1 large; 2.4.7 focus
visible).

## Decisions (settled 2026-11-17)

- **Full reset, not a repaint.** Tokens, markup and copy. The chrome was
  restructured: the floating pill bar became a toolbar, the legend became a
  folder list in a sidebar, the note panel got a header/body/footer with
  history arrows, and the collection tray moved out of the canvas into the
  sidebar.
- **The scene keeps the metaphor; the data does not.** Views are still called
  Graph, Brain and Timeline. Counts read `328 notes · 557 links · 7 folders ·
  16 clusters`, and the boot line counts notes instead of narrating a mood.
- **Notes open each other.** A `[[link]]`, a backlink or a mention opens in
  place, with back/forward through the chain (`⌘[` / `⌘]`). Split panes were
  considered and deliberately left out; the panel is the unit of reading.
- **A folder is chosen on launch.** Launch screen with remembered vaults and a
  typed path, several vaults switchable without a restart. A native OS dialog
  is deferred: a browser cannot pass a path to the server process, and the
  dialog crate drags GTK into the Linux build. See
  [`adr/0001-vault-binding-and-live-updates.md`](adr/0001-vault-binding-and-live-updates.md).
- **No permanent instruction line.** The one hint that survives lives at the
  bottom of the sidebar, out of the canvas.

## Still owed

- Label collisions in dense views are reduced, not solved.
- The quiet states exist (empty backlinks, empty mentions, no vault open,
  missing folder) but no first-run tour exists beyond the launch screen.
- The atlas was checked at 1400×900 and at 384×723. Labels are placed in
  screen space with collision boxes, so a 122-note settlement still crowds; the
  reading is "that clump is a city", not a legible list.
- Atlas places are one symbol. A capital/town/hamlet hierarchy is not drawn yet.
- Panels are not resizable, in any view.
