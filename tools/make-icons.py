#!/usr/bin/env python3
"""Draw the Cortex mark once and export every platform asset.

The mark is a lobed brain silhouette with the thinking trail cut out of it.
Nothing here downloads anything; run it after changing the geometry:

    python3 tools/make-icons.py

Outputs live in assets/icons/ and web/. Requires Pillow.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "assets" / "icons"
WEB = ROOT / "web"

SIZE = 1024
SS = 2  # supersampling factor

# The silhouette: overlapping lobes, so the outline reads as a brain rather
# than a circle. Coordinates are in the 1024 master.
LOBES = [
    (512, 512, 330),
    (300, 210, 156), (512, 150, 170), (724, 214, 154),
    (168, 356, 146), (856, 356, 146),
    (132, 540, 132), (892, 540, 132),
    (176, 714, 140), (848, 714, 140),
    (322, 842, 146), (702, 842, 146),
    (512, 878, 150),
]

CREAM = (242, 234, 217, 255)
INK = (12, 13, 14, 255)


def spiral_points(turns: float, radius: float, offset: float, phase: float = 0.0):
    """One broad thinking trail: an open sweep, not a tight fingerprint."""
    steps = 320
    points = []
    for index in range(steps + 1):
        t = index / steps
        angle = phase + t * turns * 2 * math.pi
        r = radius * (0.16 + 0.84 * t) + offset
        points.append((512 + r * math.cos(angle), 512 + r * math.sin(angle)))
    return points


def draw_mark(size: int, ink: tuple[int, int, int, int]):
    """Transparent canvas with the brain in `ink` and the trail as a cutout."""
    work = size * 3  # supersample: ImageDraw has no antialiasing of its own
    scale = work / SIZE
    canvas = Image.new("RGBA", (work, work), (0, 0, 0, 0))

    mask = Image.new("L", (work, work), 0)
    mask_draw = ImageDraw.Draw(mask)
    for cx, cy, radius in LOBES:
        x, y, r = cx * scale, cy * scale, radius * scale
        mask_draw.ellipse((x - r, y - r, x + r, y + r), fill=255)

    # The trail is negative space: draw it into the coverage mask.
    width = max(2, round(62 * scale))
    for offset in (-76, 76):
        trail = [
            (x * scale, y * scale)
            for x, y in spiral_points(1.3, 398, offset, phase=math.radians(204))
        ]
        mask_draw.line(trail, fill=0, width=width, joint="curve")
        for point in (trail[0], trail[-1]):
            r = width / 2
            mask_draw.ellipse((point[0] - r, point[1] - r, point[0] + r, point[1] + r), fill=0)

    # The seam: the mark is two hemispheres, not one blob.
    seam = max(2, round(20 * scale))
    mask_draw.line(
        [(512 * scale, 58 * scale), (512 * scale, 512 * scale)],
        fill=0,
        width=seam,
    )
    mask_draw.line(
        [(512 * scale, 512 * scale), (512 * scale, 966 * scale)],
        fill=0,
        width=seam,
    )
    canvas.paste(Image.new("RGBA", (work, work), ink), (0, 0), mask)
    return canvas.resize((size, size), Image.LANCZOS)


def plated(size: int) -> Image.Image:
    """The app icon: warm plate, ink mark, generous optical margin."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    inset = round(size * 0.06)
    radius = round(size * 0.235)
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset), radius=radius, fill=CREAM
    )
    inner = round(size * 0.86)
    mark = draw_mark(inner, INK)
    canvas.alpha_composite(mark, ((size - inner) // 2, (size - inner) // 2))
    return canvas


def save_png(image: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG")
    print(f"  {path.relative_to(ROOT)}")


def svg_defs() -> str:
    paths = []
    for offset in (-76, 76):
        trail = spiral_points(1.3, 398, offset, phase=math.radians(204))
        d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in trail)
        paths.append(
            f'      <path d="{d}" stroke="#000" stroke-width="62" '
            'stroke-linecap="round" fill="none" />'
        )
    return f'''  <defs>
    <mask id="cortex-trail">
      <rect width="1024" height="1024" fill="#fff" />
{chr(10).join(paths)}
      <line x1="512" y1="58" x2="512" y2="966" stroke="#000" stroke-width="20" />
    </mask>
  </defs>'''


def svg_lobes() -> str:
    return "\n".join(
        f'    <circle cx="{cx}" cy="{cy}" r="{radius}" />' for cx, cy, radius in LOBES
    )


def svg_mark() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Cortex">
{svg_defs()}
  <g fill="currentColor" mask="url(#cortex-trail)">
{svg_lobes()}
  </g>
</svg>
'''


def svg_plate() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Cortex">
  <rect x="61" y="61" width="902" height="902" rx="241" fill="#f2ead9" />
{svg_defs()}
  <g transform="translate(72 72) scale(0.86)" fill="#0c0d0e" mask="url(#cortex-trail)">
{svg_lobes()}
  </g>
</svg>
'''


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    print("mark + plate")
    master = plated(SIZE)
    save_png(master, ICONS / "cortex-1024.png")
    for size in (512, 256, 128, 96, 64, 48, 40, 32, 24, 20, 16):
        image = master if size == SIZE else master.resize((size, size), Image.LANCZOS)
        save_png(image, ICONS / f"cortex-{size}.png")

    print("windows .ico")
    ico_sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40),
                 (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(ICONS / "cortex.ico", "ICO", sizes=ico_sizes)
    print("  assets/icons/cortex.ico")
    master.save(ROOT / "installer" / "cortex.ico", "ICO", sizes=ico_sizes)
    print("  installer/cortex.ico")

    print("macos .icns")
    master.save(
        ICONS / "cortex.icns",
        "ICNS",
        sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)],
    )
    print("  assets/icons/cortex.icns")

    print("tray + window")
    light = draw_mark(64, (255, 255, 255, 255))
    save_png(light, ICONS / "tray-light-64.png")
    light32 = light.resize((32, 32), Image.LANCZOS)
    save_png(light32, ICONS / "tray-light-32.png")
    (ICONS / "tray-light-32.rgba").write_bytes(light32.tobytes())
    dark = draw_mark(64, INK)
    save_png(dark, ICONS / "tray-dark-64.png")
    dark32 = dark.resize((32, 32), Image.LANCZOS)
    save_png(dark32, ICONS / "tray-dark-32.png")
    (ICONS / "tray-dark-32.rgba").write_bytes(dark32.tobytes())
    window = draw_mark(64, (255, 255, 255, 255))
    save_png(draw_mark(256, (255, 255, 255, 255)), ICONS / "cortex-window.png")
    (ICONS / "cortex-window-64.rgba").write_bytes(window.tobytes())

    print("web")
    (WEB / "logo.svg").write_text(svg_mark(), encoding="utf-8")
    print("  web/logo.svg")
    (WEB / "favicon.svg").write_text(svg_plate(), encoding="utf-8")
    print("  web/favicon.svg")
    save_png(master.resize((180, 180), Image.LANCZOS), WEB / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
