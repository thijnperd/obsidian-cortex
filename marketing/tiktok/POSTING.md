# TikTok posting pack

Three videos in [`videos/`](../../videos/), rendered from the app's own
screenshots by `tools/make-tiktok.py`. Silent by design: add a sound inside TikTok's composer,
which is licensed by the platform, rather than baking music into the file.

| File | Length | Hook | Job |
| --- | --- | --- | --- |
| `01-your-notes-have-a-shape.mp4` | 19 s | "Your notes have a shape." | Reach. Particles assemble into the Brain, then the real 5,523-note vault, then the decision trail. |
| `02-five-thousand-notes.mp4` | 14.6 s | "This is one vault." | Scale proof and range: Brain, Atlas, Brain. Good for stitching or a reply video. |
| `03-why-did-you-decide-that.mp4` | 17 s | "Why did you pick this two years ago?" | Conversion. The decision board and the trail behind it. |

Each has a `-cover.jpg` next to it for the cover picker.

**Post in order 1 → 2 → 3, one a day.** Video 1 is the reach play, video 3 is
the one that makes someone download.

## Copy and paste

### 1 — your notes have a shape

> Your notes have a shape. Cortex draws an Obsidian vault as a brain.
> 5,523 notes, 24,151 links on one cortical surface. Free, open source, no
> account, and the files never leave your folder.
> `#obsidian #pkm #opensource`

### 2 — 5,523 notes

> 5,523 notes, 24,151 links. This is one vault as a brain.
> The same vault in six views: Brain, Graph, Timeline, Atlas, Bento, Decisions.
> One Rust binary, no cloud, no telemetry.
> `#obsidianmd #notetaking #opensource`

### 3 — why did you decide that

> Why did you pick that two years ago? Your notes know.
> Cortex keeps a decision's confidence, its review date and the note it
> replaced — as plain frontmatter in your own folder.
> `#obsidian #pkm #buildinpublic`

### Pinned comment on all three

> It's a desktop app, not a plugin — it reads an Obsidian vault (or any folder
> of Markdown) as-is. Free download: github.com/thijnperd/obsidian-cortex/releases

A clickable bio link needs 1,000 followers or a business account, so the pinned
comment and the on-screen URL carry the install until then.

## Before you hit post

- **Toggle content disclosure.** TikTok requires it when you promote your own
  product, and undisclosed commercial content can have its reach reduced.
- **Add a sound in the composer.** The files are silent; pick something on-beat
  and low-key. Do not add trending audio to the file itself.
- **Leave the hashtags at three.** Two to three is TikTok's own guidance, and
  the app caps most accounts at five. Don't add `#fyp`; it gives no boost.
- **Check the frame for personal data.** These use the seeded demo vault, so
  there is nothing real on screen. Keep it that way if you re-render with your
  own vault.
- **Don't keyword-stuff the caption.** TikTok names that as spam-flag worthy.

## Re-rendering

```bash
python3 tools/make-tiktok.py        # all three
python3 tools/make-tiktok.py 1      # just the first
```

The renderer reads `docs/screenshots/`, writes `videos/*.mp4` at
1080×1920, 30 fps, H.264 with no audio track, and takes about 90 seconds per
video. `marketing/tiktok/fonts/` holds Inter and JetBrains Mono; if
`marketing/tiktok/bin/ffmpeg` is absent it falls back to `ffmpeg` on `PATH`.

Why not a generative video model: every hosted model tops out at 8–30 seconds
and cannot reproduce the real UI, so the text would be invented. The reasoning,
sources and the caption/hashtag rules are in
[`docs/research/tiktok-launch.md`](../../docs/research/tiktok-launch.md).
