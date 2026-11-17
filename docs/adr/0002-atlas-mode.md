# ADR 0002 — Atlas mode: a parchment map over the same graph

Status: accepted (2026-11-17)

## Context

The universe answers "what is near this note, and what is orphaned". It does not
answer "which part of my vault is this, and what reaches across the border",
and it cannot carry a history or worldbuilding reading at all: a 3D cloud of
star labels is the wrong instrument for a folder of campaign notes.

So: a fourth view, chosen when a folder is opened and swappable from Vault
settings, that draws the same graph as a map — folders as countries, notes as
places, links as roads.

## Decision

**Canvas 2D, not the WebGL renderer.** The reference is a printed map: paper,
ink, hatching, engraved coastlines. Those are fill and stroke problems, and a
2D canvas gets them for free (clipping, dashes, text, image fills) where the
shader pipeline would need new programs per effect. `web/js/atlas.js` is a
self-contained module; the 3D renderer keeps its own job and neither one knows
about the other's internals.

**Voronoi cells are a partition hint, not the outline.** Capitals are laid out
on a golden-angle spiral by folder size and relaxed, cells are clipped half
planes, and then every border segment is displaced by midpoint displacement.
The displacement is keyed to the *unordered* endpoints of the segment, so the
two countries that share a border compute exactly the same curve: no seam, no
overlap, no gap. A per-country amplitude would look prettier and break this,
so the amplitude is global.

**Land is pulled away from the frame.** The clipping rectangle sits inside the
map rect, which leaves sea around the continent. The sea is a ruled wash, the
coasts are ringed with small islands, and the frame, cartouche, compass and
scale bar do the rest.

**Unsettled land is wilderness; settled land is walled.** Grass tufts are
placed on a jittered grid and skipped near places. Each single-linkage cluster
of places gets one enclosure: a convex hull, grown, roughened, filled pale and
stroked as a dashed wall. Inside the wall, the wilderness is cleared.

**Roads are bucketed by width.** Every link becomes a meandering road, and the
width is `0.8 + log2(1 + weight) * 0.55`, so link count is visible as thickness
rather than as a number. Roads are grouped into one `Path2D` per quarter-unit
width: 338 links cost a dozen strokes, not 338. Links *inside* a settlement are
not drawn — at country scale they turn a clump of notes into a sunburst, and
the clump already reads as a town.

**Labels are laid out in screen pixels, outside the map transform.** The map
transform scales the world; text must not scale with it or labels shrink to
nothing when zoomed out. Place labels are restricted to hubs, the focused and
the hovered note, deduplicated against each other with boxes.

**The whole chrome re-inks.** The atlas is not a canvas inside a dark app: the
page switches to parchment by swapping CSS custom properties under
`body.mode-atlas`, so toolbar, sidebar and note panel belong to the same sheet.
Every component already read tokens, so this is one rule block, not a skin.

**One CC0 asset.** The paper is a 380×421 CC0 parchment scan
(Felis Chaus, OpenGameArt) at `web/assets/parchment.jpg` under a paper wash.
Galaxy and brain stay procedural: CC0 starfields and nebulae exist, but a
nebula photograph under a star graph reads as a background, not as geography,
and the Dungeondraft pack that inspired this mode is not licensed for
redistribution.

## Consequences

- The atlas shares no camera with the other views: it has its own pan/zoom,
  reset on vault change, and its own keyboard map (arrows pan, `+`/`-` zoom,
  `0` fits). `4` switches to it from anywhere.
- Determinism is load-bearing. Every placement draws from the graph, a fixed
  golden angle or a position-keyed hash — never `Math.random()`.
- Notes remain individually pickable: `pick()` is a screen-space radius search
  over places, so hit targets do not shrink with zoom.
- The map shows at most a place per note. A 122-note folder becomes a dense
  town clump rather than 122 labels; that is the intended reading, and the
  labels-on-hover path covers the rest.
- `Vault settings` stores the chosen view per vault (`cortex.view.<id>`) in
  `localStorage`. Losing it costs one click, so no server-side preference.
