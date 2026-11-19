#!/usr/bin/env python3
"""Render the vertical launch videos for TikTok from the real app screenshots.

    python3 tools/make-tiktok.py          # all three
    python3 tools/make-tiktok.py 1 3      # selected videos

Output: videos/*.mp4 (1080x1920, 30 fps, H.264, no audio) and a
cover frame per video. Audio is deliberately absent: add a TikTok sound in the
composer, which is licensed by the platform and keeps the post clean.

Every frame is a pure function of time. Nothing here reads the clock or a
random source at render time, so re-running produces the same video.
"""

import os
import subprocess
import sys
from dataclasses import dataclass, field

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "docs", "screenshots")
OUT = os.path.join(ROOT, "videos")
TOOLING = os.path.join(ROOT, "marketing", "tiktok")
FONTS = os.path.join(TOOLING, "fonts")
FFMPEG = os.path.join(TOOLING, "bin", "ffmpeg")
if not os.path.exists(FFMPEG):
    FFMPEG = "ffmpeg"

W, H, FPS = 1080, 1920, 30
BG = (7, 9, 12)
INK = (245, 247, 250)
MUTED = (150, 158, 169)
GOLD = (255, 217, 160)
MARGIN = 72

SHOT = {
    "brain-medium": os.path.join(SHOTS, "medium", "02-brain.jpg"),
    "brain-giant": os.path.join(SHOTS, "giant", "02-brain.jpg"),
    "atlas-giant": os.path.join(SHOTS, "giant", "04-atlas.jpg"),
    "decisions": os.path.join(SHOTS, "v1-decisions.jpg"),
    "trail": os.path.join(SHOTS, "v1-decision-trail.jpg"),
    "icon": os.path.join(ROOT, "assets", "icons", "cortex-128.png"),
}


# ---------------------------------------------------------------- primitives


