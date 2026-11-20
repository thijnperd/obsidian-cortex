import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

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

    // 3. Edit and persist a note in Notes Studio across a full reload.
    await page.locator('.view[data-mode="notes"]').click();
    await page.locator('[data-list-view="list"]').click();
    const firstCard = page.locator('#notes-feed .notes-card').first();
    const targetNoteId = await firstCard.getAttribute('data-note-id');
    assert.ok(targetNoteId, 'Expected a note card in Notes Studio list');
    await firstCard.locator('.notes-card-main').click();

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
    await page.locator('[data-editor-mode="read"]').click();
    await page.waitForFunction(
      (token) => document.getElementById('studio-prose')?.textContent?.includes(token),
      sentinel,
      { timeout: 10000 },
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

    assert.deepEqual(pageErrors, [], `Uncaught page errors: ${pageErrors.join(' | ')}`);
    assert.deepEqual(consoleErrors, [], `Console errors: ${consoleErrors.join(' | ')}`);
    console.log(`smoke ok (${opts.bin ? path.basename(opts.bin) : 'mock-web'} + site): all 7 views, note save, settings, and site tabs passed.`);
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
