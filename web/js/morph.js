// Universe -> brain mapping.
//
// Each folder becomes a region on one of two hemispheres; notes are spread
// through the lobe's volume rather than pinned to its surface, so the links
// between them read as fibre tracts. Diary folders become a diffuse core
// inside both hemispheres: chronology, without the wire halo the old orbiting
// belt produced. A large topic folder is not a diary and keeps its lobe.

import { clamp } from './math.js';

const LOBE_CENTER_X = 0.26;
const RADII = [0.27, 0.44, 0.6];
const CORE_TILT = 0.12;

/// Returns `{ positions, anchors }`; anchors are per-folder surface points so
/// the UI can label each region of the brain.
/// When `options.surfaceOnly` is true ("notes make up the brain" mode), notes
/// are sculpted onto the outer cortical gyri and anatomical mesh envelope so
/// the stars and fibre tracts themselves form the 3D brain without the shell.
export function buildBrainPositions(nodes, folderNames, diaries = new Set(), options = {}) {
  const surfaceOnly = Boolean(options.surfaceOnly);
  const meshPositions = options.meshPositions || null;
  const anchors = new Map();
  const folderIndex = new Map(folderNames.map((name, index) => [name, index]));
  const sums = new Map();
  const counts = new Map();

  // Pre-partition the real 3D cortical mesh vertices by hemisphere (left / right)
  // so `surfaceOnly` mode can snap notes directly onto the anatomical brain surface.
  const leftVerts = [];
  const rightVerts = [];
  if (surfaceOnly && meshPositions && meshPositions.length >= 9) {
    for (let i = 0; i < meshPositions.length; i += 3) {
      const vx = meshPositions[i];
      const vy = meshPositions[i + 1];
      const vz = meshPositions[i + 2];
      if (vx < -0.015) leftVerts.push(vx, vy, vz);
      else if (vx > 0.015) rightVerts.push(vx, vy, vz);
    }
  }

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

    if (diaries.has(node.folder) && !surfaceOnly) {
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

    // Spread notes through a cone around the folder ray so the lobe has tissue.
    const spreadScale = surfaceOnly ? 1.22 : 1.0;
    const lateral = (0.26 + 0.34 * pseudoRandom(index + 37))
      * Math.sqrt(pseudoRandom(index + 101))
      * spreadScale;
    const around = pseudoRandom(index + 203) * Math.PI * 2;
    const up = Math.abs(direction[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    let sideA = [
      direction[1] * up[2] - direction[2] * up[1],
      direction[2] * up[0] - direction[0] * up[2],
      direction[0] * up[1] - direction[1] * up[0],
    ];
    const sideLength = Math.hypot(sideA[0], sideA[1], sideA[2]) || 1;
    sideA = sideA.map((value) => value / sideLength);
    const sideB = [
      direction[1] * sideA[2] - direction[2] * sideA[1],
      direction[2] * sideA[0] - direction[0] * sideA[2],
      direction[0] * sideA[1] - direction[1] * sideA[0],
    ];
    let dx = direction[0]
      + sideA[0] * Math.cos(around) * lateral
      + sideB[0] * Math.sin(around) * lateral
      + rx * 0.08;
    let dy = direction[1]
      + sideA[1] * Math.cos(around) * lateral
      + sideB[1] * Math.sin(around) * lateral
      + ry * 0.08;
    let dz = direction[2]
      + sideA[2] * Math.cos(around) * lateral
      + sideB[2] * Math.sin(around) * lateral
      + rz * 0.08;
    const units = Math.hypot(dx, dy, dz) || 1;
    dx /= units;
    dy /= units;
    dz /= units;

    // Gyri: small folds so the outer notes trace cortical ridges.
    const foldAmp = surfaceOnly ? 1.55 : 1.0;
    const fold = 1
      + 0.05 * foldAmp * Math.sin(dx * 11 + dz * 7)
      + 0.03 * foldAmp * Math.sin(dy * 13 + dx * 4);
    const seeded = surfaceOnly
      ? (0.80 + 0.20 * Math.pow(pseudoRandom(index), 0.42))
      : (0.16 + 0.82 * Math.cbrt(pseudoRandom(index)));

    let px = center[0] + dx * RADII[0] * fold * seeded;
    let py = clamp(center[1] + dy * RADII[1] * fold * seeded, -0.44, 0.54);
    let pz = center[2] + dz * RADII[2] * fold * seeded;

    const hemiVerts = side < 0 ? leftVerts : rightVerts;
    if (surfaceOnly && hemiVerts.length >= 3) {
      let bestX = px;
      let bestY = py;
      let bestZ = pz;
      let bestD2 = Infinity;
      for (let v = 0; v < hemiVerts.length; v += 3) {
        const vx = hemiVerts[v];
        const vy = hemiVerts[v + 1];
        const vz = hemiVerts[v + 2];
        const d2 = (vx - px) ** 2 + (vy - py) ** 2 + (vz - pz) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestX = vx;
          bestY = vy;
          bestZ = vz;
        }
      }
      const depth = 0.94 + 0.08 * pseudoRandom(index + 509);
      const jx = (pseudoRandom(index + 613) - 0.5) * 0.032;
      const jy = (pseudoRandom(index + 719) - 0.5) * 0.032;
      const jz = (pseudoRandom(index + 827) - 0.5) * 0.032;
      px = bestX * depth + jx;
      py = bestY * depth + jy;
      pz = bestZ * depth + jz;
    }

    brain[index * 3] = px;
    brain[index * 3 + 1] = py;
    brain[index * 3 + 2] = pz;
  }

  for (const name of folderNames) {
    if (!anchors.has(name)) anchors.set(name, [0, 0.56, 0]);
  }

  const pullIn = surfaceOnly ? 0.96 : 0.86;
  for (let index = 0; index < brain.length; index += 1) {
    brain[index] *= pullIn;
    if (index % 3 === 1) brain[index] = clamp(brain[index], surfaceOnly ? -0.36 : -0.32, surfaceOnly ? 0.46 : 0.42);
  }

  for (const anchor of anchors.values()) {
    anchor[0] *= pullIn;
    anchor[1] = clamp(anchor[1] * pullIn, -0.34, 0.44);
    anchor[2] *= pullIn;
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
    // visible in every view instead of never arriving. Cap at 0.90 so
    // smoothstep(appear, appear + 0.05, 1.0) reaches 1.0 for every note on the
    // newest date (rule: every note must survive the reveal animation).
    const order = count > 1 ? (index / (count - 1)) * 0.04 : 0;
    appear[index] = day === null
      ? order
      : clamp(((day - min) / (max - min)) * 0.86 + order, 0, 0.9);
  });
  return appear;
}

function pseudoRandom(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