def clamp(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def ease_out(t):
    t = clamp(t)
    return 1 - (1 - t) ** 3


def lerp(a, b, t):
    return a + (b - a) * t


_fonts = {}


def font(size, weight=700, mono=False):
    key = (size, weight, mono)
    if key in _fonts:
        return _fonts[key]
    path = os.path.join(FONTS, "JetBrainsMono.ttf" if mono else "Inter.ttf")
    f = ImageFont.truetype(path, size)
    try:
        axes = f.get_variation_axes()
        vals = []
        for a in axes:
            name = a["name"]
            if isinstance(name, bytes):
                name = name.decode()
            n = name.lower()
            vals.append(weight if ("wght" in n or "weight" in n) else a["default"])
        f.set_variation_by_axes(vals)
    except Exception:
        pass
    _fonts[key] = f
    return f


def text_width(s, f, tracking=0):
    if not s:
        return 0
    return sum(f.getlength(ch) for ch in s) + tracking * (len(s) - 1)


def paste_text(base, s, x, y, f, color=INK, alpha=255, tracking=0, align="center"):
    """Draw one line onto an RGBA canvas with real alpha and optional tracking."""
    if alpha <= 0 or not s:
        return
    tw = text_width(s, f, tracking)
    if align == "center":
        x -= tw / 2
    elif align == "right":
        x -= tw
    asc, desc = f.getmetrics()
    pad = 16
    layer = Image.new("RGBA", (int(tw) + pad * 2, asc + desc + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = pad
    for ch in s:
        d.text((cx, pad), ch, font=f, fill=color + (alpha,))
        cx += f.getlength(ch) + tracking
    base.alpha_composite(layer, (int(x) - pad, int(y) - pad))


def make_vignette():
    yy, xx = np.mgrid[0:H, 0:W]
    nx = (xx - W / 2) / (W / 2)
    ny = (yy - H / 2) / (H / 2)
    r = np.sqrt(nx * nx * 0.85 + ny * ny * 0.5)
    a = np.clip((r - 0.5) / 0.95, 0, 1) ** 1.5 * 200
    arr = np.zeros((H, W, 4), np.uint8)
    arr[..., 3] = a.astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


VIGNETTE = make_vignette()
NOISE = np.random.default_rng(3).normal(0, 3.0, (H, W, 1)).repeat(3, axis=2).astype(np.int16)


def make_scrim():
    arr = np.zeros((H, W, 4), np.uint8)
    ramp = np.clip((1000 - np.arange(H)) / 860, 0, 1) ** 1.4
    arr[..., 3] = (ramp[:, None] * 255).astype(np.uint8)
    return Image.fromarray(arr, "RGBA")


SCRIM = make_scrim()

_cache = {}


def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    x = (im.width - w) // 2
    y = (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def background(path):
    key = ("bg", path)
    if key not in _cache:
        im = cover(Image.open(path).convert("RGB"), W, H)
        im = im.filter(ImageFilter.GaussianBlur(42))
        im = ImageEnhance.Brightness(im).enhance(0.5)
        im = Image.blend(im, Image.new("RGB", (W, H), (5, 7, 11)), 0.45)
        _cache[key] = im.convert("RGBA")
    return _cache[key]


def rounded_mask(w, h, r):
    key = ("mask", w, h, r)
    if key not in _cache:
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, w - 1, h - 1), radius=r, fill=255)
        _cache[key] = m
    return _cache[key]


def card_shadow(w, h, r=28):
    key = ("shadow", w, h, r)
    if key not in _cache:
        pad = 70
        s = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
        d = ImageDraw.Draw(s)
        d.rounded_rectangle((pad, pad + 18, w + pad, h + pad + 18), radius=r, fill=(0, 0, 0, 225))
        _cache[key] = s.filter(ImageFilter.GaussianBlur(36))
    return _cache[key]


def border_layer(w, h, r=28):
    key = ("border", w, h, r)
    if key not in _cache:
        s = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(s).rounded_rectangle(
            (0, 0, w - 1, h - 1), radius=r, outline=(255, 255, 255, 34), width=1
        )
        _cache[key] = s
    return _cache[key]


def radial_glow(color, radius=620, strength=26):
    key = ("glow", color, radius, strength)
    if key not in _cache:
        size = radius * 2
        yy, xx = np.mgrid[0:size, 0:size]
        d = np.sqrt((xx - radius) ** 2 + (yy - radius) ** 2) / radius
        a = np.clip(1 - d, 0, 1) ** 2.2 * strength
        arr = np.zeros((size, size, 4), np.uint8)
        arr[..., 0], arr[..., 1], arr[..., 2] = color
        arr[..., 3] = a.astype(np.uint8)
        _cache[key] = Image.fromarray(arr, "RGBA")
    return _cache[key]


# ------------------------------------------------------------------- camera

@dataclass
class Cam:
    cx: float  # 0..1 of source image
    cy: float
    zoom: float  # fraction of the source width that fills the frame


def cam_at(keys, t):
    if t <= keys[0][0]:
        return Cam(*keys[0][1:])
    for (t0, *a), (t1, *b) in zip(keys, keys[1:]):
        if t <= t1:
            u = smooth((t - t0) / (t1 - t0)) if t1 > t0 else 1.0
            return Cam(*(lerp(x, y, u) for x, y in zip(a, b)))
    return Cam(*keys[-1][1:])


def _crop_window(im_w, im_h, cam, aspect):
    cw = im_w * cam.zoom
    ch = cw / aspect
    if ch > im_h:
        ch = im_h
        cw = ch * aspect
    cx = clamp(cam.cx * im_w, cw / 2, im_w - cw / 2)
    cy = clamp(cam.cy * im_h, ch / 2, im_h - ch / 2)
    return cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2


def draw_card(canvas, path, rect, cam, radius=28):
    x, y, w, h = rect
    im = Image.open(path).convert("RGB")
    box = _crop_window(im.width, im.height, cam, w / h)
    crop = im.crop(tuple(round(v) for v in box)).resize((w, h), Image.LANCZOS)
    crop = crop.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))
    sh = card_shadow(w, h, radius)
    canvas.alpha_composite(sh, (x - 70, y - 70))
    canvas.paste(crop, (x, y), rounded_mask(w, h, radius))
    canvas.alpha_composite(border_layer(w, h, radius), (x, y))


