# Decisions view: what the primary sources actually say

Notes taken before building the Decisions view ([ADR 0007](adr/0007-decisions-view.md)).
Everything here is from documentation the project itself owns, not from blog
posts. Where a claim could not be verified, it says so instead of guessing.

## Obsidian properties are user-defined

- Property names and values are yours: "For the name, you can choose anything
  you like." — [Obsidian Help: Properties](https://help.obsidian.md/properties)
- The supported types are Text, List, Number, Checkbox, Date, Date & time and
  Tags. There is **no enum type**, so `status` is a text property with a
  convention, not a schema. — same page
- **Consequence:** a status vocabulary of `open` / `refining` is Cortex's
  choice, not an Obsidian rule. Hence: render unknown values as their own
  columns instead of coercing them.

## Bases already owns the board interaction

- Bases layouts include Table and Kanban: "Kanban | Display files as cards
  organized into columns based on a grouped property." (documented for 1.14) —
  [Obsidian Help: Bases views](https://obsidian.md/help/bases/views)
- Columns are property values: "Each column represents a value of the property
  used to group results." —
  [Kanban view](https://obsidian.md/help/bases/views/kanban)
- Dragging is a write: "Drag a card to another column to update the grouped
  property in that note." — same page
- **Consequence:** do not rebuild a worse Bases. A read-only board is the
  defensible scope, and the differentiator has to be something Bases does not
  show: the evidence each decision cites.

## Dataview: frontmatter is queryable, tasks are a different `status`

- "All YAML Frontmatter fields will be automatically available as Dataview
  fields." —
  [Adding Metadata](https://blacksmithgu.github.io/obsidian-dataview/annotation/add-metadata)
- Dataview's task `status` is the checkbox character, not the note property: "The
  completion status of this task, as determined by the character inside the
  `[ ]` brackets." —
  [Metadata on Tasks and Lists](https://blacksmithgu.github.io/obsidian-dataview/annotation/metadata-tasks)
- **Consequence:** `status` in the board means the note's frontmatter field
  only. Checkbox counts in a brief are not treated as its status.

## Decision records do have a conventional status

- Microsoft's architecture-decision-record guidance lists "Proposed,"
  "Accepted," and "Superseded," and argues that "Tracking status makes the
  current state of each decision clear, especially as the number of decisions
  grows." —
  [Microsoft Learn: Maintain an ADR](https://learn.microsoft.com/en-us/azure/well-architected/architect-role/architecture-decision-record)
- MADR uses proposed / rejected / accepted / deprecated / superseded. —
  [MADR template](https://adr.github.io/madr)
- **Could not verify:** neither source prescribes `open` and `decided`. Those
  are Cortex's mapping, chosen to match the two templates it writes; the board
  must keep showing any other value rather than translating it.

## What this changed in the design

1. The board groups by the note's own `status`, with no translation table.
2. `status` is not written from the view; Bases already does that better, in
   the place the notes live.
3. The card's job is the evidence list, which is the only part of this that is
   specific to Cortex.
