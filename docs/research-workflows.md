# What research and idea tools actually support

Primary-source notes gathered before adding the collect → focus → structure-note
workflow. Sources are first-party documentation; prevalence claims are not
available from any vendor, so this is a documentation brief, not telemetry.

## The affordances worth having

1. **A dated default capture surface.** Obsidian's Daily notes, Logseq's Journals
   page and Roam's Daily Notes all make today the path of least resistance.
   [Obsidian](https://help.obsidian.md/plugins/daily-notes) ·
   [Logseq](https://github.com/logseq/docs/blob/master/pages/Getting%20started%20with%20the%20Journals%20page.md) ·
   [Roam](https://roamresearch.com/#/app/help/page/eOaNXBvXZ)
2. **A template that imposes a source schema.** Obsidian's study-note template is
   the clearest documented example (key concepts, details, examples, questions,
   summary, related topics). [Obsidian Templates](https://help.obsidian.md/plugins/templates)
3. **Highlights anchored to their source.** Heptabase's PDF highlights keep a
   locator back to the original position. [Heptabase PDF annotation](https://wiki.heptabase.com/pdf-annotation)
4. **Backlinks and unlinked mentions.** Obsidian separates explicit links from
   unlinked occurrences, with context and filtering, so implicit overlap can be
   promoted to a real link. [Obsidian Backlinks](https://help.obsidian.md/backlinks)
5. **Block references.** Roam's block IDs keep provenance while wording changes.
   [Roam block references](https://roamdocs.fyi/help/block-references)
6. **Queries over the graph.** Logseq documents queries as questions with
   property/date/tag filters, turning browsing into a defined evidence set.
   [Logseq Queries](https://github.com/logseq/docs/blob/master/pages/Queries.md)
7. **Atomic notes.** Zettelkasten: one thought per note, in your own words, with
   sources at the bottom. Heptabase: one concept per card, titled as a claim.
   [Zettelkasten](https://zettelkasten.de/introduction) ·
   [Heptabase reading method](https://wiki.heptabase.com/the-best-way-to-acquire-knowledge-from-readings)
8. **A spatial surface with sections and connectors.** Obsidian Canvas, Logseq
   Whiteboard and Heptabase whiteboards are all documented this way.
   [Obsidian Canvas](https://help.obsidian.md/plugins/canvas) ·
   [Logseq Whiteboard](https://github.com/logseq/docs/blob/master/pages/Whiteboard.md)
9. **A structure note as the synthesis artifact.** Zettelkasten's structure note
   is "a Zettel about other Zettels and their relationships" — an entry point
   with an order, not a hairball. [Zettelkasten](https://zettelkasten.de/introduction)
10. **Progressive summarization.** Forte's ladder from excerpt to bold to
    highlight to executive summary, then a remix into a new artifact.
    [Forte Labs](https://fortelabs.com/blog/progressive-summarization-a-practical-technique-for-designing-discoverable-notes)

The pipeline these imply: capture with time and provenance → define the corpus →
make reusable units → synthesize on a surface → distill into an output.

## What the documentation says about graph views

The recurring criticism is the hairball: Obsidian's own help admits that
understanding connections gets harder as a vault grows
([Link notes](https://help.obsidian.md/link-notes)). Forum threads describe the
global graph as low-density noise and recommend the shallow local graph plus
filters ([example](https://forum.obsidian.md/t/how-i-made-the-local-graph-usable/22534)).
Documented reliable uses are finding orphans, clusters and unlinked notes, not
"insight" from reading the whole graph.

Heptabase's related point is that long, multi-concept notes make visualization
much less useful; the unit of connection has to be an atomic idea.

## Consequences adopted in Cortex

- Focus is a first-class state: opening a note dims everything except its
  direct neighbourhood, and labels follow only that set.
- The graph's job is maintenance and local reading, not a hero view.
- Collection is explicit (⌘-click, `c`, or the panel button) because a
  selection is the input to synthesis.
- The output is a **structure note** with a linked evidence list, not a copy of
  the sources: provenance stays one click away and survives edits.
- The idea template adds the decision step the reviewed tools leave external:
  assumptions, options scored on effort/risk/reversibility, recommendation,
  and what would change your mind.