def draw_fullbleed(canvas, path, cam):
    im = Image.open(path).convert("RGB")
    box = _crop_window(im.width, im.height, cam, W / H)
    crop = im.crop(tuple(round(v) for v in box)).resize((W, H), Image.LANCZOS)
    crop = crop.filter(ImageFilter.UnsharpMask(radius=1.8, percent=70, threshold=2))
    canvas.paste(crop, (0, 0))
    canvas.alpha_composite(SCRIM)


# ------------------------------------------------------------------- text

@dataclass
class Txt:
    s: str
    y: int
    size: int
    weight: int = 800
    color: tuple = INK
    start: float = 0.0
    end: float = 99.0
    align: str = "center"
    x: int = W // 2
    tracking: int = 0
    rise: int = 24
    fade: float = 0.42
    mono: bool = False
    field_defaults = None


def draw_texts(canvas, texts, t):
    for tx in texts:
        if t < tx.start or t > tx.end:
            continue
        u = smooth((t - tx.start) / tx.fade) if tx.fade > 0 else 1.0
        out = smooth((t - (tx.end - 0.3)) / 0.3) if tx.end < 90 else 0.0
        alpha = int(255 * clamp(u) * (1 - out))
        if alpha <= 2:
            continue
        dy = int((1 - ease_out(u)) * tx.rise)
        paste_text(
            canvas,
            tx.s,
            tx.x,
            tx.y + dy,
            font(tx.size, tx.weight, tx.mono),
            tx.color,
            alpha,
            tx.tracking,
            tx.align,
        )


# --------------------------------------------------------------- particles

def particle_cloud(path, n=3000, seed=11):
    """Sample bright pixels from a brain screenshot and map them into the frame."""
    im = Image.open(path).convert("RGB")
    bx0, by0, bx1, by1 = 470, 160, 1155, 785
    crop = im.crop((bx0, by0, bx1, by1))
    arr = np.asarray(crop).astype(np.float32)
    lum = arr.max(axis=2)
    ys, xs = np.nonzero(lum > 70)
    rng = np.random.default_rng(seed)
    take = rng.choice(len(xs), size=min(n, len(xs)), replace=False)
    xs, ys = xs[take], ys[take]
    tx = 40 + xs / (bx1 - bx0) * 1000
    ty = 520 + ys / (by1 - by0) * 900
    rgb = np.clip(arr[ys, xs] * 1.7 + 40, 0, 255)
    # start scattered outward from the frame centre, so the cloud collapses in
    ang = rng.uniform(0, np.pi * 2, len(xs))
    rad = rng.uniform(260, 760, len(xs))
    sx = tx + np.cos(ang) * rad
    sy = ty + np.sin(ang) * rad * 0.7
    delay = rng.uniform(0.0, 0.45, len(xs))
    size = rng.uniform(1.4, 3.0, len(xs))
    return dict(tx=tx, ty=ty, sx=sx, sy=sy, rgb=rgb, delay=delay, size=size)


CLOUD = None


def draw_particles(canvas, t, duration=3.2, opacity=1.0):
    global CLOUD
    if CLOUD is None:
        CLOUD = particle_cloud(SHOT["brain-giant"])
    c = CLOUD
    u = np.clip((t - c["delay"]) / 1.15, 0, 1)
    e = 1 - (1 - u) ** 3
    x = c["sx"] + (c["tx"] - c["sx"]) * e
    y = c["sy"] + (c["ty"] - c["sy"]) * e
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(len(x)):
        if u[i] <= 0:
            continue
        r = c["size"][i] * (0.5 + 0.5 * e[i])
        col = tuple(int(v) for v in c["rgb"][i])
        a = int(255 * (0.25 + 0.75 * e[i]) * opacity)
        d.ellipse((x[i] - r, y[i] - r, x[i] + r, y[i] + r), fill=col + (a,))
    bloom = layer.filter(ImageFilter.GaussianBlur(9))
    halo = layer.filter(ImageFilter.GaussianBlur(26))
    canvas.alpha_composite(halo)
    canvas.alpha_composite(bloom)
    canvas.alpha_composite(layer)


