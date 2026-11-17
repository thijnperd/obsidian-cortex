# Working in a Cortex vault

Cortex is a folder of plain Markdown files. You have tools that read and write
that folder through the same validation the app uses: no path escapes, no hidden
folders, atomic writes, a 1 MiB note cap.

Your job is bookkeeping a human would otherwise do by hand: finding notes,
creating them, and reshaping what is already there so the vault stays one graph.

## House format

A note is a Markdown file whose path is its link target. `World/Istar.md` is
`[[Istar]]` or `[[World/Istar]]`. There is no database; the file is the record.

- **Title**: one `# Heading` at the top, matching the file name. Cortex falls
  back to the file name, so a missing H1 is not fatal — a *mismatched* one is
  confusing.
- **Frontmatter**: optional, flat YAML between `---` lines. Cortex reads
  `tags`, `aliases` and `created`; anything else is preserved untouched.
- **Headings**: ATX (`## Like this`), never underlined. One blank line before
  and after every heading. Section order inside a note: what it is, why it
  matters, how it connects, sources.
- **Links**: `[[Note]]` wikilinks, not `[Note](Note.md)`. Aliases are
  `[[Note|shown text]]`; headings are `[[Note#Section]]`. Cortex resolves all
  three forms, so leave existing anchors alone unless you are fixing a broken
  one.
- **Whitespace**: no trailing spaces, no tabs, exactly one blank line between
  blocks, one trailing newline at end of file. Do not reflow prose while
  editing something else.
- **Tags**: `#tag` inline or in `tags:` frontmatter, lowercase, hyphenated.

When you reformat, change formatting only. Rewriting a sentence because it
could be shorter is a different, unasked-for edit.

## Workflow

1. `cortex_guide` once per session, then `cortex_stats` to see the shape of the
   vault.
2. `cortex_search` to find candidates; `cortex_read_note` before you touch
   anything. Never write a note you have not read in this session.
3. Write. Every write needs the `hash` you got from `cortex_read_note` in
   `expect`. If the hash does not match, someone changed the file: read it
   again, redo your edit against the new body, and retry. Do not "fix" a
   conflict by overwriting anyway.
4. `cortex_links` after creating or moving a note, to see whether anything now
   points at a name that no longer exists.
5. Say what you changed, in note names — not "updated some notes".

## Choosing a tool

| Intent | Tool |
| --- | --- |
| Create a note that does not exist | `cortex_create_note` |
| Replace a whole note body | `cortex_write_note` |
| Rewrite one section, keep the rest | `cortex_replace_section` |
| Add a paragraph at the end | `cortex_append` |
| Rename or refile a note | `cortex_move_note` |
| See what points here, or what this points at | `cortex_links` |
| Find unconnected notes | `cortex_orphans` |

Prefer the narrowest tool. `cortex_replace_section` cannot silently drop the
rest of a note; `cortex_write_note` can.

## Hard rules

- **Never delete.** There is no delete tool, and you must not emulate one by
  writing an empty file. If a note should go, tell the human.
- **Never touch `.obsidian/`, `.git/` or any dotted path.** The tools refuse
  these paths; do not work around them.
- **Never move a note with inbound links** without telling the human which
  notes still point at the old name. `cortex_move_note` does not rewrite links.
- **Do not reformat the whole vault** in one go. One folder, or the notes the
  human named, then report.
- **Do not invent facts about the vault.** If search finds nothing, say so.

## Obsidian compatibility

The vault is usually open in Obsidian at the same time. Cortex writes whole
files atomically, so a note never lands half-written, but Obsidian will reload
the note the moment you save it. Keep frontmatter keys you do not understand,
keep `[[...]]` anchors, and do not add YAML Cortex does not read unless the
human asked for it.
