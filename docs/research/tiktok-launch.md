# TikTok launch: marketing, tooling and the first videos

Research for the 1.3 launch. Three questions: what TikTok rewards, what can
actually render the videos, and what Cortex should post. Every claim that
matters is cited; the unverified parts are listed at the end rather than
smoothed over.

The videos themselves are in [`marketing/tiktok/`](../../marketing/tiktok), and
`tools/make-tiktok.py` regenerates them from the real app screenshots.

## The short version

1. **The graph is the hook, the claim is the reason to stay.** A 1.6M-view
   second-brain post put a glowing graph behind a talking head and won 45% of
   the hook on the title, 35% on the spoken claim and 20% on the visual. Graph
   fly-throughs with no claim are commoditized: one creator's 9-second solar
   system graph variants mostly got 50–1,100 views.
2. **Two to three hashtags, per TikTok itself.** "When it comes to hashtags,
   less is more, so we encourage you to use 2 to 3 relevant hashtags on each
   video." More tags do not buy reach, and keyword stuffing can be flagged as
   spam.
3. **Generative video models cannot shoot this product.** Diffusion models
   hallucinate UI text and cannot reproduce the real Brain view. The videos are
   rendered from the actual screenshots with a deterministic Python/FFmpeg
   pipeline instead.
4. **Disclose that it is your product.** TikTok's commercial policy requires
   disclosure when you promote your own product, and undisclosed commercial
   content can have its reach reduced. Toggle the content disclosure in the
   composer.

## 1. What TikTok's own documentation says