# ------------------------------------------------------------------ end card


def end_card(canvas, u):
    """u: 0..1 entrance."""
    e = ease_out(u)
    rise = int((1 - e) * 30)
    glow = radial_glow(GOLD, 560, 30)
    canvas.alpha_composite(glow, (W // 2 - 560, 820 - 560))

    icon = Image.open(SHOT["icon"]).convert("RGBA").resize((188, 188), Image.LANCZOS)
    canvas.alpha_composite(icon, (W // 2 - 94, 640 + rise))

    paste_text(canvas, "Cortex", W // 2, 872 + rise, font(112, 800), INK, 255)
    paste_text(canvas, "Your notes, as a brain.", W // 2, 1012 + rise, font(42, 500), MUTED, 255)

    paste_text(
        canvas, "FREE  ·  OPEN SOURCE  ·  MIT", W // 2, 1126 + rise,
        font(26, 700), GOLD, 255, tracking=6,
    )

    # the one call to action that works without a bio link
    box = (110, 1218, W - 110, 1362)
    s = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(s).rounded_rectangle(box, radius=22, fill=(255, 255, 255, 8), outline=(255, 255, 255, 40), width=1)
    canvas.alpha_composite(s)
    paste_text(canvas, "github.com/thijnperd/obsidian-cortex", W // 2, 1266 + rise, font(31, 600, mono=True), INK, 255)
    paste_text(canvas, "download, or run it from source", W // 2, 1312 + rise, font(27, 500), MUTED, 255)

    paste_text(
        canvas, "reads any folder of Markdown — Obsidian vaults open as-is",
        W // 2, 1432 + rise, font(28, 500), MUTED, 255,
    )


# --------------------------------------------------------------------- film


@dataclass
class Shot:
    start: float
    end: float
    kind: str
    path: str = ""
    keys: list = field(default_factory=list)
    rect: tuple = (30, 640, 1020, 638)
    fade: float = 0.45


def render_shot(shot, t):
    canvas = Image.new("RGBA", (W, H), BG + (255,))
    if shot.kind in ("card", "full"):
        canvas.alpha_composite(background(shot.path if shot.path else SHOT["brain-giant"]))
        glow = radial_glow((150, 175, 220), 700, 22)
        canvas.alpha_composite(glow, (W // 2 - 700, 940 - 700))
    if shot.kind == "card":
        cam = cam_at(shot.keys, t)
        draw_card(canvas, shot.path, shot.rect, cam)
    elif shot.kind == "full":
        cam = cam_at(shot.keys, t)
        draw_fullbleed(canvas, shot.path, cam)
    elif shot.kind == "particles":
        canvas = Image.new("RGBA", (W, H), BG + (255,))
        draw_particles(canvas, t)
    elif shot.kind == "end":
        local = t - shot.start
        end_card(canvas, clamp(local / 0.9))
    return canvas


class Film:
    def __init__(self, name, duration, shots, texts):
        self.name = name
        self.duration = duration
        self.shots = shots
        self.texts = texts

    def frame(self, t):
        active = [s for s in self.shots if s.start <= t < s.end]
        if not active:
            active = [self.shots[-1]]
        s = active[0]
        canvas = render_shot(s, t)
        idx = self.shots.index(s)
        if idx > 0 and t < s.start + s.fade:
            prev = render_shot(self.shots[idx - 1], t)
            u = smooth((t - s.start) / s.fade)
            canvas = Image.blend(prev, canvas, u)
        draw_texts(canvas, self.texts, t)
        canvas.alpha_composite(VIGNETTE)

        arr = np.asarray(canvas.convert("RGB")).astype(np.int16)
        arr += np.roll(NOISE, (int(t * FPS * 37) % H, int(t * FPS * 53) % W), (0, 1))
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


def encode(film, cover_at=0.55):
    os.makedirs(OUT, exist_ok=True)
    mp4 = os.path.join(OUT, film.name + ".mp4")
    n = int(round(film.duration * FPS))
    cmd = [
        FFMPEG, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
        "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4,
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
    cover = None
    for i in range(n):
        img = film.frame(i / FPS)
        proc.stdin.write(img.tobytes())
        if i == int(cover_at * n):
            cover = img.copy()
        if i % 60 == 0:
            print(f"  {film.name}: {i}/{n}", flush=True)
    proc.stdin.close()
    err = proc.stderr.read().decode()
    rc = proc.wait()
    if rc != 0:
        raise SystemExit(f"ffmpeg failed for {film.name}:\n{err}")
    if cover is not None:
        cover.save(os.path.join(OUT, film.name + "-cover.jpg"), quality=93)
    print(f"  wrote {mp4}", flush=True)


# -------------------------------------------------------------------- films


def film_one():
    shots = [
        Shot(0.0, 3.35, "particles", fade=0.0),
        Shot(3.35, 8.9, "card", SHOT["brain-giant"],
             keys=[(3.35, 0.53, 0.53, 0.74), (8.9, 0.53, 0.52, 0.63)]),
        Shot(8.9, 13.7, "card", SHOT["brain-medium"],
             keys=[(8.9, 0.54, 0.52, 0.70), (13.7, 0.57, 0.44, 0.40)]),
        Shot(13.7, 16.5, "card", SHOT["trail"], rect=(250, 700, 580, 880),
             keys=[(13.7, 0.865, 0.5, 0.33), (16.5, 0.875, 0.45, 0.30)]),
        Shot(16.5, 19.0, "end", fade=0.5),
    ]
    texts = [
        Txt("C O R T E X", 196, 30, 700, GOLD, 0.3, 3.1),
        Txt("Your notes", 262, 92, 800, INK, 0.45, 3.1),
        Txt("have a shape.", 366, 92, 800, INK, 0.72, 3.1),

        Txt("5 , 5 2 3   N O T E S   ·   2 4 , 1 5 1   L I N K S", 196, 26, 700, GOLD, 3.75, 8.7, tracking=1),
        Txt("One vault.", 250, 92, 800, INK, 3.85, 8.7),
        Txt("One surface.", 354, 92, 800, INK, 4.15, 8.7),
        Txt("Every folder is a region. Every link is a fibre tract.", 500, 36, 500, MUTED, 4.45, 8.7),

        Txt("E V E R Y   D O T   I S   A   N O T E", 196, 26, 700, GOLD, 9.3, 13.5),
        Txt("Every dot", 250, 92, 800, INK, 9.4, 13.5),
        Txt("is a note.", 354, 92, 800, INK, 9.7, 13.5),
        Txt("Every line is a link you made.", 500, 36, 500, MUTED, 10.0, 13.5),

        Txt("D E C I S I O N S", 196, 26, 700, GOLD, 14.1, 16.3),
        Txt("And it keeps", 250, 92, 800, INK, 14.2, 16.3),
        Txt("the why.", 354, 92, 800, INK, 14.5, 16.3),
        Txt("Confidence, a review date, and what it replaced.", 500, 36, 500, MUTED, 14.8, 16.3),
    ]
    return Film("01-your-notes-have-a-shape", 19.0, shots, texts)


def film_two():
    shots = [
        Shot(0.0, 4.7, "full", SHOT["brain-giant"],
             keys=[(0.0, 0.51, 0.52, 1.0), (4.7, 0.51, 0.5, 0.9)], fade=0.0),
        Shot(4.7, 9.4, "card", SHOT["atlas-giant"],
             keys=[(4.7, 0.56, 0.5, 0.78), (9.4, 0.55, 0.5, 0.70)]),
        Shot(9.4, 12.4, "full", SHOT["brain-medium"],
             keys=[(9.4, 0.53, 0.5, 1.0), (12.4, 0.55, 0.48, 0.86)]),
        Shot(12.4, 14.6, "end", fade=0.5),
    ]
    texts = [
        Txt("5 , 5 2 3   N O T E S", 210, 26, 700, GOLD, 0.35, 4.4, tracking=1),
        Txt("This is one vault.", 268, 86, 800, INK, 0.5, 4.4),
        Txt("24,151 links. 41 folders. Zero unresolved.", 388, 34, 500, MUTED, 0.9, 4.4),

        Txt("S A M E   V A U L T", 210, 26, 700, GOLD, 5.0, 9.1, tracking=1),
        Txt("A different lens.", 268, 86, 800, INK, 5.15, 9.1),
        Txt("Atlas: folders as countries, links as roads.", 388, 34, 500, MUTED, 5.55, 9.1),

        Txt("S I X   V I E W S", 210, 26, 700, GOLD, 9.7, 12.2, tracking=1),
        Txt("One binary.", 268, 86, 800, INK, 9.85, 12.2),
        Txt("Brain, Graph, Timeline, Atlas, Bento, Decisions.", 388, 34, 500, MUTED, 10.2, 12.2),
    ]
    return Film("02-five-thousand-notes", 14.6, shots, texts)


def film_three():
    shots = [
        Shot(0.0, 3.5, "full", SHOT["brain-giant"],
             keys=[(0.0, 0.51, 0.52, 0.9), (3.5, 0.51, 0.5, 0.84)], fade=0.0),
        Shot(3.5, 8.8, "card", SHOT["decisions"],
             keys=[(3.5, 0.75, 0.35, 0.58), (8.8, 0.75, 0.35, 0.53)]),
        Shot(8.8, 13.7, "card", SHOT["trail"], rect=(250, 720, 580, 880),
             keys=[(8.8, 0.87, 0.52, 0.31), (13.7, 0.88, 0.45, 0.30)]),
        Shot(13.7, 17.0, "end", fade=0.5),
    ]
    texts = [
        Txt("A   Q U E S T I O N", 250, 26, 700, GOLD, 0.4, 3.2, tracking=1),
        Txt("Why did you pick", 306, 82, 800, INK, 0.55, 3.2),
        Txt("this two years ago?", 402, 82, 800, INK, 0.9, 3.2),
        Txt("You don't remember. Your notes do.", 520, 34, 500, MUTED, 1.4, 3.2),

        Txt("D E C I S I O N S", 196, 26, 700, GOLD, 3.95, 8.5, tracking=1),
        Txt("Not a checkbox.", 250, 92, 800, INK, 4.05, 8.5),
        Txt("Confidence. Review date. Supersession.", 372, 36, 500, MUTED, 4.5, 8.5),

        Txt("T H E   T R A I L", 196, 26, 700, GOLD, 9.2, 13.5, tracking=1),
        Txt("Why, with", 250, 92, 800, INK, 9.3, 13.5),
        Txt("receipts.", 354, 92, 800, INK, 9.6, 13.5),
        Txt("Every claim is a wikilink back to its source.", 500, 36, 500, MUTED, 10.0, 13.5),
    ]
    return Film("03-why-did-you-decide-that", 17.0, shots, texts)


FILMS = {"1": film_one, "2": film_two, "3": film_three}


def main(argv):
    wanted = [a for a in argv[1:] if a in FILMS] or list(FILMS)
    for k in wanted:
        film = FILMS[k]()
        print(f"rendering {film.name} ({film.duration:.1f}s)", flush=True)
        encode(film)


if __name__ == "__main__":
    main(sys.argv)
