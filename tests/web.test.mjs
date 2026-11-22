import assert from 'node:assert/strict';
import test from 'node:test';

import {
  joinDocument,
  joinMarkdownBlocks,
  parseFrontmatterBlock,
  splitDocument,
  splitMarkdownBlocks,
  updateFrontmatterTags,
} from '../web/js/live-editor.js';
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

test('splitDocument and joinDocument perform lossless round-trip across document shapes and line endings', () => {
  const cases = [
    {
      name: 'frontmatter + H1 + body (LF)',
      raw: '---\ntitle: Deep Work\ntags: [focus, craft]\n---\n\n# Deep Work\n\nBody paragraph.\n',
      hasFm: true,
      titleText: 'Deep Work',
      body: '\nBody paragraph.\n',
    },
    {
      name: 'frontmatter + H1 + body (CRLF)',
      raw: '---\r\ntitle: Deep Work\r\ntags: [focus]\r\n---\r\n\r\n# Deep Work\r\n\r\nLine one.\r\nLine two.',
      hasFm: true,
      titleText: 'Deep Work',
      body: '\r\nLine one.\r\nLine two.',
    },
    {
      name: 'frontmatter without H1 (starts with H2)',
      raw: '---\nstatus: open\n---\n\n## Section\n\nDetails here.\n',
      hasFm: true,
      titleText: '',
      body: '\n## Section\n\nDetails here.\n',
    },
    {
      name: 'without frontmatter, with H1',
      raw: '# Standalone Note\n\nJust markdown.\n',
      hasFm: false,
      titleText: 'Standalone Note',
      body: '\nJust markdown.\n',
    },
    {
      name: 'without frontmatter and without H1',
      raw: 'Plain opening paragraph.\n\n- item 1\n- item 2',
      hasFm: false,
      titleText: '',
      body: 'Plain opening paragraph.\n\n- item 1\n- item 2',
    },
    {
      name: 'BOM + ... frontmatter terminator + no trailing newline',
      raw: '\uFEFF---\ntype: idea\n...\n# Title Only',
      hasFm: true,
      titleText: 'Title Only',
      body: '',
    },
    {
      name: 'empty document',
      raw: '',
      hasFm: false,
      titleText: '',
      body: '',
    },
  ];

  for (const tc of cases) {
    const split = splitDocument(tc.raw);
    assert.equal(Boolean(split.frontmatter), tc.hasFm, `${tc.name}: frontmatter presence`);
    assert.equal(split.titleText, tc.titleText, `${tc.name}: titleText`);
    assert.equal(split.body, tc.body, `${tc.name}: body`);
    assert.equal(joinDocument(split), tc.raw, `${tc.name}: lossless joinDocument`);
  }

  assert.equal(
    joinDocument({ frontmatter: '---\na: 1\n---', titleLine: '# Title', body: 'Hello' }),
    '---\na: 1\n---\n# Title\nHello',
  );
});

