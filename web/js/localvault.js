// Local vaults: read Markdown from the device and build the same payload the
// Rust server serves, so the whole UI (graph, brain, notes, search, links)
// works with no server behind it.
//
// iOS has no File System Access API, so a vault cannot stay a live folder
// handle: the files are copied into IndexedDB once and the graph is rebuilt
// from that copy on every launch. Read-only by design — nothing is written
// back to the phone's files.

const DB_NAME = 'cortex.localvault';
const STORE = 'vault';
const RECORD_KEY = 'current';
const MAX_FILES = 5000;
const MAX_BYTES = 48 * 1024 * 1024;
const PALETTE_SIZE = 8;
const INBOX = 'Inbox';
const GOLDEN = Math.PI * (3 - Math.sqrt(5));

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

// ---------------------------------------------------------------- parsing

function splitFrontmatter(text) {
  const normalised = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!normalised.startsWith('---\n')) return { frontmatter: '', body: normalised };
  const end = normalised.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: '', body: normalised };
  let close = end + 4;
  if (normalised[close] === '\n') close += 1;
  return { frontmatter: normalised.slice(4, end), body: normalised.slice(close) };
}

function frontmatterValue(frontmatter, key) {
  // [ \t], not \s: a trailing \s would swallow the newline after `tags:` and
  // make the block list below look like an inline value.
  const match = frontmatter.match(new RegExp(`^${key}[ \\t]*:[ \\t]*(.*)$`, 'im'));
  return match ? match[1].trim() : '';
}

function frontmatterList(frontmatter, key) {
  const raw = frontmatterValue(frontmatter, key);
  if (!raw) {
    // block list: tags:\n  - one\n  - two
    const block = frontmatter.match(
      new RegExp(`^${key}[ \\t]*:[ \\t]*\\n((?:[ \\t]*-[ \\t]*.*(?:\\n|$))+)`, 'im'),
    );
    if (!block) return [];
    return block[1]
      .split('\n')
      .map((line) => line.replace(/^[ \t]*-[ \t]*/, '').trim())
      .filter(Boolean);
  }
  const unwrapped = raw.replace(/^\[(.*)\]$/, '$1');
  return unwrapped
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

function cleanTag(tag) {
  return tag
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

/** Wikilinks outside fenced code, without aliases, headings or embeds. */
function linksOf(body) {
  const out = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/!?\[\[([^\]]+)\]\]/g)) {
      const target = match[1].split('|')[0].split('#')[0].trim();
      if (target) out.push(target);
    }
  }
  return out;
}

function inlineTags(body) {
  const out = new Set();
  let fenced = false;
  for (const line of body.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced || line.trimStart().startsWith('#')) continue;
    for (const match of line.matchAll(/(^|\s)#([\p{L}\p{N}][\p{L}\p{N}/_-]*)/gu)) {
      out.add(match[2]);
    }
  }
  return [...out];
}

function isoDate(value, fallback) {
  const match = String(value || '').match(/\d{4}-\d{2}-\d{2}/);
  if (match) return match[0];
  const date = fallback ? new Date(fallback) : new Date();
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
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

// ---------------------------------------------------------------- layout

function place(nodes, folders) {
  const radius = 120;
  const centres = folders.map((_, index) => {
    const y = folders.length === 1 ? 0 : 1 - (index / (folders.length - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN * index * 3;
    return [Math.cos(theta) * ring * radius, y * radius * 0.92, Math.sin(theta) * ring * radius];
  });
  const slot = new Map();
  for (const node of nodes) {
    const group = folders.findIndex((folder) => folder.name === node.folder);
    const centre = centres[group === -1 ? 0 : group] || [0, 0, 0];
    const index = slot.get(node.folder) || 0;
    slot.set(node.folder, index + 1);
    const angle = GOLDEN * index;
    const spread = 9 + Math.sqrt(index) * 7;
    node.x = Number((centre[0] + Math.cos(angle) * spread).toFixed(4));
    node.y = Number((centre[1] + Math.sin(angle * 1.7) * spread * 0.55).toFixed(4));
    node.z = Number((centre[2] + Math.sin(angle) * spread).toFixed(4));
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

// ---------------------------------------------------------------- build

/**
 * Turns a FileList (folder picker or multi-select) into a Cortex graph and
 * stores the text on the device so the next launch opens without asking again.
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

  const entries = [];
  for (const file of accepted.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name))) {
    const raw = await file.text();
    const path = normalisePath(file.webkitRelativePath || file.name);
    if (isIgnored(path)) continue;
    const { frontmatter, body } = splitFrontmatter(raw);
    const id = path.replace(MARKDOWN, '');
    const name = path.split('/').pop().replace(MARKDOWN, '');
    const tags = [...frontmatterList(frontmatter, 'tags'), ...inlineTags(body)]
      .map(cleanTag)
      .filter(Boolean);
    entries.push({
      id,
      path,
      title: titleOf(body, name),
      folder: folderOf(id),
      tags: [...new Set(tags)].slice(0, 12),
      created: isoDate(frontmatterValue(frontmatter, 'created') || frontmatterValue(frontmatter, 'date'), file.lastModified),
      body,
      size: file.size,
    });
  }
  if (!entries.length) throw new Error('No Markdown notes in that selection.');

  const stored = entries.map((entry) => ({
    path: entry.path,
    text: entry.body,
    size: entry.size,
    title: entry.title,
    created: entry.created,
    tags: entry.tags,
  }));
  const label =
    options.title ||
    entries.find((entry) => entry.path.includes('/'))?.path.split('/')[0] ||
    'On this device';
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
  });

  const pairs = new Map();
  entries.forEach((entry, source) => {
    for (const target of linksOf(entry.body)) {
      const key = normalisePath(target).replace(MARKDOWN, '');
      const hit = byTitle.get(key.toLowerCase()) ?? index.get(key.toLowerCase());
      if (hit === undefined || hit === source) continue;
      const id = `${source}:${hit}`;
      pairs.set(id, (pairs.get(id) || 0) + 1);
    }
  });

  const edges = [...pairs.entries()].map(([id, weight]) => {
    const [source, target] = id.split(':').map(Number);
    return { source, target, weight };
  });

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
    body: entry.body,
  }));
  place(nodes, folders);

  const links = edges.reduce((sum, edge) => sum + edge.weight, 0);
  const orphans = nodes.filter((node) => node.degree === 0).length;
  const hub = nodes.reduce((best, node) => (node.pagerank > (best?.pagerank ?? -1) ? node : best), null);

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
    structures: { total: 0, open: 0, cards: [] },
    local: { persisted },
  };
}

/** Rebuilds the stored vault, or returns null when nothing is saved. */
export async function loadLocalGraph() {
  const record = await readRecord();
  if (!record || !Array.isArray(record.files) || !record.files.length) return null;
  const entries = record.files.map((file) => {
    const id = file.path.replace(MARKDOWN, '');
    const name = file.path.split('/').pop().replace(MARKDOWN, '');
    return {
      id,
      path: file.path,
      title: file.title || titleOf(file.text, name),
      folder: folderOf(id),
      tags: (file.tags && file.tags.length ? file.tags : inlineTags(file.text).map(cleanTag)).slice(0, 12),
      created: file.created || '',
      body: file.text,
      size: file.size || file.text.length,
    };
  });
  return graphFrom(entries, record.title || 'On this device', true);
}

export function isDeviceGraph(graph) {
  return Boolean(graph && graph.meta && graph.meta.source === 'device');
}
