// Atlas: the same vault drawn as a campaign map.
//
// Folders become countries, connected notes become places inside them. The
// geography is deterministic: capitals are placed by a fixed golden-angle
// spiral and relaxed, territories are Voronoi cells clipped against every
// other capital, and the coastlines are offset by a position-keyed hash so the
// same vault always produces the same map.
//
// Everything is drawn on a 2D canvas in world units (0..WORLD) and then
// transformed, so panning and zooming never re-layout anything.

import { isOverview } from './scale.js';

const WORLD = 1000;
const EDGE = 108;
const GOLDEN = 2.399963229728653;
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const INK = [52, 40, 24];
const RUBRIC = [140, 47, 31];
const RIVER = [72, 96, 112];

// Terrain grid. 132 cells across the world is enough for rivers to meander
// and cheap enough to rebuild on every index (about 17k cells).
const GRID = 132;
const CELL = WORLD / GRID;

// Muted pigments, all close enough to paper to stay readable as fills.
const PIGMENTS = [
  [146, 108, 58],
  [110, 122, 78],
  [132, 96, 96],
  [84, 108, 122],
  [156, 124, 72],
  [96, 112, 92],
  [138, 84, 66],
  [92, 96, 128],
];

const rgba = (rgb, alpha) => `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Position-keyed hash: same coordinates always give the same jitter. */
function noise2(x, y, seed = 7) {
  let h = Math.imul(Math.round(x) | 0, 374761393)
    + Math.imul(Math.round(y) | 0, 668265263)
    + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Smooth value noise on a lattice, seeded and deterministic. */
function smoothNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = noise2(xi, yi, seed);
  const b = noise2(xi + 1, yi, seed);
  const c = noise2(xi, yi + 1, seed);
  const d = noise2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * smoothNoise(x * frequency, y * frequency, seed + octave * 13);
    frequency *= 2.03;
    amplitude *= 0.5;
  }
  return sum;
}

/** Ridges for mountain chains: fold the noise at its midpoint. */
function ridged(x, y, seed, octaves) {
  return 1 - Math.abs(2 * fbm(x, y, seed, octaves) - 1);
}

/** A last perpendicular nudge, so no river is a ruler-straight D8 run. */
function meanderLine(points) {
  const out = [];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (index === 0 || index === points.length - 1) {
      out.push(point);
      continue;
    }
    const before = points[index - 1];
    const after = points[index + 1];
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    const bend = (noise2(point[0], point[1], 97) - 0.5) * 2.6;
    out.push([
      point[0] - (dy / length) * bend,
      point[1] + (dx / length) * bend,
      point[2],
    ]);
  }
  return out;
}

/** Chaikin corner cutting: turns a D8 staircase into a meander. */
function chaikin(points, iterations) {
  let current = points;
  for (let step = 0; step < iterations; step += 1) {
    if (current.length < 3) break;
    const out = [current[0]];
    for (let index = 0; index < current.length - 1; index += 1) {
      const a = current[index];
      const b = current[index + 1];
      out.push([
        a[0] * 0.75 + b[0] * 0.25,
        a[1] * 0.75 + b[1] * 0.25,
        a[2] * 0.75 + b[2] * 0.25,
      ]);
      out.push([
        a[0] * 0.25 + b[0] * 0.75,
        a[1] * 0.25 + b[1] * 0.75,
        a[2] * 0.25 + b[2] * 0.75,
      ]);
    }
    out.push(current[current.length - 1]);
    current = out;
  }
  return current;
}

/** Minimal binary heap for the priority flood. */
class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(priority, value) {
    const items = this.items;
    items.push({ priority, value });
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].priority <= items[index].priority) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }

  pop() {
    const items = this.items;
    if (!items.length) return -1;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        if (left < items.length && items[left].priority < items[smallest].priority) smallest = left;
        if (right < items.length && items[right].priority < items[smallest].priority) smallest = right;
        if (smallest === index) break;
        [items[index], items[smallest]] = [items[smallest], items[index]];
        index = smallest;
      }
    }
    return top.value;
  }
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonArea(poly) {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return area / 2;
}

function centroid(poly) {
  let x = 0;
  let y = 0;
  for (const point of poly) {
    x += point[0];
    y += point[1];
  }
  return [x / poly.length, y / poly.length];
}

/** Sutherland–Hodgman clip against a half plane `keep(point) === true`. */
function clipHalfPlane(poly, keep) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const current = poly[i];
    const next = poly[(i + 1) % poly.length];
    const currentIn = keep(current);
    const nextIn = keep(next);
    if (currentIn) out.push(current);
    if (currentIn !== nextIn) {
      let lo = 0;
      let hi = 1;
      for (let step = 0; step < 18; step++) {
        const t = (lo + hi) / 2;
        const point = [
          current[0] + (next[0] - current[0]) * t,
          current[1] + (next[1] - current[1]) * t,
        ];
        if (keep(point) === currentIn) lo = t;
        else hi = t;
      }
      out.push([
        current[0] + (next[0] - current[0]) * lo,
        current[1] + (next[1] - current[1]) * lo,
      ]);
    }
  }
  return out;
}

/**
 * Power cell for one capital, clipped out of the map rectangle.
 *
 * Plain Voronoi gives every folder the same patch of land, so a forty-note
 * folder and a four-hundred-note folder are drawn as equals. A power diagram
 * moves the shared border by the difference of the two weights instead:
 * `|x-pi|^2 - wi <= |x-pj|^2 - wj`, which is still a straight line and still
 * welds shared borders to the same curve. That is what lets country area track
 * note count without giving up the campaign-map shape.
 */
function powerCell(index, points) {
  let poly = [
    [EDGE, EDGE],
    [WORLD - EDGE, EDGE],
    [WORLD - EDGE, WORLD - EDGE],
    [EDGE, WORLD - EDGE],
  ];
  const origin = points[index];
  for (let other = 0; other < points.length; other++) {
    if (other === index) continue;
    const target = points[other];
    const nx = target.x - origin.x;
    const ny = target.y - origin.y;
    if (nx === 0 && ny === 0) continue;
    const mx = (origin.x + target.x) / 2;
    const my = (origin.y + target.y) / 2;
    const shift = ((origin.weight || 0) - (target.weight || 0)) / 2;

    poly = clipHalfPlane(poly, ([x, y]) => (x - mx) * nx + (y - my) * ny <= shift);
    if (poly.length === 0) break;
  }
  return poly;
}

/**
 * Capitals: sized by note count, packed from the largest outward, then relaxed
 * until the discs stop overlapping. No randomness, so the map is stable.
 */
function layoutCapitals(folders) {
  const count = folders.length;
  const inner = WORLD - EDGE * 2;
  if (count === 1) {
    return [{ x: WORLD / 2, y: WORLD / 2, area: inner * inner, radius: inner / 2, weight: inner * inner }];
  }

  const total = folders.reduce((sum, folder) => sum + Math.max(1, folder.count), 0);
  // Cells tile the whole inner square, so that is the area budget. The radius
  // is slightly smaller than the area-equivalent disc: discs leave gaps and the
  // power diagram fills them, while packing at 100% would force overlaps.
  const land = inner * inner;
  const points = folders.map((folder, index) => {
    const area = (land * Math.max(1, folder.count)) / total;
    return {
      x: WORLD / 2,
      y: WORLD / 2,
      area,
      radius: Math.sqrt(area / Math.PI) * 0.86,
      weight: area,
      index,
    };
  });

  // Largest at the centre, then a golden-angle spiral. Sorting first means the
  // big countries get the room they need instead of whatever index they had.
  const order = [...points.keys()].sort(
    (a, b) => folders[b].count - folders[a].count || a - b,
  );
  let placed = 0;
  order.forEach((index, rank) => {
    const point = points[index];
    if (rank === 0) return;
    placed += point.area;
    const angle = rank * GOLDEN;
    const radius = Math.sqrt(placed / Math.PI) * 0.94;
    point.x = WORLD / 2 + Math.cos(angle) * radius;
    point.y = WORLD / 2 + Math.sin(angle) * radius;
  });

  // Relax unequal discs. The minimum distance is the sum of their radii, so the
  // shape of the map follows the data instead of a fixed packing grid.
  for (let step = 0; step < 220; step += 1) {
    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        const a = points[i];
        const b = points[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;
        const minimum = (a.radius + b.radius) * 0.93;
        if (distance < minimum) {
          const push = ((minimum - distance) / distance) * 0.5;
          a.x -= dx * push;
          a.y -= dy * push;
          b.x += dx * push;
          b.y += dy * push;
        }
      }
    }
    for (const point of points) {
      point.x += (WORLD / 2 - point.x) * 0.003;
      point.y += (WORLD / 2 - point.y) * 0.003;
      const inset = EDGE + clamp(point.radius * 0.62, 28, 96);
      point.x = clamp(point.x, inset, WORLD - inset);
      point.y = clamp(point.y, inset, WORLD - inset);
    }
  }
  return points;
}

/**
 * Tune the power weights until each cell's area is proportional to its folder.
 *
 * Weights start equal (which gives an ordinary Voronoi) and move by the area
 * error each pass. The best valid state is kept: a weight that is too extreme
 * can make a small country degenerate to a line, and that state is never drawn.
 * Plain Voronoi remains the last resort, but it is no longer the first answer.
 */
function balancedCells(points) {
  if (points.length < 2) return points.map((_, index) => powerCell(index, points));
  const totalTarget = points.reduce((sum, point) => sum + point.area, 0) || 1;
  const shares = points.map((point) => point.area / totalTarget);
  for (const point of points) point.weight = 0;

  let best = null;
  for (let step = 0; step < 30; step += 1) {
    const cells = points.map((_, index) => powerCell(index, points));
    if (cells.some((cell) => cell.length < 3)) break;
    const areas = cells.map((cell) => Math.abs(polygonArea(cell)));
    const total = areas.reduce((sum, area) => sum + area, 0) || 1;
    let error = 0;
    for (let index = 0; index < points.length; index += 1) {
      error += Math.abs(areas[index] / total - shares[index]);
    }
    if (!best || error < best.error) {
      best = { error, cells, weights: points.map((point) => point.weight) };
    }
    if (error < 0.02) break;
    for (let index = 0; index < points.length; index += 1) {
      const actual = areas[index] / total;
      points[index].weight += (shares[index] - actual) * total * 0.28;
    }
  }

  if (best) {
    points.forEach((point, index) => {
      point.weight = best.weights[index];
    });
    return best.cells;
  }
  for (const point of points) point.weight = 0;
  return points.map((_, index) => powerCell(index, points));
}

/**
 * Midpoint displacement for one border segment.
 *
 * The offset depends only on the *unordered* endpoints, so two countries that
 * share a border displace it to exactly the same curve — the line stays welded
 * instead of opening into a gap or overlapping into a smear.
 */
function roughSegment(a, b, depth, amplitude) {
  if (depth <= 0) return [a];
  const lex = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
  const [p, q] = lex ? [a, b] : [b, a];
  const nx = -(q[1] - p[1]);
  const ny = q[0] - p[0];
  const length = Math.hypot(nx, ny) || 1;
  const amount = (noise2(p[0] + q[0], p[1] + q[1], depth * 17 + 3) - 0.5) * 2 * amplitude;
  const mid = [(a[0] + b[0]) / 2 + (nx / length) * amount, (a[1] + b[1]) / 2 + (ny / length) * amount];
  const rest = amplitude * 0.56;
  return [
    ...roughSegment(a, mid, depth - 1, rest),
    ...roughSegment(mid, b, depth - 1, rest),
  ];
}

function roughOutline(poly, depth, amplitude) {
  const points = [];
  for (let i = 0; i < poly.length; i++) {
    points.push(...roughSegment(poly[i], poly[(i + 1) % poly.length], depth, amplitude));
  }
  return points;
}

/** An irregular closed blob, for islets and single-place settlements. */
function blob(cx, cy, radius, seed, sides = 9) {
  const points = [];
  const random = mulberry(seed);
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2;
    const r = radius * (0.62 + random() * 0.66);
    points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return points;
}

function convexHull(points) {
  if (points.length < 3) return points;
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const point = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * Settlements should stay towns, not turn into one white disc. The radius
 * shrinks as a folder grows, so the 250-note journal becomes a country of
 * villages instead of a single smeared capital.
 */
function clusterRadius(count) {
  return clamp(58 * Math.sqrt(32 / Math.max(8, count)), 16, 58);
}

/** Single-linkage grouping, so a clump of linked notes becomes one settlement. */
function clusterPoints(points, radius) {
  const groups = [];
  const taken = new Set();
  for (let i = 0; i < points.length; i++) {
    if (taken.has(i)) continue;
    taken.add(i);
    const queue = [i];
    const group = [];
    while (queue.length) {
      const current = points[queue.pop()];
      group.push(current);
      for (let j = 0; j < points.length; j++) {
        if (taken.has(j)) continue;
        if (Math.hypot(points[j].x - current.x, points[j].y - current.y) <= radius) {
          taken.add(j);
          queue.push(j);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

/** A walled enclosure: the settlement's silhouette, grown and roughened. */
function wallPath(group) {
  if (group.length === 1) {
    const place = group[0];
    return smoothPath(roughOutline(blob(place.x, place.y, 12, place.index * 31 + 7, 7), 2, 2.6));
  }
  const hull = convexHull(group.map((place) => [place.x, place.y]));
  if (hull.length < 3) return null;
  const centre = centroid(hull);
  const spread = hull.reduce((max, [x, y]) => Math.max(max, Math.hypot(x - centre[0], y - centre[1])), 1);
  const grow = 1 + Math.min(18, 10 + group.length * 0.5) / spread;
  const grown = hull.map(([x, y]) => [
    centre[0] + (x - centre[0]) * grow,
    centre[1] + (y - centre[1]) * grow,
  ]);
  return smoothPath(roughOutline(grown, 2, 2.8));
}

/** Grass tufts on a jittered grid, skipping the settled ground near places. */
function wildernessPath(poly, places, seed) {
  if (poly.length < 3) return null;
  const path = new Path2D();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const step = 26;
  let marks = 0;
  for (let y = minY + 6; y < maxY - 6; y += step) {
    for (let x = minX + 6; x < maxX - 6; x += step) {
      const px = x + (noise2(x, y, seed) - 0.5) * step * 0.9;
      const py = y + (noise2(x, y, seed + 91) - 0.5) * step * 0.9;
      if (!pointInPoly(px, py, poly)) continue;
      if (places.some((place) => Math.hypot(place.x - px, place.y - py) < 34)) continue;
      const size = 3 + noise2(px, py, seed + 17) * 2.6;
      path.moveTo(px - size, py + size * 0.7);
      path.quadraticCurveTo(px - size * 0.35, py - size, px, py - size * 0.1);
      path.quadraticCurveTo(px + size * 0.35, py - size, px + size, py + size * 0.7);
      marks += 1;
    }
  }
  return marks ? path : null;
}

/** Smooth, open path through a road's meander points. */
function smoothOpen(points) {
  const path = new Path2D();
  if (points.length < 2) return path;
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const mid = [(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2];
    path.quadraticCurveTo(points[i][0], points[i][1], mid[0], mid[1]);
  }
  const last = points[points.length - 1];
  path.lineTo(last[0], last[1]);
  return path;
}

/** A road bends around whatever the land does; the seed keeps it stable. */
function meander(from, to, seed) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const sway = Math.min(24, length * 0.18);
  const points = [[from.x, from.y]];
  const steps = 4;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const bend = (noise2(from.x + to.x, from.y + to.y, seed + s * 13) - 0.5) * 2 * sway * Math.sin(Math.PI * t);
    points.push([from.x + dx * t + nx * bend, from.y + dy * t + ny * bend]);
  }
  points.push([to.x, to.y]);
  return points;
}

/** Rounded, slightly hand-drawn path through a polygon. */
function smoothPath(points) {
  const path = new Path2D();
  if (points.length < 3) return path;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const first = mid(points[points.length - 1], points[0]);
  path.moveTo(first[0], first[1]);
  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const end = mid(current, next);
    path.quadraticCurveTo(current[0], current[1], end[0], end[1]);
  }
  path.closePath();
  return path;
}

function mulberry(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Atlas {
  constructor(canvas, handlers = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.handlers = handlers;
    this.graph = null;
    this.countries = [];
    this.places = [];
    this.roadBands = [];
    this.routeBands = [];
    this.hidden = new Set();
    this.focus = null;
    this.selection = new Set();
    this.hover = null;
    this.view = { x: 0, y: 0, k: 1 };
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.dirty = true;
    this.paper = null;
    this.fibres = null;
    this.riverBands = [];
    this.lakes = [];
    this.terrain = null;
    this.started = 0;
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.pointer = { down: false, moved: false, x: 0, y: 0, startX: 0, startY: 0, startView: null };
    this.showRoads = true;
    this.showRoutes = true;
    this.loadPaper();
    this.bind();
  }

  /* ---------- asset ---------- */

  loadPaper() {
    const image = new Image();
    image.decoding = 'async';
    image.addEventListener('load', () => {
      this.paper = image;
      this.dirty = true;
    });
    image.addEventListener('error', () => {
      this.paper = null;
    });
    image.src = './assets/parchment.jpg';
  }

  /* ---------- data ---------- */

  setGraph(graph) {
    const same = this.graph && this.graph.meta.generated_at === graph.meta.generated_at;
    this.graph = graph;
    if (same) return;
    this.build();
    this.dirty = true;
  }

  build() {
    const graph = this.graph;
    if (!graph) return;
    this.overview = isOverview(graph.nodes.length);
    const folders = (graph.meta.folders || []).filter((folder) => folder.count > 0);
    const byFolder = new Map();
    graph.nodes.forEach((node, index) => {
      const list = byFolder.get(node.folder);
      if (list) list.push(index);
      else byFolder.set(node.folder, [index]);
    });

    const capitals = layoutCapitals(folders);
    const cells = balancedCells(capitals);

    this.countries = folders.map((folder, index) => {
      const cell = cells[index].length >= 3 ? cells[index] : [];
      const centre = cell.length ? centroid(cell) : [WORLD / 2, WORLD / 2];
      // Tuned weights can move a border past its own capital; a capital outside
      // its country would place that folder's notes in a neighbour.
      const capital = cell.length && !pointInPoly(capitals[index].x, capitals[index].y, cell)
        ? { x: centre[0], y: centre[1] }
        : capitals[index];
      // The cell decides membership; the roughened outline decides the coast.
      // Land is pulled in slightly so notes sit inside their own borders.
      const field = cell.map(([x, y]) => [
        centre[0] + (x - centre[0]) * 0.93,
        centre[1] + (y - centre[1]) * 0.93,
      ]);
      // Constant depth and amplitude on every cell: a border shared by two
      // countries must displace by exactly the same amount on both sides.
      const outline = cell.length ? roughOutline(cell, 4, 30) : [];
      return {
        name: folder.name,
        count: folder.count,
        colour: folder.color ?? index,
        ink: PIGMENTS[(folder.color ?? index) % PIGMENTS.length],
        capital,
        cell,
        polygon: field,
        hatch: (index * 0.73) % Math.PI,
        path: outline.length ? smoothPath(outline) : null,
        members: byFolder.get(folder.name) || [],
        places: [],
        walls: [],
        wilderness: null,
        islets: this.buildIslets(cell, centre, index),
      };
    });

    const maxDegree = graph.nodes.reduce((max, node) => Math.max(max, node.degree || 0), 0) || 1;
    this.countries.forEach((country, index) => {
      country.places = this.placeMembers(country, maxDegree);
      country.label = labelPoint(country);
      const groups = clusterPoints(country.places, clusterRadius(country.count));
      country.walls = this.overview ? [] : groups.map(wallPath).filter(Boolean);
      groups.forEach((group, cluster) => {
        for (const place of group) place.cluster = `${index}:${cluster}`;
      });
      country.wilderness = wildernessPath(country.polygon, country.places, 100 + index * 17);
    });

    // Rivers depend on the finished countries (their coastlines and towns), so
    // the water is computed once the land exists.
    this.buildTerrain();

    const position = new Map();
    this.places = [];
    this.countries.forEach((country, countryIndex) => {
      for (const place of country.places) {
        position.set(place.index, place);
        place.country = countryIndex;
        this.places.push(place);
      }
    });
    this.position = position;

    this.layoutRoads();
  }

  buildIslets(cell, centre, index) {
    if (!cell.length) return [];
    const random = mulberry(4000 + index * 131);
    const far = cell
      .map((point) => ({ point, distance: Math.hypot(point[0] - centre[0], point[1] - centre[1]) }))
      .sort((a, b) => b.distance - a.distance)
      .slice(0, 3);
    return far.map(({ point, distance }, slot) => {
      const angle = Math.atan2(point[1] - centre[1], point[0] - centre[0]) + (random() - 0.5) * 0.9;
      const reach = distance * (1.03 + random() * 0.2);
      const x = clamp(centre[0] + Math.cos(angle) * reach, EDGE - 34, WORLD - EDGE + 34);
      const y = clamp(centre[1] + Math.sin(angle) * reach, EDGE - 34, WORLD - EDGE + 34);
      const radius = 6 + random() * 12;
      return smoothPath(roughOutline(blob(x, y, radius, index * 71 + slot * 13, 8), 2, radius * 0.4));
    });
  }

  /**
   * Roads are bucketed by width instead of stored per link: a note with many
   * links draws the same road four times, and the wider line is the evidence.
   */
  layoutRoads() {
    const roads = new Map();
    const routes = new Map();
    const nodes = this.graph?.nodes || [];
    const add = (bucket, width, path) => {
      const key = Math.round(width * 4) / 4;
      const existing = bucket.get(key);
      if (existing) existing.addPath(path);
      else bucket.set(key, path);
    };

    const candidates = [];
    for (const edge of this.graph?.edges || []) {
      const from = this.position?.get(edge.source);
      const to = this.position?.get(edge.target);
      if (!from || !to) continue;
      if (this.hidden.has(nodes[edge.source]?.folder) || this.hidden.has(nodes[edge.target]?.folder)) {
        continue;
      }
      // Links inside one settlement are streets: at country scale they turn a
      // tight clump of notes into a sunburst. The clump already reads as a town.
      if (from.cluster && from.cluster === to.cluster) continue;
      // In an overview, a single hub with a hundred links turns the roads into
      // a white starburst. Its neighbours are already in the same stipple.
      if (this.overview && ((from.degree || 0) > 8 || (to.degree || 0) > 8)) continue;
      candidates.push({ edge, from, to, weight: Math.max(1, edge.weight || 1) });
    }
    // A 20,000-link vault would otherwise draw a hairball. Keep the strongest
    // roads, deterministically, and let the graph view carry every link.
    if (candidates.length > 12000) {
      candidates.sort((a, b) =>
        b.weight - a.weight
        || a.edge.source - b.edge.source
        || a.edge.target - b.edge.target);
      candidates.length = 12000;
    }
    let routesDrawn = 0;
    for (const { edge, from, to, weight } of candidates) {
      const path = smoothOpen(meander(from, to, edge.source * 31 + edge.target * 7));
      if (from.country !== to.country) {
        if (routesDrawn >= (this.overview ? 400 : 2500)) continue;
        routesDrawn += 1;
        add(routes, 1 + Math.log2(1 + weight) * 0.35, path);
      } else {
        add(roads, 0.8 + Math.log2(1 + weight) * 0.55, path);
      }
    }

    this.roadBands = [...roads].map(([width, path]) => ({ width, path }));
    this.routeBands = [...routes].map(([width, path]) => ({ width, path }));
    this.dirty = true;
  }

  placeMembers(country, maxDegree) {
    const { polygon, capital } = country;
    const members = country.members;
    if (!polygon.length || !members.length) return [];
    const area = Math.abs(polygonArea(polygon));
    const radius = Math.sqrt(area / Math.PI) * 0.66;
    const count = members.length;
    // A big folder becomes a country of towns, not one white disc. Town centres
    // sit on a ring inside the border and each town gets its share of notes.
    const towns = count > 48 ? Math.min(12, Math.ceil(count / 24)) : 1;
    const perTown = Math.ceil(count / towns);
    const townSpread = towns > 1 ? radius * 0.8 : 0;
    const townRadius = towns > 1
      ? Math.min(
        radius * (this.overview ? 0.42 : 0.16),
        Math.max(10, Math.sqrt(perTown) * (this.overview ? 5.5 : 4.5)),
      )
      : radius;
    const random = mulberry(country.name.length * 131 + count);
    const townCentres = Array.from({ length: towns }, (_, town) => {
      if (towns === 1) return [capital.x, capital.y];
      const angle = town * 2.399963 + 0.35;
      const reach = townSpread * (0.82 + random() * 0.18);
      return [capital.x + Math.cos(angle) * reach, capital.y + Math.sin(angle) * reach];
    });
    const points = members.map((nodeIndex, slot) => {
      const town = Math.min(towns - 1, Math.floor(slot / perTown));
      const localSlot = slot - town * perTown;
      const centre = townCentres[town];
      const angle = localSlot * GOLDEN;
      const ring = townRadius * Math.sqrt((localSlot + 0.7) / perTown);
      return {
        index: nodeIndex,
        x: centre[0] + Math.cos(angle) * ring * 0.82,
        y: centre[1] + Math.sin(angle) * ring * 0.82,
      };
    });

    // Springs along real links, so a cluster of connected notes reads as a
    // settlement cluster rather than an even sprinkle.
    const local = new Map();
    members.forEach((nodeIndex, slot) => local.set(nodeIndex, slot));
    const springs = [];
    for (const edge of this.graph.edges) {
      const a = local.get(edge.source);
      const b = local.get(edge.target);
      if (a === undefined || b === undefined || a === b) continue;
      springs.push([a, b]);
    }

    const density = count > 800 ? 0.3 : count > 240 ? 0.42 : count > 120 ? 0.58 : 1;
    const finish = () => points.map((point) => {
      const node = this.graph.nodes[point.index];
      const relative = Math.sqrt((node.degree || 0) / maxDegree);
      return {
        index: point.index,
        x: point.x,
        y: point.y,
        r: (2.4 + relative * 5.2) * density,
        stipple: count > 64 || this.overview,
        folderCount: count,
        title: node.title,
        folder: node.folder,
        degree: node.degree || 0,
        pagerank: node.pagerank || 0,
      };
    });

    // A daily journal of 1,300 entries is 1.7 million pairwise checks *per
    // pass*: the town spiral is already even, so skip the physics and let the
    // stipple carry the density. In a large vault every 120-note folder would
    // pay that cost too, so the overview skips it for all stippled folders.
    if (count > 800 || (this.overview && count > 64)) {
      for (const point of points) {
        if (!pointInPoly(point.x, point.y, polygon)) {
          const inside = this.nearestInside(point.x, point.y, polygon, capital);
          point.x = inside[0];
          point.y = inside[1];
        }
      }
      return finish();
    }

    const spacing = clamp(21 - Math.log2(count + 2) * 2.2, 8, 18);
    for (let step = 0; step < 90; step++) {
      for (let i = 0; i < count; i++) {
        for (let j = i + 1; j < count; j++) {
          const a = points[i];
          const b = points[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let distance = Math.hypot(dx, dy);
          if (distance < 1e-3) {
            dx = 0.01 * (i + 1);
            dy = 0.01;
            distance = Math.hypot(dx, dy);
          }
          if (distance < spacing) {
            const push = ((spacing - distance) / distance) * 0.5;
            a.x -= dx * push;
            a.y -= dy * push;
            b.x += dx * push;
            b.y += dy * push;
          }
        }
      }
      for (const [a, b] of springs) {
        const from = points[a];
        const to = points[b];
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const distance = Math.hypot(dx, dy) || 1;
        const target = spacing * 2.6;
        const pull = ((distance - target) / distance) * 0.05;
        from.x += dx * pull;
        from.y += dy * pull;
        to.x -= dx * pull;
        to.y -= dy * pull;
      }
      for (const point of points) {
        point.x += (capital.x - point.x) * 0.0025;
        point.y += (capital.y - point.y) * 0.0025;
        if (!pointInPoly(point.x, point.y, polygon)) {
          const inside = this.nearestInside(point.x, point.y, polygon, capital);
          point.x = inside[0];
          point.y = inside[1];
        }
      }
    }

    return finish();
  }

  nearestInside(x, y, polygon, origin) {
    let low = 0;
    let high = 1;
    for (let step = 0; step < 14; step++) {
      const t = (low + high) / 2;
      const px = origin.x + (x - origin.x) * t;
      const py = origin.y + (y - origin.y) * t;
      if (pointInPoly(px, py, polygon)) high = t;
      else low = t;
    }
    // Nudge past the border so the marker sits inside its country.
    const t = Math.max(0, high - 0.04);
    return [origin.x + (x - origin.x) * t, origin.y + (y - origin.y) * t];
  }

  /**
   * Real hydrology, not decorative squiggles.
   *
   * 1. Rasterise the land into a 132×132 grid.
   * 2. Measure the distance to the sea and build an elevation model: low at
   *    the coast, ridged inland (mountains), plus fine noise.
   * 3. Fill closed basins with a priority flood, so every drop can find a path
   *    downhill instead of pooling in a one-cell pit.
   * 4. Route one unit of rain downhill (D8, steepest slope) and accumulate it.
   *    Cells that gather enough water become streams; tracing downhill from
   *    each spring gives rivers that only ever join, widen and reach the sea.
   */
  buildTerrain() {
    const n = GRID;
    const total = n * n;
    if (!this.countries.length) return;
    const land = new Uint8Array(total);
    const owner = new Int16Array(total).fill(-1);

    this.countries.forEach((country, index) => {
      if (!country.cell.length) return;
      let lowX = Infinity;
      let lowY = Infinity;
      let highX = -Infinity;
      let highY = -Infinity;
      for (const [x, y] of country.cell) {
        lowX = Math.min(lowX, x);
        lowY = Math.min(lowY, y);
        highX = Math.max(highX, x);
        highY = Math.max(highY, y);
      }
      const x0 = clamp(Math.floor(lowX / CELL) - 1, 0, n - 1);
      const y0 = clamp(Math.floor(lowY / CELL) - 1, 0, n - 1);
      const x1 = clamp(Math.ceil(highX / CELL) + 1, 0, n - 1);
      const y1 = clamp(Math.ceil(highY / CELL) + 1, 0, n - 1);
      for (let gy = y0; gy <= y1; gy += 1) {
        for (let gx = x0; gx <= x1; gx += 1) {
          const id = gy * n + gx;
          if (land[id]) continue;
          if (pointInPoly((gx + 0.5) * CELL, (gy + 0.5) * CELL, country.cell)) {
            land[id] = 1;
            owner[id] = index;
          }
        }
      }
    });

    // Chamfer distance to the sea: two sweeps are enough for this resolution.
    const dist = new Float32Array(total);
    for (let index = 0; index < total; index += 1) dist[index] = land[index] ? 1e6 : 0;
    const around = [
      [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
      [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142],
    ];
    for (let gy = 0; gy < n; gy += 1) {
      for (let gx = 0; gx < n; gx += 1) {
        const id = gy * n + gx;
        if (!land[id]) continue;
        let best = dist[id];
        for (const [dx, dy, cost] of around) {
          const x = gx + dx;
          const y = gy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          best = Math.min(best, dist[y * n + x] + cost);
        }
        dist[id] = best;
      }
    }
    for (let gy = n - 1; gy >= 0; gy -= 1) {
      for (let gx = n - 1; gx >= 0; gx -= 1) {
        const id = gy * n + gx;
        if (!land[id]) continue;
        let best = dist[id];
        for (const [dx, dy, cost] of around) {
          const x = gx + dx;
          const y = gy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          best = Math.min(best, dist[y * n + x] + cost);
        }
        dist[id] = best;
      }
    }

    const elev = new Float32Array(total);
    for (let gy = 0; gy < n; gy += 1) {
      for (let gx = 0; gx < n; gx += 1) {
        const id = gy * n + gx;
        if (!land[id]) continue;
        const x = (gx + 0.5) * CELL;
        const y = (gy + 0.5) * CELL;
        // Broad ranges and valleys decide where watersheds sit; the coast
        // ramp only pulls the land down near the sea. Without this, every
        // river ran straight to the nearest coast in parallel.
        const inland = clamp(dist[id] / 7, 0, 1);
        const macro = fbm(x * 0.0052, y * 0.0052, 37, 5);
        const ridge = ridged(x * 0.0095, y * 0.0095, 53, 3);
        const detail = fbm(x * 0.026, y * 0.026, 11, 3);
        elev[id] = 0.02 + (0.10 + 0.74 * macro + 0.24 * ridge * Math.pow(macro, 1.5))
          * Math.pow(inland, 0.72)
          + (detail - 0.5) * 0.025;
      }
    }

    // Priority flood: raise every closed basin to its spill point.
    const filled = Float32Array.from(elev);
    const visited = new Uint8Array(total);
    const heap = new MinHeap();
    for (let index = 0; index < total; index += 1) {
      if (!land[index]) heap.push(0, index);
    }
    while (heap.size) {
      const id = heap.pop();
      if (visited[id]) continue;
      visited[id] = 1;
      const gx = id % n;
      const gy = Math.floor(id / n);
      for (const [dx, dy] of around) {
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const next = y * n + x;
        if (!land[next] || visited[next]) continue;
        filled[next] = Math.max(filled[next], filled[id] + 0.0006);
        heap.push(filled[next], next);
      }
    }

    // D8 flow: every cell drains to its steepest lower neighbour.
    const flow = new Int32Array(total).fill(-1);
    for (let gy = 0; gy < n; gy += 1) {
      for (let gx = 0; gx < n; gx += 1) {
        const id = gy * n + gx;
        if (!land[id]) continue;
        let best = -1;
        let steepest = 0;
        for (const [dx, dy, cost] of around) {
          const x = gx + dx;
          const y = gy + dy;
          if (x < 0 || y < 0 || x >= n || y >= n) continue;
          const next = y * n + x;
          const drop = filled[id] - filled[next];
          if (drop <= 0) continue;
          const slope = drop / cost;
          if (slope > steepest) {
            steepest = slope;
            best = next;
          }
        }
        flow[id] = best;
      }
    }

    // Rain: one unit per land cell, accumulated downstream.
    const rain = new Float32Array(total);
    const order = [];
    for (let index = 0; index < total; index += 1) {
      if (!land[index]) continue;
      rain[index] = 1;
      order.push(index);
    }
    order.sort((a, b) => filled[b] - filled[a]);
    for (const id of order) {
      const next = flow[id];
      if (next >= 0) rain[next] += rain[id];
    }

    const threshold = 50;
    const bands = new Map();
    const lakes = [];
    const addSegment = (a, b, width) => {
      const key = Math.round(width * 4) / 4;
      let path = bands.get(key);
      if (!path) {
        path = new Path2D();
        bands.set(key, path);
      }
      path.moveTo(a[0], a[1]);
      path.lineTo(b[0], b[1]);
    };
    const hasUpstream = (id, gx, gy) => {
      for (const [dx, dy] of around) {
        const x = gx + dx;
        const y = gy + dy;
        if (x < 0 || y < 0 || x >= n || y >= n) continue;
        const next = y * n + x;
        if (land[next] && flow[next] === id && rain[next] >= threshold) return true;
      }
      return false;
    };

    for (let gy = 0; gy < n; gy += 1) {
      for (let gx = 0; gx < n; gx += 1) {
        const id = gy * n + gx;
        if (!land[id] || rain[id] < threshold || filled[id] < 0.2) continue;
        if (hasUpstream(id, gx, gy)) continue;
        const raw = [];
        let cursor = id;
        for (let step = 0; step < 600; step += 1) {
          const width = 0.45 + Math.min(2.0, Math.sqrt(rain[cursor] / threshold) * 0.34);
          raw.push([(cursor % n + 0.5) * CELL, (Math.floor(cursor / n) + 0.5) * CELL, width]);
          const next = flow[cursor];
          if (next < 0) break;
          if (!land[next]) {
            raw.push([(next % n + 0.5) * CELL, (Math.floor(next / n) + 0.5) * CELL, width]);
            break;
          }
          cursor = next;
        }
        if (raw.length < 7) continue;
        const points = meanderLine(chaikin(raw, 2));
        for (let index = 1; index < points.length; index += 1) {
          const a = points[index - 1];
          const b = points[index];
          addSegment([a[0], a[1]], [b[0], b[1]], (a[2] + b[2]) / 2);
        }
      }
    }

    // Lakes: basins that never found a lower neighbour but gather real water.
    for (let gy = 0; gy < n; gy += 1) {
      for (let gx = 0; gx < n; gx += 1) {
        const id = gy * n + gx;
        if (!land[id] || flow[id] !== -1 || rain[id] < 90) continue;
        const x = (gx + 0.5) * CELL;
        const y = (gy + 0.5) * CELL;
        if (lakes.some((lake) => Math.hypot(lake.x - x, lake.y - y) < CELL * 2.5)) continue;
        lakes.push({ x, y, r: clamp(Math.sqrt(rain[id] / 48) * CELL * 0.55, 3.5, 13) });
      }
    }

    this.riverBands = [...bands].map(([width, path]) => ({ width, path }));
    this.lakes = lakes;
    this.terrain = { land, owner, elev: filled, mountains: [], forests: [] };
    this.terrain.relief = this.buildRelief(filled, land);
    this.terrain.contours = this.buildContours(filled, land);
    this.buildTerrainMarks();
  }

  /** A soft height wash with a north-west light, drawn under the map marks. */
  buildRelief(filled, land) {
    const n = GRID;
    const canvas = document.createElement('canvas');
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(n, n);
    for (let gy = 0; gy < n; gy += 1) {
      for (let gx = 0; gx < n; gx += 1) {
        const id = gy * n + gx;
        if (!land[id]) continue;
        const height = clamp(filled[id], 0, 1.05);
        const left = gx > 0 ? filled[id - 1] : height;
        const right = gx < n - 1 ? filled[id + 1] : height;
        const up = gy > 0 ? filled[id - n] : height;
        const down = gy < n - 1 ? filled[id + n] : height;
        const slope = (right - left) * 13 + (down - up) * 13;
        const shade = clamp(0.92 - slope, 0.66, 1.18);
        let red = 168;
        let green = 160;
        let blue = 112;
        if (height > 0.4) {
          const t = clamp((height - 0.4) / 0.32, 0, 1);
          red = 168 - 12 * t;
          green = 160 - 16 * t;
          blue = 112 + 3 * t;
        }
        if (height > 0.72) {
          const t = clamp((height - 0.72) / 0.3, 0, 1);
          red += 10 * t;
          green += 13 * t;
          blue += 22 * t;
        }
        const offset = id * 4;
        image.data[offset] = clamp(red * shade, 0, 255);
        image.data[offset + 1] = clamp(green * shade, 0, 255);
        image.data[offset + 2] = clamp(blue * shade, 0, 255);
        image.data[offset + 3] = 235;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /** Iso-hypsometric lines: the engraved contour layer under the relief. */
  buildContours(filled, land) {
    const n = GRID;
    const path = new Path2D();
    const levelAt = (a, b, level) => (level - a) / (b - a || 1e-6);
    for (let level = 0.18; level < 0.98; level += 0.09) {
      for (let gy = 0; gy < n - 1; gy += 1) {
        for (let gx = 0; gx < n - 1; gx += 1) {
          const id = gy * n + gx;
          if (!land[id] || !land[id + 1] || !land[id + n] || !land[id + n + 1]) continue;
          const v00 = filled[id];
          const v10 = filled[id + 1];
          const v01 = filled[id + n];
          const v11 = filled[id + n + 1];
          if (level < Math.min(v00, v10, v01, v11) || level > Math.max(v00, v10, v01, v11)) continue;
          const x0 = gx * CELL;
          const y0 = gy * CELL;
          const points = [];
          if ((v00 < level) !== (v10 < level)) points.push([x0 + levelAt(v00, v10, level) * CELL, y0]);
          if ((v10 < level) !== (v11 < level)) points.push([x0 + CELL, y0 + levelAt(v10, v11, level) * CELL]);
          if ((v01 < level) !== (v11 < level)) points.push([x0 + levelAt(v01, v11, level) * CELL, y0 + CELL]);
          if ((v00 < level) !== (v01 < level)) points.push([x0, y0 + levelAt(v00, v01, level) * CELL]);
          if (points.length < 2) continue;
          path.moveTo(points[0][0], points[0][1]);
          path.lineTo(points[1][0], points[1][1]);
          if (points.length === 4) {
            path.moveTo(points[2][0], points[2][1]);
            path.lineTo(points[3][0], points[3][1]);
          }
        }
      }
    }
    return path;
  }

  /** Mountains and woods, sampled on a stride so the land never turns to noise. */
  buildTerrainMarks() {
    const n = GRID;
    const { elev, land, owner, mountains, forests } = this.terrain;
    const nearPlace = (x, y) => this.places.some((place) => Math.hypot(place.x - x, place.y - y) < 24);
    for (let gy = 2; gy < n - 2; gy += 2) {
      for (let gx = 2; gx < n - 2; gx += 2) {
        const id = gy * n + gx;
        if (!land[id] || owner[id] < 0) continue;
        const x = (gx + 0.5) * CELL + (noise2(gx, gy, 17) - 0.5) * CELL * 1.6;
        const y = (gy + 0.5) * CELL + (noise2(gx, gy, 29) - 0.5) * CELL * 1.6;
        const height = elev[id];
        if (height > 0.46
          && height >= elev[id - 1] && height >= elev[id + 1]
          && height >= elev[id - n] && height >= elev[id + n]
          && noise2(gx, gy, 41) > 0.12
          && !nearPlace(x, y)
          && mountains.length < (this.overview ? 150 : 280)) {
          mountains.push({
            x,
            y,
            s: 10 + height * 14,
            tilt: (noise2(gx, gy, 53) - 0.5) * 0.35,
            country: owner[id],
          });
        } else if (height > 0.12 && height < 0.46
          && fbm(x * 0.02, y * 0.02, 211, 3) > 0.48
          && noise2(gx, gy, 67) > 0.2
          && !nearPlace(x, y)
          && forests.length < (this.overview ? 0 : 340)) {
          forests.push({
            x,
            y,
            s: 4.6 + noise2(gx, gy, 71) * 3.6,
            conifer: noise2(gx, gy, 83) > 0.45,
            country: owner[id],
          });
        }
      }
    }
  }

  drawRelief(country) {
    const relief = this.terrain?.relief;
    if (!relief) return;
    const { ctx } = this;
    ctx.save();
    ctx.clip(country.path);
    ctx.globalAlpha = 0.24;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(relief, 0, 0, WORLD, WORLD);
    const contours = this.terrain.contours;
    if (contours) {
      ctx.globalAlpha = 0.16;
      ctx.strokeStyle = rgba(INK, 0.7);
      ctx.lineWidth = 0.55;
      ctx.stroke(contours);
    }
    ctx.restore();
  }

  drawTerrainMarks(country) {
    const terrain = this.terrain;
    if (!terrain) return;
    const index = this.countries.indexOf(country);
    const { ctx } = this;
    for (const mountain of terrain.mountains) {
      if (mountain.country === index) this.drawMountain(mountain);
    }
    for (const forest of terrain.forests) {
      if (forest.country === index) this.drawTree(forest);
    }
  }

  /** A peak with two smaller shoulders, so a ridge reads as a range. */
  drawMountain({ x, y, s, tilt }) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.strokeStyle = rgba(INK, 0.5);
    ctx.lineWidth = 0.65;
    const shoulder = (cx, cy, size, flip) => {
      const w = size * 0.56;
      ctx.beginPath();
      ctx.moveTo(cx - w * flip, cy + size * 0.42);
      ctx.lineTo(cx, cy - size * 0.55);
      ctx.lineTo(cx + w * flip, cy + size * 0.42);
      ctx.closePath();
      ctx.fillStyle = 'rgba(247, 238, 216, 0.5)';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - size * 0.55);
      ctx.lineTo(cx + w * flip, cy + size * 0.42);
      ctx.lineTo(cx + w * 0.08, cy + size * 0.42);
      ctx.closePath();
      ctx.fillStyle = rgba(INK, 0.22);
      ctx.fill();
    };
    shoulder(-s * 0.46, s * 0.06, s * 0.62, 1);
    shoulder(s * 0.5, s * 0.1, s * 0.52, 1);
    shoulder(0, 0, s, 1);
    ctx.restore();
  }

  drawTree({ x, y, s, conifer }) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = rgba(INK, 0.34);
    ctx.lineWidth = 0.55;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.6);
    ctx.lineTo(x, y - s * 0.5);
    ctx.stroke();
    if (conifer) {
      for (let tier = 0; tier < 3; tier += 1) {
        const top = y - s * 0.9 + tier * s * 0.42;
        ctx.beginPath();
        ctx.moveTo(x - s * (0.55 - tier * 0.12), top + s * 0.5);
        ctx.lineTo(x, top);
        ctx.lineTo(x + s * (0.55 - tier * 0.12), top + s * 0.5);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = 'rgba(104, 116, 72, 0.22)';
      ctx.beginPath();
      ctx.arc(x, y - s * 0.62, s * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - s * 0.36, y - s * 0.34, s * 0.38, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + s * 0.36, y - s * 0.3, s * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y - s * 0.62, s * 0.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  setHidden(hidden) {
    this.hidden = hidden instanceof Set ? hidden : new Set(hidden || []);
    if (this.position) this.layoutRoads();
    this.dirty = true;
  }

  setRoads(show) {
    this.showRoads = Boolean(show);
    this.dirty = true;
  }

  setRoutes(show) {
    this.showRoutes = Boolean(show);
    this.dirty = true;
  }

  setFocus(index) {
    if (this.focus === index) return;
    this.focus = index;
    this.dirty = true;
  }

  setSelection(indices) {
    this.selection = indices instanceof Set ? indices : new Set(indices || []);
    this.dirty = true;
  }

  /* ---------- geometry ---------- */

  baseScale() {
    return (Math.min(this.width, this.height) / WORLD) * 0.97;
  }

  scale() {
    return this.baseScale() * this.view.k;
  }

  toScreen(x, y) {
    const scale = this.scale();
    return [
      this.width / 2 + this.view.x + (x - WORLD / 2) * scale,
      this.height / 2 + this.view.y + (y - WORLD / 2) * scale,
    ];
  }

  toWorld(sx, sy) {
    const scale = this.scale();
    return [
      (sx - this.width / 2 - this.view.x) / scale + WORLD / 2,
      (sy - this.height / 2 - this.view.y) / scale + WORLD / 2,
    ];
  }

  reset() {
    this.view = { x: 0, y: 0, k: 1 };
    this.dirty = true;
  }

  zoomAt(factor, sx, sy) {
    const before = this.toWorld(sx, sy);
    this.view.k = clamp(this.view.k * factor, 0.65, 6);
    const after = this.toWorld(sx, sy);
    const scale = this.scale();
    this.view.x += (after[0] - before[0]) * scale;
    this.view.y += (after[1] - before[1]) * scale;
    this.dirty = true;
  }

  centreOn(index) {
    const place = this.position?.get(index);
    if (!place) return;
    const scale = this.scale();
    this.view.x = -(place.x - WORLD / 2) * scale;
    this.view.y = -(place.y - WORLD / 2) * scale;
    this.dirty = true;
  }

  /* ---------- input ---------- */

  bind() {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      this.pointer.down = true;
      this.pointer.moved = false;
      this.pointer.startX = event.clientX;
      this.pointer.startY = event.clientY;
      this.pointer.x = event.clientX;
      this.pointer.y = event.clientY;
      this.pointer.startView = { ...this.view };
      try {
        this.canvas.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can already be gone (or synthetic); dragging still works.
      }
      this.canvas.focus();
    });

    this.canvas.addEventListener('pointermove', (event) => {
      if (this.pointer.down) {
        const dx = event.clientX - this.pointer.startX;
        const dy = event.clientY - this.pointer.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.pointer.moved = true;
        this.view.x = this.pointer.startView.x + dx;
        this.view.y = this.pointer.startView.y + dy;
        this.dirty = true;
        return;
      }
      const rect = this.canvas.getBoundingClientRect();
      const place = this.pick(event.clientX - rect.left, event.clientY - rect.top);
      const index = place ? place.index : null;
      if (index !== this.hover) {
        this.hover = index;
        this.dirty = true;
        this.canvas.style.cursor = index == null ? 'grab' : 'pointer';
      }
      this.handlers.onHover?.(index, event.clientX, event.clientY);
    });

    const finish = (event) => {
      if (!this.pointer.down) return;
      this.pointer.down = false;
      if (this.pointer.moved) return;
      const rect = this.canvas.getBoundingClientRect();
      const place = this.pick(event.clientX - rect.left, event.clientY - rect.top);
      if (place) {
        const additive = event.metaKey || event.ctrlKey || event.shiftKey;
        this.handlers.onSelect?.(place.index, additive);
      } else {
        this.handlers.onBackground?.();
      }
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', () => {
      this.pointer.down = false;
    });
    this.canvas.addEventListener('pointerleave', () => {
      if (this.hover != null) {
        this.hover = null;
        this.dirty = true;
      }
      this.handlers.onHover?.(null, 0, 0);
    });

    this.canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const factor = Math.exp(-event.deltaY * 0.0015);
        this.zoomAt(factor, event.clientX - rect.left, event.clientY - rect.top);
      },
      { passive: false },
    );

    this.canvas.addEventListener('keydown', (event) => {
      const step = 40;
      if (event.key === 'ArrowLeft') this.view.x += step;
      else if (event.key === 'ArrowRight') this.view.x -= step;
      else if (event.key === 'ArrowUp') this.view.y += step;
      else if (event.key === 'ArrowDown') this.view.y -= step;
      else if (event.key === '+' || event.key === '=') {
        this.zoomAt(1.18, this.width / 2, this.height / 2);
      } else if (event.key === '-' || event.key === '_') {
        this.zoomAt(1 / 1.18, this.width / 2, this.height / 2);
      } else if (event.key === '0') this.reset();
      else if (event.key === 'Enter' && this.hover != null) {
        this.handlers.onSelect?.(this.hover, false);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.dirty = true;
    });
  }

  pick(sx, sy) {
    if (!this.position) return null;
    let best = null;
    let bestDistance = Infinity;
    for (const place of this.places) {
      const [x, y] = this.toScreen(place.x, place.y);
      const distance = Math.hypot(x - sx, y - sy);
      const radius = 9 + place.r;
      if (distance < radius && distance < bestDistance) {
        bestDistance = distance;
        best = place;
      }
    }
    return best;
  }

  /* ---------- render ---------- */

  resize() {
    const width = this.canvas.clientWidth || 1;
    const height = this.canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && dpr === this.dpr) return;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.fibres = null;
    this.dirty = true;
  }

  tick(now) {
    if (!this.width) this.resize();
    if (!this.dirty) return;
    if (!this.started) this.started = now;
    this.draw(now);
    this.dirty = false;
  }

  draw(now) {
    const { ctx, width, height, dpr } = this;
    if (!width || !height) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    this.drawPaper();

    const fade = this.reduced ? 1 : clamp((now - this.started) / 320, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.15 + fade * 0.85;

    const scale = this.scale();
    ctx.save();
    ctx.translate(width / 2 + this.view.x, height / 2 + this.view.y);
    ctx.scale(scale, scale);
    ctx.translate(-WORLD / 2, -WORLD / 2);

    this.drawSea();
    this.drawIslets();
    this.drawCountries();
    this.drawLakes();
    this.drawRivers();
    this.drawRoutes();
    this.drawRoads();
    this.drawPlaces();

    ctx.restore();

    // Labels are laid out in screen pixels so they stay a readable size at any
    // zoom; drawing them inside the map transform would scale them twice.
    ctx.globalAlpha = 0.15 + fade * 0.85;
    this.drawPlaceLabels();
    ctx.globalAlpha = 1;

    ctx.restore();

    this.drawFrame();
    this.drawCartouche();
    this.drawCompass();
    this.drawScale();
  }

  drawPaper() {
    const { ctx, width, height } = this;
    ctx.fillStyle = '#efe3c8';
    ctx.fillRect(0, 0, width, height);
    if (this.paper && this.paper.complete && this.paper.naturalWidth) {
      const scale = Math.max(width / this.paper.naturalWidth, height / this.paper.naturalHeight);
      const w = this.paper.naturalWidth * scale;
      const h = this.paper.naturalHeight * scale;
      ctx.globalAlpha = 0.9;
      ctx.drawImage(this.paper, (width - w) / 2, (height - h) / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(247, 238, 216, 0.34)';
      ctx.fillRect(0, 0, width, height);
    }
    if (!this.fibres) this.fibres = this.makeFibres();
    if (this.fibres) {
      ctx.globalAlpha = 0.05;
      ctx.fillStyle = ctx.createPattern(this.fibres, 'repeat');
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.34,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.74,
    );
    vignette.addColorStop(0, 'rgba(92, 66, 34, 0)');
    vignette.addColorStop(1, 'rgba(92, 66, 34, 0.26)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  makeFibres() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(size, size);
    const random = mulberry(20261117);
    for (let i = 0; i < image.data.length; i += 4) {
      const value = 90 + random() * 120;
      image.data[i] = value;
      image.data[i + 1] = value * 0.86;
      image.data[i + 2] = value * 0.62;
      image.data[i + 3] = random() * 60;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  /** Sea wash: a fine horizontal ruling, the way engraved charts read water. */
  drawSea() {
    const { ctx } = this;
    const inset = EDGE - 28;
    const size = WORLD - inset * 2;
    ctx.save();
    ctx.fillStyle = 'rgba(92, 122, 124, 0.22)';
    ctx.fillRect(inset, inset, size, size);
    ctx.strokeStyle = 'rgba(64, 92, 92, 0.2)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let y = inset + 3; y < WORLD - inset; y += 4.5) {
      ctx.moveTo(inset, y);
      ctx.lineTo(WORLD - inset, y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(58, 78, 78, 0.32)';
    ctx.lineWidth = 1;
    ctx.strokeRect(inset + 1.5, inset + 1.5, size - 3, size - 3);
    ctx.restore();
  }

  drawIslets() {
    const { ctx } = this;
    ctx.save();
    ctx.lineJoin = 'round';
    for (const country of this.countries) {
      if (this.hidden.has(country.name)) continue;
      for (const islet of country.islets) {
        ctx.fillStyle = rgba(country.ink, 0.4);
        ctx.fill(islet);
        ctx.strokeStyle = rgba(INK, 0.68);
        ctx.lineWidth = 1.1;
        ctx.stroke(islet);
      }
    }
    ctx.restore();
  }

  drawCountries() {
    const { ctx } = this;
    for (const country of this.countries) {
      if (!country.path) continue;
      const dim = this.hidden.has(country.name);
      ctx.save();
      ctx.fillStyle = rgba(country.ink, dim ? 0.06 : 0.4);
      ctx.fill(country.path);

      if (!dim) {
        // Hatching, angled per country so neighbours read as different lands.
        ctx.save();
        ctx.clip(country.path);
        ctx.translate(country.capital.x, country.capital.y);
        ctx.rotate(country.hatch);
        ctx.strokeStyle = rgba(country.ink, 0.08);
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        const reach = WORLD;
        for (let offset = -reach; offset < reach; offset += 12) {
          ctx.moveTo(offset, -reach);
          ctx.lineTo(offset, reach);
        }
        ctx.stroke();
        ctx.restore();

        // Height shading: lowlands pale, ridges inked. Clipped to the country
        // so a hidden folder takes its relief with it.
        this.drawRelief(country);
        this.drawTerrainMarks(country);

        // Wilderness fills the land nobody settled.
        if (country.wilderness) {
          ctx.save();
          ctx.clip(country.path);
          ctx.strokeStyle = rgba(INK, 0.26);
          ctx.lineWidth = 0.8;
          ctx.stroke(country.wilderness);
          ctx.restore();
        }

        // Walls around the settled ground: cleared land inside a dashed ring.
        for (const wall of country.walls) {
          ctx.save();
          ctx.clip(country.path);
          ctx.fillStyle = `rgba(243, 232, 205, ${country.count > 64 ? 0.16 : 0.4})`;
          ctx.fill(wall);
          // Ploughed fields: fine furrows inside the walls, so a settlement
          // reads as worked land instead of a blank chip.
          ctx.save();
          ctx.clip(wall);
          ctx.strokeStyle = rgba(INK, 0.075);
          ctx.lineWidth = 0.55;
          ctx.beginPath();
          for (let row = -220; row < 220; row += 4.5) {
            ctx.moveTo(row, -220);
            ctx.lineTo(row + 150, 220);
          }
          ctx.stroke();
          ctx.restore();
          ctx.strokeStyle = rgba(INK, 0.5);
          ctx.lineWidth = 0.9;
          ctx.setLineDash([3.5, 2.4]);
          ctx.stroke(wall);
          ctx.restore();
        }
      }

      ctx.lineJoin = 'round';
      ctx.strokeStyle = rgba(INK, dim ? 0.16 : 0.3);
      ctx.lineWidth = 4.2;
      ctx.stroke(country.path);
      ctx.strokeStyle = rgba(INK, dim ? 0.3 : 0.86);
      ctx.lineWidth = 1.15;
      ctx.stroke(country.path);
      ctx.restore();
    }
  }

  drawLakes() {
    if (!this.lakes.length) return;
    const { ctx } = this;
    for (const lake of this.lakes) {
      ctx.beginPath();
      ctx.arc(lake.x, lake.y, lake.r, 0, Math.PI * 2);
      ctx.fillStyle = rgba(RIVER, 0.22);
      ctx.fill();
      ctx.strokeStyle = rgba(RIVER, 0.5);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
  }

  /** Water first a pale casing, then the river itself, then a highlight. */
  drawRivers() {
    if (!this.riverBands.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(247, 238, 216, 0.34)';
    for (const band of this.riverBands) {
      ctx.lineWidth = band.width + 1.2;
      ctx.stroke(band.path);
    }
    ctx.strokeStyle = rgba(RIVER, 0.68);
    for (const band of this.riverBands) {
      ctx.lineWidth = band.width * 1.1;
      ctx.stroke(band.path);
    }
    ctx.strokeStyle = 'rgba(154, 180, 190, 0.42)';
    for (const band of this.riverBands) {
      ctx.lineWidth = Math.max(0.35, band.width * 0.32);
      ctx.stroke(band.path);
    }
    ctx.restore();
  }

  drawRoutes() {
    if (!this.showRoutes || !this.routeBands?.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([2.5, 6]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = rgba(INK, 0.26);
    for (const band of this.routeBands) {
      ctx.lineWidth = band.width;
      ctx.stroke(band.path);
    }
    ctx.restore();
  }

  drawRoads() {
    if (!this.showRoads || !this.roadBands?.length) return;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // A pale casing first, so roads cut through the wilderness marks instead
    // of colliding with them.
    ctx.strokeStyle = 'rgba(240, 229, 202, 0.66)';
    for (const band of this.roadBands) {
      ctx.lineWidth = band.width + 2.8;
      ctx.stroke(band.path);
    }
    ctx.strokeStyle = 'rgba(74, 56, 34, 0.58)';
    for (const band of this.roadBands) {
      ctx.lineWidth = band.width;
      ctx.stroke(band.path);
    }
    ctx.restore();
  }

  drawPlaces() {
    const { ctx } = this;
    for (const place of this.places) {
      const dim = this.hidden.has(place.folder);
      const collected = this.selection.has(place.index);
      const selected = this.focus === place.index;
      const hovered = this.hover === place.index;
      const ink = collected ? RUBRIC : INK;
      const alpha = dim ? 0.18 : 1;

      ctx.save();
      ctx.globalAlpha = alpha;

      if (selected || hovered) {
        ctx.beginPath();
        ctx.arc(place.x, place.y, place.r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(RUBRIC, selected ? 0.9 : 0.45);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      if (place.stipple) {
        // A 240-note folder is a field, not a wall of badges: solid ink dots
        // read as stipple, and the old white discs stopped swallowing the land.
        // In a large-vault overview the stipple is lighter still, so five
        // towns do not merge into five black pills.
        ctx.beginPath();
        ctx.arc(
          place.x,
          place.y,
          Math.max(0.7, place.r * (place.folderCount > 240 ? 0.5 : 0.55) * (this.overview ? 0.8 : 1)),
          0,
          Math.PI * 2,
        );
        ctx.fillStyle = rgba(
          ink,
          this.overview ? (place.folderCount > 240 ? 0.2 : 0.24)
            : (place.folderCount > 240 ? 0.34 : 0.4),
        );
        ctx.fill();
        ctx.restore();
        continue;
      }

      ctx.beginPath();
      ctx.arc(place.x, place.y, place.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(247, 238, 216, 0.92)';
      ctx.fill();
      ctx.strokeStyle = rgba(ink, 0.92);
      ctx.lineWidth = 1.15;
      ctx.stroke();

      if (place.r > 4.6) {
        ctx.strokeStyle = rgba(ink, 0.8);
        ctx.lineWidth = 1;
        for (let k = 0; k < 4; k++) {
          const angle = (Math.PI / 4) * (k * 2 + 1);
          ctx.beginPath();
          ctx.moveTo(
            place.x + Math.cos(angle) * place.r,
            place.y + Math.sin(angle) * place.r,
          );
          ctx.lineTo(
            place.x + Math.cos(angle) * (place.r + 2.6),
            place.y + Math.sin(angle) * (place.r + 2.6),
          );
          ctx.stroke();
        }
      }

      if (collected) {
        ctx.beginPath();
        ctx.arc(place.x, place.y, Math.max(1.4, place.r * 0.34), 0, Math.PI * 2);
        ctx.fillStyle = rgba(RUBRIC, 0.9);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawPlaceLabels() {
    const { ctx } = this;
    const placed = [];
    const scale = this.scale();
    // Country names first: they anchor the map. Big countries win a collision
    // with a small neighbour, or a 40-country map becomes a word cloud.
    const named = [...this.countries]
      .sort((a, b) => b.count - a.count)
      .slice(0, this.overview ? 26 : this.countries.length);
    for (const country of named) {
      if (!country.polygon.length || !country.label) continue;
      const [x, y] = this.toScreen(country.label.x, country.label.y);
      const text = country.name.toUpperCase();
      const size = clamp(10 + scale * 6, 10, 20);
      ctx.save();
      ctx.font = `600 ${size}px ${SERIF}`;
      ctx.letterSpacing = '1.5px';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const width = ctx.measureText(text).width;
      const box = { x: x - width / 2 - 4, y: y - size, w: width + 8, h: size * 2 };
      if (placed.some((other) => overlaps(box, other))) {
        ctx.restore();
        continue;
      }
      ctx.globalAlpha = this.hidden.has(country.name) ? 0.3 : 0.78;
      this.inkedText(text, x, y);
      ctx.restore();
      placed.push(box);
    }

    const candidates = this.places
      .filter((place) => !this.hidden.has(place.folder))
      .filter((place) => place.index === this.focus || place.index === this.hover || place.degree >= 4)
      .sort((a, b) => b.pagerank - a.pagerank)
      .slice(0, this.overview ? 8 : 22);

    ctx.save();
    ctx.font = `12px ${SERIF}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const place of candidates) {
      const [x, y] = this.toScreen(place.x, place.y);
      const width = ctx.measureText(place.title).width;
      const box = { x: x - width / 2 - 3, y: y + 8, w: width + 6, h: 16 };
      if (placed.some((other) => overlaps(box, other))) continue;
      placed.push(box);
      ctx.globalAlpha = 0.9;
      this.inkedText(place.title, x, y + 9);
    }
    ctx.restore();
  }

  /** Paper-coloured halo, then ink: keeps labels legible over hatching. */
  inkedText(text, x, y) {
    const { ctx } = this;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(247, 238, 216, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = rgba(INK, 0.92);
    ctx.fillText(text, x, y);
  }

  drawFrame() {
    const { ctx, width, height } = this;
    const inset = 12;
    ctx.save();
    ctx.strokeStyle = rgba(INK, 0.34);
    ctx.lineWidth = 1;
    ctx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    ctx.strokeStyle = rgba(INK, 0.5);
    ctx.lineWidth = 2;
    ctx.strokeRect(inset + 5, inset + 5, width - (inset + 5) * 2, height - (inset + 5) * 2);
    ctx.restore();
  }

  drawCartouche() {
    const { ctx, width } = this;
    const graph = this.graph;
    if (!graph) return;
    const title = graph.meta.title || 'Vault';
    const span = this.dateSpan();
    const lines = [
      `${graph.meta.note_count} notes · ${graph.meta.link_count} links · ${this.countries.length} countries`,
    ];
    if (span) lines.push(span);

    ctx.save();
    ctx.font = `italic 400 26px ${SERIF}`;
    const titleWidth = ctx.measureText(title).width;
    ctx.font = `11px ${MONO}`;
    const detailWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const boxWidth = clamp(Math.max(titleWidth, detailWidth) + 34, 230, Math.min(420, width - 90));
    const boxHeight = 74 + (lines.length - 1) * 16;
    const x = 30;
    const y = 30;

    ctx.fillStyle = 'rgba(247, 238, 216, 0.82)';
    ctx.fillRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = rgba(INK, 0.45);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, boxWidth, boxHeight);
    ctx.strokeStyle = rgba(INK, 0.28);
    ctx.strokeRect(x + 4, y + 4, boxWidth - 8, boxHeight - 8);

    ctx.textAlign = 'left';
    ctx.fillStyle = rgba(INK, 0.94);
    ctx.font = `italic 400 26px ${SERIF}`;
    ctx.fillText(title, x + 16, y + 36);
    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = rgba(INK, 0.66);
    lines.forEach((line, index) => {
      ctx.fillText(line, x + 16, y + 56 + index * 15);
    });
    ctx.restore();
  }

  dateSpan() {
    const dates = (this.graph?.nodes || [])
      .map((node) => node.created)
      .filter((value) => typeof value === 'string' && value.length >= 4)
      .sort();
    if (!dates.length) return null;
    const first = dates[0].slice(0, 4);
    const last = dates[dates.length - 1].slice(0, 4);
    return first === last ? `Chronicle ${first}` : `Chronicle ${first}–${last}`;
  }

  drawCompass() {
    const { ctx, width, height } = this;
    const cx = width - 72;
    const cy = height - 78;
    const radius = 34;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = rgba(INK, 0.5);
    ctx.fillStyle = rgba(INK, 0.72);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, radius + 4, 0, Math.PI * 2);
    ctx.stroke();
    for (let point = 0; point < 8; point++) {
      const angle = (Math.PI / 4) * point;
      const length = point % 2 === 0 ? radius : radius * 0.55;
      const spread = 0.11;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle - spread) * length, Math.sin(angle - spread) * length);
      ctx.lineTo(Math.cos(angle) * (length + 6), Math.sin(angle) * (length + 6));
      ctx.lineTo(Math.cos(angle + spread) * length, Math.sin(angle + spread) * length);
      ctx.closePath();
      ctx.fillStyle = point % 2 === 0 ? rgba(INK, 0.78) : rgba(INK, 0.4);
      ctx.fill();
    }
    ctx.fillStyle = rgba(247, 238, 216, 0.95);
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(INK, 0.6);
    ctx.stroke();
    ctx.restore();
  }

  drawScale() {
    const { ctx, height } = this;
    const x = 34;
    const y = height - 40;
    ctx.save();
    ctx.strokeStyle = rgba(INK, 0.55);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 96, y);
    ctx.stroke();
    for (let tick = 0; tick <= 4; tick++) {
      ctx.beginPath();
      ctx.moveTo(x + tick * 24, y - (tick % 2 === 0 ? 5 : 3));
      ctx.lineTo(x + tick * 24, y + (tick % 2 === 0 ? 5 : 3));
      ctx.stroke();
    }
    ctx.fillStyle = rgba(INK, 0.6);
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'left';
    ctx.fillText('ten leagues', x, y - 10);
    ctx.restore();
  }
}

/** The emptiest well-inside spot in a country: label there, not on the seed,
 *  because Voronoi seeds bunch near the middle of the map while land spreads. */
function labelPoint(country) {
  const { polygon, places } = country;
  if (!polygon.length) return { x: 0, y: 0 };
  const centre = centroid(polygon);
  const reach = Math.max(26, edgeDistance(centre[0], centre[1], polygon) * 0.74);
  let best = { x: centre[0], y: centre[1], score: -Infinity };
  for (let step = 0; step < 24; step += 1) {
    const angle = step * GOLDEN;
    const radius = reach * Math.sqrt((step + 0.6) / 24);
    const x = centre[0] + Math.cos(angle) * radius;
    const y = centre[1] + Math.sin(angle) * radius;
    if (edgeDistance(x, y, polygon) < 20) continue;
    let clearance = 90;
    for (const place of places) {
      clearance = Math.min(clearance, Math.hypot(place.x - x, place.y - y));
    }
    if (clearance > best.score) best = { x, y, score: clearance };
  }
  return best;
}

function edgeDistance(px, py, polygon) {
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    best = Math.min(best, segmentDistance(px, py, a[0], a[1], b[0], b[1]));
  }
  return best;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function overlaps(a, b) {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}