test('parseFrontmatterBlock and updateFrontmatterTags preserve keys and handle add/update/remove', () => {
  const fmBlockList = [
    '---',
    'title: "Quoted: Value"',
    '# YAML comment',
    'tags:',
    '  - alpha',
    '  - "beta, gamma"',
    'confidence: 0.85',
    'empty_key:',
    '---',
    '',
  ].join('\n');

  const parsed = parseFrontmatterBlock(fmBlockList);
  assert.deepEqual(parsed, [
    { key: 'title', value: 'Quoted: Value', isList: false, items: [] },
    { key: 'tags', value: 'alpha, beta, gamma', isList: true, items: ['alpha', 'beta, gamma'] },
    { key: 'confidence', value: '0.85', isList: false, items: [] },
    { key: 'empty_key', value: '', isList: false, items: [] },
  ]);

  assert.deepEqual(parseFrontmatterBlock(''), []);
  assert.deepEqual(parseFrontmatterBlock('not frontmatter'), []);

  // Update existing block-list tags while preserving other keys and comments
  const updated = updateFrontmatterTags(fmBlockList, ['#Focus', 'focus', 'two words']);
  assert.ok(updated.includes('title: "Quoted: Value"'));
  assert.ok(updated.includes('# YAML comment'));
  assert.ok(updated.includes('confidence: 0.85'));
  assert.ok(updated.includes('empty_key:'));
  assert.ok(updated.includes('tags: [Focus, "two words"]'));
  assert.ok(!updated.includes('  - alpha'));

  // Remove tags cleanly when other keys exist
  const removedWithOthers = updateFrontmatterTags(updated, []);
  assert.ok(!/tags\s*:/i.test(removedWithOthers));
  assert.ok(removedWithOthers.includes('title: "Quoted: Value"'));
  assert.ok(removedWithOthers.includes('confidence: 0.85'));

  // Add tags when absent in existing CRLF frontmatter
  const noTagsCrlf = '---\r\ndate: 2026-11-22\r\nstatus: open\r\n---\r\n';
  const addedToExisting = updateFrontmatterTags(noTagsCrlf, ['craft', 'notes']);
  assert.equal(
    addedToExisting,
    '---\r\ndate: 2026-11-22\r\nstatus: open\r\ntags: [craft, notes]\r\n---\r\n',
  );

  // Add tags when frontmatter is absent, then remove all tags cleanly -> ''
  const createdFm = updateFrontmatterTags('', ['solo']);
  assert.equal(createdFm, '---\ntags: [solo]\n---\n');
  assert.equal(updateFrontmatterTags(createdFm, []), '');
});

test('splitMarkdownBlocks and joinMarkdownBlocks round-trip all block kinds losslessly', () => {
  const richBody = [
    '## Architecture Notes',
    '',
    'Opening paragraph with [[Deep Work]] and **bold** text.',
    'Continued on the next line.',
    '',
    '```js',
    'const x = 1;',
    '// ~~~ not a closing fence',
    '```',
    '',
    '~~~markdown',
    '# Heading inside tilde fence',
    '~~~',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '$$a^2 + b^2 = c^2$$',
    '',
    '> [!NOTE] Local-first',
    '> Keep plain Markdown on disk.',
    '',
    '> Regular blockquote line.',
    '> Second quote line.',
    '',
    '| Name | Status |',
    '| --- | --- |',
    '| Cortex | Ready |',
    '',
    '- [ ] First task',
    '- [x] Completed task',
    '  - Nested bullet',
    '1. Ordered item',
    '',
    '---',
    '',
    'Final paragraph without trailing newline',
  ].join('\n');

  const blocks = splitMarkdownBlocks(richBody);
  assert.equal(joinMarkdownBlocks(blocks), richBody);

  const kinds = blocks.map((b) => b.kind);
  assert.deepEqual(kinds, [
    'heading',
    'paragraph',
    'code',
    'code',
    'math',
    'math',
    'callout',
    'quote',
    'table',
    'list',
    'hr',
    'paragraph',
  ]);

  // CRLF round-trip
  const crlfBody = richBody.replace(/\n/g, '\r\n');
  const crlfBlocks = splitMarkdownBlocks(crlfBody);
  assert.deepEqual(crlfBlocks.map((b) => b.kind), kinds);
  assert.equal(joinMarkdownBlocks(crlfBlocks), crlfBody);

  // Adjacent blocks without blank lines & whitespace edge cases
  const edgeCases = [
    '',
    '   \n\n  ',
    '\n\n# Leading Blank Lines\nParagraph immediately after\n> Quote immediately after\n***\n- list item\n```py\nprint(1)\n```\n| A | B |\n| - | - |\n| 1 | 2 |\n',
    'Unclosed ``` fence\nstill code',
  ];
  for (const sample of edgeCases) {
    assert.equal(joinMarkdownBlocks(splitMarkdownBlocks(sample)), sample);
  }
  assert.deepEqual(splitMarkdownBlocks(''), []);
  assert.equal(joinMarkdownBlocks([]), '');
  assert.equal(joinMarkdownBlocks(null), '');
});
