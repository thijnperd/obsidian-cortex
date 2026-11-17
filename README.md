# Cortex

Cortex turns a folder of Markdown notes into a navigable 3D universe — and then
gives that view a job: collect notes, read their local graph, and turn the
selection into a research brief or an idea decision.

Four views share one graph: a 3D **universe**, a **brain**, a **timeline**, and
an **atlas** that draws folders as countries on a parchment map and links as
roads. Same notes, different question: where does this live, and what connects
to it?

It reads and writes plain Markdown, so an existing Obsidian or Logseq vault
works as-is. No account, no cloud, no database.

```bash
cargo run -p cortex                       # reopens the last vault, or offers a picker
cargo run -p cortex -- seed-demo demo     # optional: a 174-note example vault
cargo run -p cortex -- serve demo         # open one folder directly
```

## Opening a folder

Run `cortex` with no arguments and it reopens whatever you used last. With
nothing remembered you get a launch screen: the vaults you have opened before,
and a field for a folder path.

- Vaults are remembered in `vaults.json` in your platform config directory
  (`$XDG_CONFIG_HOME/cortex`, `~/Library/Application Support/cortex`,
  `%APPDATA%\cortex`). Override it with `CORTEX_CONFIG_DIR`.
- Several vaults can stay open at once. The list on the left switches between
  them without restarting anything; search, synthesis and the palette always
  act on the vault you are looking at.
- Choose the view you land in on the launch screen (**Open in**), or change it
  later from **Vault settings**. Cortex remembers the view per vault.
- `cortex serve ~/Notes` still opens one directly, and `⌘O` returns to the
  picker.
- Nothing is copied, moved or synced. Cortex reads the folder in place, and a
  folder that has been moved shows up struck through until you forget it.

### Live updates

A change on disk — your editor, a sync client, another machine — appears in
about 400 ms. Only the changed files are re-parsed, and every note that still
exists keeps its position, so the universe does not rearrange itself while you
work. The tab is notified over a long poll: no refresh button, no page reload.
If the change lands in the note you are editing, Cortex warns instead of
replacing your draft.

## The research loop

1. **Collect evidence.** ⌘-click (or shift-click) stars, or press `Collect` in a
   note panel. Collected stars stay bright while everything else dims.
2. **Read the neighbourhood.** Opening a note focuses its local graph: only the
   note, its backlinks and its direct neighbours keep their labels.
3. **Make the structure note.** `Research brief` asks for the question and writes
   `Synthesis/<question>.md` with frontmatter, a linked evidence list (title,
   folder, excerpt) and sections for what the sources say, tensions, synthesis
   and open questions.

Every claim in the brief is one click from its source, because the evidence
list is made of `[[wikilinks]]`, not copies.

## The idea-refinement loop

Select the notes that carry the tension, then choose `Refine idea`. The scaffold
has situation, assumptions (load-bearing vs cosmetic), two options with effort /
risk / reversibility, a recommendation, and "what would change my mind".

This is the part most note tools leave out: they help you collect and connect,
then stop before a decision exists. Cortex makes the decision artifact a
first-class note in the same graph.

## The atlas

The fourth view is a campaign map for history and worldbuilding: folders become
countries, notes become places inside them, links become roads.

- **Geography is deterministic.** The same vault always grows the same map, so
  a place stays where you learned it.
- **Borders are shared.** Country outlines are grown from a partition of the
  folder centres and roughened with noise keyed to the *unordered* endpoints of
  each border segment, so two neighbouring countries displace their shared
  border to the same line instead of leaving a seam.
- **Wilderness is the default.** Land nobody settled is stippled with grass;
  each clump of notes gets a walled enclosure with cleared ground inside it.
- **Roads carry weight.** Every link draws a road. A note with more links draws
  a wider road, and a link that crosses a border becomes a dashed trade route.
- **Sea, islands, compass.** The land is pulled in from the frame, ringed with
  a fine sea wash, and dotted with small islands off the coasts.

