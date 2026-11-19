#!/usr/bin/env python3
"""Draw the Cortex mark once and export every platform asset.

The mark is the supplied brain: one solid, gently lobed silhouette split by a
vertical seam, with the thinking trail cut through it as a clean double band.
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
SS = 3  # supersampling factor

CREAM = (247, 242, 232, 255)
INK = (10, 11, 12, 255)

# A brain is a walnut, not a flower or a hexagon. Four large lobes per
# hemisphere, a wider parietal middle, a narrower frontal top and a smooth
# occipital base. Clockwise from the top of the longitudinal fissure.
CONTROLS = [
    (512, 158), (566, 146), (610, 150), (650, 172),
    (680, 182), (706, 196), (730, 220), (744, 236),
    (772, 252), (798, 276), (812, 304), (820, 330),
    (834, 360), (842, 392), (845, 424), (846, 452),
    (848, 488), (850, 520), (844, 556), (840, 588),
    (828, 620), (818, 648), (800, 678), (790, 700),
    (770, 726), (742, 754), (716, 774), (690, 794),
    (652, 812), (620, 824), (570, 838), (550, 842),
    (512, 838),
    (474, 842), (454, 838), (404, 824),
    (372, 812), (334, 794), (308, 774), (282, 754),
    (254, 726), (230, 700), (220, 678), (202, 648),
    (192, 620), (180, 588), (176, 556), (170, 520),
    (172, 488), (174, 452), (175, 424), (182, 392),
    (190, 360), (200, 330), (208, 304), (222, 276),
    (250, 252), (278, 236), (294, 220), (318, 196),
    (344, 182), (374, 172), (414, 150), (458, 146),
]


def catmull_rom(points, steps: int = 8):
    """Sample a closed Catmull-Rom spline through every control point."""
    count = len(points)
    sampled = []
    for index in range(count):
        p0 = points[(index - 1) % count]
        p1 = points[index]
        p2 = points[(index + 1) % count]
        p3 = points[(index + 2) % count]
        for step in range(steps):
            t = step / steps
            t2 = t * t
            t3 = t2 * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t
                       + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2
                       + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t
                       + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2
                       + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            sampled.append((x, y))
    return sampled


def brain_points():
    return catmull_rom(CONTROLS)


def spiral_points(steps: int = 420):
    """The trail: one open sweep from the centre to the frontal edge."""
    cx, cy = 512, 512
    turns = 1.2
    phase = math.radians(325 - turns * 360)
    points = []
    for index in range(steps + 1):
        t = index / steps
        angle = phase + t * turns * 2 * math.pi
        radius = 82 + (280 - 82) * t
        points.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle)))
    return points


def ribbon(points, width: float):
    """Offset a centreline into a closed band polygon.

    Pillow's thick `line` joints leave radial hairline spikes at this scale,
    so the band is filled as geometry instead of stroked.
    """
    left = []
    right = []
    for index, (x, y) in enumerate(points):
        before = points[max(0, index - 1)]
        after = points[min(len(points) - 1, index + 1)]
        tx = after[0] - before[0]
        ty = after[1] - before[1]
        length = math.hypot(tx, ty) or 1.0
        nx = -ty / length
        ny = tx / length
        left.append((x + nx * width / 2, y + ny * width / 2))
        right.append((x - nx * width / 2, y - ny * width / 2))
    return left + right[::-1]


def draw_ribbon(draw: ImageDraw.ImageDraw, points, fill, width: int):
    draw.polygon(ribbon(points, width), fill=fill)
    radius = width / 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def draw_mark(size: int, ink: tuple[int, int, int, int]):
    """Transparent canvas with the brain in `ink` and the trail cut out."""
    work = size * SS
    scale = work / SIZE
    canvas = Image.new("RGBA", (work, work), (0, 0, 0, 0))

    mask = Image.new("L", (work, work), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon([(x * scale, y * scale) for x, y in brain_points()], fill=255)

    trail = [(x * scale, y * scale) for x, y in spiral_points()]
    # Outer white band, then the black centre that turns it into two ribbons.
    draw_ribbon(mask_draw, trail, 0, max(2, round(104 * scale)))
    mask_draw.polygon(ribbon(trail, max(1, round(34 * scale))), fill=255)

    # The seam: the mark is two hemispheres, not one blob.
    seam = max(2, round(22 * scale))
    mask_draw.line(
        [(512 * scale, 116 * scale), (512 * scale, 914 * scale)],
        fill=0,
        width=seam,
    )
    canvas.paste(Image.new("RGBA", (work, work), ink), (0, 0), mask)
    return canvas.resize((size, size), Image.LANCZOS)


def plated(size: int) -> Image.Image:
    """The app icon: warm plate, ink mark, generous optical margin."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    inset = round(size * 0.054)
    radius = round(size * 0.232)
    draw.rounded_rectangle(
        (inset, inset, size - inset, size - inset), radius=radius, fill=CREAM
    )
    inner = round(size * 0.90)
    mark = draw_mark(inner, INK)
    canvas.alpha_composite(mark, ((size - inner) // 2, (size - inner) // 2))
    return canvas


def save_png(image: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG")
    print(f"  {path.relative_to(ROOT)}")


def svg_path() -> str:
    points = CONTROLS

    def fmt(point):
        return f"{point[0]:.1f} {point[1]:.1f}"

    # Catmull-Rom to cubic Bezier, closed. The control points are the shape;
    # the PNG path samples the same spline, so the two cannot drift apart.
    path = f"M {fmt(points[0])}"
    count = len(points)
    for index in range(count):
        p0 = points[(index - 1) % count]
        p1 = points[index]
        p2 = points[(index + 1) % count]
        p3 = points[(index + 2) % count]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        path += f" C {fmt(c1)} {fmt(c2)} {fmt(p2)}"
    return f"{path} Z"


def svg_spiral() -> str:
    points = spiral_points()
    return "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in points)


def svg_mask() -> str:
    return f'''  <defs>
    <mask id="cortex-trail">
      <rect width="1024" height="1024" fill="#fff" />
      <path d="{svg_path()}" fill="#fff" />
      <path d="{svg_spiral()}" fill="none" stroke="#000" stroke-width="104" stroke-linecap="round" />
      <path d="{svg_spiral()}" fill="none" stroke="#fff" stroke-width="34" />
      <line x1="512" y1="116" x2="512" y2="914" stroke="#000" stroke-width="22" />
    </mask>
  </defs>'''


def svg_mark() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Cortex">
{svg_mask()}
  <path d="{svg_path()}" fill="#f2ead9" mask="url(#cortex-trail)" />
</svg>
'''


def svg_plate() -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Cortex">
  <rect x="55" y="55" width="914" height="914" rx="238" fill="#f7f2e8" />
  <svg x="51" y="51" width="922" height="922" viewBox="0 0 1024 1024">
{svg_mask()}
    <path d="{svg_path()}" fill="#0a0b0c" mask="url(#cortex-trail)" />
  </svg>
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
