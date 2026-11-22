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
