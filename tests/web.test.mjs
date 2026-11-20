import assert from 'node:assert/strict';
import test from 'node:test';

import {
  escapeHtml,
  extractNoteTallies,
  renderMarkdown,
  toggleNthBallotBox,
  toggleNthTaskBox,
} from '../web/js/markdown.js';
import { clamp, easeInOut, lookAt, multiply, perspective, project, smoothstep } from '../web/js/math.js';
import { buildAppearValues, buildBrainPositions } from '../web/js/morph.js';
import { diaryFolders, isOverview, OVERVIEW_NOTES } from '../web/js/scale.js';

test('math helpers clamp, interpolate, and project deterministically', () => {
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(15, 0, 10), 10);
  assert.equal(clamp(4, 0, 10), 4);
  assert.equal(smoothstep(0, 1, 0), 0);
  assert.equal(smoothstep(0, 1, 1), 1);
  assert.equal(smoothstep(0, 1, 0.5), 0.5);
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);

  const p = perspective(new Float32Array(16), Math.PI / 3, 16 / 9, 0.1, 100);
  const v = lookAt(new Float32Array(16), [0, 0, 3], [0, 0, 0], [0, 1, 0]);
  const vp = multiply(new Float32Array(16), p, v);
  const center = project(vp, 0, 0, 0, 1440, 900);
  assert.ok(center);
  assert.ok(Math.abs(center.x - 720) < 0.01);
  assert.ok(Math.abs(center.y - 450) < 0.01);
  assert.equal(project(vp, 0, 0, 4, 1440, 900), null);
});

test('scale rules distinguish dense daily journals from topic folders', () => {
  assert.equal(isOverview(OVERVIEW_NOTES - 1), false);
  assert.equal(isOverview(OVERVIEW_NOTES), true);

  // Ensure consecutive spaced days spanning > 180 days with median gap <= 3
  const journal = Array.from({ length: 70 }, (_, idx) => {
    const dt = new Date(Date.UTC(2025, 0, 1 + idx * 3));
    return { folder: 'Journal', created: dt.toISOString().slice(0, 10) };
  });
  const sparse = Array.from({ length: 60 }, (_, idx) => {
    const dt = new Date(Date.UTC(2025, 0, 1 + idx * 14));
    return { folder: 'Topic', created: dt.toISOString().slice(0, 10) };
  });
  const diaries = diaryFolders([...journal, ...sparse]);
  assert.equal(diaries.has('Journal'), true);
  assert.equal(diaries.has('Topic'), false);
});

test('markdown escapes unsafe HTML, renders tables/callouts, and resolves escaped wikilinks', () => {
  assert.equal(escapeHtml('<script>"x"&\'y\'</script>'), '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');

  const md = [
    '# Heading',
    '',
    'Text with <script>alert(1)</script>, [[Note\\|Alias]], [bad](javascript:alert(1)), and [ok](https://example.com).',
    '',
    '> [!NOTE] Remember',
    '> Keep files local.',
    '',
    '| Name | Score |',
    '| --- | --- |',
    '| [[Alpha\\|First]] | 10 |',
  ].join('\n');

  const html = renderMarkdown(md, (target) => target === 'Note' || target === 'Alpha');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('data-target="Note"'));
  assert.ok(html.includes('>Alias<'));
  assert.ok(html.includes('data-target="Alpha"'));
  assert.ok(html.includes('callout'));
  assert.ok(html.includes('<table class="md-table">'));
});

test('task and tally helpers toggle exact indices without touching frontmatter', () => {
  const src = [
    '---',
    'title: "Test ☐"',
    '---',
    '',
    '- [ ] First task',
    '- [x] Second task',
    '',
    '## Scoreboard',
    '',
    '| Player | Points |',
    '| --- | --- |',
    '| [[Alice]] | ☐ ☑ ☐ |',
  ].join('\n');

  const toggledTask = toggleNthTaskBox(src, 0);
  assert.ok(toggledTask.includes('title: "Test ☐"'));
  assert.ok(toggledTask.includes('- [x] First task'));
  assert.ok(toggledTask.includes('- [x] Second task'));

  const toggledPip = toggleNthBallotBox(src, 0);
  assert.ok(toggledPip.includes('title: "Test ☐"'));
  assert.ok(toggledPip.includes('| [[Alice]] | ☑ ☑ ☐ |'));

  const tallies = extractNoteTallies(src, 'score', 'Score');
  assert.equal(tallies.length, 1);
  assert.equal(tallies[0].rows[0].label, 'Alice');
  assert.equal(tallies[0].rows[0].pips.length, 3);
  assert.equal(tallies[0].rows[0].pips[1].checked, true);
});

test('morph layout is deterministic and every note survives reveal animation', () => {
  const sameDay = [
    { id: 'A/1', folder: 'A', x: 0.1, y: 0.2, z: 0.3, created: '2026-11-20' },
    { id: 'A/2', folder: 'A', x: -0.2, y: 0.1, z: 0.4, created: '2026-11-20' },
    { id: 'B/1', folder: 'B', x: 0.4, y: -0.1, z: -0.2, created: '' },
  ];
  const appearSame = buildAppearValues(sameDay);
  for (const value of appearSame) {
    assert.ok(value >= 0 && value < 0.95, `appear value ${value} would hide note at reveal=1`);
  }

  const dated = [
    { id: 'A/1', folder: 'A', x: 0.1, y: 0.2, z: 0.3, created: '2024-01-01' },
    { id: 'A/2', folder: 'A', x: -0.2, y: 0.1, z: 0.4, created: '2026-11-20' },
    { id: 'B/1', folder: 'B', x: 0.4, y: -0.1, z: -0.2, created: '' },
  ];
  const appearDated = buildAppearValues(dated);
  for (const value of appearDated) {
    assert.ok(value >= 0 && value <= 0.9, `appear value ${value} out of safe range`);
  }

  const first = buildBrainPositions(dated, ['A', 'B']);
  const second = buildBrainPositions(dated, ['A', 'B']);
  assert.deepEqual([...first.positions], [...second.positions]);
  assert.ok([...first.positions].every((n) => Number.isFinite(n)));
});
