// DOM builders. Every user string is escaped; colours go through CSSOM so the
// strict CSP never needs 'unsafe-inline'.

import { escapeHtml } from './markdown.js';

export function setStats(meta, overview = false) {
  const element = document.getElementById('stats');
  const items = [
    [Number(meta.note_count) || 0, 'notes'],
    [Number(meta.link_count) || 0, 'links'],
    [Number(meta.folder_count) || 0, 'folders'],
    [Number(meta.cluster_count) || 0, 'clusters'],
  ];
  const flag = overview
    ? '<span class="overview-tag" title="Folder-level overview: note labels appear when you hover or select one.">overview</span>'
    : '';
  element.innerHTML = items
    .map(([value, label]) => `<span><b>${value}</b> ${label}</span>`)
    .join('') + flag;
}

export function renderFolders(container, folders, hidden, onToggle, palette) {
  container.innerHTML = '';
  folders.forEach((folder) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-item';
    button.dataset.folder = folder.name;
    button.setAttribute('aria-pressed', String(!hidden.has(folder.name)));
    button.title = `Show or hide ${folder.name}`;

    const dot = document.createElement('span');
    dot.className = 'folder-dot';
    const color = palette[(folder.color ?? 0) % palette.length];
    dot.style.background = `rgb(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)})`;

    const name = document.createElement('span');
    name.className = 'folder-name';
    name.textContent = folder.name;

    const count = document.createElement('span');
    count.className = 'folder-count';
    count.textContent = String(folder.count);

    button.append(dot, name, count);
    button.addEventListener('click', () => onToggle(folder.name));
    container.appendChild(button);
  });
}

export function syncFolders(hidden) {
  document.querySelectorAll('.folder-item').forEach((element) => {
    const off = hidden.has(element.dataset.folder);
    element.classList.toggle('is-off', off);
    element.setAttribute('aria-pressed', String(!off));
  });
  const reset = document.getElementById('folders-reset');
  if (reset) reset.hidden = hidden.size === 0;
}

export function renderVaultList(container, vaults, activeId, onOpen, onReveal) {
  container.innerHTML = '';
  for (const vault of vaults) {
    const item = document.createElement('li');
    item.className = 'vault-row';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vault-item';
    if (vault.id === activeId) button.classList.add('is-active');
    if (vault.missing) button.classList.add('is-missing');
    button.title = vault.path;
    button.setAttribute('aria-current', String(vault.id === activeId));

    const name = document.createElement('span');
    name.className = 'vault-item-name';
    name.textContent = vault.name;

    const count = document.createElement('span');
    count.className = 'vault-item-count';
    count.textContent = vault.missing ? '' : vault.notes == null ? '' : String(vault.notes);

    button.append(name, count);
    button.addEventListener('click', () => onOpen(vault));
    item.appendChild(button);

    if (onReveal) {
      const reveal = document.createElement('button');
      reveal.type = 'button';
      reveal.className = 'vault-reveal';
      reveal.textContent = '⤢';
      reveal.title = `Show ${vault.name} in the file manager`;
      reveal.setAttribute('aria-label', `Show ${vault.name} in the file manager`);
      reveal.disabled = Boolean(vault.missing);
      reveal.addEventListener('click', (event) => {
        event.stopPropagation();
        onReveal(vault);
      });
      item.appendChild(reveal);
    }

    container.appendChild(item);
  }
}

export function renderLaunch(container, vaults, { onOpen, onForget }) {
  container.innerHTML = '';
  for (const vault of vaults) {
    const row = document.createElement('li');
    row.className = 'launch-row';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'launch-open';
    open.title = vault.path;

    const text = document.createElement('span');
    text.className = 'launch-item-text';
    const name = document.createElement('span');
    name.className = 'launch-item-name';
    name.textContent = vault.name;
    const path = document.createElement('span');
    path.className = 'launch-item-path';
    path.textContent = vault.path;
    text.append(name, path);

    const meta = document.createElement('span');
    meta.className = 'launch-item-meta';
    meta.textContent = vault.missing
      ? 'folder missing'
      : vault.loaded || vault.notes != null
        ? `${vault.notes == null ? '—' : vault.notes} notes`
        : 'open';

    open.append(text, meta);
    open.addEventListener('click', () => onOpen(vault));

    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'launch-item-forget';
    forget.textContent = 'Forget';
    forget.title = `Remove ${vault.name} from this list (the folder is not touched)`;
    forget.addEventListener('click', (event) => {
      event.stopPropagation();
      onForget(vault);
    });

    row.append(open, forget);
    container.appendChild(row);
  }
}

