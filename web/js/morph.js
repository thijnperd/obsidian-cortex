// Universe -> brain mapping.
//
// Each folder becomes a region on one of two hemispheres; notes are spread
// through the lobe's volume rather than pinned to its surface, so the links
// between them read as fibre tracts. Very large folders (the journal) become a
// diffuse core inside both hemispheres: chronology, without the wire halo the
// old orbiting belt produced.

import { clamp } from './math.js';

const LOBE_CENTER_X = 0.26;
const RADII = [0.27, 0.44, 0.6];
const CORE_TILT = 0.12;

/// Returns `{ positions, anchors }`; anchors are per-folder surface points so
/// the UI can label each region of the brain.
export function buildBrainPositions(nodes, folderNames) {
  const anchors = new Map();
  const folderIndex = new Map(folderNames.map((name, index) => [name, index]));
  const sums = new Map();
  const counts = new Map();

  for (const node of nodes) {
    const entry = sums.get(node.folder) || [0, 0, 0];
    entry[0] += node.x;
    entry[1] += node.y;
    entry[2] += node.z;
    sums.set(node.folder, entry);
    counts.set(node.folder, (counts.get(node.folder) || 0) + 1);
  }

  const centroids = new Map();
  for (const [folder, sum] of sums) {
    const count = counts.get(folder) || 1;
    centroids.set(folder, [sum[0] / count, sum[1] / count, sum[2] / count]);
  }

  const total = Math.max(1, folderNames.length);
  const brain = new Float32Array(nodes.length * 3);
  const sinTilt = Math.sin(CORE_TILT);
  const cosTilt = Math.cos(CORE_TILT);

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const folder = folderIndex.get(node.folder) ?? 0;
    const count = counts.get(node.folder) || 0;

    if (count > 48) {
      // Diffuse core: a seeded spiral through the middle of both hemispheres.
      // It is inside the shell, so the chapter links cross the lobes instead of
      // drawing a ring around them.
      const angle = Math.atan2(node.z, node.x);
      const depth = 0.14 + 0.26 * pseudoRandom(index);
      const x = Math.cos(angle) * depth;
      const z = Math.sin(angle) * depth * 1.45;
      const y = (pseudoRandom(index + 811) * 2 - 1) * 0.32;
      brain[index * 3] = x;
      brain[index * 3 + 1] = y * cosTilt - z * sinTilt;
      brain[index * 3 + 2] = z * cosTilt + y * sinTilt;
      if (!anchors.has(node.folder)) anchors.set(node.folder, [0, 0.56, 0]);
      continue;
    }

    const side = folder % 2 === 0 ? -1 : 1;
    const lane = Math.floor(folder / 2);
    const lanes = Math.max(1, Math.ceil(total / 2));
    const polar = 0.55 + (lane / lanes) * 1.7;
    const azimuth = lane * 2.399963 + 0.4;
    const direction = [
      Math.cos(polar) * side,
      Math.sin(polar) * Math.cos(azimuth),
      Math.sin(polar) * Math.sin(azimuth),
    ];
    const center = [side * LOBE_CENTER_X, 0.02, 0];
    const anchor = [
      center[0] + direction[0] * RADII[0],
      center[1] + direction[1] * RADII[1],
      center[2] + direction[2] * RADII[2],
    ];

    if (!anchors.has(node.folder)) anchors.set(node.folder, anchor);
    const centroid = centroids.get(node.folder) || [0, 0, 0];
    let rx = node.x - centroid[0];
    let ry = node.y - centroid[1];
    let rz = node.z - centroid[2];
    const length = Math.hypot(rx, ry, rz) || 1;
    rx /= length;
    ry /= length;
    rz /= length;

    // Scatter inside the lobe: a thick volume of tissue, not a hollow shell.
    const spread = 0.16;
    let dx = (anchor[0] + rx * spread - center[0]) / RADII[0];
    let dy = (anchor[1] + ry * spread - center[1]) / RADII[1];
    let dz = (anchor[2] + rz * spread - center[2]) / RADII[2];
    const units = Math.hypot(dx, dy, dz) || 1;
    dx /= units;
    dy /= units;
    dz /= units;

    // Gyri: small folds so the outer notes are not a perfect ellipsoid.
    const fold = 1 + 0.05 * Math.sin(dx * 11 + dz * 7) + 0.03 * Math.sin(dy * 13 + dx * 4);
    const seeded = 0.62 + 0.38 * pseudoRandom(index);

    brain[index * 3] = center[0] + dx * RADII[0] * fold * seeded;
    brain[index * 3 + 1] = clamp(center[1] + dy * RADII[1] * fold * seeded, -0.44, 0.54);
    brain[index * 3 + 2] = center[2] + dz * RADII[2] * fold * seeded;
  }

  // White matter: a folder of its own never got a core point, so give it an
  // anchor the labels can follow instead of silently dropping it.
  for (const name of folderNames) {
    if (!anchors.has(name)) anchors.set(name, [0, 0.56, 0]);
  }

  // The cortical mesh is narrower than a smooth ellipsoid (temporal lobes,
  // frontal pole), so a few surface notes would float just outside it. Pull
  // the whole cloud in slightly: fibres stay visibly inside the shell.
  for (let index = 0; index < brain.length; index += 1) {
    brain[index] *= 0.86;
    // The mesh has no tissue under the temporal lobes: keep nodes above the
    // brainstem so nothing floats in the black below the brain.
    if (index % 3 === 1) brain[index] = clamp(brain[index], -0.32, 0.42);
  }

  return { positions: brain, anchors };
}

export function buildAppearValues(nodes) {
  const appear = new Float32Array(nodes.length);
  const count = nodes.length;
  if (count === 0) return appear;
  let min = Infinity;
  let max = -Infinity;
  const days = nodes.map((node) => {
    const value = Date.parse(`${node.created}T00:00:00Z`);
    return Number.isFinite(value) ? value / 86400000 : null;
  });
  for (const day of days) {
    if (day === null) continue;
    if (day < min) min = day;
    if (day > max) max = day;
  }
  // No usable chronology: a vault with no frontmatter dates, or one whose files
  // were all unpacked today, so every note carries the same date. Filling with 1
  // made `smoothstep(w, w + 0.05, reveal)` zero for every reveal <= 1, which
  // hid every star and every arc in all three 3D views. Spread the birth time
  // by index instead, so the reveal still cascades and everything is visible.
  if (!Number.isFinite(min) || max <= min) {
    const step = count > 1 ? 0.9 / (count - 1) : 0;
    for (let index = 0; index < count; index += 1) appear[index] = index * step;
    return appear;
  }
  days.forEach((day, index) => {
    // Undated notes are older than anything else: born at the start, so they are
    // visible in every view instead of never arriving.
    appear[index] = day === null ? 0 : clamp((day - min) / (max - min), 0, 1);
  });
  return appear;
}

function pseudoRandom(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
