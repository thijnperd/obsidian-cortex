import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');

function parseArgs(argv) {
  const opts = { bin: null, mock: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--bin' && argv[i + 1]) {
      opts.bin = path.resolve(argv[++i]);
    } else if (argv[i] === '--mock') {
      opts.mock = true;
    }
  }
  if (!opts.bin && !opts.mock) opts.mock = true;
  return opts;
}

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    const candidates = [];
    if (process.env.NODE_PATH) {
      for (const dir of process.env.NODE_PATH.split(path.delimiter).filter(Boolean)) {
        candidates.push(path.join(dir, 'playwright', 'index.mjs'));
      }
    }
    const globalRoot = execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    }).trim();
    candidates.push(path.join(globalRoot, 'playwright', 'index.mjs'));
    const entry = candidates.find((p) => fs.existsSync(p));
    if (!entry) {
      throw new Error(`Playwright not found in NODE_PATH or ${globalRoot}`);
    }
    return import(pathToFileURL(entry).href);
  }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function mimeFor(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.ico': return 'image/x-icon';
    default: return 'application/octet-stream';
  }
}

function sendFile(res, fullPath) {
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': mimeFor(fullPath), 'cache-control': 'no-store' });
  fs.createReadStream(fullPath).pipe(res);
}

function safeResolve(baseDir, reqPath) {
  const clean = reqPath.split('?')[0].replace(/^\/+/, '');
  const target = path.resolve(baseDir, clean || 'index.html');
  if (!target.startsWith(path.resolve(baseDir))) return null;
  return target;
}

