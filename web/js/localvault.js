// Local vaults: read Markdown from the device and build the same payload the
// Rust server serves, so the whole UI (graph, brain, atlas, bento, decisions,
// notes, search, links) works in the browser with no server behind it.

const DB_NAME = 'cortex.localvault';
const STORE = 'vault';
const RECORD_KEY = 'current';
const MAX_FILES = 5000;
const MAX_BYTES = 48 * 1024 * 1024;
const PALETTE_SIZE = 8;
const INBOX = 'Inbox';
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const TARGET_RADIUS = 1.0;

const MARKDOWN = /\.(md|markdown|mdown|txt)$/i;

/** Caps enforced before any file is read; exported so tests assert the real values. */
export const LIMITS = Object.freeze({ files: MAX_FILES, bytes: MAX_BYTES });

// ---------------------------------------------------------------- storage

function openDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser cannot store a vault on the device.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local storage.'));
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error || new Error('Local storage failed.'));
      tx.onabort = () => reject(tx.error || new Error('Local storage was aborted.'));
    });
  } finally {
    db.close();
  }
}

export async function forgetLocalVault() {
  try {
    await withStore('readwrite', (store) => store.delete(RECORD_KEY));
  } catch {
    /* nothing stored */
  }
}

async function readRecord() {
  try {
    return (await withStore('readonly', (store) => store.get(RECORD_KEY))) || null;
  } catch {
    return null;
  }
}

async function writeRecord(record) {
  try {
    await withStore('readwrite', (store) => store.put(record, RECORD_KEY));
    return true;
  } catch {
    return false;
  }
}

/** True when a vault from this device is stored and restorable. */
export async function hasLocalVault() {
  const record = await readRecord();
  return Boolean(record && Array.isArray(record.files) && record.files.length);
}

/** Updates one note in IndexedDB so edits survive reloads on device vaults. */
export async function updateLocalNote(id, rawContent) {
  const record = await readRecord();
  if (!record || !Array.isArray(record.files)) return false;
  const key = String(id || '').toLowerCase();
  const slot = record.files.findIndex((file) => {
    const fileId = normalisePath(file.path).replace(MARKDOWN, '').toLowerCase();
    return fileId === key;
  });
  if (slot === -1) return false;
  const existing = record.files[slot];
  const parsed = parseMarkdownEntry(rawContent, existing.path, {
    lastModified: Date.now(),
    size: typeof rawContent === 'string' ? rawContent.length : existing.size,
  });
  record.files[slot] = {
    path: existing.path,
    raw: parsed.raw,
    text: parsed.body,
    size: parsed.size,
    title: parsed.title,
    created: parsed.created || existing.created,
    tags: parsed.tags,
    aliases: parsed.aliases,
    kind: parsed.kind,
    status: parsed.status,
    confidence: parsed.confidence,
    review_on: parsed.review_on,
    supersedes: parsed.supersedes,
  };
  record.savedAt = Date.now();
  return writeRecord(record);
}

// ---------------------------------------------------------------- parsing

function splitFrontmatter(text) {
  const normalised = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalised.startsWith('---\n')) return { frontmatter: '', body: normalised };
  const end = normalised.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: '', body: normalised };
  let close = end + 4;
  if (normalised[close] === '\n') close += 1;
  return { frontmatter: normalised.slice(4, end), body: normalised.slice(close) };
}

function unquoteScalar(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '').trim();
}

function frontmatterValue(frontmatter, key) {
  // [ \t], not \s: a trailing \s would swallow the newline after `tags:` and
  // make the block list below look like an inline value.
  const match = frontmatter.match(new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`, 'im'));
  return match ? unquoteScalar(match[1]) : '';
}

function frontmatterList(frontmatter, key) {
  const match = frontmatter.match(new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`, 'im'));
  const raw = match ? match[1].trim() : '';
  if (!raw) {
    // block list: tags:\n  - one\n  - two
    const block = frontmatter.match(
      new RegExp(`^${key}[ \\t]*:[ \\t]*\\n((?:[ \\t]*-[ \\t]*.*(?:\\n|$))+)`, 'im'),
    );
    if (!block) return [];
    return block[1]
      .split('\n')
      .map((line) => unquoteScalar(line.replace(/^[ \t]*-[ \t]*/, '')))
      .filter(Boolean);
  }
  const unwrapped = raw.replace(/^\[(.*)\]$/, '$1');
  return unwrapped
    .split(',')
    .map((item) => unquoteScalar(item))
    .filter(Boolean);
}

