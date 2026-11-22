import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLocalVault, LIMITS } from '../web/js/localvault.js';

/**
 * A stand-in for a browser File. `webkitRelativePath` is what a folder picker
 * sets; `text()` is only called after the size checks, so tests that trip a
 * limit can make it throw and prove nothing was read.
 */
function note(path, body, { size, mtime, text } = {}) {
  return {
    name: path.split('/').pop(),
    webkitRelativePath: path,
    size: size ?? Buffer.byteLength(body, 'utf8'),
    lastModified: mtime ?? Date.UTC(2026, 0, 1),
    text: text ?? (async () => body),
  };
}

const indexOf = (graph, title) => {
  const index = graph.nodes.findIndex((node) => node.title === title);
  assert.notEqual(index, -1, `missing node ${title}`);
  return index;
};

test('frontmatter tags are normalised from inline and block lists', async () => {
  const graph = await buildLocalVault([
    note('Notities/Een.md', '---\ntags: [Dagboek, "Test Tag", "#derde"]\n---\n\n# Een\n'),
    note('Notities/Twee.md', '---\ntags:\n  - Project\n  - Diep Werk\n---\n\n# Twee\n'),
  ]);

  const tags = Object.fromEntries(graph.nodes.map((node) => [node.title, node.tags]));
  assert.deepEqual(tags.Een, ['dagboek', 'test-tag', 'derde']);
  assert.deepEqual(tags.Twee, ['project', 'diep-werk']);
});

test('wikilinks resolve by note title and by filename stem', async () => {
  const graph = await buildLocalVault([
    note('Dagboek/2026-01-01.md', '# Nieuw begin\n\nVandaag.\n'),
    note('Inbox.md', '# Inbox\n\nZie [[2026-01-01]].\n'),
    note('Projecten/Alfa.md', '# Alfa\n\nZie [[Nieuw begin]].\n'),
  ]);

  const target = indexOf(graph, 'Nieuw begin');
  assert.equal(graph.edges.length, 2);
  assert.deepEqual(
    graph.edges.map((edge) => edge.target),
    [target, target],
    'title link and stem link must land on the same note',
  );
  assert.equal(indexOf(graph, 'Alfa'), 2, 'sanity: path order is stable');
  assert.equal(graph.nodes[target].folder, 'Dagboek');
});

test('repeated links to one note collapse into a single weighted edge', async () => {
  const graph = await buildLocalVault([
    note(
      'Projecten/Bron.md',
      '# Bron\n\n[[Alfa]] en [[Alfa|de eerste]] en [[Alfa#Kop]].\n\n```\n[[Alfa]] in code telt niet\n```\n',
    ),
    note('Projecten/Alfa.md', '# Alfa\n'),
  ]);

  assert.equal(graph.edges.length, 1, 'a fenced code block must not add a link');
  assert.equal(graph.edges[0].weight, 3);
  assert.equal(graph.edges[0].source, indexOf(graph, 'Bron'));
  assert.equal(graph.edges[0].target, indexOf(graph, 'Alfa'));
});

test('an empty or non-Markdown selection is rejected', async () => {
  await assert.rejects(buildLocalVault([]), /No Markdown notes in that selection/);
  await assert.rejects(buildLocalVault(undefined), /No Markdown notes in that selection/);
  await assert.rejects(
    buildLocalVault([note('Beeld.png', 'x'), note('Leeg.md', '', { size: 0 })]),
    /No Markdown notes in that selection/,
  );
});

test('file and size limits are enforced before any note is read', async () => {
  const tooMany = Array.from({ length: LIMITS.files + 1 }, (_, index) => note(`n/${index}.md`, 'x'));
  await assert.rejects(
    buildLocalVault(tooMany),
    new RegExp(`caps a local vault at ${LIMITS.files}`),
  );

  const unreadable = () => {
    throw new Error('a rejected selection must not be read');
  };
  await assert.rejects(
    buildLocalVault([note('Groot.md', '', { size: LIMITS.bytes + 1, text: unreadable })]),
    /larger than 48 MB/,
  );
});