Drag to pan, wheel or `+`/`-` to zoom, `0` to fit, arrow keys to pan with the
keyboard, click a place to open it. Hiding a folder dims its country and its
roads rather than deleting them.

## Navigating

| Action | Key |
| --- | --- |
| Search every note | `⌘K` or `/` |
| Back / forward through opened notes | `⌘[` / `⌘]`, or `‹` `›` in the panel |
| Collect / uncollect a note | `⌘`/`Ctrl`/`Shift` + click, or `c` |
| Focus a note | click it (local graph only) |
| Views | `1` graph, `2` brain, `3` timeline, `4` atlas |
| Reset camera | `f` |
| New note / edit | `n`, or `Edit` in the panel |
| Open another folder | `⌘O` |

The folder list toggles visibility; hidden folders dim instead of disappearing,
so the context stays visible. Clicking a `[[link]]`, a backlink or an unlinked
mention opens that note in place, and the arrows walk back through the chain.

## Run it on your own vault

```bash
cargo run -p cortex -- serve ~/Notes --title "My vault"
```

| Flag | Meaning |
| --- | --- |
| `--open` | open the UI in your browser once the server is up |
| `--read-only` | serve without write endpoints (switching folders still works) |
| `--bind 0.0.0.0` | expose on the LAN (loopback is the default) |
| `--allow-any-origin` | relax the same-origin check (LAN preview) |
| `--allow-framing` | allow embedding in an iframe |
| `--port` | default 3000 |

`cortex export <vault> --out dist` writes a static, read-only site plus
`graph.json` (note bodies included). `cortex index <vault>` prints vault health.

Because opening a folder reads it, it is gated by the `x-cortex` write header
and the same-origin check rather than by `--read-only`. Combined with
`--allow-any-origin` that means anyone who can reach the server can point it at
any folder the process can read — which is why the default is loopback-only.

## Download

Every push to `main` refreshes one rolling release, so there is always a
freshly built binary:

**https://github.com/thijnperd/obsidian-cortex/releases/tag/latest**

| Platform | File |
| --- | --- |
| Windows x86-64 | `cortex-windows-x86_64.zip` |
| macOS (Apple silicon) | `cortex-macos-arm64.tar.gz` |
| Linux x86-64 | `cortex-linux-x86_64.tar.gz` |

One self-contained binary per platform: no runtime, no installer, the whole UI
embedded. Unpack the folder, then either run `cortex` and pick your Obsidian
vault from the launch screen, or point it straight at one:

```bash
cortex serve ~/Documents/MyVault --open
```

macOS builds are unsigned, so the first run needs
`xattr -d com.apple.quarantine ./cortex`. Version tags (`v*`) publish the same
archives with release notes. GitHub Pages hosts the demo vault only; there is
no hosted version of your own vault.

## Design constraints

- **The files are the app.** Frontmatter, wikilinks, tags and headings are the
  only schema; no proprietary format. Deleting the vault is the uninstall.
- **The graph must earn its place.** It is for orphans, clusters, and local
  neighbourhoods — not for reading the whole vault at once. That is why focus
  and filters exist.
- **Writes are opt-in.** Loopback by default, custom header plus exact-origin
  check, path validation, atomic writes, 1 MiB caps, strict CSP.
- **Deterministic.** Same vault, same layout, so places stay memorable.

## Develop

```bash
cargo test -p cortex-core
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all --check
```

The workflow design is grounded in primary documentation from Obsidian,
Logseq, Heptabase, Roam, Zettelkasten and Forte Labs; the notes and sources are
in [`docs/research-workflows.md`](docs/research-workflows.md).

`crates/core` is pure logic (parse, index, layout, search, synthesis);
`crates/server` is axum plus the embedded `web/` UI, which is hand-written
WebGL2 with no build step. CI runs the checks on Linux, macOS and Windows and
publishes the static export to GitHub Pages.