function cleanTag(tag) {
  return String(tag || '')
    .trim()
    .replace(/^#/, '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function titleOf(body, fallback) {
  const heading = body.match(/^\s{0,3}#\s+(.+)$/m);
  return heading ? heading[1].trim() : fallback;
}

function excerptOf(body) {
  const plain = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 160 ? `${plain.slice(0, 157).trimEnd()}…` : plain;
}

/** Wikilinks outside fenced code and inline backticks, handling escaped pipes. */
function linksOf(body) {
  const out = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const strippedLine = line.replace(/`[^`]*`/g, ' ');
    for (const match of strippedLine.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
      const beforePipe = match[1].split('|')[0].replace(/\\+$/, '');
      const target = beforePipe.split(/[#\^]/)[0].trim();
      if (target) out.push(target);
    }
  }
  return out;
}

function inlineTags(body) {
  const out = new Set();
  let fenced = false;
  for (const line of body.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fenced = !fenced;
      continue;
    }
    if (fenced || trimmed.startsWith('#')) continue;
    for (const match of line.matchAll(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}/_-]*)/gu)) {
      out.add(match[2]);
    }
  }
  return [...out];
}

function isoDate(value, fallback) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  if (fallback === null || fallback === undefined) return '';
  const date = new Date(fallback);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function parseConfidence(raw) {
  if (!raw) return null;
  const num = Number.parseFloat(String(raw).replace('%', '').trim());
  if (!Number.isFinite(num) || num < 0) return null;
  const pct = num <= 1 ? Math.round(num * 100) : Math.round(num);
  return Math.max(0, Math.min(100, pct));
}

function daysEpoch(iso) {
  if (!iso) return 0;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 86_400_000) : 0;
}

function normalisePath(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function isIgnored(path) {
  return path
    .split('/')
    .some((segment) => segment.startsWith('.') || segment === 'node_modules' || segment === '__MACOSX');
}

function folderOf(id) {
  const cut = id.indexOf('/');
  return cut === -1 ? INBOX : id.slice(0, cut);
}

/**
 * Strips shared enclosing folder wrapper(s) when the user picks a vault directory
 * via `<input webkitdirectory>` or drag-and-drop, so subfolders become real
 * vault regions rather than collapsing the whole vault into one root folder.
 */
function stripCommonRoot(records) {
  if (!records.length) return { entries: records, label: null };
  let working = records.map((item) => ({ ...item }));
  let strippedLabel = null;
  const allFromPicker = working.every((item) => item.fromPicker && item.path.includes('/'));

  while (working.every((item) => item.path.includes('/'))) {
    const first = working[0].path.slice(0, working[0].path.indexOf('/'));
    if (!first || !working.every((item) => item.path.startsWith(`${first}/`))) {
      break;
    }
    const prefixLen = first.length + 1;
    const hasNestedSubfolders = working.some((item) => item.path.slice(prefixLen).includes('/'));
    if (hasNestedSubfolders) {
      strippedLabel = first;
      working = working.map((item) => ({ ...item, path: item.path.slice(prefixLen) }));
      continue;
    }
    if (allFromPicker) {
      strippedLabel = first;
      working = working.map((item) => ({ ...item, path: item.path.slice(prefixLen) }));
    }
    break;
  }

  return { entries: working, label: strippedLabel };
}

function parseMarkdownEntry(rawText, path, { lastModified, size } = {}) {
  const raw = String(rawText || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const { frontmatter, body } = splitFrontmatter(raw);
  const id = path.replace(MARKDOWN, '');
  const name = path.split('/').pop().replace(MARKDOWN, '');
  const tags = [...frontmatterList(frontmatter, 'tags'), ...inlineTags(body)]
    .map(cleanTag)
    .filter(Boolean);
  const aliases = [
    ...frontmatterList(frontmatter, 'aliases'),
    ...frontmatterList(frontmatter, 'alias'),
  ].filter(Boolean);
  const title = frontmatterValue(frontmatter, 'title') || titleOf(body, name);
  const kindRaw = frontmatterValue(frontmatter, 'type').toLowerCase();
  const kind = kindRaw === 'research' || kindRaw === 'idea' ? kindRaw : null;
  const statusRaw = frontmatterValue(frontmatter, 'status').toLowerCase();
  const status = kind ? (statusRaw || (kind === 'idea' ? 'refining' : 'open')) : null;
  const confidence = parseConfidence(frontmatterValue(frontmatter, 'confidence'));
  const review_on = isoDate(frontmatterValue(frontmatter, 'review_on'), null) || null;
  const supersedes = frontmatterValue(frontmatter, 'supersedes') || null;
  const created = isoDate(
    frontmatterValue(frontmatter, 'created') || frontmatterValue(frontmatter, 'date'),
    lastModified ?? Date.now(),
  );

  return {
    id,
    path,
    title,
    folder: folderOf(id),
    tags: [...new Set(tags)].slice(0, 12),
    aliases: [...new Set(aliases)],
    created,
    createdDays: daysEpoch(created),
    raw,
    body,
    size: size ?? raw.length,
    kind,
    status,
    confidence,
    review_on,
    supersedes,
  };
}

// ---------------------------------------------------------------- grouping & layout

/**
 * When a vault has all notes in a single flat folder (4+ notes), derive
 * virtual visual regions from primary #tags or link components so Graph,
 * Brain, Atlas and Bento still reveal real structure.
 */
function assignRegions(entries, edges) {
  if (entries.length < 4) return;
  const existingFolders = new Set(entries.map((entry) => entry.folder));
  if (existingFolders.size > 1) return;

  // 1. Primary #tag clustering
  const primaryTags = entries.map((entry) => entry.tags[0] || '');
  const tagSet = new Set(primaryTags.filter(Boolean));
  const taggedCount = primaryTags.filter(Boolean).length;
  if (tagSet.size >= 2 && taggedCount >= 2) {
    entries.forEach((entry, index) => {
      entry.folder = primaryTags[index] ? `#${primaryTags[index]}` : 'Untagged';
    });
    return;
  }

  // 2. Link-component clustering (only if edges split notes into >= 2 groups)
  if (!edges.length) return;
  const parent = entries.map((_, i) => i);
  const degree = new Array(entries.length).fill(0);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const edge of edges) {
    degree[edge.source] += 1;
    degree[edge.target] += 1;
    const ra = find(edge.source);
    const rb = find(edge.target);
    if (ra !== rb) parent[rb] = ra;
  }

  const components = new Map();
  for (let i = 0; i < entries.length; i += 1) {
    const root = find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(i);
  }

  const multiComponents = [...components.values()].filter((list) => list.length >= 2);
  if (multiComponents.length < 2) return;

  const usedNames = new Set();
  for (const list of multiComponents) {
    let hubIdx = list[0];
    for (const idx of list) {
      if (degree[idx] > degree[hubIdx]) hubIdx = idx;
    }
    let name = entries[hubIdx].title || 'Cluster';
    if (usedNames.has(name)) {
      let suffix = 2;
      while (usedNames.has(`${name} (${suffix})`)) suffix += 1;
      name = `${name} (${suffix})`;
    }
    usedNames.add(name);
    for (const idx of list) {
      entries[idx].folder = name;
    }
  }
  for (const list of components.values()) {
    if (list.length < 2) {
      entries[list[0]].folder = 'Loose notes';
    }
  }
}

