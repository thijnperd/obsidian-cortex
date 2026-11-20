#!/usr/bin/env python3
"""Draw the Cortex studio mark once and export every platform asset.

The mark combines Cortex's two core metaphors with Swiss geometric precision:
- Two smooth, closed cerebral hemispheres (filled in deep slate and outlined in
  warm ivory) separated by a clean central fissure.
- A five-node constellation graph in warm sand (#ffd9a0) bridging the two
  hemispheres.

Run after changing the geometry:

    python tools/make-icons.py

Outputs live in assets/icons/, installer/, and web/. Requires Pillow.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "assets" / "icons"
WEB = ROOT / "web"

SIZE = 1024
SS = 4  # 4x supersampling

PLATE_BG = (11, 13, 18, 255)        # #0b0d12 deep obsidian
PLATE_INNER = (16, 19, 26, 255)     # #10131a studio surface
PLATE_RIM = (48, 54, 68, 255)       # #303644 crisp hairline rim
LOBE_FILL = (27, 32, 44, 255)       # #1b202c subtle hemisphere volume
LOBE_STROKE = (236, 230, 218, 255)  # #ece6da warm ivory contour
SAND = (255, 217, 160, 255)         # #ffd9a0 signature cortex accent
CREAM = (248, 243, 233, 255)        # #f8f3e9 bright star core
INK = (12, 14, 20, 255)             # #0c0e14 dark ink for light tray

# 5 constellation nodes: (x, y, radius, is_primary_hub)
# Asymmetric, organic constellation spanning both hemispheres.
NODES = [
    (328, 344, 30, False),  # L-frontal
    (272, 526, 44, True),   # L-temporal hub (warm-sand primary)
    (342, 686, 28, False),  # L-occipital
    (688, 376, 38, True),   # R-frontal hub
    (718, 622, 32, False),  # R-parietal
]

EDGES = [
    (0, 1),
    (1, 2),
    (3, 4),
    (0, 3),  # upper callosal bridge
    (1, 3),  # diagonal cross-hemisphere tract
    (2, 4),  # lower callosal bridge
]


def hemisphere_loop(side: int, steps: int = 160) -> list[tuple[float, float]]:
    """Closed, smooth cerebral hemisphere silhouette (side = -1 left, +1 right).

    Uses a smooth D-shaped closed curve in polar coordinates around each lobe's
    centroid: flat-ish medial wall along the central fissure, rounded frontal
    and occipital poles, and three gentle gyri undulations along the lateral wall.
    """
    pts = []
    for i in range(steps):
        t = i / steps
        a = t * 2.0 * math.pi  # 0 = lateral (outer), pi = medial (fissure)
        cos_a = math.cos(a)
        sin_a = math.sin(a)

        lateral = max(0.0, cos_a)
        medial = max(0.0, -cos_a)

        # Three distinct gyri lobes along the outer wall (frontal, parietal, occipital)
        gyri = 1.0 + 0.068 * (lateral ** 1.35) * math.cos(3.0 * a)

        # Slightly wider in the lower parietal/occipital half than the frontal pole
        taper = 1.0 + 0.045 * sin_a

        rx_outer = 286 * gyri * taper
        rx_inner = 64
        rx = rx_outer if cos_a >= 0 else rx_inner * (1.0 - 0.42 * (medial ** 2))

        ry = 306 * (1.0 - 0.04 * (medial ** 2)) * (1.0 + 0.03 * math.cos(3.0 * a) * lateral)

        cx = 512 + side * 86
        cy = 514
        x = cx + side * rx * cos_a
        y = cy + ry * sin_a
        pts.append((x, y))
    return pts


def stroke_closed(draw: ImageDraw.ImageDraw, points, color, width: float):
    pts = list(points) + [points[0]]
    stroke_open(draw, pts, color, width)


def stroke_open(draw: ImageDraw.ImageDraw, points, color, width: float):
    r = width / 2.0
    for i in range(len(points) - 1):
        x0, y0 = points[i]
        x1, y1 = points[i + 1]
        dx = x1 - x0
        dy = y1 - y0
        length = math.hypot(dx, dy) or 1.0
        nx = -dy / length * r
        ny = dx / length * r
        poly = [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]
        draw.polygon(poly, fill=color)
    for x, y in points:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def draw_mark(
    size: int,
    stroke_col: tuple[int, int, int, int],
    accent_col: tuple[int, int, int, int],
    lobe_fill: tuple[int, int, int, int] | None = None,
    cutout_col: tuple[int, int, int, int] | None = None,
) -> Image.Image:
    """Render the brain + constellation mark at `size`."""
    work = size * SS
    scale = work / SIZE
    canvas = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    # 1. Closed cerebral hemispheres
    outline_w = max(2.0, 36 * scale)
    for side in (-1, 1):
        loop = [(x * scale, y * scale) for x, y in hemisphere_loop(side)]
        if lobe_fill is not None:
            draw.polygon(loop, fill=lobe_fill)
        stroke_closed(draw, loop, stroke_col, outline_w)

        # One subtle interior sulcus arc per hemisphere for anatomical craft
        if size >= 32:
            sulcus = []
            for i in range(28):
                t = i / 27
                ang = (-0.52 + 1.04 * t) * math.pi * 0.5
                sx = (512 + side * (118 + 148 * math.cos(ang))) * scale
                sy = (514 + 178 * math.sin(ang)) * scale
                sulcus.append((sx, sy))
            sulcus_col = (stroke_col[0], stroke_col[1], stroke_col[2], 72)
            stroke_open(draw, sulcus, sulcus_col, max(1.2, 18 * scale))

    # 2. Constellation graph edges
    edge_w = max(1.6, 22 * scale)
    for ia, ib in EDGES:
        xa, ya, _, _ = NODES[ia]
        xb, yb, _, _ = NODES[ib]
        stroke_open(draw, [(xa * scale, ya * scale), (xb * scale, yb * scale)], accent_col, edge_w)

    # 3. Constellation star nodes
    for x, y, rad, is_hub in NODES:
        cx, cy = x * scale, y * scale
        r = max(2.0, rad * scale)
        if cutout_col is not None:
            halo = r + max(1.0, 12 * scale)
            draw.ellipse((cx - halo, cy - halo, cx + halo, cy + halo), fill=cutout_col)
        col = accent_col if is_hub else stroke_col
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col)
        if is_hub and size >= 32:
            core_r = r * 0.42
            draw.ellipse((cx - core_r, cy - core_r, cx + core_r, cy + core_r), fill=CREAM)

    return canvas.resize((size, size), Image.LANCZOS)


def plated(size: int) -> Image.Image:
    """The desktop & web app icon: deep obsidian squircle plate, hairline rim, brain-constellation."""
    work = size * SS
    scale = work / SIZE
    canvas = Image.new("RGBA", (work, work), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)

    inset = round(work * 0.055)
    radius = round(work * 0.225)
    draw.rounded_rectangle(
        (inset, inset, work - inset, work - inset),
        radius=radius,
        fill=PLATE_BG,
        outline=PLATE_RIM,
        width=max(2, round(16 * scale)),
    )
    inner_inset = inset + max(2, round(18 * scale))
    inner_radius = max(2, radius - round(14 * scale))
    draw.rounded_rectangle(
        (inner_inset, inner_inset, work - inner_inset, work - inner_inset),
        radius=inner_radius,
        fill=PLATE_INNER,
    )

    plate = canvas.resize((size, size), Image.LANCZOS)
    mark = draw_mark(size, LOBE_STROKE, SAND, lobe_fill=LOBE_FILL, cutout_col=LOBE_FILL)
    plate.alpha_composite(mark, (0, 0))
    return plate


def save_png(image: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG")
    print(f"  {path.relative_to(ROOT)}")


def _svg_loop_path(side: int) -> str:
    pts = hemisphere_loop(side, steps=96)
    d = f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"
    for x, y in pts[1:]:
        d += f" L {x:.1f} {y:.1f}"
    return d + " Z"


def _svg_sulcus_path(side: int) -> str:
    pts = []
    for i in range(24):
        t = i / 23
        ang = (-0.52 + 1.04 * t) * math.pi * 0.5
        sx = 512 + side * (118 + 148 * math.cos(ang))
        sy = 514 + 178 * math.sin(ang)
        pts.append((sx, sy))
    d = f"M {pts[0][0]:.1f} {pts[0][1]:.1f}"
    for x, y in pts[1:]:
        d += f" L {x:.1f} {y:.1f}"
    return d


def svg_plate() -> str:
    left_d = _svg_loop_path(-1)
    right_d = _svg_loop_path(1)
    left_s = _svg_sulcus_path(-1)
    right_s = _svg_sulcus_path(1)
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Cortex">',
        '  <rect x="56" y="56" width="912" height="912" rx="230" fill="#0b0d12" stroke="#303644" stroke-width="16" />',
        '  <rect x="74" y="74" width="876" height="876" rx="216" fill="#10131a" />',
        f'  <path d="{left_d}" fill="#1b202c" stroke="#ece6da" stroke-width="36" stroke-linejoin="round" />',
        f'  <path d="{right_d}" fill="#1b202c" stroke="#ece6da" stroke-width="36" stroke-linejoin="round" />',
        f'  <path d="{left_s}" fill="none" stroke="#ece6da" stroke-opacity="0.28" stroke-width="18" stroke-linecap="round" />',
        f'  <path d="{right_s}" fill="none" stroke="#ece6da" stroke-opacity="0.28" stroke-width="18" stroke-linecap="round" />',
    ]
    for ia, ib in EDGES:
        xa, ya, _, _ = NODES[ia]
        xb, yb, _, _ = NODES[ib]
        parts.append(
            f'  <line x1="{xa}" y1="{ya}" x2="{xb}" y2="{yb}" stroke="#ffd9a0" stroke-width="22" stroke-linecap="round" />'
        )
    for x, y, rad, is_hub in NODES:
        parts.append(f'  <circle cx="{x}" cy="{y}" r="{rad + 12}" fill="#1b202c" />')
        col = "#ffd9a0" if is_hub else "#ece6da"
        parts.append(f'  <circle cx="{x}" cy="{y}" r="{rad}" fill="{col}" />')
        if is_hub:
            parts.append(f'  <circle cx="{x}" cy="{y}" r="{rad * 0.42:.1f}" fill="#f8f3e9" />')
    parts.append("</svg>\n")
    return "\n".join(parts)


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    print("mark + plate")
    master = plated(SIZE)
    save_png(master, ICONS / "cortex-1024.png")
    for size in (512, 256, 128, 96, 64, 48, 40, 32, 24, 20, 16):
        image = plated(size)
        save_png(image, ICONS / f"cortex-{size}.png")

    print("windows .ico")
    ico_sizes = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40),
                 (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(ICONS / "cortex.ico", "ICO", sizes=ico_sizes)
    print("  assets/icons/cortex.ico")
    master.save(ROOT / "installer" / "cortex.ico", "ICO", sizes=ico_sizes)
    print("  installer/cortex.ico")
    master.save(WEB / "favicon.ico", "ICO", sizes=[(16, 16), (32, 32), (48, 48)])
    print("  web/favicon.ico")

    print("macos .icns")
    master.save(
        ICONS / "cortex.icns",
        "ICNS",
        sizes=[(16, 16), (32, 32), (64, 64), (128, 128), (256, 256), (512, 512), (1024, 1024)],
    )
    print("  assets/icons/cortex.icns")

    print("tray + window")
    light64 = draw_mark(64, LOBE_STROKE, SAND)
    save_png(light64, ICONS / "tray-light-64.png")
    light32 = draw_mark(32, LOBE_STROKE, SAND)
    save_png(light32, ICONS / "tray-light-32.png")
    (ICONS / "tray-light-32.rgba").write_bytes(light32.tobytes())

    dark64 = draw_mark(64, INK, (154, 75, 22, 255))
    save_png(dark64, ICONS / "tray-dark-64.png")
    dark32 = draw_mark(32, INK, (154, 75, 22, 255))
    save_png(dark32, ICONS / "tray-dark-32.png")
    (ICONS / "tray-dark-32.rgba").write_bytes(dark32.tobytes())

    window64 = plated(64)
    save_png(plated(256), ICONS / "cortex-window.png")
    (ICONS / "cortex-window-64.rgba").write_bytes(window64.tobytes())

    print("web")
    svg = svg_plate()
    (WEB / "logo.svg").write_text(svg, encoding="utf-8")
    print("  web/logo.svg")
    (WEB / "favicon.svg").write_text(svg, encoding="utf-8")
    print("  web/favicon.svg")
    save_png(plated(180), WEB / "apple-touch-icon.png")


if __name__ == "__main__":
    main()
