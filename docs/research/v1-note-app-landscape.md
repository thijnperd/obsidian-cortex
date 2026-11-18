# The note-app landscape and Cortex v1

Snapshot: 2026-11-18. Question: what do the most popular note apps make
essential, what do users complain about, and which gap should Cortex v1 own
without copying Notion or Obsidian?

Method: first-party help centers, product docs, pricing pages and release notes.
Community threads are used only for the complaint pattern, not as market data.

## The four models

| Model | Examples | Defining idea | What Cortex should take |
| --- | --- | --- | --- |
| Local Markdown vault | Obsidian, Logseq, Reflect | The folder is the database; links build a network. | Ownership, plain files, fast search. |
| Cloud workspace | Notion, Capacities, Anytype, Tana | Objects, blocks or typed nodes in a hosted workspace. | A clear organizing primitive, not a block builder. |
| Apple-native writing | Bear, Apple Notes | Capture and typography first, deep OS integration. | Writing feel and zero-friction capture. |
| Spatial canvas | Heptabase, Craft | Cards placed on a canvas for sense-making. | Spatial thinking without manual layout work. |

Obsidian documents a vault as a local folder of Markdown and treats backlinks,
graph, daily notes and templates as core plugins
([data storage](https://obsidian.md/help/data-storage),
[backlinks](https://obsidian.md/help/backlinks),
[plugins](https://obsidian.md/help/plugins)). Notion's model is blocks and
databases, with search, backlinks and page history as platform features
([blocks](https://www.notion.com/help/what-is-a-block),
[databases](https://www.notion.com/help/intro-to-databases),
[history](https://www.notion.com/help/duplicate-delete-and-restore-content)).
Bear is Markdown with tags, wiki links and backlinks
([features](https://bear.app/faq/features-and-price-of-bear-pro),
[backlinks](https://bear.app/faq/how-to-use-the-info-panel-table-of-contents-and-backlinks-in-bear/)).
Logseq makes every bullet a block and journals the default surface
([Logseq](https://logseq.com/)). Capacities gives every note a type
([getting started](https://docs.capacities.io/tutorials/getting-started)).
Heptabase puts cards on spatial whiteboards
([fundamentals](https://wiki.heptabase.com/fundamental-elements)).

The pattern is consistent: **one organizing primitive plus speed and
ownership**. The complaints are equally consistent: sync, mobile, history,
scale and setup cost are the seams where these products hurt.

## Table stakes for a public v1

| Capability | Evidence | Cortex v1 stance |
| --- | --- | --- |
| Markdown in a local folder | Obsidian, Logseq, Reflect | Already the foundation. Never add a proprietary database. |
| Full-text search | Obsidian, Notion, Bear, Capacities | Already present. Keep it instant and local. |
| Backlinks and unlinked mentions | Obsidian, Bear, Capacities, Craft | Present; the note panel also shows related notes. |
| Quick capture / daily note | Obsidian daily notes, Logseq journals, Apple Quick Note | **Added in v1:** `t` opens or creates `Journal/YYYY-MM-DD.md`, then starts editing. |
| Decision history | Notion history, Craft history, Heptabase card history | **Partial in v1:** review dates and supersession make decisions age visibly; file-level history remains the vault's / sync client's job. |
| Import / export | Every serious tool | Open a folder in place; `cortex export` writes a static site. |
| Onboarding | Notion templates, Obsidian's get-started path | `cortex seed-demo` is the guided sample; the launch screen explains opening a folder. |
| Mobile and sync | Obsidian Sync, Bear iCloud, Capacities offline | **Not in v1.** Use folder sync (iCloud, Dropbox, Syncthing, Git). Document the boundary. |
| Collaboration | Notion, Craft, Heptabase | **Not in v1.** Local-first, single-writer by design. |
| AI | Notion, Capacities, Reflect | Not a dependency. The MCP server lets the user's own client work on the vault. |

## What users praise and complain about

- Obsidian: ownership, speed and plugins, but sync friction and the global
  graph becoming a hairball
  ([graph discussion](https://www.reddit.com/r/ObsidianMD/comments/1sf2msz/3_years_in_still_not_sure_if_im_using_graph_view/)).
- Notion: flexibility, but slow pages, setup cost and weak offline
  ([offline docs](https://www.notion.com/help/use-pages-offline)).
- Bear: clean writing, but no native version history and an Apple-only world
  ([web/Android FAQ](https://bear.app/faq/what-about-bear-for-web-android-windows)).
- Logseq: references feel natural, but mobile sync and reliability are recurring
  concerns.
- Capacities: the object model clicks, but mobile parity and sharing lag.
- Anytype: privacy and local-first, but a steep learning curve.

The lesson for Cortex: do not win by having the most features. Win by making a
focused workflow faster and more trustworthy than a general workspace.

## The v1 wedge: decision trails

A graph answers "what links to what". It does not answer **"why did we decide
this, what did we know then, and when should we look again?"** Notion decision
logs are templates; Obsidian decision journals are templates; MADR is a
Markdown convention
([MADR](https://adr.github.io/madr/decisions/adr-template.html)). None of the
reviewed products makes the reasoning trail a native, queryable object across
graph, timeline and board.

Cortex already has the spine: research briefs and idea refinements become
`type: research` / `type: idea` notes, and the Decisions board groups them by
status with their cited sources. v1 completes the loop with optional
frontmatter:

```yaml
confidence: 0.8          # 0–1 or 70–100; stored as a percentage
review_on: 2027-01-15    # YYYY-MM-DD
supersedes: "[[Earlier decision]]"
```

The note panel renders a **decision trail**: status, confidence, review date,
the decision it supersedes, and the linked sources. Past-due reviews are marked
in the Decisions board. `y` jumps back to the trail. Nothing is required: a
plain note without these fields behaves exactly as before.

This is the personality in one sentence: **Obsidian gives you a vault, Notion
gives you a database, Cortex gives you the reasoning trail.** The 3D graph is
where the trail lives spatially; the Decisions board is where it becomes work.

## v1 non-goals

- No hosted account, sync service, real-time collaboration or mobile app.
- No block editor, plugin runtime or mandatory database.
- No AI key or model inside Cortex; MCP remains the integration boundary.
- No telemetry.

The public promise is narrower and stronger: your folder, your files, six ways
to see them, and a record of why the important conclusions exist.