function relationList(title, notes, empty) {
  const items = (notes || [])
    .map(
      (note) =>
        `<button type="button" class="relation" data-note-id="${escapeHtml(note.id)}">` +
        `<span>${escapeHtml(note.title)}</span><span>${escapeHtml(note.folder)}</span></button>`,
    )
    .join('');
  return (
    `<section class="relations"><h2>${escapeHtml(title)}${notes && notes.length ? ` <span>${notes.length}</span>` : ''}</h2>` +
    `${items || `<p class="empty">${escapeHtml(empty)}</p>`}</section>`
  );
}

export function panelHtml(detail, markdownHtml) {
  const tags = (detail.tags || [])
    .map((tag) => `<span class="note-tag">#${escapeHtml(tag)}</span>`)
    .join('');
  const meta = [
    detail.created || 'Undated',
    `${Number(detail.words) || 0} words`,
    `${detail.backlinks.length} ${detail.backlinks.length === 1 ? 'backlink' : 'backlinks'}`,
  ]
    .map((part) => `<span>${escapeHtml(part)}</span>`)
    .join('');

  return `
    <h1 class="note-title">${escapeHtml(detail.title)}</h1>
    <div class="note-meta">${meta}</div>
    ${tags ? `<div class="note-tags">${tags}</div>` : ''}
    <div class="prose" id="note-prose">${markdownHtml}</div>
    ${relationList('Backlinks', detail.backlinks, 'No note links here yet.')}
    ${detail.mentions && detail.mentions.length ? relationList('Mentions', detail.mentions, '') : ''}
    ${relationList('Related', detail.related, 'Nothing shares a neighbour yet.')}
  `;
}

export function editorHtml(detail, draft) {
  return `
    <p class="note-crumb">Editing · ${escapeHtml(detail.folder)}</p>
    <h1 class="note-title">${escapeHtml(detail.title)}</h1>
    <textarea class="editor" id="note-editor" spellcheck="false" aria-label="Note source">${escapeHtml(draft)}</textarea>
  `;
}

export function renderPaletteHits(container, hits, active) {
  if (!hits.length) {
    container.innerHTML = '<p class="palette-empty">No note matches that.</p>';
    return;
  }
  container.innerHTML = hits
    .map(
      (hit, index) => `
      <button type="button" class="palette-hit${index === active ? ' is-active' : ''}" data-hit-index="${index}">
        <span class="palette-hit-title">${escapeHtml(hit.title)}</span>
        <span class="palette-hit-path">${escapeHtml(hit.folder)}</span>
        <span class="palette-hit-snippet">${escapeHtml(hit.snippet || '')}</span>
      </button>`,
    )
    .join('');
  const activeElement = container.querySelector('.is-active');
  if (activeElement) activeElement.scrollIntoView({ block: 'nearest' });
}

let toastTimer = null;
export function toast(message, duration = 3200) {
  const element = document.getElementById('toast');
  element.textContent = message;
  element.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    element.hidden = true;
  }, duration);
}

export function setBootStatus(message) {
  const element = document.getElementById('boot-status');
  if (element) element.textContent = message;
}

export function hideBoot() {
  const element = document.getElementById('boot');
  if (!element) return;
  element.classList.add('is-done');
  setTimeout(() => {
    element.hidden = true;
  }, 500);
}

export function setCrumbs(text) {
  const element = document.getElementById('panel-crumbs');
  if (element) element.textContent = text;
}