| Lever | Guidance | Source |
| --- | --- | --- |
| Hook | Hook "ideally within the first 5 seconds"; ads guidance narrows it to the first 3 | [Creator Academy: elements of a video](https://www.tiktok.com/creator-academy/en/article/elements-of-tiktok-video) · [Business: creative best practices](https://ads.tiktok.com/help/article/creative-best-practices) |
| Length | No required length — "length diversity over requirements". Ads benchmark: 21–34 s over-indexes, but that is a 2022 ad sample, not organic | [Creator Academy](https://www.tiktok.com/creator-academy/en/article/elements-of-tiktok-video) |
| Muted viewing | "Over 30% of TikTok survey respondents watch videos on mute and rely on captions" | [Creator Academy](https://www.tiktok.com/creator-academy/en/article/elements-of-tiktok-video) |
| Captions | 5–10 words per second on screen; on-screen text is 1.4× more likely to hook | [Business: creative best practices](https://ads.tiktok.com/help/article/creative-best-practices) |
| Hashtags | 2–3 relevant tags; "more hashtags won't guarantee a broader reach"; #FYP behaves like any other tag | [Creator Academy](https://www.tiktok.com/creator-academy/en/article/elements-of-tiktok-video) · [Newsroom](https://newsroom.tiktok.com/en-us/5-tips-for-tiktok-creators) |
| Search | Description, voiceover, captions and on-screen text all signal the topic; unrelated keyword walls read as spam | [Creator Academy: search](https://www.tiktok.com/creator-academy/en/article/Getting-discovered-with-Search) |
| Ranking | Interactions are weighted above "video information" (caption, sound, hashtags) | [Newsroom: how recommendations work](https://newsroom.tiktok.com/how-tiktok-recommends-videos-foryou) |
| Cadence | No universal number; publishers posting multiple times a day see higher views | [Creator Academy: posting cadence](https://www.tiktok.com/creator-academy/en/article/posting-cadence-best-practices-publishers) |
| STEM feed | A complete English lesson tagged `#STEMTok` can also surface in the STEM feed | [Creator Academy: STEM content](https://www.tiktok.com/creator-academy/article/creating-STEM-content) |

TikTok's own docs never prescribe a posting frequency or a video length. Any
"post 3–5× a week" number is agency advice, not platform policy.

## 2. What performs in this niche

Counts below are **likes**, not views: TikTok's logged-out pages expose likes,
comments, saves and shares, not view counts.

**A claim beats an announcement.** On the same account, Supabase's contrarian
dev videos pulled 4.5K–6.8K likes while its product-launch posts pulled 114–514.
VS Code's "Hacking GitHub" hit 6.4K. ([Supabase 6.7K](https://www.tiktok.com/@supabase.com/video/7680195528012975381),
[launch post 178](https://www.tiktok.com/@supabase.com/video/7667307354832112903),
[VS Code](https://www.tiktok.com/@vscode/video/7665435494355946782))

**In PKM, the artifact is the hook.** The breakout Obsidian post is a 30-second
animation — "literally hundreds of hours of work all in one animation" — with
551K likes, 44.9K saves and 4.6K shares. Ordinary Obsidian how-tos from small
accounts land at 500–4,000 likes. ([source](https://www.tiktok.com/@isabelthearcher/video/7597106579535727895))

**Sponsored app posts underperform method posts.** The same studytok creator
gets 100K–290K on her own tips and 12.8K–16.8K on app-integration posts. A
plugin announcement is the weak format; a method with the plugin as the reveal
is the strong one.

**Saves are the metric that matters for a tool.** 44.9K saves on a notes
visualization predicts installs far better than likes do. Instrument nothing;
watch GitHub traffic after posting.

## 3. AI video: what the named model actually is

**"DeepSeek V4 Flash 1017" does not generate video, and the name is slightly
off.** The real model is **DeepSeek-V4.1-Flash-1017**, released 2026-10-17;
`1017` is a date suffix. Its output is text, it accepts images as input, and
its API surface is Chat Completions / Messages / Responses with JSON output and
tool calls — there is no video endpoint and no video model in the list.
([release note](https://api-docs.deepseek.com/news/news261017),
[models and pricing](https://api-docs.deepseek.com/quick_start/pricing))

That does not make it useless here: a text model is the right tool for writing
scripts, shot lists and captions. It is the wrong tool for pixels.

**What can generate footage (Nov 2026):** every hosted model caps out at 8–30
seconds per generation and none can reproduce a real product UI.

| Model | Max clip | 9:16 | Audio | Price |
| --- | --- | --- | --- | --- |
| Google Veo 3.1 | 8 s, extendable to 141 s | yes | native | $0.40/s with audio, no free tier |
| Gemini Omni Flash 1.2 | 15 s | yes | native | ≈$0.07/s at 720p |
| Runway Gen-4.5 | 10 s | yes (image-to-video) | no | 125 one-time credits, API $0.12/s |
| Kling 4.0 | 30 s | yes | native | prepaid units |
| Pika H3 Flex | 15 s (API) | yes | native | $0.01–0.08/s |
| MiniMax H3 | 15 s | yes | native | $0.08/s |
| OpenAI Sora 2 | — | — | — | **discontinued** (app Apr 2026, API Sep 2026) |
| Wan 2.2 / LTX-2.5 | 5–20 s | yes | LTX only | self-hosted, open weights |

Sources: [Veo](https://ai.google.dev/gemini-api/docs/veo),
[Omni](https://ai.google.dev/gemini-api/docs/omni),
[Runway](https://runway.com/pricing), [Kling](https://kling.ai/document-api/pricing/base/video),
[Pika](https://dev.pika.art/models/pika/pika-h3-flex/text-to-video),
[MiniMax](https://platform.minimax.io/docs/guides/video-generation),
[Sora shutdown](https://help.openai.com/en/articles/20001152-what-to-know-about-the-sora-discontinuation),
[Wan 2.2](https://github.com/Wan-Video/Wan2.2), [LTX](https://docs.ltx.io/models/ltx-2-5).

**The decision:** render the videos from code. Remotion is free for a solo dev
and unlimited commercial use ([licence](https://www.remotion.dev/docs/license/pricing)),
but a Rust repo with no Node toolchain does not need a React renderer for three
clips. `tools/make-tiktok.py` composes frames in Python from the real
screenshots and pipes raw RGB into FFmpeg. Deterministic, free, and the UI text
is pixel-exact because it is the actual UI.

## 4. How Claude makes animations

Two different things share that name.

**Claude Motion** is Anthropic's video-oriented artifact template. Anthropic
says it builds code that animates text, charts, shapes and images, plays like a
short video, can be edited in an editor or by asking, and exports MP4. It
explicitly does **not** use a video-generation model and is not for realistic
footage. ([Get started with Claude Motion](https://support.claude.com/en/articles/17454997-get-started-with-claude-motion))

**A normal artifact** is a single self-contained page: HTML, CSS and inline
JavaScript in one file, which is why an animation request usually comes back as
a live page rather than a video. ([Artifacts](https://support.claude.com/en/articles/17153992-what-are-artifacts-and-how-do-i-use-them),
[Claude Code artifacts](https://code.claude.com/docs/en/artifacts))

I found no public Anthropic motion-design manual with timings and easing, so the
following is technique, not company doctrine:

| Technique | Use |
| --- | --- |
| CSS `@keyframes` | simple reveals, loops, UI motion ([MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/%40keyframes)) |
| SVG `stroke-dashoffset` | drawing a path on, like a link being traced ([MDN](https://developer.mozilla.org/en-US/docs/Web/SVG/Reference/Attribute/stroke-dashoffset)) |
| Canvas + `requestAnimationFrame` | particles and continuous drawing ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)) |
| Frame-indexed rendering | animation state is a function of frame number, so every render is identical ([Remotion](https://www.remotion.dev/docs/troubleshooting/css-animations)) |

Anthropic's published frontend advice is the useful design rule: one
orchestrated page-load reveal with staggered elements beats scattered
micro-interactions. ([Anthropic frontend design](https://claude.com/resources/articles/improving-frontend-design-through-skills))

`tools/make-tiktok.py` follows exactly that: every frame is a pure function of
time, the camera has one move per shot, and text enters once and then holds.

## 5. Video concepts, ranked

| # | Concept | Format | Why |
| --- | --- | --- | --- |
| 1 | **"Your notes have a shape"** | 19 s, silent, text only | Visual reveal. Particles assemble into the Brain, then the real 5,523-note screenshot, then Decisions. Broadest reach. |
| 2 | **"5,523 notes"** | 14 s, silent | Scale proof and the six views in one clip: Brain, Atlas, back to Brain. Good for stitching into other posts. |
| 3 | **"Why did you decide that?"** | 17 s, silent | The differentiator. Hook is a question everyone has lived; payoff is the decision trail. Lowest reach, highest intent. |
| 4 | Method video (45–75 s, voiceover) | future | The format that actually converts in studytok — teach a method, reveal the brain at the end. Needs a script and a voice. |
| 5 | Build-in-public failure story | future | The one build-in-public post that broke out was a specific mistake and its fix, not a manifesto. |

Deliberately not made: a silent fly-through with no claim. It is the easiest
video and the most commoditized one.

## 6. Titles, descriptions and hashtags

**Formula** (first line must survive truncation at roughly 100 characters):

> Cortex + concrete visual outcome + searchable category + proof/constraint

**Rules:** put "Obsidian" or "Cortex" in the first five words; use one concrete
visual noun ("brain-shaped graph", not "beautiful visualization"); add one
proof ("free", "open source", "your files stay"); never open with "Have you
ever" or "In this video". Hashtags go after the fold.

**Core tag sets** (pick three unless there is a reason for five):

- Launch / visual: `#obsidian #pkm #opensource`
- Notes audience: `#obsidianmd #notetaking #secondbrain`
- Builder audience: `#buildinpublic #opensource #rust`

`#obsidian` also contains crystals and the game; `#pkm` contains the machine
gun and Pokémon; `#secondbrain` is dominated by gut-health posts. The caption
therefore has to disambiguate in words: **"Obsidian vault"** and
**"brain-shaped graph"**.

**Caption for video 1 (your notes have a shape)**

> Cortex turns an Obsidian vault into a brain-shaped graph you can fly through.
> 5,523 notes, 24,151 links, one surface. Free + open source, no account, your
> files stay where they are.
> `#obsidian #pkm #opensource`

**Caption for video 2 (5,523 notes)**

> Same 5,523-note vault, six ways to see it: Brain, Graph, Timeline, Atlas,
> Bento, Decisions. One Rust binary, no cloud.
> `#obsidianmd #notetaking #opensource`

**Caption for video 3 (why did you decide that)**

> A decision note in Cortex carries its confidence, its review date and the
> note it replaced — as plain frontmatter, in your own folder.
> `#obsidian #pkm #buildinpublic`

**Pinned comment for all three:** "It's a desktop app, not a plugin — it reads
an Obsidian vault (or any Markdown folder) as-is. Free download:
github.com/thijnperd/obsidian-cortex/releases"

A clickable bio link needs 1,000 followers or a business account, so the pinned
comment and the on-screen URL do the work until then.

## 7. Compliance checklist

- Toggle **content disclosure** — promoting your own product is explicitly in
  scope. ([Commercial activities policy](https://www.tiktok.com/safety/en/policies-and-engagement/regulated-commercial-activities))
- Use the seeded demo vault, or a vault with no real names, emails, paths or
  tokens on screen. Never show another person's notes.
- No third-party music under the screen recording. Add a TikTok sound in the
  composer instead, which is licensed by the platform.
- Only your own footage; the clips are rendered from this repo's screenshots.
- Don't stuff the caption with unrelated tags.

## 8. What could not be verified

- **View counts.** TikTok's logged-out pages do not expose them; every number
  in section 2 is likes, saves or shares.
- **Any organic length or frequency number from TikTok.** The 21–34 s figure is
  a 2022 ad benchmark and contradicts the 2026 "length diversity" guidance.
- **Whether auto-captions feed ranking.** Third-party blogs say so; no TikTok
  document does.
- **Enforcement consistency** for undisclosed own-product promotion.
- **A public Anthropic motion-design system.** The timing and easing choices in
  the videos are craft, not a leaked brand guide.
- **Which CTA converts installs.** No public data ties an Obsidian-adjacent
  TikTok video to plugin or app installs.
- Figures for hosted video models come from vendor pricing pages read in
  November 2026 and will drift; re-check before spending money.
