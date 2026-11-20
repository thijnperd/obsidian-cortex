import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

// Strip JS line/block comments while preserving string/template contents, or
// also blank out string literals when scanning identifier property access.
function stripComments(src, { blankStrings = false } = {}) {
  let out = '';
  let i = 0;
  let mode = 'code';
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (mode === 'code') {
      if (ch === '/' && next === '/') {
        mode = 'line';
        i += 2;
        continue;
      }
      if (ch === '/' && next === '*') {
        mode = 'block';
        i += 2;
        continue;
      }
      if (ch === "'") mode = 'sq';
      else if (ch === '"') mode = 'dq';
      else if (ch === '`') mode = 'tq';
      out += ch;
    } else if (mode === 'line') {
      if (ch === '\n') {
        mode = 'code';
        out += '\n';
      }
    } else if (mode === 'block') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i += 2;
        continue;
      }
      if (ch === '\n') out += '\n';
    } else {
      if (ch === '\\' && i + 1 < src.length) {
        out += blankStrings ? '  ' : ch + src[i + 1];
        i += 2;
        continue;
      }
      if ((mode === 'sq' && ch === "'") || (mode === 'dq' && ch === '"') || (mode === 'tq' && ch === '`')) {
        out += ch;
        mode = 'code';
      } else {
        out += blankStrings ? (ch === '\n' ? '\n' : ' ') : ch;
      }
    }
    i += 1;
  }
  return out;
}

// 1. Refuse committed vault archives, .obsidian/, workspace state, and leaked campaign files.
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const forbiddenFiles = tracked.filter((rel) => {
  const lower = rel.toLowerCase();
  return (
    /\.(zip|7z|rar|tar\.gz|tgz)$/.test(lower)
    || /(^|\/)\.obsidian(\/|$)/.test(lower)
    || /(^|\/)workspace\.json$/.test(lower)
    || lower.includes('dragonlance')
  );
});
assert.deepEqual(forbiddenFiles, [], `Forbidden tracked files found: ${forbiddenFiles.join(', ')}`);

for (const dir of ['web', 'site']) {
  for (const file of walk(path.join(root, dir))) {
    if (!/\.(html|js|css|svg)$/i.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(!/dragonlance|siege of kalaman/i.test(text), `Forbidden reference in ${path.relative(root, file)}`);
  }
}

// 2. Version parity across Cargo.toml, README, CHANGELOG, site/, and web/.
const cargoToml = read('Cargo.toml');
const versionMatch = /^version\s*=\s*"([^"]+)"/m.exec(cargoToml);
assert.ok(versionMatch, 'Could not read workspace version from Cargo.toml');
const version = versionMatch[1];

const readme = read('README.md');
assert.ok(readme.includes(`version-${version}-`), `README.md badge missing version ${version}`);
assert.ok(readme.includes(`CortexSetup-${version}.exe`), `README.md installer missing version ${version}`);
assert.ok(readme.includes(`v${version}.md`), `README.md release notes link missing v${version}.md`);

const changelog = read('CHANGELOG.md');
assert.ok(changelog.includes(`## ${version}`), `CHANGELOG.md missing section for ${version}`);
for (const expected of ['## 2.1.0', '## 2.2.0', '## 2.2.1', '## 2.3.0']) {
  assert.ok(changelog.includes(expected), `CHANGELOG.md missing ${expected}`);
}

const siteHtml = read('site/index.html');
assert.ok(siteHtml.includes(`<span class="brand-version">v${version}</span>`), `site/index.html header version out of sync (expected v${version})`);
assert.ok(siteHtml.includes(`Cortex ${version}`), `site/index.html hero kicker out of sync (expected Cortex ${version})`);
assert.ok(siteHtml.includes(`CortexSetup-${version}.exe`), `site/index.html Windows download out of sync`);
assert.ok(!siteHtml.includes('>v2.0<') && !siteHtml.includes('Cortex 2.0'), 'site/index.html still contains stale v2.0 header copy');

const siteJs = read('site/main.js');
assert.ok(siteJs.includes(`Download v${version}`), `site/main.js fallback label out of sync (expected Download v${version})`);

const webHtml = read('web/index.html');
assert.ok(webHtml.includes(`v${version} · local-first`), `web/index.html launch badge out of sync (expected v${version})`);

// 3. Social cards & OG assets.
for (const tag of ['property="og:title"', 'property="og:description"', 'property="og:image"', 'name="twitter:card"', 'name="twitter:image"']) {
  assert.ok(siteHtml.includes(tag), `site/index.html missing ${tag}`);
}
assert.ok(fs.existsSync(path.join(root, 'assets/social-preview.jpg')), 'assets/social-preview.jpg missing');

// 4. Syntax check all JS/MJS files and statically verify ES module imports/exports.
const jsDirs = ['web/js', 'site', 'tools', 'tests'];
for (const dir of jsDirs) {
  const fullDir = path.join(root, dir);
  if (!fs.existsSync(fullDir)) continue;
  for (const file of walk(fullDir)) {
    if (/\.(js|mjs)$/.test(file)) {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    }
  }
}

const webJsDir = path.join(root, 'web/js');
const exportsByFile = new Map();
const webFiles = walk(webJsDir).filter((f) => f.endsWith('.js'));

for (const file of webFiles) {
  const clean = stripComments(fs.readFileSync(file, 'utf8'));
  const exported = new Set();
  for (const m of clean.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
  for (const m of clean.matchAll(/export\s+class\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
  for (const m of clean.matchAll(/export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) exported.add(m[1]);
  for (const m of clean.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const item = part.trim();
      if (!item) continue;
      const asParts = item.split(/\s+as\s+/);
      exported.add((asParts[1] || asParts[0]).trim());
    }
  }
  exportsByFile.set(path.resolve(file), exported);
}

for (const file of webFiles) {
  const raw = fs.readFileSync(file, 'utf8');
  const clean = stripComments(raw);
  const codeOnly = stripComments(raw, { blankStrings: true });
  const dir = path.dirname(file);

  for (const m of clean.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(dir, m[2]);
    const available = exportsByFile.get(target);
    assert.ok(available, `${path.relative(root, file)} imports missing module ${m[2]}`);
    for (const rawSpec of m[1].split(',')) {
      const spec = rawSpec.trim();
      if (!spec) continue;
      const orig = spec.split(/\s+as\s+/)[0].trim();
      assert.ok(available.has(orig), `${path.relative(root, file)} imports missing export '${orig}' from ${m[2]}`);
    }
  }

  for (const m of clean.matchAll(/import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const ns = m[1];
    const target = path.resolve(dir, m[2]);
    const available = exportsByFile.get(target);
    assert.ok(available, `${path.relative(root, file)} imports missing namespace module ${m[2]}`);
    const refRe = new RegExp(`\\b${ns}\\.([A-Za-z_$][\\w$]*)\\b`, 'g');
    for (const ref of codeOnly.matchAll(refRe)) {
      const member = ref[1];
      assert.ok(
        available.has(member),
        `${path.relative(root, file)} calls missing export ${ns}.${member} (from ${m[2]})`,
      );
    }
  }
}

console.log(`check-repo ok: v${version}, ${webFiles.length} web modules verified, 0 hygiene issues.`);
