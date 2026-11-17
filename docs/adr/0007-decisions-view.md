# 0007 — A decisions view, not a fifth graph

- Status: accepted
- Date: 2026-11-17
- Supersedes: nothing
- Related: [0002](0002-atlas-mode.md) (the other non-WebGL view)

## Context

Cortex's research loop ends in a note: `Synthesis/<question>.md`, with
`type: research` or `type: idea`, a `status`, and an evidence list of
`[[wikilinks]]`. The README calls that note the point of the product — "the part
most note tools leave out" — and then nothing in the UI ever shows it again. You
had to remember which questions you had opened, open the folder in a file
manager, or search for the word you used last month.

The four existing views cannot answer the question that note exists for. They
are spatial: where does this note live, what connects to it, when did it appear.
"What have I concluded, and on what?" is a list question, and a graph makes it
worse, not better.

## Decision

Add a fifth view, **Decisions** (`5`), which is a bounded board of structure
notes.

- **It is DOM, not a scene.** Cards, chips and columns are ordinary buttons and
  articles, so the view is keyboard-operable and readable by a screen reader
  without teaching the WebGL renderer about text. The loop stops rendering while
  the board is open: there is no scene to draw.
- **The data ships in the graph payload.** `GraphData.structures` is a
  `structures::Board` built during the same vault scan, next to `nodes` and
  `edges`. One fetch, one version, one live poll, and `cortex export` gets the
  view for free because it already writes `graph.json`. An empty board costs 45
  bytes; a populated card costs roughly 900 bytes including its evidence.
- **Only `type: research` and `type: idea` are structure notes.** Those are the
  two values `synthesis::build` writes. Every other `type` — `meeting`, `book`,
  a vault's own vocabulary — is ignored rather than guessed at.
- **Status is read, never written.** `open` and `refining` are the values Cortex
  creates and the ones counted as open work. Anything else is shown as its own
  column. There is no drag-to-change-status and no status vocabulary invented
  here: the field belongs to the user and works from any editor.
- **A card shows its evidence.** Resolved wikilinks become chips that open the
  source note; unresolved links are counted, not hidden. This is the part a
  generic database view cannot do without a second query and a second cache.

## Alternatives rejected

- **A Kanban board over every note, grouped by any frontmatter property.** This
  is Obsidian Bases' Kanban view (1.14+), and it already does the general case,
  including dragging a card to rewrite the property. Rebuilding it would be a
  worse Bases that also has to own a write path.
- **A separate `/api/structures` endpoint.** It would have needed its own
  fetching, caching and invalidation, and the static export would have needed a
  second JSON file. The board is derived from data the client already has.
- **Making it the default view.** A vault with no structure notes would open on
  an empty board; the graph is the honest first impression.

## Consequences

- The graph payload grows by one field. On the 174-note demo: 86,230 → 86,275
  bytes with no structure notes, 87,995 bytes with two. Response time on
  loopback stayed inside the same 0.6–1.6 ms noise band.
- `structures::board` must stay cheap: it walks each note's links once and
  resolves them through the vault's existing lookup. No new pass over the
  filesystem, no second parse.
- The view is read-only. Changing a status means editing frontmatter — in the
  note panel, in Obsidian, or through `cortex mcp`. If a write UI is ever added,
  it goes through `store` with an `expect` hash, like every other write.
- Cards are capped at 240. A vault with more structure notes than that is not a
  board problem, and the UI says how many it is not showing.