test('strips picked root vault folder so subfolders become real regions inside unit sphere', async () => {
  const graph = await buildLocalVault([
    note('MyVault/Ideas/Deep Work.md', '---\ntags: [focus]\n---\n\n# Deep Work\n\nSee [[Journal/2026-01-01]] and [[Loose]].\n'),
    note('MyVault/Journal/2026-01-01.md', '# New Year\n\nBack to [[Deep Work]].\n'),
    note('MyVault/Loose.md', '# Loose\n\nTop-level inbox note.\n'),
  ]);

  assert.equal(graph.meta.title, 'MyVault');
  assert.deepEqual(
    graph.meta.folders.map((f) => f.name),
    ['Ideas', 'Inbox', 'Journal'],
  );
  assert.equal(graph.meta.folder_count, 3);

  const deepWork = graph.nodes.find((n) => n.title === 'Deep Work');
  assert.equal(deepWork.id, 'Ideas/Deep Work');
  assert.ok(deepWork.raw.startsWith('---\ntags: [focus]\n---'), 'preserves YAML frontmatter in raw');
  assert.deepEqual(deepWork.links.sort(), ['Journal/2026-01-01', 'Loose']);

  for (const node of graph.nodes) {
    const r = Math.hypot(node.x, node.y, node.z);
    assert.ok(r <= 1.05, `node ${node.id} radius ${r} exceeded camera frustum`);
  }
});

test('peels redundant wrapper folders while keeping real nested folders intact', async () => {
  const graph = await buildLocalVault([
    note('Exports/MainVault/Research/Alpha.md', '# Alpha\n'),
    note('Exports/MainVault/Craft/Beta.md', '# Beta\n\nSee [[Alpha]].\n'),
  ]);

  assert.equal(graph.meta.title, 'MainVault');
  assert.deepEqual(
    graph.meta.folders.map((f) => f.name),
    ['Craft', 'Research'],
  );
});

test('flat single-folder vault groups notes by primary #tag when at least two tags exist', async () => {
  const graph = await buildLocalVault([
    note('FlatVault/One.md', '#One\n\n#alpha\n\nBody one'),
    note('FlatVault/Two.md', '---\ntags: [alpha]\n---\n\n# Two\n'),
    note('FlatVault/Three.md', '---\ntags: [beta]\n---\n\n# Three\n'),
    note('FlatVault/Four.md', 'Body without tag'),
  ]);

  assert.equal(graph.meta.title, 'FlatVault');
  assert.ok(graph.meta.folder_count >= 2, 'expected flat vault to split into >= 2 regions by primary tag');
  assert.deepEqual(
    graph.meta.folders.map((f) => f.name),
    ['#alpha', '#beta', 'Untagged'],
  );
});

test('builds Decisions cards, resolves frontmatter aliases, and strips escaped pipes in wikilinks', async () => {
  const graph = await buildLocalVault([
    note(
      'MyVault/Sources/Attention.md',
      '---\naliases: [Deep Focus]\n---\n\n# Attention Study\n\nFocus lasts longer without switches.\n',
    ),
    note(
      'MyVault/Sources/Prior.md',
      '---\ntype: research\nstatus: accepted\ncreated: 2026-08-01\n---\n\n# Prior Brief\n\n[[Attention Study]]\n',
    ),
    note(
      'MyVault/Decisions/Protect Mornings.md',
      '---\ntype: idea\nstatus: refining\ncreated: 2026-10-10\nconfidence: 0.85\nreview_on: 2026-12-01\nsupersedes: Prior Brief\n---\n\n# Protect Mornings\n\nSee [[Deep Focus\\|study]] and [[Missing Note]].\n',
    ),
  ]);

  assert.equal(graph.structures.total, 2);
  assert.equal(graph.structures.open, 1);
  const idea = graph.structures.cards[0];
  assert.equal(idea.title, 'Protect Mornings');
  assert.equal(idea.kind, 'idea');
  assert.equal(idea.status, 'refining');
  assert.equal(idea.confidence, 85);
  assert.equal(idea.review_on, '2026-12-01');
  assert.equal(idea.supersedes?.title, 'Prior Brief');
  assert.equal(idea.sources, 1);
  assert.equal(idea.missing, 1);
  assert.equal(idea.evidence[0]?.id, 'Sources/Attention');
});
