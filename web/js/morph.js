// Universe -> brain mapping.
//
// Each folder becomes a region on one of two hemispheres; nodes are projected
// onto a folded ellipsoid surface so the vault reads as a brain. Very large
// folders (the journal ring) become a memory belt orbiting the brain.

import { clamp } from './math.js';

const LOBE_CENTER_X = 0.44;
const RADII = [0.32, 0.5, 0.56];
const BELT_RADIUS = 0.74;
const BELT_TILT = 0.12;

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
  const sinTilt = Math.sin(BELT_TILT);
  const cosTilt = Math.cos(BELT_TILT);

  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const folder = folderIndex.get(node.folder) ?? 0;
    const count = counts.get(node.folder) || 0;

    if (count > 48) {
      // Memory belt: keeps chronology readable after the fold.
      const angle = Math.atan2(node.z, node.x);
      const x = Math.cos(angle) * BELT_RADIUS;
      const z = Math.sin(angle) * BELT_RADIUS;
      const y = -0.04 + Math.sin(angle * 3 + 0.6) * 0.03;
      brain[index * 3] = x;
      brain[index * 3 + 1] = y * cosTilt - z * sinTilt;
      brain[index * 3 + 2] = z * cosTilt + y * sinTilt;
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

    const target = [
      anchor[0] + rx * 0.16,
      anchor[1] + ry * 0.16,
      anchor[2] + rz * 0.16,
    ];
    let dx = (target[0] - center[0]) / RADII[0];
    let dy = (target[1] - center[1]) / RADII[1];
    let dz = (target[2] - center[2]) / RADII[2];
    const units = Math.hypot(dx, dy, dz) || 1;
    dx /= units;
    dy /= units;
    dz /= units;

    // Gyri: small folds so the surface is not a perfect ellipsoid.
    const fold = 1 + 0.05 * Math.sin(dx * 11 + dz * 7) + 0.03 * Math.sin(dy * 13 + dx * 4);
    // Thick shell, not a hollow surface: the lobes need volume to read as a
    // brain rather than two wire hoops.
    const seeded = 0.72 + 0.28 * pseudoRandom(index);

    brain[index * 3] = center[0] + dx * RADII[0] * fold * seeded;
    brain[index * 3 + 1] = clamp(center[1] + dy * RADII[1] * fold * seeded, -0.46, 0.6);
    brain[index * 3 + 2] = center[2] + dz * RADII[2] * fold * seeded;
  }
  return { positions: brain, anchors };
}

export function buildAppearValues(nodes) {
  const appear = new Float32Array(nodes.length);
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
  if (!Number.isFinite(min) || max <= min) {
    appear.fill(1);
    return appear;
  }
  days.forEach((day, index) => {
    appear[index] = day === null ? 1 : clamp((day - min) / (max - min), 0, 1);
  });
  return appear;
}

function pseudoRandom(index) {
  const value = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}