function hash32(value) {
  let h = (value ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function unitVec(seed) {
  const u = (hash32(seed) / 4294967296) * 2 - 1;
  const theta = (hash32(seed + 1013) / 4294967296) * Math.PI * 2;
  const r = Math.sqrt(Math.max(0, 1 - u * u));
  return [r * Math.cos(theta), u, r * Math.sin(theta)];
}

function galaxyCenter(group, total) {
  if (total <= 1) return [0, 0, 0];
  const y = 1 - ((group + 0.5) / total) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = GOLDEN * group;
  const orbit = total <= 12 ? 0.62 : 0.68;
  return [Math.cos(theta) * r * orbit, y * orbit, Math.sin(theta) * r * orbit];
}

function looksLikeJournal(indices, entries) {
  if (indices.length <= 48) return false;
  const days = [...new Set(indices.map((i) => entries[i].createdDays).filter(Boolean))].sort((a, b) => a - b);
  if (days.length < 48) return false;
  if (days[days.length - 1] - days[0] < 180) return false;
  const gaps = [];
  for (let i = 1; i < days.length; i += 1) gaps.push(days[i] - days[i - 1]);
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] <= 3;
}

/**
 * Deterministic unit-sphere layout matching `crates/core/src/layout.rs`, keeping
 * every note well inside the camera's [0.45..8.5] view frustum (target radius 1.0).
 */
function place(nodes, folders, edges, entries) {
  const count = nodes.length;
  if (count === 0) return;
  const groupCount = Math.max(1, folders.length);
  const members = Array.from({ length: groupCount }, () => []);
  const folderIndex = new Map(folders.map((folder, pos) => [folder.name, pos]));

  nodes.forEach((node, idx) => {
    const group = folderIndex.get(node.folder) ?? 0;
    members[group].push(idx);
  });

  const pos = Array.from({ length: count }, () => [0, 0, 0]);
  members.forEach((list, group) => {
    if (!list.length) return;
    if (looksLikeJournal(list, entries)) {
      const sorted = [...list].sort(
        (a, b) => entries[a].createdDays - entries[b].createdDays || a - b,
      );
      sorted.forEach((nodeIdx, slot) => {
        const t = sorted.length > 1 ? slot / (sorted.length - 1) : 0;
        const angle = t * Math.PI * 2 + group * 0.4;
        const radial = 0.88 + (hash32(nodeIdx * 31) / 4294967296 - 0.5) * 0.08;
        pos[nodeIdx] = [
          Math.cos(angle) * radial,
          Math.sin(angle * 2) * 0.14,
          Math.sin(angle) * radial,
        ];
      });
      return;
    }

    const center = galaxyCenter(group, groupCount);
    const localScale = groupCount === 1
      ? 0.72
      : (0.18 + 0.24 * Math.sqrt(list.length / 80)) * (groupCount > 12 ? 0.68 : 1);

    list.forEach((nodeIdx, slot) => {
      if (list.length === 1) {
        pos[nodeIdx] = [...center];
        return;
      }
      const dir = unitVec(nodeIdx * 7919 + group * 97 + slot);
      const dist = localScale * (0.35 + 0.65 * Math.cbrt((slot + 0.5) / list.length));
      pos[nodeIdx] = [
        center[0] + dir[0] * dist,
        center[1] + dir[1] * dist * 0.85,
        center[2] + dir[2] * dist,
      ];
    });
  });

  // Light deterministic attraction along links within galaxies so connected notes group gently.
  if (edges.length && count > 2) {
    const sameGroupEdges = edges.filter(
      (e) => (folderIndex.get(nodes[e.source].folder) ?? 0) === (folderIndex.get(nodes[e.target].folder) ?? 0),
    );
    for (let step = 0; step < 6; step += 1) {
      for (const edge of sameGroupEdges) {
        const a = pos[edge.source];
        const b = pos[edge.target];
        const dx = (b[0] - a[0]) * 0.08;
        const dy = (b[1] - a[1]) * 0.08;
        const dz = (b[2] - a[2]) * 0.08;
        a[0] += dx; a[1] += dy; a[2] += dz;
        b[0] -= dx; b[1] -= dy; b[2] -= dz;
      }
    }
  }

  // Normalise into a sphere of TARGET_RADIUS = 1.0 (centroid at origin when single group).
  let cx = 0; let cy = 0; let cz = 0;
  for (const p of pos) {
    cx += p[0]; cy += p[1]; cz += p[2];
  }
  cx /= count; cy /= count; cz /= count;
  let maxDist = 0;
  for (const p of pos) {
    p[0] -= cx; p[1] -= cy; p[2] -= cz;
    const d = Math.hypot(p[0], p[1], p[2]);
    if (d > maxDist) maxDist = d;
  }
  const scale = maxDist > 1e-6 ? TARGET_RADIUS / maxDist : 1;
  for (let i = 0; i < count; i += 1) {
    nodes[i].x = Number((pos[i][0] * scale).toFixed(4));
    nodes[i].y = Number((pos[i][1] * scale).toFixed(4));
    nodes[i].z = Number((pos[i][2] * scale).toFixed(4));
  }
}

function rank(count, edges) {
  if (!count) return [];
  const damping = 0.85;
  const out = new Array(count).fill(0);
  const incoming = Array.from({ length: count }, () => []);
  for (const edge of edges) {
    out[edge.source] += 1;
    incoming[edge.target].push(edge.source);
  }
  let scores = new Array(count).fill(1 / count);
  for (let step = 0; step < 24; step += 1) {
    const next = new Array(count).fill((1 - damping) / count);
    let dangling = 0;
    for (let i = 0; i < count; i += 1) {
      if (out[i] === 0) {
        dangling += scores[i];
        continue;
      }
      for (const from of incoming[i]) next[i] += (damping * scores[from]) / out[from];
    }
    if (dangling) {
      for (let i = 0; i < count; i += 1) next[i] += (damping * dangling) / count;
    }
    scores = next;
  }
  return scores;
}

function buildStructures(entries, resolveTarget) {
  const MAX_CARDS = 240;
  const MAX_EVIDENCE = 12;
  const cards = [];

  entries.forEach((entry, sourceIdx) => {
    if (!entry.kind) return;
    const seen = new Set();
    const missing = new Set();
    const evidence = [];
    let sources = 0;

    for (const rawTarget of linksOf(entry.body)) {
      const targetIdx = resolveTarget(rawTarget);
      if (targetIdx === undefined) {
        missing.add(rawTarget.toLowerCase());
        continue;
      }
      if (targetIdx === sourceIdx) continue;
      const target = entries[targetIdx];
      if (seen.has(target.id)) continue;
      seen.add(target.id);
      sources += 1;
      if (evidence.length < MAX_EVIDENCE) {
        evidence.push({ id: target.id, title: target.title, folder: target.folder });
      }
    }

    let supersedes = null;
    if (entry.supersedes) {
      const supIdx = resolveTarget(entry.supersedes);
      if (supIdx !== undefined && supIdx !== sourceIdx) {
        const sup = entries[supIdx];
        supersedes = { id: sup.id, title: sup.title, folder: sup.folder };
      }
    }

    cards.push({
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      status: entry.status || (entry.kind === 'idea' ? 'refining' : 'open'),
      folder: entry.folder,
      created: entry.created,
      confidence: entry.confidence ?? null,
      review_on: entry.review_on ?? null,
      supersedes,
      sources,
      missing: missing.size,
      evidence,
    });
  });

  const statusRank = (s) => (s === 'open' ? 0 : s === 'refining' ? 1 : 2);
  const total = cards.length;
  const open = cards.filter((c) => c.status === 'open' || c.status === 'refining').length;
  cards.sort((a, b) => (
    statusRank(a.status) - statusRank(b.status)
    || b.created.localeCompare(a.created)
    || a.title.toLowerCase().localeCompare(b.title.toLowerCase())
    || a.id.localeCompare(b.id)
  ));

  return { total, open, cards: cards.slice(0, MAX_CARDS) };
}

// ---------------------------------------------------------------- build

/**
 * Turns a FileList (folder picker or multi-select) into a Cortex graph and
 * stores it in IndexedDB so the next launch opens without asking again.
 */
export async function buildLocalVault(fileList, options = {}) {
  const files = [...(fileList || [])];
  const accepted = files.filter((file) => MARKDOWN.test(file.name) && file.size > 0);
  if (!accepted.length) throw new Error('No Markdown notes in that selection.');
  if (accepted.length > MAX_FILES) {
    throw new Error(`That is ${accepted.length} notes; this build caps a local vault at ${MAX_FILES}.`);
  }
  const total = accepted.reduce((sum, file) => sum + file.size, 0);
  if (total > MAX_BYTES) throw new Error('That selection is larger than 48 MB.');

  const sortedFiles = [...accepted].sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name),
  );
  const rawRecords = [];
  for (const file of sortedFiles) {
    const path = normalisePath(file.webkitRelativePath || file.name);
    if (isIgnored(path)) continue;
    const raw = await file.text();
    rawRecords.push({
      path,
      raw,
      size: file.size,
      lastModified: file.lastModified,
      fromPicker: Boolean(file.webkitRelativePath),
    });
  }
  if (!rawRecords.length) throw new Error('No Markdown notes in that selection.');

  const { entries: normalised, label: strippedLabel } = stripCommonRoot(rawRecords);
  const entries = normalised.map((rec) =>
    parseMarkdownEntry(rec.raw, rec.path, { lastModified: rec.lastModified, size: rec.size }),
  );

  const label =
    options.title
    || strippedLabel
    || entries.find((entry) => entry.path.includes('/'))?.path.split('/')[0]
    || 'On this device';

  const stored = entries.map((entry) => ({
    path: entry.path,
    raw: entry.raw,
    text: entry.body,
    size: entry.size,
    title: entry.title,
    created: entry.created,
    tags: entry.tags,
    aliases: entry.aliases,
    kind: entry.kind,
    status: entry.status,
    confidence: entry.confidence,
    review_on: entry.review_on,
    supersedes: entry.supersedes,
  }));
  const persisted = await writeRecord({ title: label, savedAt: Date.now(), files: stored });
  return graphFrom(entries, label, persisted);
}

