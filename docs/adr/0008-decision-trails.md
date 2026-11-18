# 0008 — Decision trails are frontmatter, not a database

Status: accepted (2026-11-18)

## Context

The Decisions board already turns `type: research` and `type: idea` notes into
cards grouped by `status`, with their cited sources. That answers *what have I
concluded, and on what?* It does not answer *how sure was I, when should I
revisit this, and what did it replace?* Those are the questions that make a
decision artifact different from a note.

Competitor research (see `docs/research/v1-note-app-landscape.md`) found that
decision logs are templates in Notion and Obsidian, not native objects. Cortex
has an opening to make the reasoning trail first-class without inventing a
second store.

## Decision

Three optional frontmatter fields extend a structure note:

- `confidence`: `0.7`, `70` or `70%`, normalised to a 0–100 integer.
- `review_on`: an ISO `YYYY-MM-DD` date. Dates in the past are **review due**.
- `supersedes`: `[[Note]]`, `Note#heading` or a plain id; resolved with the same
  lookup as every other wikilink.

They are parsed in `crates/core/src/markdown.rs`, carried on `Note`, serialised
on `structures::Card`, and resolved again for the note detail response. The
board shows confidence, the review date and a due flag; the panel renders a
`Decision trail` with the status, confidence, review date, supersession link and
linked sources.

`y` scrolls to the trail in an open structure note. `t` opens or creates
`Journal/YYYY-MM-DD.md`; it is a capture surface, not a structure note.

## Why not a separate database or a new note type

- The vault already owns the data. A second index would drift, need migration
  and break `cortex export`.
- Missing fields must fail open. A normal note, an Obsidian note with unrelated
  frontmatter, and a static export all keep working.
- The fields are readable and writable in any editor, which is the point of the
  local-first promise.

## Consequences

- The review date is evaluated in the browser's local timezone; the server
  stores only the date, never a timestamp.
- A superseded note is still a note. Cortex links to it; it does not archive or
  rewrite it.
- Status remains user-owned. Cortex reports custom statuses in their own
  columns and does not infer a lifecycle.
- `supersedes` records one predecessor. A future schema may need a list, but v1
  keeps the common case explicit and the fallback graceful.