async function startSiteServer() {
  const server = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/social-preview.jpg') {
      return sendFile(res, path.join(root, 'assets/social-preview.jpg'));
    }
    if (urlPath === '/screenshots/decision-trail.jpg') {
      return sendFile(res, path.join(root, 'docs/screenshots/v1-decision-trail.jpg'));
    }
    if (urlPath.startsWith('/screenshots/')) {
      const rel = urlPath.slice('/screenshots/'.length);
      const file = safeResolve(path.join(root, 'docs/screenshots/medium'), rel);
      return file ? sendFile(res, file) : (res.writeHead(404), res.end());
    }
    for (const icon of ['/favicon.ico', '/favicon.svg', '/logo.svg', '/apple-touch-icon.png']) {
      if (urlPath === icon) {
        return sendFile(res, path.join(root, 'web', icon.slice(1)));
      }
    }
    const target = safeResolve(path.join(root, 'site'), urlPath === '/' ? 'index.html' : urlPath);
    if (!target) {
      res.writeHead(403);
      return res.end();
    }
    sendFile(res, target);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startMockAppServer() {
  const vaultId = 'mock-vault-0001';
  let versionCounter = 1;
  let version = `v${versionCounter}`;

  const notes = [
    {
      id: 'Ideas/Deep Work',
      title: 'Deep Work',
      folder: 'Ideas',
      tags: ['focus', 'craft'],
      created: '2026-09-12',
      words: 28,
      degree: 2,
      pagerank: 0.9,
      community: 0,
      size: 1.4,
      x: -0.35,
      y: 0.15,
      z: 0.2,
      excerpt: 'Depth compounds when distractions are removed upfront.',
      raw: '---\ndate: 2026-09-12\ntags: [focus, craft]\n---\n\n# Deep Work\n\nDepth compounds when distractions are removed upfront.\n\nSee [[Cognitive Load]].\n',
    },
    {
      id: 'Ideas/Cognitive Load',
      title: 'Cognitive Load',
      folder: 'Ideas',
      tags: ['psychology'],
      created: '2026-09-18',
      words: 24,
      degree: 2,
      pagerank: 0.8,
      community: 0,
      size: 1.2,
      x: -0.25,
      y: 0.22,
      z: -0.1,
      excerpt: 'Working memory holds only a handful of active threads.',
      raw: '---\ndate: 2026-09-18\ntags: [psychology]\n---\n\n# Cognitive Load\n\nWorking memory holds only a handful of active threads.\n\nBack to [[Deep Work]].\n',
    },
    {
      id: 'Systems/Local First',
      title: 'Local First',
      folder: 'Systems',
      tags: ['software'],
      created: '2026-10-01',
      words: 22,
      degree: 1,
      pagerank: 0.75,
      community: 1,
      size: 1.2,
      x: 0.35,
      y: -0.1,
      z: 0.25,
      excerpt: 'Plain Markdown files outlive every viewer.',
      raw: '---\ndate: 2026-10-01\ntags: [software]\n---\n\n# Local First\n\nPlain Markdown files outlive every viewer.\n',
    },
    {
      id: 'Synthesis/how-does-attention-shape-deep-work',
      title: 'How does attention shape deep work?',
      folder: 'Synthesis',
      tags: ['research'],
      created: '2026-11-10',
      words: 45,
      degree: 2,
      pagerank: 0.7,
      community: 2,
      size: 1.1,
      x: 0.1,
      y: 0.3,
      z: -0.3,
      kind: 'research',
      status: 'open',
      confidence: 78,
      review_on: '2027-01-15',
      excerpt: 'Uninterrupted blocks need fewer open loops.',
      raw: '---\ntype: research\nstatus: open\ncreated: 2026-11-10\nconfidence: 0.78\nreview_on: 2027-01-15\n---\n\n# How does attention shape deep work?\n\nUninterrupted blocks need fewer open loops.\n\n- [[Deep Work]]\n- [[Cognitive Load]]\n',
    },
    {
      id: 'Synthesis/store-decision-trails-in-frontmatter',
      title: 'Store decision trails in plain frontmatter',
      folder: 'Synthesis',
      tags: ['idea'],
      created: '2026-11-12',
      words: 40,
      degree: 1,
      pagerank: 0.65,
      community: 2,
      size: 1.0,
      x: 0.2,
      y: 0.25,
      z: 0.35,
      kind: 'idea',
      status: 'accepted',
      confidence: 88,
      review_on: '2026-11-01',
      excerpt: 'Keep decision metadata portable in YAML.',
      raw: '---\ntype: idea\nstatus: accepted\ncreated: 2026-11-12\nconfidence: 0.88\nreview_on: 2026-11-01\n---\n\n# Store decision trails in plain frontmatter\n\nKeep decision metadata portable in YAML.\n\n- [[Local First]]\n',
    },
  ];

  function buildGraph() {
    const foldersMap = new Map();
    for (const n of notes) foldersMap.set(n.folder, (foldersMap.get(n.folder) || 0) + 1);
    const folders = [...foldersMap.entries()].map(([name, count], idx) => ({ name, count, color: idx }));
    const cards = notes
      .filter((n) => n.kind)
      .map((n) => ({
        id: n.id,
        title: n.title,
        kind: n.kind,
        status: n.status,
        folder: n.folder,
        created: n.created,
        confidence: n.confidence ?? null,
        review_on: n.review_on ?? null,
        supersedes: null,
        sources: 1,
        missing: 0,
        evidence: [{ id: 'Ideas/Deep Work', title: 'Deep Work', folder: 'Ideas' }],
      }));
    return {
      meta: {
        title: 'Smoke Vault',
        note_count: notes.length,
        link_count: 4,
        orphan_count: 0,
        word_count: notes.reduce((s, n) => s + n.words, 0),
        cluster_count: 3,
        folder_count: folders.length,
        density: 0.3,
        generated_at: 1700000000,
        source: 'mock',
        folders,
        hub: notes[0].id,
      },
      nodes: notes.map(({ raw, kind, status, confidence, review_on, ...pub }) => pub),
      edges: [
        { source: 0, target: 1, weight: 2 },
        { source: 1, target: 0, weight: 1 },
        { source: 3, target: 0, weight: 1 },
        { source: 4, target: 2, weight: 1 },
      ],
      structures: {
        total: cards.length,
        open: cards.filter((c) => c.status === 'open' || c.status === 'refining').length,
        cards,
      },
    };
  }

  function readBody(req) {
    return new Promise((resolve) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => resolve(data ? JSON.parse(data) : {}));
    });
  }

  const sendJson = (res, status, obj, extraHeaders = {}) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    });
    res.end(JSON.stringify(obj));
  };

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url || '/', 'http://127.0.0.1');
    const p = parsed.pathname;

    if (p === '/api/health') {
      return sendJson(res, 200, { ok: true, app: 'cortex', version: '2.3.0', build: 'smoke' });
    }
    if (p === '/api/vaults' && req.method === 'GET') {
      return sendJson(res, 200, {
        vaults: [{
          id: vaultId,
          name: 'Smoke Vault',
          path: '/smoke',
          notes: notes.length,
          loaded: true,
          active: true,
          missing: false,
          obsidian: false,
          agents: true,
        }],
        active: vaultId,
        read_only: false,
      });
    }
    if (p === '/api/graph') {
      return sendJson(res, 200, buildGraph(), { 'x-cortex-version': version });
    }
    if (p === '/api/version') {
      return sendJson(res, 200, { version, notes: notes.length, live: true });
    }
    if (p === '/api/about') {
      return sendJson(res, 200, {
        version: '2.3.0',
        build: 'smoke',
        port: server.address().port,
        pid: process.pid,
        config: null,
        log: null,
        releases: 'https://github.com/thijnperd/obsidian-cortex/releases',
        read_only: false,
        offline: true,
      });
    }
    if (p === '/api/update' && req.method === 'GET') {
      return sendJson(res, 200, {
        current: '2.3.0',
        latest: null,
        available: false,
        url: null,
        can_install: false,
        disabled: true,
        error: 'Offline mode is enabled; update checks are disabled',
      });
    }
    if (p === '/api/mcp/status') {
      return sendJson(res, 200, {
        vault: vaultId,
        name: 'Smoke Vault',
        agents: true,
        binary: 'cortex',
        snippet: '{}',
        clients: [],
      });
    }
    if (p === '/api/events') {
      const since = parsed.searchParams.get('since');
      if (since && since === version) {
        const timer = setTimeout(() => {
          sendJson(res, 200, { vault: vaultId, version, notes: notes.length, links: 4 });
        }, 25000);
        req.on('close', () => clearTimeout(timer));
        return;
      }
      return sendJson(res, 200, { vault: vaultId, version, notes: notes.length, links: 4 });
    }
    if (p === '/api/search') {
      const q = (parsed.searchParams.get('q') || '').toLowerCase();
      const hits = notes
        .filter((n) => n.title.toLowerCase().includes(q) || n.raw.toLowerCase().includes(q))
        .map((n) => ({ id: n.id, title: n.title, folder: n.folder, snippet: n.excerpt }));
      return sendJson(res, 200, hits);
    }
    if (p === '/api/note' && req.method === 'GET') {
      const id = parsed.searchParams.get('id');
      const note = notes.find((n) => n.id.toLowerCase() === String(id || '').toLowerCase());
      if (!note) return sendJson(res, 404, { error: 'not found', code: 'not_found' });
      const body = note.raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
      return sendJson(res, 200, {
        id: note.id,
        title: note.title,
        folder: note.folder,
        created: note.created,
        words: note.words,
        tags: note.tags,
        kind: note.kind || null,
        status: note.status || null,
        confidence: note.confidence ?? null,
        review_on: note.review_on ?? null,
        supersedes: null,
        evidence: [],
        markdown: body,
        raw: note.raw,
        backlinks: [],
        mentions: [],
        related: [],
      });
    }
    if (p === '/api/note' && req.method === 'POST') {
      const body = await readBody(req);
      const target = notes.find((n) => n.id === body.id);
      if (!target) return sendJson(res, 404, { error: 'not found', code: 'not_found' });
      target.raw = body.content;
      target.words = body.content.trim().split(/\s+/).length;
      versionCounter += 1;
      version = `v${versionCounter}`;
      return sendJson(res, 200, { id: target.id, version });
    }

    const staticFile = safeResolve(path.join(root, 'web'), p === '/' ? 'index.html' : p);
    if (!staticFile) {
      res.writeHead(403);
      return res.end();
    }
    sendFile(res, staticFile);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    isNewBuild: true,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startStaticDemoServer() {
  const staticGraph = {
    meta: {
      title: 'Static Demo Vault',
      note_count: 2,
      link_count: 1,
      orphan_count: 0,
      word_count: 30,
      cluster_count: 1,
      folder_count: 1,
      density: 0.5,
      generated_at: 1700000000,
      source: 'demo',
      folders: [{ name: 'Ideas', count: 2, color: 0 }],
      hub: 'Ideas/Demo Note',
    },
    nodes: [
      {
        id: 'Ideas/Demo Note',
        title: 'Demo Note',
        folder: 'Ideas',
        tags: ['demo'],
        created: '2026-10-01',
        words: 15,
        degree: 1,
        pagerank: 1,
        community: 0,
        size: 1.2,
        x: -0.2,
        y: 0.1,
        z: 0.1,
        excerpt: 'Demo note body.',
        body: '# Demo Note\n\nDemo note body.\n',
      },
      {
        id: 'Ideas/Second Note',
        title: 'Second Note',
        folder: 'Ideas',
        tags: ['demo'],
        created: '2026-10-02',
        words: 15,
        degree: 1,
        pagerank: 0.8,
        community: 0,
        size: 1.0,
        x: 0.2,
        y: -0.1,
        z: -0.1,
        excerpt: 'Second demo note.',
        body: '# Second Note\n\nLinks to [[Demo Note]].\n',
      },
    ],
    edges: [{ source: 1, target: 0, weight: 1 }],
    structures: { total: 0, open: 0, cards: [] },
  };

  const server = http.createServer((req, res) => {
    const p = new URL(req.url || '/', 'http://127.0.0.1').pathname;
    if (p.startsWith('/api/')) {
      res.writeHead(req.method === 'GET' ? 404 : 405, { 'content-type': 'text/plain' });
      return res.end('static export');
    }
    if (p === '/graph.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(staticGraph));
    }
    const staticFile = safeResolve(path.join(root, 'web'), p === '/' ? 'index.html' : p);
    if (!staticFile) {
      res.writeHead(403);
      return res.end();
    }
    sendFile(res, staticFile);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function startBinAppServer(binPath) {
  if (!fs.existsSync(binPath)) {
    throw new Error(`Binary not found: ${binPath}`);
  }
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-smoke-'));
  const vaultDir = path.join(tmpRoot, 'vault');
  const configDir = path.join(tmpRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });

  const env = { ...process.env, CORTEX_CONFIG_DIR: configDir, CORTEX_OFFLINE: '1' };
  execFileSync(binPath, ['seed-demo', vaultDir, '--size', 'small'], { env, stdio: 'pipe' });

  const helpText = execFileSync(binPath, ['serve', '--help'], { env, encoding: 'utf8' });
  const hasOffline = helpText.includes('--offline');
  const port = await getFreePort();
  const args = ['serve', vaultDir, '--port', String(port)];
  if (hasOffline) args.push('--offline');

  const child = spawn(binPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (d) => { logs += d.toString(); });
  child.stderr.on('data', (d) => { logs += d.toString(); });

  const url = `http://127.0.0.1:${port}/`;
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* waiting for server startup */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (!ready) {
    child.kill();
    throw new Error(`Server failed to become healthy within 15s.\nLogs:\n${logs}`);
  }

  return {
    url,
    isNewBuild: hasOffline,
    close: async () => {
      child.kill();
      await new Promise((r) => setTimeout(r, 250));
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { chromium } = await loadPlaywright();

  const appServer = opts.bin ? await startBinAppServer(opts.bin) : await startMockAppServer();
  const siteServer = await startSiteServer();

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
  });

  const pageErrors = [];
  const consoleErrors = [];

  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // 1. Boot the app and ensure the boot overlay disappears cleanly (regression check for 2.2.0).
    await page.goto(appServer.url, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('boot')?.hidden === true, { timeout: 15000 });

    // 2. Visit all 7 views and verify real DOM/canvas activation.
    const views = [
      { mode: 'notes', check: () => !document.getElementById('notes-studio')?.hidden },
      { mode: 'universe', check: () => !document.getElementById('stage')?.hidden },
      { mode: 'brain', check: () => !document.getElementById('stage')?.hidden },
      { mode: 'replay', check: () => !document.getElementById('replay')?.hidden },
      { mode: 'atlas', check: () => !document.getElementById('atlas')?.hidden },
      { mode: 'bento', check: () => document.querySelectorAll('#bento-board .bento-cell').length > 0 },
      { mode: 'decisions', check: () => document.querySelectorAll('#decisions-board .decision-card').length > 0 },
    ];
    for (const view of views) {
      const btn = page.locator(`.view[data-mode="${view.mode}"]`);
      await btn.click();
      await page.waitForFunction(
        (m) => document.querySelector(`.view[data-mode="${m}"]`)?.getAttribute('aria-pressed') === 'true',
        view.mode,
      );
      await page.waitForFunction(view.check, { timeout: 8000 });
    }

    if (appServer.isNewBuild) {
      const summaryStats = await page.locator('#decisions-board .decisions-stat').count();
      assert.ok(summaryStats >= 4, `Expected decisions summary strip, found ${summaryStats} stats`);
    }

    // 2b. Verify UI overhaul guarantees: no #stats overlap in Bento/Decisions, Utilities popover, single sidebar & collapsed inspector in Notes.
    for (const non3d of ['bento', 'decisions', 'atlas']) {
      await page.locator(`.view[data-mode="${non3d}"]`).click();
      await page.waitForFunction(
        (m) => document.body.classList.contains(`mode-${m}`),
        non3d,
      );
      const statsDisplay = await page.evaluate(() => getComputedStyle(document.getElementById('stats')).display);
      assert.equal(statsDisplay, 'none', `Expected #stats hidden in ${non3d} mode`);
    }

    await page.locator('#toolbar-more-btn').click();
    await page.waitForFunction(() => document.getElementById('toolbar-more-menu')?.hidden === false);
    const menuHasActions = await page.evaluate(() => Boolean(
      document.querySelector('#toolbar-more-menu #theme-toggle')
      && document.querySelector('#toolbar-more-menu #shortcuts-button'),
    ));
    assert.equal(menuHasActions, true, 'Expected secondary utilities inside #toolbar-more-menu');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.getElementById('toolbar-more-menu')?.hidden === true);

    // 3. Verify Notes Studio single sidebar, collapsed inspector, unobstructed bottom note & save flow.
    await page.locator('.view[data-mode="notes"]').click();
    await page.waitForFunction(() => !document.getElementById('notes-studio')?.hidden);
    const notesUiChecks = await page.evaluate(() => {
      const sidebar = document.getElementById('sidebar');
      const studio = document.getElementById('notes-studio');
      const stats = document.getElementById('stats');
      return {
        sidebarHidden: Boolean(sidebar?.hidden),
        hasSidebarClass: document.body.classList.contains('has-sidebar'),
        inspectorCollapsed: Boolean(studio?.classList.contains('is-inspector-collapsed')),
        statsDisplay: stats ? getComputedStyle(stats).display : 'none',
      };
    });
    assert.equal(notesUiChecks.sidebarHidden, true, 'Expected global #sidebar hidden in Notes mode (no double sidebar)');
    assert.equal(notesUiChecks.hasSidebarClass, false, 'Expected body.has-sidebar cleared in Notes mode');
    assert.equal(notesUiChecks.inspectorCollapsed, true, 'Expected right inspector collapsed by default');
    assert.equal(notesUiChecks.statsDisplay, 'none', 'Expected #stats hidden in Notes mode');

    // Top-left #sidebar-toggle controls Notes list pane on desktop.
    await page.locator('#sidebar-toggle').click();
    await page.waitForFunction(() => document.getElementById('notes-studio')?.classList.contains('is-list-collapsed') === true);
    await page.locator('#sidebar-toggle').click();
    await page.waitForFunction(() => document.getElementById('notes-studio')?.classList.contains('is-list-collapsed') === false);

    await page.locator('[data-list-view="list"]').click();
    const lastCard = page.locator('#notes-feed .notes-card').last();
    await lastCard.scrollIntoViewIfNeeded();
    const hitOk = await page.evaluate(() => {
      const feed = document.getElementById('notes-feed');
      if (feed) feed.scrollTop = feed.scrollHeight;
      const cards = document.querySelectorAll('#notes-feed .notes-card');
      const last = cards[cards.length - 1];
      const mainBtn = last?.querySelector('.notes-card-main');
      if (!last || !mainBtn) return false;
      const rect = mainBtn.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(hit && last.contains(hit));
    });
    assert.equal(hitOk, true, 'Expected bottom-most note card to be unobstructed and hit-testable');
    const lastNoteId = await lastCard.getAttribute('data-note-id');
    await lastCard.locator('.notes-card-main').click();
    if (lastNoteId) {
      await page.waitForFunction(
        (id) => document.querySelector('#notes-canvas .studio-doc-top')?.getAttribute('data-note-id') === id,
        lastNoteId,
      );
    }

    const firstCard = page.locator('#notes-feed .notes-card').first();
    const targetNoteId = await firstCard.getAttribute('data-note-id');
    assert.ok(targetNoteId, 'Expected a note card in Notes Studio list');
    await firstCard.locator('.notes-card-main').click();
    await page.waitForFunction(
      (id) => document.querySelector('#notes-canvas .studio-doc-top')?.getAttribute('data-note-id') === id,
      targetNoteId,
    );

    await page.locator('[data-editor-mode="edit"]').click();
    const editor = page.locator('#studio-editor');
    await editor.waitFor({ state: 'visible' });
    const sentinel = `SMOKE_PERSIST_${Date.now()}`;
    const existingText = await editor.inputValue();
    await editor.fill(`${existingText}\n\n${sentinel}`);
    await editor.focus();

    const saveRespPromise = page.waitForResponse(
      (res) => res.url().includes('/api/note') && res.request().method() === 'POST',
    );
    await page.keyboard.press('Control+s');
    const saveResp = await saveRespPromise;
    assert.equal(saveResp.status(), 200, 'Expected POST /api/note to succeed');
    await page.waitForFunction(
      () => document.getElementById('notes-save-status')?.textContent?.trim() === 'Saved',
    );

    // Reload and verify saved sentinel persisted on disk.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.getElementById('boot')?.hidden === true, { timeout: 15000 });
    await page.locator('.view[data-mode="notes"]').click();
    await page.locator('[data-list-view="list"]').click();
    await page.locator(`#notes-feed .notes-card[data-note-id=${JSON.stringify(targetNoteId)}] .notes-card-main`).click();
    await page.waitForFunction(
      (id) => document.querySelector('#notes-canvas .studio-doc-top')?.getAttribute('data-note-id') === id,
      targetNoteId,
    );
    await page.locator('[data-editor-mode="read"]').click();
    await page.waitForFunction(
      (token) => document.getElementById('studio-prose')?.textContent?.includes(token),
      sentinel,
      { timeout: 10000 },
    );

    // 3b. Verify Live Preview (#studio-live-host) block editing and Ctrl+S save.
    await page.locator('[data-editor-mode="live"]').click();
    const liveHost = page.locator('#studio-live-host');
    await liveHost.waitFor({ state: 'visible' });
    await page.waitForFunction(
      () => document.querySelectorAll('#studio-live-host .live-block').length > 0,
    );
    // A paragraph with a wikilink in it opens that note instead of editing, so
    // pick one that only holds plain text.
    const liveParagraph = liveHost
      .locator('.live-block.is-paragraph')
      .filter({ hasNot: page.locator('.wikilink') })
      .last();
    await liveParagraph.click();
    const liveInput = liveHost.locator('.live-block-input');
    await liveInput.waitFor({ state: 'visible' });
    const liveSentinel = `LIVE_EDIT_${Date.now()}`;
    const existingBlockText = await liveInput.inputValue();
    await liveInput.fill(`${existingBlockText} ${liveSentinel}`);
    await liveInput.focus();

    const liveSaveRespPromise = page.waitForResponse(
      (res) => res.url().includes('/api/note') && res.request().method() === 'POST',
    );
    await page.keyboard.press('Control+s');
    const liveSaveResp = await liveSaveRespPromise;
    assert.equal(liveSaveResp.status(), 200, 'Expected Live Preview POST /api/note to succeed');
    await page.waitForFunction(
      () => document.getElementById('notes-save-status')?.textContent?.trim() === 'Saved',
    );

    // 4. Open Settings modal and check update opt-out checkbox when present.
    await page.locator('#settings-button').click();
    await page.waitForFunction(() => document.getElementById('settings')?.hidden === false);
    if (appServer.isNewBuild) {
      const autoUpdate = page.locator('#settings-auto-update');
      assert.equal(await autoUpdate.isChecked(), true);
      await autoUpdate.uncheck();
      assert.equal(await autoUpdate.isChecked(), false);
      await autoUpdate.check();
      assert.equal(await autoUpdate.isChecked(), true);
    }
    await page.locator('#settings-close').click();
    await page.waitForFunction(() => document.getElementById('settings')?.hidden === true);

    // 5. Verify landing site (site/index.html) tabs and OG social preview image.
    await page.goto(siteServer.url, { waitUntil: 'domcontentloaded' });
    const ogRes = await fetch(`${siteServer.url}social-preview.jpg`);
    assert.equal(ogRes.status, 200, 'Expected OG social-preview.jpg to serve HTTP 200');
    for (const tabId of ['universe', 'replay', 'atlas', 'bento', 'decisions', 'brain']) {
      await page.locator(`[data-view-tab="${tabId}"]`).click();
      await page.waitForFunction(
        (id) =>
          document.querySelector(`[data-view-tab="${id}"]`)?.getAttribute('aria-selected') === 'true'
          && !document.querySelector(`[data-view-panel="${id}"]`)?.hasAttribute('hidden'),
        tabId,
      );
    }

    // 6. Verify iOS / Mobile shell (390x844, touch) against the app server.
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    try {
      const mobilePage = await mobileContext.newPage();
      mobilePage.on('pageerror', (err) => pageErrors.push(`mobile: ${err.message}`));
      mobilePage.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(`mobile: ${msg.text()}`);
      });

      await mobilePage.goto(appServer.url, { waitUntil: 'domcontentloaded' });
      await mobilePage.waitForFunction(() => document.getElementById('boot')?.hidden === true, { timeout: 15000 });

      const layoutMetrics = await mobilePage.evaluate(() => {
        const overflow = document.documentElement.scrollWidth;
        const toolbar = document.querySelector('.toolbar');
        const toolbarRect = toolbar ? toolbar.getBoundingClientRect() : null;
        const toolbarControls = [...document.querySelectorAll('.toolbar-left > *, .toolbar-actions > *')]
          .filter((el) => getComputedStyle(el).display !== 'none')
          .map((el) => {
            const r = el.getBoundingClientRect();
            return {
              id: el.id || el.className,
              left: r.left,
              right: r.right,
              top: r.top,
              bottom: r.bottom,
              width: r.width,
            };
          });
        const viewsEl = document.querySelector('.views');
        const viewsRect = viewsEl ? viewsEl.getBoundingClientRect() : null;
        return {
          overflow,
          toolbarRect: toolbarRect ? { left: toolbarRect.left, right: toolbarRect.right } : null,
          toolbarControls,
          viewsRect: viewsRect
            ? { left: viewsRect.left, right: viewsRect.right, top: viewsRect.top, bottom: viewsRect.bottom }
            : null,
        };
      });

      assert.ok(
        layoutMetrics.overflow <= 390,
        `Expected no horizontal overflow on mobile (scrollWidth=${layoutMetrics.overflow})`,
      );
      assert.ok(layoutMetrics.toolbarRect, 'Expected .toolbar element on mobile');
      assert.ok(
        layoutMetrics.toolbarRect.left >= 0 && layoutMetrics.toolbarRect.right <= 390,
        `Expected .toolbar inside [0, 390], got [${layoutMetrics.toolbarRect.left}, ${layoutMetrics.toolbarRect.right}]`,
      );
      for (const ctrl of layoutMetrics.toolbarControls) {
        assert.ok(
          ctrl.width > 0 && ctrl.left >= -0.5 && ctrl.right <= 390.5,
          `Expected toolbar control ${ctrl.id} inside [0, 390], got [${ctrl.left}, ${ctrl.right}] (w=${ctrl.width})`,
        );
      }
      assert.ok(layoutMetrics.viewsRect, 'Expected .views bottom dock on mobile');
      assert.ok(
        layoutMetrics.viewsRect.bottom <= 844 && layoutMetrics.viewsRect.top >= 700,
        `Expected .views docked at bottom (top>=700, bottom<=844), got top=${layoutMetrics.viewsRect.top}, bottom=${layoutMetrics.viewsRect.bottom}`,
      );

      // More sheet -> Atlas -> closes sheet
      await mobilePage.locator('#mobile-more-btn').tap();
      await mobilePage.waitForFunction(() => document.getElementById('mobile-more-sheet')?.hidden === false);
      await mobilePage.locator('#mobile-more-sheet [data-mobile-mode="atlas"]').tap();
      await mobilePage.waitForFunction(
        () =>
          document.getElementById('atlas')?.hidden === false
          && document.getElementById('mobile-more-sheet')?.hidden === true,
      );

      // Notes two-step navigation: list -> reading/editing -> back
      await mobilePage.locator('.views .view[data-mode="notes"]').tap();
      await mobilePage.waitForFunction(() => document.getElementById('notes-studio')?.hidden === false);
      const listPaneVisible = await mobilePage.evaluate(() => {
        const pane = document.getElementById('notes-list-pane');
        if (!pane) return false;
        const style = getComputedStyle(pane);
        const rect = pane.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      });
      assert.equal(listPaneVisible, true, 'Expected #notes-list-pane visible on mobile before selecting a note');

      await mobilePage.locator('#notes-list-pane [data-list-view="list"]').tap();
      await mobilePage.waitForFunction(
        () => document.querySelectorAll('#notes-feed .notes-card').length > 0,
      );
      const cardCount = await mobilePage.locator('#notes-feed .notes-card').count();
      assert.ok(cardCount > 0, `Expected #notes-feed .notes-card items, found ${cardCount}`);

      await mobilePage.locator('#notes-feed .notes-card .notes-card-main').first().tap();
      await mobilePage.waitForFunction(
        () => document.getElementById('notes-studio')?.classList.contains('is-mobile-reading') === true,
      );
      await mobilePage.locator('#notes-canvas').waitFor({ state: 'visible' });

      // Live Preview tap-to-edit on mobile
      await mobilePage.locator('[data-editor-mode="live"]').tap();
      await mobilePage.waitForFunction(
        () => document.querySelectorAll('#studio-live-host .live-block').length > 0,
      );
      // Same as desktop: tap a plain-text paragraph, never one that would
      // navigate through a wikilink.
      await mobilePage
        .locator('#studio-live-host .live-block.is-paragraph')
        .filter({ hasNot: mobilePage.locator('.wikilink') })
        .last()
        .tap();
      await mobilePage.locator('#studio-live-host .live-block-input').waitFor({ state: 'visible' });

      // Mobile inspector drawer open/close
      await mobilePage.locator('#notes-toggle-inspector').tap();
      await mobilePage.waitForFunction(
        () => document.getElementById('notes-inspector-pane')?.classList.contains('is-mobile-open') === true,
      );
      await mobilePage.locator('#notes-inspector-close').tap();
      await mobilePage.waitForFunction(
        () => document.getElementById('notes-inspector-pane')?.classList.contains('is-mobile-open') === false,
      );

      // Back button returns to list
      await mobilePage.locator('#notes-mobile-back').tap();
      await mobilePage.waitForFunction(
        () => document.getElementById('notes-studio')?.classList.contains('is-mobile-reading') === false,
      );
      const listVisibleAgain = await mobilePage.evaluate(() => {
        const pane = document.getElementById('notes-list-pane');
        if (!pane) return false;
        const style = getComputedStyle(pane);
        const rect = pane.getBoundingClientRect();
        return style.display !== 'none' && rect.width > 0 && rect.height > 0;
      });
      assert.equal(listVisibleAgain, true, 'Expected #notes-list-pane visible again after tapping #notes-mobile-back');
    } finally {
      await mobileContext.close();
    }

    // 7. Static GitHub Pages export desktop test: #vault-button opens #local-vault (never HTTP 405 #launch) and opening a single .md file works.
    const staticServer = await startStaticDemoServer();
    const staticContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    try {
      const staticPage = await staticContext.newPage();
      const staticPageErrors = [];
      const staticBadResponses = [];
      staticPage.on('pageerror', (err) => staticPageErrors.push(err.message));
      staticPage.on('response', (res) => {
        const pathname = new URL(res.url()).pathname;
        if (res.status() >= 400 && pathname !== '/api/vaults') {
          staticBadResponses.push(`${res.status()} ${pathname}`);
        }
      });

      await staticPage.goto(staticServer.url, { waitUntil: 'domcontentloaded' });
      await staticPage.waitForFunction(() => document.getElementById('boot')?.hidden === true, { timeout: 15000 });
      await staticPage.locator('#open-vault').waitFor({ state: 'visible' });

      // Clicking top-left #vault-button on GitHub Pages must open #local-vault, never the server-only #launch screen.
      await staticPage.locator('#vault-button').click();
      await staticPage.waitForFunction(() => document.getElementById('local-vault')?.hidden === false);
      const launchHidden = await staticPage.evaluate(() => document.getElementById('launch')?.hidden === true);
      assert.equal(launchHidden, true, 'Expected #launch to stay hidden in static/GitHub Pages mode');

      // Pick a single Markdown file on PC and verify it opens directly in Notes view.
      await staticPage.locator('#local-vault-files').setInputFiles({
        name: 'QuickNote.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from('# Quick Note\n\nOpened from PC.\n'),
      });
      await staticPage.waitForFunction(() => document.getElementById('local-vault')?.hidden === true, { timeout: 10000 });
      await staticPage.waitForFunction(
        () => document.body.classList.contains('mode-notes') && !document.getElementById('notes-studio')?.hidden,
        { timeout: 10000 },
      );
      await staticPage.waitForFunction(
        () => (document.getElementById('notes-canvas')?.textContent || '').includes('Opened from PC.'),
        { timeout: 10000 },
      );

      // Re-open #local-vault via #open-vault: Return-to-demo button is shown and Close dismisses cleanly.
      await staticPage.locator('#open-vault').click();
      await staticPage.waitForFunction(() => document.getElementById('local-vault')?.hidden === false);
      await staticPage.locator('#local-vault-forget').waitFor({ state: 'visible' });

      // Import a multi-folder nested vault directory via #local-vault-folder and verify all views adapt.
      const nestedTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-nested-'));
      try {
        const vaultRoot = path.join(nestedTmp, 'NestedVault');
        fs.mkdirSync(path.join(vaultRoot, 'Ideas'), { recursive: true });
        fs.mkdirSync(path.join(vaultRoot, 'Craft'), { recursive: true });
        fs.mkdirSync(path.join(vaultRoot, 'Decisions'), { recursive: true });
        fs.writeFileSync(
          path.join(vaultRoot, 'Ideas', 'Alpha.md'),
          '---\ntags: [focus]\n---\n\n# Alpha\n\nLinks to [[Beta]].\n',
        );
        fs.writeFileSync(
          path.join(vaultRoot, 'Craft', 'Beta.md'),
          '# Beta\n\nLinks back to [[Alpha]].\n',
        );
        fs.writeFileSync(
          path.join(vaultRoot, 'Decisions', 'Brief.md'),
          '---\ntype: research\nstatus: open\nconfidence: 0.8\n---\n\n# Brief\n\n- [[Alpha]]\n- [[Beta]]\n',
        );

        await staticPage.locator('#local-vault-folder').setInputFiles(vaultRoot);
        await staticPage.waitForFunction(() => document.getElementById('local-vault')?.hidden === true, { timeout: 10000 });
        await staticPage.waitForFunction(
          () => (document.getElementById('vault-title')?.textContent || '').includes('NestedVault'),
          { timeout: 10000 },
        );

        // Bento must show the stripped subfolders, not collapse the whole vault into one NestedVault box.
        await staticPage.locator('.view[data-mode="bento"]').click();
        await staticPage.waitForFunction(() => document.querySelectorAll('#bento-board .bento-cell').length >= 3);

        // Decisions board must populate from frontmatter type: research.
        await staticPage.locator('.view[data-mode="decisions"]').click();
        await staticPage.waitForFunction(() => document.querySelectorAll('#decisions-board .decision-card').length >= 1);

        // Atlas & Graph must switch cleanly without errors.
        await staticPage.locator('.view[data-mode="atlas"]').click();
        await staticPage.waitForFunction(() => !document.getElementById('atlas')?.hidden);
        await staticPage.locator('.view[data-mode="universe"]').click();
        await staticPage.waitForFunction(() => !document.getElementById('stage')?.hidden);

        // Notes view must expose Download .md export in the more menu.
        await staticPage.locator('.view[data-mode="notes"]').click();
        await staticPage.locator('#notes-export-md').waitFor({ state: 'attached' });
      } finally {
        fs.rmSync(nestedTmp, { recursive: true, force: true });
      }

      assert.deepEqual(staticPageErrors, [], `Uncaught static page errors: ${staticPageErrors.join(' | ')}`);
      assert.deepEqual(staticBadResponses, [], `Unexpected static HTTP errors: ${staticBadResponses.join(' | ')}`);
    } finally {
      await staticContext.close();
    }

    // 7b. Static iOS Safari test: folder button switches to compressed .zip vault import & .md files are unlocked.
    const iosContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    });
    try {
      const iosPage = await iosContext.newPage();
      const iosErrors = [];
      iosPage.on('pageerror', (err) => iosErrors.push(err.message));

      await iosPage.goto(staticServer.url, { waitUntil: 'domcontentloaded' });
      await iosPage.waitForFunction(() => document.getElementById('boot')?.hidden === true, { timeout: 15000 });
      await iosPage.locator('#open-vault').tap();
      await iosPage.waitForFunction(() => document.getElementById('local-vault')?.hidden === false);

      const iosUi = await iosPage.evaluate(() => ({
        folderBtnVisible: getComputedStyle(document.getElementById('local-vault-folder-button')).display !== 'none',
        folderBtnText: document.getElementById('local-vault-folder-button')?.textContent?.trim(),
        iosGuideVisible: document.getElementById('local-vault-ios-guide')?.hidden === false,
        filesAccept: document.getElementById('local-vault-files')?.getAttribute('accept'),
      }));
      assert.equal(iosUi.folderBtnVisible, true, 'Expected folder/zip button visible on iOS');
      assert.equal(iosUi.folderBtnText, 'Import vault (.zip)');
      assert.equal(iosUi.iosGuideVisible, true, 'Expected 2-tap iOS Files compress guide visible');
      assert.equal(iosUi.filesAccept, null, 'Expected accept attribute removed on iOS so .md notes stay selectable');

      const buildSmokeZip = (entries) => {
        const locals = [];
        const cds = [];
        let off = 0;
        for (const e of entries) {
          const nameBuf = Buffer.from(e.path, 'utf8');
          const rawBuf = Buffer.from(e.data, 'utf8');
          const compBuf = deflateRawSync(rawBuf);
          const lfh = Buffer.alloc(30 + nameBuf.length);
          lfh.writeUInt32LE(0x04034b50, 0);
          lfh.writeUInt16LE(20, 4);
          lfh.writeUInt16LE(0x0808, 6);
          lfh.writeUInt16LE(8, 8);
          lfh.writeUInt16LE(nameBuf.length, 26);
          nameBuf.copy(lfh, 30);
          const dd = Buffer.alloc(16);
          dd.writeUInt32LE(0x08074b50, 0);
          dd.writeUInt32LE(compBuf.length, 8);
          dd.writeUInt32LE(rawBuf.length, 12);
          const cdh = Buffer.alloc(46 + nameBuf.length);
          cdh.writeUInt32LE(0x02014b50, 0);
          cdh.writeUInt16LE(20, 4);
          cdh.writeUInt16LE(20, 6);
          cdh.writeUInt16LE(0x0808, 8);
          cdh.writeUInt16LE(8, 10);
          cdh.writeUInt32LE(compBuf.length, 20);
          cdh.writeUInt32LE(rawBuf.length, 24);
          cdh.writeUInt16LE(nameBuf.length, 28);
          cdh.writeUInt32LE(off, 42);
          nameBuf.copy(cdh, 46);
          locals.push(lfh, compBuf, dd);
          cds.push(cdh);
          off += lfh.length + compBuf.length + dd.length;
        }
        const cdBuf = Buffer.concat(cds);
        const eocd = Buffer.alloc(22);
        eocd.writeUInt32LE(0x06054b50, 0);
        eocd.writeUInt16LE(entries.length, 8);
        eocd.writeUInt16LE(entries.length, 10);
        eocd.writeUInt32LE(cdBuf.length, 12);
        eocd.writeUInt32LE(off, 16);
        return Buffer.concat([...locals, cdBuf, eocd]);
      };

      const iosZipBuffer = buildSmokeZip([
        { path: '__MACOSX/PhoneVault/._Alpha.md', data: 'appledouble' },
        { path: 'PhoneVault/Ideas/Alpha.md', data: '# Alpha\n\n[[Beta]]\n' },
        { path: 'PhoneVault/Craft/Beta.md', data: '# Beta\n\n[[Alpha]]\n' },
        {
          path: 'PhoneVault/Decisions/Brief.md',
          data: '---\ntype: research\nstatus: open\n---\n\n# Brief\n\n- [[Alpha]]\n',
        },
      ]);

      await iosPage.locator('#local-vault-zip').setInputFiles({
        name: 'PhoneVault.zip',
        mimeType: 'application/zip',
        buffer: iosZipBuffer,
      });
      await iosPage.waitForFunction(() => document.getElementById('local-vault')?.hidden === true, { timeout: 10000 });
      await iosPage.waitForFunction(
        () => (document.getElementById('vault-title')?.textContent || '').includes('PhoneVault'),
        { timeout: 10000 },
      );

      // Verify all folders and Decisions cards populated cleanly from the .zip archive.
      await iosPage.locator('.views .view[data-mode="decisions"]').tap();
      await iosPage.waitForFunction(() => document.querySelectorAll('#decisions-board .decision-card').length >= 1);
      await iosPage.locator('#mobile-more-btn').tap();
      await iosPage.locator('#mobile-more-sheet [data-mobile-mode="bento"]').tap();
      await iosPage.waitForFunction(() => document.querySelectorAll('#bento-board .bento-cell').length >= 3);

      assert.deepEqual(iosErrors, [], `Uncaught iOS static page errors: ${iosErrors.join(' | ')}`);
    } finally {
      await iosContext.close();
      await staticServer.close();
    }

    assert.deepEqual(pageErrors, [], `Uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join(' | ')}`);
    console.log(`smoke ok (${opts.bin ? path.basename(opts.bin) : 'mock-web'} + site + mobile + static-pc + static-ios-zip): all 7 views, note & live-preview save, settings, site tabs, iOS/mobile shell, and static PC/iOS vault import passed.`);
  } finally {
    await browser.close();
    await siteServer.close();
    await appServer.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
