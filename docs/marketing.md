# Cortex marketing: the brain is the front door

Status: adopted for 1.3.0. Research behind it:
[v1.3 brain-first](research/v1.3-brain-first.md).

## The situation, without a solution in it

The situation is that people with years of Markdown notes can retrieve any
single page but cannot see the shape of what they know or why they concluded
something. The people affected are researchers, writers, designers and
developers who already keep a folder of notes and are suspicious of turning it
over to a cloud service. The outcome we want is that the shape of their
knowledge becomes visible in seconds, and the reasoning behind a decision
survives as part of the same artifact.

### Assumptions

**Load-bearing**

- The Brain view is visually distinctive enough to stop a scroll without
  explaining the product first.
- A real screenshot of a populated vault communicates more than a logo, a
  diagram or a feature list.
- "Cortex" and "brain" are mutually reinforcing; leading with anything else
  wastes the name.
- The Decisions trail is the reason to switch, but it needs a second beat: it
  is hard to understand before the user has seen the shape it belongs to.

**Cosmetic**

- The warm-white plate on the app icon is better than pure white.
- The README's exact headline ("Your notes, as a brain.") is carved in stone.
- The social card needs a wordmark burned into it.

## The idea, refined

The obvious move is to keep Decisions as the hero: it is the differentiator and
the most defensible feature. The problem is that a decision board looks like
every other kanban board until you already care. The Brain view is the only
asset that is unmistakably Cortex, carries the name, and can be understood in
one glance: my notes, connected, in the shape of a brain.

This is a funnel change, not a feature change. Brain is the hook. Decisions is
the proof that the hook is not decoration. Local-first is the trust argument
that closes.

### Options considered

| Option | Effort | Risk | Reversibility | Fit |
| --- | --- | --- | --- | --- |
| **Null:** keep Decisions as the hero | none | the app reads as another decision-log tool; the name stays unexplained | trivial | weak |
| **Cheapest:** swap only the README image | 1 hour | inconsistent story: docs lead with Brain, demo and social card still lead with Decisions | trivial | partial |
| **Inverted:** hide the graph and market only the decision workflow | medium | throws away the visual advantage; competes with established PKM tools on their terms | medium | weak |
| **Adjacent:** market "second brain" like Obsidian/Logseq | small | category is crowded and the phrase is generic; no proof of difference | trivial | weak |
| **Ten-times:** interactive brain demo with a guided "find the bridge" task | large | needs a hosted demo path and instrumentation; not a release-sized change | hard | strong later, not now |
| **Recommended:** brain-first hierarchy across README, social card and tour | 1 day | Brain may read as eye candy if Decisions is not shown immediately below | easy | strong |

### Recommendation

Lead with the Brain view everywhere a first impression is formed, then show the
reasoning trail as the proof. The README now does this: brain hero, one-line
promise, real screenshot, then "Why the brain", then Decisions and the trail.
The social card is the same brain at 1280×640. The tour still visits Brain; its
step now calls it the signature view, while the README carries the
first-impression job.

The runner-up is the Decisions-first story. Switch back if Brain screenshots
consistently underperform the decision-board screenshot on the live demo, or if
the audience turns out to be decision-heavy teams who need the trail before they
care about the map. The assumption that would most change the answer is that a
still image of a brain is legible without a caption; if it is not, the card needs
a short overlay.

## Positioning

**One-liner.** Cortex turns a folder of Markdown into a brain you can see — and
keeps the reasoning behind every decision.

**Category.** Local-first knowledge graph / thinking space, not a note editor
and not an AI chatbot.

**Audience.** People with 300–5,000 notes who already use Obsidian, Logseq or a
folder of Markdown, and who want to see structure without uploading their
thinking to a service.

**Promise.** Your files stay where they are. Cortex adds a second way of seeing
them and a place for the conclusions.

**Proof.**

- A real cortical surface, not a node-link diagram: links are fibre tracts,
  folders are regions, and the layout is deterministic.
- Research briefs and idea notes are ordinary Markdown with `[[wikilinks]]`
  back to the sources; no model, API key or account.
- Decision trails carry confidence, review dates and supersession in
  frontmatter, so the reasoning survives every editor and export.
- One Rust binary, six views, no cloud, no telemetry.

**Tone.** Quiet, precise, a little wry. No "revolutionary", no "AI-powered", no
"second brain" as the main claim. The product is the argument.

**Anti-positioning.** Not a prettier Obsidian, not a task manager, not a
dashboard for teams, not a chatbot over your notes.

## Message hierarchy

1. **Brain.** "Your notes, as a brain." A real Brain view screenshot, 328 notes,
   557 links. One caption, no overlay paragraph.
2. **Decisions.** "And it keeps the reason." The decision board and trail, with
   one concrete card. This is the differentiator, not the hook.
3. **Local-first.** "Your folder. Plain Markdown. No account." The trust close,
   with the native window and download links.

Anything that does not serve one of those three moves below the fold.

## Surfaces

### GitHub README

- Mark, wordmark, one-line promise, brain hero, one caption, badges, demo link.
- Relative image paths only.
- The brain hero is a real 1440×900 screenshot of the 328-note seeded vault,
  not a mock-up.
- Decisions and the trail remain a full section with their own screenshot; they
  are the second beat, not a footnote.
- Alt text names the graphic and the state: "Screenshot of Cortex's Brain view:
  a translucent cortical surface with folder clusters, note stars and links as
  fibre tracts."

### Repository social preview

- `assets/social-preview.jpg`, 1280×640, opaque, under 1 MB.
- Same Brain crop as the README, no sidebar and no toolbar, so it reads at
  320×160.
- Upload it in GitHub → Settings → Social preview. The API does not set this
  image.

### Live demo

- Keep the URL stable: <https://thijnperd.github.io/obsidian-cortex/>.
- The demo is the product, not a video. It opens on a seeded vault and does not
  require an account.
- The README link uses `?view=brain`, so the first thing a visitor sees is the
  same brain as the hero. `?view=` accepts `universe`, `brain`, `replay`,
  `atlas`, `bento` and `decisions`; it is a link feature, not a saved default.

### App icon

- One solid brain, one seam, one double-band trail; warm-white plate, near-black
  ink.
- Exported at 16, 20, 24, 32, 40, 48, 64, 128 and 256 px plus `.ico`, `.icns`,
  tray and window variants.
- The README mark, launcher mark, Windows exe, installer, macOS bundle and
  favicon all come from the same geometry in `tools/make-icons.py`.

### Release notes

- Lead with the user-visible change, not the version number.
- Include one Brain screenshot and one Decisions screenshot.
- State the Linux browser-path limitation plainly. No marketing gloss over it.

## What we will watch

Cortex has no telemetry, so this is deliberately not an analytics plan.

- GitHub traffic: referrers and clones around a release.
- Demo visits, if the Pages host exposes them; otherwise qualitative feedback.
- Which screenshot people mention when they write about the release.
- Whether new users ask "what is this?" in the first reply, which means the
  brain hero is not carrying the explanation.

If the Brain hero does not produce a clearer first impression than the Decisions
board, switch the second beat and the hero. The product is the same either way;
only the order of the argument changes.

## Sources

The primary-source rules and their limits are in
[research/v1.3-brain-first.md](research/v1.3-brain-first.md). The short version:
GitHub recommends relative README images and a 1280×640 social preview; Apple
asks for one clear focal point and simple, filled icon shapes; Microsoft asks for
one literal metaphor, a distinctive silhouette and 16/24/32/48/256 px exports;
Material asks for bold, consistent icons with a unique silhouette.