function graphFrom(entries, label, persisted) {
  const index = new Map();
  const byTitle = new Map();
  entries.forEach((entry, position) => {
    index.set(entry.id.toLowerCase(), position);
    index.set(entry.path.replace(MARKDOWN, '').toLowerCase(), position);
    // [[2026-01-01]] is how people link a note in a dated subfolder.
    const stem = entry.id.split('/').pop().toLowerCase();
    if (!index.has(stem)) index.set(stem, position);
    const key = entry.title.toLowerCase();
    if (!byTitle.has(key)) byTitle.set(key, position);
    for (const alias of entry.aliases || []) {
      const aKey = alias.toLowerCase();
      if (!byTitle.has(aKey)) byTitle.set(aKey, position);
    }
  });

  const resolveTarget = (rawTarget) => {
    const clean = normalisePath(rawTarget).replace(MARKDOWN, '').split(/[#\^]/)[0].trim().toLowerCase();
    if (!clean) return undefined;
    const hit = byTitle.get(clean) ?? index.get(clean) ?? index.get(clean.split('/').pop());
    return hit;
  };

  const pairs = new Map();
  const resolvedOutIds = entries.map(() => new Set());
  entries.forEach((entry, source) => {
    for (const target of linksOf(entry.body)) {
      const hit = resolveTarget(target);
      if (hit === undefined || hit === source) continue;
      resolvedOutIds[source].add(entries[hit].id);
      const id = `${source}:${hit}`;
      pairs.set(id, (pairs.get(id) || 0) + 1);
    }
  });

  const edges = [...pairs.entries()].map(([id, weight]) => {
    const [source, target] = id.split(':').map(Number);
    return { source, target, weight };
  });

  assignRegions(entries, edges);

  const counts = new Map();
  for (const entry of entries) counts.set(entry.folder, (counts.get(entry.folder) || 0) + 1);
  const folders = [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, count], position) => ({ name, count, color: position % PALETTE_SIZE }));

  const degree = new Array(entries.length).fill(0);
  for (const edge of edges) {
    degree[edge.source] += 1;
    degree[edge.target] += 1;
  }
  const pr = rank(entries.length, edges);
  const maxRank = Math.max(...pr, 1e-6);
  const folderIndex = new Map(folders.map((folder, position) => [folder.name, position]));

  const nodes = entries.map((entry, position) => ({
    id: entry.id,
    title: entry.title,
    folder: entry.folder,
    tags: entry.tags,
    created: entry.created,
    words: entry.body.split(/\s+/).filter(Boolean).length,
    degree: degree[position],
    pagerank: Number((pr[position] / maxRank).toFixed(3)),
    community: folderIndex.get(entry.folder) ?? 0,
    size: Number((0.55 + 1.85 * Math.sqrt(pr[position] / maxRank)).toFixed(3)),
    x: 0,
    y: 0,
    z: 0,
    excerpt: excerptOf(entry.body),
    links: [...resolvedOutIds[position]],
    raw: entry.raw,
    body: entry.body,
  }));
  place(nodes, folders, edges, entries);

  const links = edges.reduce((sum, edge) => sum + edge.weight, 0);
  const orphans = nodes.filter((node) => node.degree === 0).length;
  const hub = nodes.reduce((best, node) => (node.pagerank > (best?.pagerank ?? -1) ? node : best), null);
  const structures = buildStructures(entries, resolveTarget);

  return {
    meta: {
      title: label,
      note_count: nodes.length,
      link_count: links,
      orphan_count: orphans,
      word_count: nodes.reduce((sum, node) => sum + node.words, 0),
      cluster_count: folders.length,
      folder_count: folders.length,
      density: Number((links / Math.max(1, nodes.length * (nodes.length - 1))).toFixed(4)),
      generated_at: Math.floor(Date.now() / 1000),
      source: 'device',
      folders,
      hub: hub ? hub.title : '',
    },
    nodes,
    edges,
    structures,
    local: { persisted },
  };
}

/** Rebuilds the stored vault, or returns null when nothing is saved. */
export async function loadLocalGraph() {
  const record = await readRecord();
  if (!record || !Array.isArray(record.files) || !record.files.length) return null;
  const entries = record.files.map((file) =>
    parseMarkdownEntry(file.raw ?? file.text ?? '', normalisePath(file.path), {
      size: file.size,
      lastModified: record.savedAt,
    }),
  );
  return graphFrom(entries, record.title || 'On this device', true);
}

export function isDeviceGraph(graph) {
  return Boolean(graph && graph.meta && graph.meta.source === 'device');
}
