// Scale rules shared by every view.
//
// A vault with a few thousand notes is not drawn like a 300-note one: the
// graph becomes a folder-level overview, the brain stops treating every big
// topic as a diary, and the atlas keeps its decoration down. These functions
// are deterministic and depend only on the graph payload.

export const OVERVIEW_NOTES = 1200;

export function isOverview(count) {
  return count >= OVERVIEW_NOTES;
}

/**
 * Folders that are diaries, not topics: large, spread over at least half a
 * year, and written at least every few days. The theme folders in a giant
 * demo are large too, but their dates are scattered, so they stay topics and
 * keep their halo, label and place on the brain.
 */
export function diaryFolders(nodes) {
  const byFolder = new Map();
  for (const node of nodes) {
    const value = Date.parse(`${node.created}T00:00:00Z`);
    if (!Number.isFinite(value)) continue;
    const day = Math.floor(value / 86400000);
    const days = byFolder.get(node.folder);
    if (days) days.push(day);
    else byFolder.set(node.folder, [day]);
  }

  const diaries = new Set();
  for (const [folder, raw] of byFolder) {
    if (raw.length < 48) continue;
    raw.sort((a, b) => a - b);
    const days = [];
    for (const day of raw) {
      if (days[days.length - 1] !== day) days.push(day);
    }
    if (days.length < 48) continue;
    if (days[days.length - 1] - days[0] < 180) continue;
    const gaps = [];
    for (let index = 1; index < days.length; index += 1) {
      gaps.push(days[index] - days[index - 1]);
    }
    gaps.sort((a, b) => a - b);
    if (gaps[Math.floor(gaps.length / 2)] <= 3) diaries.add(folder);
  }
  return diaries;
}