export function setModeButtons(mode) {
  document.querySelectorAll('.view[data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

export function showTooltip(node, x, y) {
  const element = document.getElementById('tooltip');
  element.hidden = false;
  element.querySelector('.tooltip-title').textContent = node.title;
  element.querySelector('.tooltip-meta').textContent = `${node.folder} · ${node.degree} links`;
  const rect = element.getBoundingClientRect();
  const left = Math.min(Math.max(12, x + 14), window.innerWidth - rect.width - 12);
  const top = Math.min(Math.max(12, y + 14), window.innerHeight - rect.height - 12);
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

export function hideTooltip() {
  const element = document.getElementById('tooltip');
  if (element) element.hidden = true;
}

const STATUS_LABELS = { open: 'Open', refining: 'Refining' };

function statusLabel(status) {
  if (STATUS_LABELS[status]) return STATUS_LABELS[status];
  if (!status) return 'Other';
  const words = status.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function decisionCard(card, onOpen) {
  const article = document.createElement('article');
  article.className = 'decision-card';

  const kind = document.createElement('p');
  kind.className = 'decision-kind';
  kind.textContent = card.kind === 'idea' ? 'Idea' : 'Research brief';
  article.appendChild(kind);

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'decision-title';
  title.textContent = card.title;
  title.addEventListener('click', () => onOpen(card.id));
  article.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'decision-meta';
  const sources = Number(card.sources) || 0;
  meta.textContent = [card.folder, card.created, `${sources} ${sources === 1 ? 'source' : 'sources'}`]
    .filter(Boolean)
    .join(' · ');
  article.appendChild(meta);

  if (card.evidence && card.evidence.length) {
    const chips = document.createElement('div');
    chips.className = 'decision-sources';
    for (const source of card.evidence) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'decision-source';
      chip.textContent = source.title;
      chip.title = `${source.title} — ${source.folder}`;
      chip.addEventListener('click', () => onOpen(source.id));
      chips.appendChild(chip);
    }
    article.appendChild(chips);
  }

  if (card.missing) {
    const missing = document.createElement('p');
    missing.className = 'decision-missing';
    const count = Number(card.missing);
    missing.textContent = `${count} ${count === 1 ? 'link points' : 'links point'} nowhere`;
    article.appendChild(missing);
  }

  return article;
}

/** The decisions view: structure notes grouped by their frontmatter status. */
export function renderDecisions(container, structures, onOpen) {
  container.textContent = '';
  const cards = (structures && structures.cards) || [];

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'decisions-empty';
    const title = document.createElement('h2');
    title.textContent = 'No structure notes yet';
    const body = document.createElement('p');
    body.textContent =
      'Collect a few notes, then press Research brief or Refine idea. Cortex writes the note into Synthesis/ and it appears here, with the notes it cites.';
    empty.append(title, body);
    container.appendChild(empty);
    return;
  }

  const columns = new Map();
  for (const card of cards) {
    const key = card.status || 'open';
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(card);
  }

  for (const [status, group] of columns) {
    const column = document.createElement('section');
    column.className = 'decision-col';

    const head = document.createElement('h2');
    head.className = 'decision-col-title';
    head.textContent = statusLabel(status);
    const count = document.createElement('span');
    count.className = 'decision-col-count';
    count.textContent = String(group.length);
    head.appendChild(count);
    column.appendChild(head);

    for (const card of group) column.appendChild(decisionCard(card, onOpen));
    container.appendChild(column);
  }

  const total = Number(structures.total) || cards.length;
  if (total > cards.length) {
    const more = document.createElement('p');
    more.className = 'decisions-more';
    more.textContent = `Showing ${cards.length} of ${total} structure notes.`;
    container.appendChild(more);
  }
}

/**
 * Bento: every folder becomes a box, its strongest notes become the contents.
 * The board answers "what is in this vault?" without asking anyone to read a
 * graph — sizes come from note count, not from link topology.
 */
export function renderBento(container, graph, hidden, { onOpen, onFolder, palette }) {
  container.textContent = '';
  const nodes = graph?.nodes || [];
  const total = nodes.length || 1;
  const byFolder = new Map();
  for (const node of nodes) {
    const list = byFolder.get(node.folder);
    if (list) list.push(node);
    else byFolder.set(node.folder, [node]);
  }
  for (const list of byFolder.values()) {
    list.sort(
      (a, b) =>
        (b.pagerank || 0) - (a.pagerank || 0)
        || String(b.created || '').localeCompare(String(a.created || ''))
        || a.title.localeCompare(b.title),
    );
  }

  const folders = [...(graph?.meta.folders || [])]
    .filter((folder) => (byFolder.get(folder.name) || []).length)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  if (!folders.length) {
    const empty = document.createElement('div');
    empty.className = 'bento-empty';
    const title = document.createElement('h2');
    title.textContent = 'No notes to group yet';
    const body = document.createElement('p');
    body.textContent = 'Open a folder of Markdown notes and its folders appear here as boxes.';
    empty.append(title, body);
    container.appendChild(empty);
    return;
  }

  folders.forEach((folder, rank) => {
    const notes = byFolder.get(folder.name) || [];
    const share = notes.length / total;
    const cell = document.createElement('article');
    cell.className = 'bento-cell';
    cell.dataset.folder = folder.name;
    if (hidden.has(folder.name)) cell.classList.add('is-off');
    // A handful of folders get a true bento rhythm; a vault with forty folders
    // stays a dense grid of equal cards instead of two giant boxes and a sea
    // of slivers.
    // One anchor tile and two wide tiles per board: a readable hierarchy that
    // does not turn a seven-folder vault into seven identical cards.
    if (rank === 0) cell.classList.add('is-large');
    else if (rank < 3) cell.classList.add('is-wide');

    const colour = palette[(folder.color ?? rank) % palette.length];
    cell.style.setProperty('--folder', `rgb(${Math.round(colour[0] * 255)}, ${Math.round(colour[1] * 255)}, ${Math.round(colour[2] * 255)})`);

    const head = document.createElement('header');
    head.className = 'bento-head';
    const dot = document.createElement('span');
    dot.className = 'bento-dot';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'bento-title';
    name.textContent = folder.name;
    name.title = `Fly into ${folder.name} in the graph`;
    name.addEventListener('click', () => onFolder(folder.name));
    const count = document.createElement('span');
    count.className = 'bento-count';
    count.textContent = String(notes.length);
    count.title = `${notes.length} of ${total} notes`;
    head.append(dot, name, count);
    cell.appendChild(head);

    const meta = document.createElement('p');
    meta.className = 'bento-meta';
    const top = notes[0];
    meta.textContent = top
      ? `${Math.round(share * 100)}% of the vault · ${top.title}`
      : `${Math.round(share * 100)}% of the vault`;
    cell.appendChild(meta);

    const list = document.createElement('div');
    list.className = 'bento-notes';
    const limit = cell.classList.contains('is-large') ? 9 : 2;
    for (const note of notes.slice(0, limit)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bento-note';
      button.title = note.title;
      const label = document.createElement('span');
      label.className = 'bento-note-title';
      label.textContent = note.title;
      const links = document.createElement('span');
      links.className = 'bento-note-meta';
      links.textContent = `${note.degree || 0}`;
      links.title = `${note.degree || 0} links`;
      button.append(label, links);
      button.addEventListener('click', () => onOpen(note.id));
      list.appendChild(button);
    }
    cell.appendChild(list);

    const footer = document.createElement('div');
    footer.className = 'bento-foot';
    if (notes.length > limit) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'bento-more';
      more.textContent = `+${notes.length - limit} more`;
      more.addEventListener('click', () => onFolder(folder.name));
      footer.appendChild(more);
    }
    const foot = document.createElement('button');
    foot.type = 'button';
    foot.className = 'bento-graph';
    foot.textContent = 'Open in graph ↗';
    foot.addEventListener('click', () => onFolder(folder.name));
    footer.appendChild(foot);
    cell.appendChild(footer);

    container.appendChild(cell);
  });
}

export function setTimelineDate(text) {
  const element = document.getElementById('replay-date');
  if (element) element.textContent = text;
}
