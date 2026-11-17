# Glossary

The words that mean something specific in Cortex. Code, docs and issues should
use them exactly.

**Vault** — a folder of Markdown files, plus whatever else lives beside them
(`.obsidian/`, images). The unit of everything: a server session, a map, a
graph. Identified by its canonical path; the registry remembers the path.

**Note** — one `.md` file in a vault. Its **id** is the path without the
extension and with forward slashes, e.g. `World/Istar`. Not a database record:
rename the file and the id changes.

**Wikilink** — `[[Note]]`, `[[Note|shown text]]` or `[[Note#Heading]]`. Cortex
resolves all three and strips the anchor when matching, which is what makes an
Obsidian vault work without edits.

**Backlink** — a note that links *to* this one. **Outgoing** is the other
direction. **Unlinked mention** — a note that contains this note's title as
text without a wikilink; a link waiting to happen.

**Orphan** — a note with no links in either direction.

**Folder** — the top-level directory a note lives in. Nested folders collapse
into their top ancestor: `Enemies/Goons/X.md` is filed under `Enemies`. One
folder becomes one country on the atlas and one colour in the graph.

**Universe / Brain / Timeline / Atlas** — the four views of the same graph.
The first three are WebGL scenes (`web/js/renderer.js`); the atlas is a 2D
canvas (`web/js/atlas.js`).

**Country** — one folder on the atlas. Its **capital** is the layout seed, its
**field** is the shrunk Voronoi cell used for membership, and its **outline** is
the roughened coast that is actually drawn.

**Place** — one note on the atlas. Places clustering within one country form a
**settlement**, drawn as a walled enclosure; **wilderness** is the unsettled
land between them, stippled with grass.

**Road** — a same-country link, drawn with width proportional to link count.
**Trade route** — a link that crosses a country border, drawn dashed.

**Agent** — an external AI client talking to `cortex mcp`. Not a feature inside
the UI: there is no model in Cortex and no API key.

**Agent access** — the per-vault switch that decides whether an agent may drive
that vault. Stored beside the vault list, not in the vault; deny by default, so a
folder Cortex has never seen has no access until it is opened or `cortex agents
<folder> --on` is run. Off means `cortex mcp` refuses to start *and* a connected
session stops on its next call.

**App window** — `cortex`'s default launch: Chrome, Edge or Brave in `--app` mode
with its own profile, so the UI has a chromeless window without an embedded
webview. Falls back to a browser tab.

**Reveal** — showing a vault or note in Explorer, Finder or the platform file
manager (`POST /api/reveal`). Goes through the same write guard as a note edit.

**House format** — the formatting rules an agent follows when it creates or
rewrites notes: one H1 matching the file name, ATX headings, wikilinks,
frontmatter keys Cortex reads, one trailing newline. Written down in
`docs/agent-guide.md`, served as the `cortex_guide` tool. An instruction to the
model, not a formatter — see ADR 0003.

**Precondition / `expect`** — the hash a write must present, taken from the
`hash` field of `cortex_read_note`. A mismatch is a **conflict**: nothing is
written and the current hash comes back so the agent can re-read.

**Journal** — `agent-writes.jsonl` in the config directory, one line per agent
mutation. A record, not an undo log.
