// DOM builders. Every user string is escaped; colours go through CSSOM so the
// strict CSP never needs 'unsafe-inline'.

import { escapeHtml } from './markdown.js';
import { key } from './platform.js';

export function setStats(meta, overview = false) {
  const element = document.getElementById('stats');
  if (!element) return;
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
  element.hidden = false;
}

export function cleanDisplayPath(rawPath) {
  const raw = String(rawPath || '').trim();
  if (!raw) return '';
  if (raw.startsWith('\\\\?\\UNC\\')) return `\\\\${raw.slice(8)}`;
  if (raw.startsWith('\\\\?\\')) return raw.slice(4);
  return raw;
}

export function cleanSnippet(raw) {
  return String(raw || '')
    .replace(/^\s*(?:>\s*)?\[?!?[a-zA-Z0-9_-]+\][+-]?\s*/i, '')
    .trim();
}

/**
 * Format a contextual snippet and highlight occurrences of `[[targetTitle]]` or `targetTitle`.
 */
export function highlightMentionSnippet(rawSnippet, targetTitle) {
  const text = cleanSnippet(rawSnippet);
  if (!text) return '';
  if (!targetTitle) return escapeHtml(text);

  const escapedTarget = targetTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(\\[\\[${escapedTarget}(?:\\|[^\\]]+)?\\]\\]|${escapedTarget})`, 'ig');
  const parts = text.split(pattern);
  return parts
    .map((part, idx) => (idx % 2 === 1
      ? `<mark class="mention-highlight">${escapeHtml(part)}</mark>`
      : escapeHtml(part)))
    .join('');
}

export function renderPinnedSidebar(
  container,
  blockEl,
  pinnedIds,
  nodesById,
  selectedId,
  { showEmptyHint = false, onOpen, onUnpin } = {},
) {
  if (!container || !blockEl) return;
  container.innerHTML = '';
  const validNotes = (pinnedIds || [])
    .map((id) => nodesById.get(id))
    .filter(Boolean);

  if (!validNotes.length) {
    if (showEmptyHint) {
      blockEl.hidden = false;
      const hint = document.createElement('p');
      hint.className = 'pinned-empty';
      hint.textContent = 'Pin any note (p) to keep it here for instant access.';
      container.appendChild(hint);
    } else {
      blockEl.hidden = true;
    }
    return;
  }

  blockEl.hidden = false;
  for (const node of validNotes) {
    const row = document.createElement('div');
    row.className = `pinned-row${node.id === selectedId ? ' is-active' : ''}`;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pinned-item';
    btn.title = `${node.title} (${node.folder})`;

    const title = document.createElement('span');
    title.className = 'pinned-title';
    title.textContent = node.title;

    const folder = document.createElement('span');
    folder.className = 'pinned-folder';
    folder.textContent = node.folder;

    btn.append(title, folder);
    btn.addEventListener('click', () => onOpen?.(node.id));
    row.appendChild(btn);

    if (onUnpin) {
      const unpin = document.createElement('button');
      unpin.type = 'button';
      unpin.className = 'pinned-unpin';
      unpin.title = `Unpin ${node.title}`;
      unpin.setAttribute('aria-label', `Unpin ${node.title}`);
      unpin.textContent = '×';
      unpin.addEventListener('click', (event) => {
        event.stopPropagation();
        onUnpin(node.id);
      });
      row.appendChild(unpin);
    }
    container.appendChild(row);
  }
}

export function renderFolders(
  container,
  folders,
  hidden,
  onToggle,
  palette,
  { nodes = [], expanded = new Set(), selectedId = null, onToggleExpand = null, onOpenNote = null } = {},
) {
  container.innerHTML = '';
  const notesByFolder = new Map();
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const list = notesByFolder.get(node.folder);
    if (list) list.push({ node, index: i });
    else notesByFolder.set(node.folder, [{ node, index: i }]);
  }
  for (const list of notesByFolder.values()) {
    list.sort((a, b) => a.node.id.localeCompare(b.node.id));
  }

  folders.forEach((folder) => {
    const isExpanded = expanded.has(folder.name);
    const group = document.createElement('div');
    group.className = `folder-group${isExpanded ? ' is-open' : ''}`;
    group.dataset.folderGroup = folder.name;

    const row = document.createElement('div');
    row.className = 'folder-row';

    if (onToggleExpand) {
      const expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'folder-expand';
      expandBtn.setAttribute('aria-expanded', String(isExpanded));
      expandBtn.title = `${isExpanded ? 'Collapse' : 'Browse'} notes in ${folder.name}`;
      expandBtn.setAttribute('aria-label', `${isExpanded ? 'Collapse' : 'Browse'} notes in ${folder.name}`);
      expandBtn.textContent = isExpanded ? '▾' : '▸';
      expandBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        onToggleExpand(folder.name);
      });
      row.appendChild(expandBtn);
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'folder-item';
    button.dataset.folder = folder.name;
    button.setAttribute('aria-pressed', String(!hidden.has(folder.name)));
    button.title = `Show or hide ${folder.name} in the graph`;

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
    row.appendChild(button);
    group.appendChild(row);

    const folderNotes = notesByFolder.get(folder.name) || [];
    if (isExpanded && folderNotes.length && onOpenNote) {
      const list = document.createElement('div');
      list.className = 'folder-notes';
      for (const { node, index } of folderNotes) {
        const noteBtn = document.createElement('button');
        noteBtn.type = 'button';
        noteBtn.className = `folder-note${node.id === selectedId ? ' is-active' : ''}`;
        noteBtn.dataset.noteId = node.id;
        noteBtn.title = `${node.title} (${node.degree || 0} links)`;

        const parts = node.id.split('/');
        const subfolder = parts.length > 2 ? parts.slice(1, -1).join('/') : '';
        if (subfolder) {
          const sub = document.createElement('span');
          sub.className = 'folder-note-sub';
          sub.textContent = subfolder;
          noteBtn.appendChild(sub);
        }

        const titleSpan = document.createElement('span');
        titleSpan.className = 'folder-note-title';
        titleSpan.textContent = node.title;
        noteBtn.appendChild(titleSpan);

        noteBtn.addEventListener('click', () => onOpenNote(index));
        list.appendChild(noteBtn);
      }
      group.appendChild(list);
    }

    container.appendChild(group);
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

function shortTallyTabName(title) {
  const lower = String(title || '').toLowerCase();
  if (lower.includes('cool')) return 'Cool';
  if (lower.includes('crybaby')) return 'Crybaby';
  return String(title || 'Tally').slice(0, 14);
}

export function renderTallies(
  container,
  {
    sections = [],
    activeSectionId = null,
    customCounters = [],
    addingCustom = false,
    onSelectSection,
    onToggleNotePip,
    onOpenNoteByTarget,
    onOpenSourceNote,
    onAdjustCustom,
    onToggleCustomPip,
    onAddCustom,
    onDeleteCustom,
    onCancelAdd,
  } = {},
) {
  if (!container) return;
  container.innerHTML = '';

  if (addingCustom) {
    const form = document.createElement('form');
    form.className = 'tally-add-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tally-add-input';
    input.placeholder = 'Counter name (e.g. Cool points)…';
    input.maxLength = 40;
    input.required = true;
    const actions = document.createElement('div');
    actions.className = 'tally-add-actions';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'btn btn-primary tally-add-btn';
    save.textContent = 'Add';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'text-button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => onCancelAdd?.());
    actions.append(save, cancel);
    form.append(input, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const val = input.value.trim();
      if (val) onAddCustom?.(val);
    });
    container.appendChild(form);
    setTimeout(() => input.focus(), 0);
  }

  if (sections.length > 0) {
    const active = sections.find((s) => s.id === activeSectionId) || sections[0];
    if (sections.length > 1) {
      const tabBar = document.createElement('div');
      tabBar.className = 'tally-tabs';
      for (const sec of sections) {
        const isCurrent = sec.id === active.id;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = `tally-tab${isCurrent ? ' is-active' : ''}`;
        tab.setAttribute('aria-pressed', String(isCurrent));
        tab.textContent = shortTallyTabName(sec.title);
        tab.title = `${sec.title} (${sec.noteTitle})`;
        tab.addEventListener('click', () => onSelectSection?.(sec.id));
        tabBar.appendChild(tab);
      }
      if (onOpenSourceNote && active.noteId) {
        const srcBtn = document.createElement('button');
        srcBtn.type = 'button';
        srcBtn.className = 'tally-source-btn';
        srcBtn.textContent = '↗';
        srcBtn.title = `Open ${active.noteTitle}`;
        srcBtn.setAttribute('aria-label', `Open ${active.noteTitle}`);
        srcBtn.addEventListener('click', () => onOpenSourceNote(active.noteId));
        tabBar.appendChild(srcBtn);
      }
      container.appendChild(tabBar);
    }

    const list = document.createElement('div');
    list.className = 'tally-list';
    const isCrybaby = /crybaby/i.test(active.title);

    for (const row of active.rows) {
      const item = document.createElement('div');
      item.className = `tally-row${isCrybaby ? ' is-crybaby' : ' is-cool'}`;

      const labelBtn = document.createElement('button');
      labelBtn.type = 'button';
      labelBtn.className = 'tally-label';
      labelBtn.textContent = row.label;
      labelBtn.title = row.targetNote ? `Open ${row.label}` : row.label;
      if (row.targetNote && onOpenNoteByTarget) {
        labelBtn.addEventListener('click', () => onOpenNoteByTarget(row.targetNote));
      } else if (active.noteId && onOpenSourceNote) {
        labelBtn.addEventListener('click', () => onOpenSourceNote(active.noteId));
      }

      const pipsWrap = document.createElement('div');
      pipsWrap.className = 'tally-pips';
      for (const pip of row.pips) {
        const pipBtn = document.createElement('button');
        pipBtn.type = 'button';
        pipBtn.className = `tally-pip${pip.checked ? ' is-checked' : ''}${pip.isBonus ? ' is-bonus' : ''}`;
        pipBtn.setAttribute('aria-pressed', String(pip.checked));
        pipBtn.title = `${row.label} · ${active.title} (${pip.colHeader || 'point'})`;
        pipBtn.textContent = pip.checked ? (pip.isBonus ? '★' : '✓') : '';
        pipBtn.addEventListener('click', () => {
          onToggleNotePip?.(active.noteId, pip.pipIndex, row, active);
        });
        pipsWrap.appendChild(pipBtn);
      }

      item.append(labelBtn, pipsWrap);
      list.appendChild(item);
    }
    container.appendChild(list);
  }

  if (customCounters.length > 0) {
    const customList = document.createElement('div');
    customList.className = 'tally-list tally-list-custom';
    for (const counter of customCounters) {
      const row = document.createElement('div');
      row.className = 'tally-row is-custom';

      const label = document.createElement('span');
      label.className = 'tally-label';
      label.textContent = counter.label;
      label.title = counter.label;

      const controls = document.createElement('div');
      controls.className = 'tally-pips';
      const maxPips = counter.max || 3;
      for (let p = 0; p < maxPips; p += 1) {
        const checked = p < (counter.count || 0);
        const pipBtn = document.createElement('button');
        pipBtn.type = 'button';
        pipBtn.className = `tally-pip${checked ? ' is-checked' : ''}`;
        pipBtn.setAttribute('aria-pressed', String(checked));
        pipBtn.title = `${counter.label}: ${counter.count || 0}/${maxPips}`;
        pipBtn.textContent = checked ? '✓' : '';
        pipBtn.addEventListener('click', () => onToggleCustomPip?.(counter.id, p));
        controls.appendChild(pipBtn);
      }

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'tally-step';
      minus.textContent = '−';
      minus.title = 'Decrease';
      minus.addEventListener('click', () => onAdjustCustom?.(counter.id, -1));

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'tally-step';
      plus.textContent = '+';
      plus.title = 'Increase';
      plus.addEventListener('click', () => onAdjustCustom?.(counter.id, 1));

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'tally-del';
      del.textContent = '×';
      del.title = `Remove ${counter.label}`;
      del.addEventListener('click', () => onDeleteCustom?.(counter.id));

      controls.append(minus, plus, del);
      row.append(label, controls);
      customList.appendChild(row);
    }
    container.appendChild(customList);
  }

  if (!sections.length && !customCounters.length && !addingCustom) {
    const empty = document.createElement('p');
    empty.className = 'tally-empty';
    empty.textContent = 'Track points, habits, or table scores. Click + Counter to add one.';
    container.appendChild(empty);
  }
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
    button.title = cleanDisplayPath(vault.path);
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
      reveal.innerHTML =
        '<svg class="icon" aria-hidden="true"><use href="#i-external-link"></use></svg>';
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
    const cleanPath = cleanDisplayPath(vault.path);
    open.title = cleanPath;

    const tile = document.createElement('span');
    tile.className = 'launch-item-tile';
    tile.setAttribute('aria-hidden', 'true');
    tile.textContent = (vault.name || '?').trim().charAt(0).toUpperCase();

    const text = document.createElement('span');
    text.className = 'launch-item-text';
    const name = document.createElement('span');
    name.className = 'launch-item-name';
    name.textContent = vault.name;
    const path = document.createElement('span');
    path.className = 'launch-item-path';
    path.textContent = cleanPath;
    text.append(name, path);

    const meta = document.createElement('span');
    meta.className = 'launch-item-meta';
    meta.textContent = vault.missing
      ? 'folder missing'
      : vault.loaded || vault.notes != null
        ? `${vault.notes == null ? '—' : vault.notes} notes`
        : 'open';

    open.append(tile, text, meta);
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
  const recents = container.closest('.launch-recents');
  if (recents) recents.hidden = vaults.length === 0;
}

function connectionItemsHtml(notes, empty, { targetTitle = '', allowLinkMention = false } = {}) {
  const items = (notes || [])
    .map((note) => {
      const snippetHtml = note.snippet
        ? `<span class="relation-snippet">${highlightMentionSnippet(note.snippet, targetTitle)}</span>`
        : '';
      const linkBtn = allowLinkMention
        ? `<button type="button" class="relation-link-btn" data-link-mention-id="${escapeHtml(note.id)}" title="Convert this plain-text mention into [[${escapeHtml(targetTitle)}]]">Link</button>`
        : '';
      return (
        `<div class="relation-card">` +
        `<div class="relation-top">` +
        `<button type="button" class="relation" data-note-id="${escapeHtml(note.id)}">` +
        `<span class="relation-title">${escapeHtml(note.title)}</span>` +
        `<span class="relation-folder">${escapeHtml(note.folder)}</span></button>` +
        `${linkBtn}</div>` +
        `${snippetHtml}</div>`
      );
    })
    .join('');
  return items || `<p class="empty">${escapeHtml(empty)}</p>`;
}

function connectionsHtml(detail, writable = false) {
  const groups = [];
  if (detail.kind && detail.evidence) {
    groups.push({
      id: 'sources',
      label: 'Sources',
      notes: detail.evidence || [],
      empty: 'No linked sources yet.',
    });
  }
  groups.push({
    id: 'backlinks',
    label: 'Backlinks',
    notes: detail.backlinks || [],
    empty: 'No note links here yet.',
  });
  if (detail.mentions && detail.mentions.length) {
    groups.push({
      id: 'mentions',
      label: 'Mentions',
      notes: detail.mentions,
      empty: 'No unlinked mentions.',
    });
  }
  groups.push({
    id: 'related',
    label: 'Related',
    notes: detail.related || [],
    empty: 'Nothing shares a neighbour yet.',
  });

  const firstPopulated = groups.findIndex((group) => group.notes.length > 0);
  const activeIndex = firstPopulated >= 0 ? firstPopulated : 0;

  const tabs = groups
    .map((group, index) => {
      const active = index === activeIndex;
      return (
        `<button type="button" class="connections-tab" role="tab" id="conn-tab-${group.id}" ` +
        `data-conn-tab="${group.id}" aria-selected="${active ? 'true' : 'false'}" ` +
        `tabindex="${active ? '0' : '-1'}">` +
        `<span>${escapeHtml(group.label)}</span>` +
        `<span class="connections-count">${group.notes.length}</span></button>`
      );
    })
    .join('');

  const panels = groups
    .map((group, index) => {
      const active = index === activeIndex;
      const hiddenAttr = active ? '' : ' hidden="until-found"';
      const tabIndexAttr = active && !group.notes.length ? ' tabindex="0"' : '';
      return (
        `<div class="connections-panel" role="tabpanel" aria-labelledby="conn-tab-${group.id}" ` +
        `data-conn-panel="${group.id}"${hiddenAttr}${tabIndexAttr}>` +
        `<div class="connections-list">${connectionItemsHtml(group.notes, group.empty, {
          targetTitle: detail.title,
          allowLinkMention: writable && group.id === 'mentions',
        })}</div></div>`
      );
    })
    .join('');

  return `
    <section class="connections" id="note-connections" aria-label="Note connections">
      <div class="connections-tabs" role="tablist" aria-label="Note connections">${tabs}</div>
      <div class="connections-panels">${panels}</div>
    </section>`;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isReviewDue(date) {
  return Boolean(date) && date <= todayIso();
}

function clampPct(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function decisionTrail(detail) {
  if (detail.kind !== 'research' && detail.kind !== 'idea') return '';
  const due = isReviewDue(detail.review_on);
  const status = detail.status || (detail.kind === 'idea' ? 'refining' : 'open');
  const hasConfidence = detail.confidence !== null && detail.confidence !== undefined;
  const pct = hasConfidence ? clampPct(detail.confidence) : null;

  const facts = [];
  facts.push(
    `<span class="trail-fact">Status <strong class="trail-status-pill">${escapeHtml(status)}</strong></span>`,
  );
  if (hasConfidence) {
    facts.push(`<span class="trail-fact">Confidence <strong>${pct}%</strong></span>`);
  }
  if (detail.review_on) {
    facts.push(
      `<span class="trail-fact${due ? ' trail-review' : ''}">Review <strong>${escapeHtml(detail.review_on)}</strong></span>`,
    );
  } else {
    facts.push('<span class="trail-fact">No review date</span>');
  }
  const meter = hasConfidence
    ? `<div class="confidence-meter" role="meter" aria-label="Confidence" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">` +
      `<span class="confidence-fill" data-confidence="${pct}"></span></div>`
    : '';
  const supersedes = detail.supersedes
    ? `<button class="trail-supersedes" type="button" data-note-id="${escapeHtml(detail.supersedes.id)}">Supersedes “${escapeHtml(detail.supersedes.title)}”</button>`
    : '';
  return `
    <section class="decision-trail${due ? ' is-due' : ''}" id="decision-trail" aria-label="Decision trail">
      <div class="trail-head">
        <p class="trail-kicker">Decision trail</p>
        ${due ? '<span class="trail-flag">Review due</span>' : ''}
      </div>
      <div class="trail-facts">${facts.join('')}</div>
      ${meter}
      ${supersedes}
      <p class="trail-help">Linked sources sit below the note. Press <kbd>y</kbd> to jump back here.</p>
    </section>`;
}

export function panelHtml(detail, markdownHtml, writable = false) {
  const tags = (detail.tags || [])
    .map((tag) => `<span class="note-tag">#${escapeHtml(tag)}</span>`)
    .join('');
  const words = Number(detail.words) || 0;
  const readMin = Math.max(1, Math.round(words / 200));
  const meta = [
    detail.created || 'Undated',
    `${words} words`,
    `${readMin} min read`,
    `${detail.backlinks.length} ${detail.backlinks.length === 1 ? 'backlink' : 'backlinks'}`,
  ]
    .map((part) => `<span>${escapeHtml(part)}</span>`)
    .join('');

  return `
    <div class="panel-article">
      <h1 class="note-title">${escapeHtml(detail.title)}</h1>
      <div class="note-meta">${meta}</div>
      ${tags ? `<div class="note-tags">${tags}</div>` : ''}
      ${decisionTrail(detail)}
      <div class="prose" id="note-prose">${markdownHtml}</div>
      ${connectionsHtml(detail, writable)}
    </div>
  `;
}

export function editorToolbarHtml() {
  const groups = [
    {
      label: 'Style',
      tools: [
        ['bold', 'i-bold', `Bold (${key('B')})`],
        ['italic', 'i-italic', `Italic (${key('I')})`],
        ['code', 'i-code', `Inline code (${key('E')})`],
        ['heading', 'i-heading', `Heading (${key('2')})`],
      ],
    },
    {
      label: 'Lists & Links',
      tools: [
        ['bullet', 'i-list', 'Bullet list'],
        ['task', 'i-checklist', `Task checkbox (${key('L')})`],
        ['wikilink', 'i-link', `Link to note [[ (${key('K')})`],
      ],
    },
    {
      label: 'Blocks',
      tools: [
        ['callout', 'i-callout', 'Obsidian callout block (/callout)'],
        ['table', 'i-table', 'Markdown table (/table)'],
        ['math', 'i-math', 'LaTeX math block (/math)'],
        ['quote', 'i-quote', 'Blockquote'],
        ['slash', 'i-bolt', 'Insert block (/)'],
      ],
    },
  ];

  return groups
    .map(({ label, tools }) => {
      const buttons = tools
        .map(
          ([cmd, icon, title]) =>
            `<button type="button" class="editor-tool" data-edit-cmd="${cmd}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">` +
            `<svg class="icon" aria-hidden="true"><use href="#${icon}"></use></svg></button>`,
        )
        .join('');
      return `<div class="editor-tool-group" role="group" aria-label="${escapeHtml(label)}">${buttons}</div>`;
    })
    .join('<span class="editor-sep" role="separator" aria-orientation="vertical"></span>');
}

export function editorHtml(detail, draft) {
  const bar = editorToolbarHtml();
  return `
    <div class="panel-article panel-article-edit">
      <p class="note-crumb">Editing · ${escapeHtml(detail.folder)}</p>
      <h1 class="note-title">${escapeHtml(detail.title)}</h1>
      <div class="editor-bar" role="toolbar" aria-label="Markdown formatting">${bar}</div>
      <div class="editor-host">
        <textarea class="editor" id="note-editor" spellcheck="false" aria-label="Note source" aria-describedby="editor-hint">${escapeHtml(draft)}</textarea>
      </div>
      <p class="editor-hint" id="editor-hint">Type <code>[[</code> to link notes · <code>/</code> for commands · ${key('L')} task · ${key('S')} save · Esc cancel</p>
    </div>
  `;
}

/**
 * Extract hierarchical headings from a Markdown document body for the Notion-style
 * floating mini-outline rail and the right inspector's Outline tab.
 */
export function extractOutlineHeadings(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0] === '---') {
    i = 1;
    while (i < lines.length && lines[i] !== '---') i += 1;
    i += 1;
  }
  const headings = [];
  let inFence = false;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,4})\s+(.+)$/.exec(line);
    if (match) {
      const level = match[1].length;
      const text = match[2]
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, alias) => alias || target)
        .replace(/[*_`~]/g, '')
        .trim();
      if (text) {
        headings.push({ level, text, index: headings.length, line: i });
      }
    }
  }
  return headings;
}

/**
 * Extract frontmatter key/value pairs from `---\n...\n---` for the studio property bar.
 */
export function extractFrontmatterProperties(raw) {
  const lines = String(raw || '').replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') return [];
  const props = [];
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i] === '---') break;
    const match = /^([a-zA-Z0-9_-]+)\s*:\s*(.+)$/.exec(lines[i].trim());
    if (match) {
      props.push({ key: match[1], value: match[2].trim() });
    }
  }
  return props;
}

/**
 * Render the left-hand Notes Studio feed (Astrocortex & Notion style).
 */
export function renderNotesStudioList(
  container,
  notes,
  {
    activeId = null,
    pinnedSet = new Set(),
    recentIds = [],
    palette = [],
    folderColorMap = new Map(),
    sortBy = 'recent',
    onSelectNote,
    onTogglePin,
  } = {},
) {
  if (!container) return;
  container.innerHTML = '';

  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-feed-empty';
    empty.innerHTML =
      '<p>No notes match this filter.</p>' +
      '<p class="notes-feed-empty-sub">Press <kbd>n</kbd> to create a new note or clear the filter above.</p>';
    container.appendChild(empty);
    return;
  }

  const recentRank = new Map();
  recentIds.forEach((id, idx) => recentRank.set(id, idx));

  let currentSection = null;
  for (const note of notes) {
    const isPinned = pinnedSet.has(note.id);
    let bucket = '';
    if (sortBy === 'recent') {
      if (isPinned) bucket = 'Pinned';
      else if (recentRank.has(note.id)) bucket = 'Recently opened';
      else if (note.created) bucket = note.created.slice(0, 7);
      else bucket = note.folder || 'Vault';
    } else if (sortBy === 'title') {
      bucket = (note.title || '#').trim().charAt(0).toUpperCase();
    } else if (sortBy === 'links') {
      bucket = (note.degree || 0) >= 8 ? 'Hub notes' : 'Connected notes';
    } else {
      bucket = note.folder || 'Vault';
    }

    if (bucket !== currentSection) {
      currentSection = bucket;
      const header = document.createElement('div');
      header.className = 'notes-feed-group';
      header.textContent = bucket;
      container.appendChild(header);
    }

    const card = document.createElement('div');
    card.className = `notes-card${note.id === activeId ? ' is-active' : ''}${isPinned ? ' is-pinned' : ''}`;
    card.setAttribute('role', 'listitem');
    card.dataset.noteId = note.id;

    const mainBtn = document.createElement('button');
    mainBtn.type = 'button';
    mainBtn.className = 'notes-card-main';

    const topRow = document.createElement('div');
    topRow.className = 'notes-card-top';
    const titleEl = document.createElement('span');
    titleEl.className = 'notes-card-title';
    titleEl.textContent = note.title;
    topRow.appendChild(titleEl);
    if (note.created) {
      const dateEl = document.createElement('span');
      dateEl.className = 'notes-card-date';
      dateEl.textContent = note.created;
      topRow.appendChild(dateEl);
    }

    const excerptText = cleanSnippet(note.snippet || '');
    const excerptEl = document.createElement('p');
    excerptEl.className = 'notes-card-excerpt';
    excerptEl.textContent = excerptText || 'Empty note — click to start writing…';

    const metaRow = document.createElement('div');
    metaRow.className = 'notes-card-meta';

    const folderBadge = document.createElement('span');
    folderBadge.className = 'notes-card-folder';
    const dot = document.createElement('span');
    dot.className = 'notes-card-dot';
    const colorIdx = folderColorMap.get(note.folder) ?? 0;
    const rgb = palette[colorIdx % (palette.length || 1)] || [0.85, 0.47, 0.34];
    dot.style.background = `rgb(${Math.round(rgb[0] * 255)}, ${Math.round(rgb[1] * 255)}, ${Math.round(rgb[2] * 255)})`;
    const folderName = document.createElement('span');
    folderName.textContent = note.folder || 'root';
    folderBadge.append(dot, folderName);

    const stats = document.createElement('span');
    stats.className = 'notes-card-stats';
    const deg = Number(note.degree) || (note.links?.length || 0);
    const words = Number(note.words) || 0;
    stats.textContent = `${words}w · ${deg} ${deg === 1 ? 'link' : 'links'}`;

    metaRow.append(folderBadge, stats);
    mainBtn.append(topRow, excerptEl, metaRow);
    mainBtn.addEventListener('click', () => onSelectNote?.(note.id));
    card.appendChild(mainBtn);

    if (onTogglePin) {
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = `notes-card-pin${isPinned ? ' is-pinned' : ''}`;
      pinBtn.title = isPinned ? `Unpin ${note.title}` : `Pin ${note.title}`;
      pinBtn.setAttribute('aria-label', pinBtn.title);
      pinBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-pin"></use></svg>';
      pinBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        onTogglePin(note.id);
      });
      card.appendChild(pinBtn);
    }

    container.appendChild(card);
  }
}

/**
 * Render the Obsidian-style open note tabs strip at the top of the Notes Studio.
 */
export function renderNotesStudioTabs(
  container,
  tabIds,
  activeId,
  nodesById,
  { dirtyId = null, pinnedSet = new Set(), onSelectTab, onCloseTab } = {},
) {
  if (!container) return;
  container.innerHTML = '';

  for (const id of tabIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    const isActive = id === activeId;
    const isDirty = id === dirtyId;
    const isPinned = pinnedSet.has(id);

    const tab = document.createElement('div');
    tab.className = `notes-tab${isActive ? ' is-active' : ''}${isDirty ? ' is-dirty' : ''}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(isActive));

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'notes-tab-btn';
    openBtn.title = `${node.title} (${node.folder})`;

    if (isPinned) {
      const pinDot = document.createElement('span');
      pinDot.className = 'notes-tab-pin';
      pinDot.textContent = '•';
      openBtn.appendChild(pinDot);
    }

    const label = document.createElement('span');
    label.className = 'notes-tab-title';
    label.textContent = node.title;
    openBtn.appendChild(label);

    openBtn.addEventListener('click', () => onSelectTab?.(id));
    openBtn.addEventListener('auxclick', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        onCloseTab?.(id);
      }
    });
    tab.appendChild(openBtn);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'notes-tab-close';
    closeBtn.title = `Close ${node.title} tab`;
    closeBtn.setAttribute('aria-label', `Close ${node.title} tab`);
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      onCloseTab?.(id);
    });
    tab.appendChild(closeBtn);

    container.appendChild(tab);
  }
}

/**
 * Render the center Notes Studio document canvas in Live, Read, Split, or Edit mode.
 */
export function renderNotesStudioCanvas(
  container,
  detail,
  {
    viewMode = 'live',
    draft = '',
    markdownHtml = '',
    writable = false,
    folderRgb = [0.85, 0.47, 0.34],
  } = {},
) {
  if (!container) return;
  if (!detail) {
    container.innerHTML = `
      <div class="notes-empty-state">
        <h2>Select a note or create a new one</h2>
        <p>Choose any note from the list on the left, press <kbd>n</kbd> to create a note with a starter template, or press <kbd>s</kbd> to jump to a random note.</p>
      </div>`;
    return;
  }

  const words = Number(detail.words) || 0;
  const readMin = Math.max(1, Math.round(words / 200));
  const outLinks = (detail.links || []).length;
  const inLinks = (detail.backlinks || []).length;
  const totalLinks = outLinks + inLinks;
  const tagsHtml = (detail.tags || [])
    .map((tag) => `<button type="button" class="note-tag studio-tag-chip" data-filter-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`)
    .join('');

  const props = extractFrontmatterProperties(draft || detail.body || '');
  const propsHtml = props.length
    ? `<div class="studio-frontmatter" aria-label="Note properties">` +
      props
        .map(
          (p) =>
            `<span class="studio-prop"><span class="studio-prop-key">${escapeHtml(p.key)}</span>` +
            `<span class="studio-prop-val">${escapeHtml(p.value)}</span></span>`,
        )
        .join('') +
      `</div>`
    : '';

  const docTopHtml = `
    <div class="studio-doc-top">
      <div class="studio-breadcrumbs">
        <button type="button" class="studio-folder-crumb" data-filter-folder="${escapeHtml(detail.folder)}">
          <span class="studio-crumb-dot" id="studio-crumb-dot"></span>
          <span>${escapeHtml(detail.folder || 'root')}</span>
        </button>
        <span class="studio-crumb-sep">/</span>
        <span class="studio-note-crumb">${escapeHtml(detail.path || detail.id)}</span>
      </div>
      <div class="studio-meta-row">
        <span>${escapeHtml(detail.created || 'Undated')}</span>
        <span data-studio-words>${words} words</span>
        <span data-studio-readtime>~${readMin} min read</span>
        <span>${totalLinks} ${totalLinks === 1 ? 'link' : 'links'} (${inLinks} in · ${outLinks} out)</span>
        ${tagsHtml ? `<div class="studio-tags">${tagsHtml}</div>` : ''}
      </div>
      ${decisionTrail(detail)}
    </div>
  `;

  const headerHtml = `
    <header class="studio-doc-head">
      ${docTopHtml}
      ${propsHtml}
    </header>
  `;

  const effectiveMode = !writable ? 'read' : viewMode;

  let bodyHtml = '';
  if (effectiveMode === 'live') {
    bodyHtml = `
      <article class="studio-article studio-article-live">
        <div class="editor-bar studio-editor-bar" id="studio-editor-bar" role="toolbar" focusgroup="toolbar wrap" aria-label="Markdown formatting">${editorToolbarHtml()}</div>
        ${docTopHtml}
        <div class="studio-live-host" id="studio-live-host"></div>
      </article>
    `;
  } else if (effectiveMode === 'read') {
    const editPrompt = writable
      ? `<div class="studio-read-bar">` +
        `<h1 class="studio-doc-title">${escapeHtml(detail.title)}</h1>` +
        `<button type="button" class="text-button studio-quick-edit" data-switch-editor-mode="live" title="Switch to Live Preview editor (${key('E')})">Edit (${escapeHtml(key('E'))})</button>` +
        `</div>`
      : `<h1 class="studio-doc-title">${escapeHtml(detail.title)}</h1>`;

    bodyHtml = `
      <article class="studio-article studio-article-read">
        ${headerHtml}
        ${editPrompt}
        <div class="prose studio-prose" id="studio-prose">${markdownHtml}</div>
      </article>
    `;
  } else if (effectiveMode === 'split') {
    bodyHtml = `
      <div class="studio-split-layout">
        <section class="studio-editor-col" aria-label="Markdown editor">
          ${headerHtml}
          <div class="editor-bar studio-editor-bar" role="toolbar" focusgroup="toolbar wrap" aria-label="Markdown formatting">${editorToolbarHtml()}</div>
          <div class="editor-host studio-editor-host">
            <textarea class="editor studio-editor" id="studio-editor" spellcheck="false" aria-label="Note Markdown source">${escapeHtml(draft)}</textarea>
          </div>
          <p class="editor-hint studio-editor-hint">Auto-saving enabled · <code>[[</code> link note · <code>/</code> slash menu · ${key('L')} toggle checkbox · ${key('E')} cycle mode</p>
        </section>
        <section class="studio-preview-col" aria-label="Live preview">
          <div class="studio-preview-kicker">Live preview · interactive tasks &amp; tallies</div>
          <h1 class="studio-doc-title">${escapeHtml(detail.title)}</h1>
          <div class="prose studio-prose" id="studio-prose">${markdownHtml}</div>
        </section>
      </div>
    `;
  } else {
    bodyHtml = `
      <article class="studio-article studio-article-edit">
        ${headerHtml}
        <div class="editor-bar studio-editor-bar" role="toolbar" focusgroup="toolbar wrap" aria-label="Markdown formatting">${editorToolbarHtml()}</div>
        <div class="editor-host studio-editor-host">
          <textarea class="editor studio-editor studio-editor-full" id="studio-editor" spellcheck="true" aria-label="Note Markdown source">${escapeHtml(draft)}</textarea>
        </div>
        <p class="editor-hint studio-editor-hint">Auto-saving enabled · <code>[[</code> link note · <code>/</code> slash commands · ${key('L')} toggle checkbox · Alt+↑/↓ move line · ${key('E')} read mode</p>
      </article>
    `;
  }

  container.innerHTML = bodyHtml;
  const dot = container.querySelector('#studio-crumb-dot');
  if (dot && folderRgb) {
    dot.style.background = `rgb(${Math.round(folderRgb[0] * 255)}, ${Math.round(folderRgb[1] * 255)}, ${Math.round(folderRgb[2] * 255)})`;
  }
}

/**
 * Render the Notion-style right-edge floating mini-outline rail (tick marks that
 * expand on hover into an interactive Table of Contents).
 */
export function renderNotesMiniOutline(container, headings, onJumpHeading) {
  if (!container) return;
  container.innerHTML = '';
  if (!headings || headings.length < 2) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const ticks = document.createElement('div');
  ticks.className = 'mini-outline-ticks';
  ticks.setAttribute('aria-hidden', 'true');

  const popover = document.createElement('div');
  popover.className = 'mini-outline-card';

  const cardTitle = document.createElement('p');
  cardTitle.className = 'mini-outline-kicker';
  cardTitle.textContent = 'On this page';
  popover.appendChild(cardTitle);

  headings.forEach((h, idx) => {
    const tick = document.createElement('span');
    tick.className = `mini-outline-tick is-h${h.level}`;
    ticks.appendChild(tick);

    const item = document.createElement('button');
    item.type = 'button';
    item.className = `mini-outline-item is-h${h.level}`;
    item.textContent = h.text;
    item.addEventListener('click', () => onJumpHeading?.(idx, h));
    popover.appendChild(item);
  });

  container.append(ticks, popover);
}

/**
 * Render the right-hand Notes Studio Connections & Outline inspector pane.
 */
export function renderNotesStudioInspector(
  container,
  detail,
  {
    activeTab = 'backlinks',
    headings = [],
    writable = false,
    onOpenNote,
    onLinkMention,
    onJumpHeading,
  } = {},
) {
  if (!container) return;
  container.innerHTML = '';

  const backlinksCountEl = document.getElementById('notes-backlinks-count');
  const mentionsCountEl = document.getElementById('notes-mentions-count');
  const inspectorBadgeEl = document.getElementById('notes-inspector-badge');
  const backlinksLen = (detail?.backlinks || []).length;
  const mentionsLen = (detail?.mentions || []).length;
  const totalConnections = backlinksLen + mentionsLen;
  if (backlinksCountEl) backlinksCountEl.textContent = String(backlinksLen);
  if (mentionsCountEl) mentionsCountEl.textContent = String(mentionsLen);
  if (inspectorBadgeEl) {
    inspectorBadgeEl.textContent = String(totalConnections);
    inspectorBadgeEl.hidden = totalConnections === 0;
  }

  if (!detail) {
    container.innerHTML = '<p class="empty">Open a note to see its linked mentions, unlinked mentions, and outline.</p>';
    return;
  }

  if (activeTab === 'backlinks') {
    const list = detail.backlinks || [];
    const wrap = document.createElement('div');
    wrap.className = 'inspector-section';
    const kicker = document.createElement('p');
    kicker.className = 'inspector-kicker';
    kicker.textContent = `Linked mentions (${list.length})`;
    wrap.appendChild(kicker);

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = `No notes link to [[${detail.title}]] yet.`;
      wrap.appendChild(empty);
    } else {
      const cards = document.createElement('div');
      cards.className = 'inspector-cards';
      cards.innerHTML = connectionItemsHtml(list, '', { targetTitle: detail.title });
      wrap.appendChild(cards);
    }
    container.appendChild(wrap);
  } else if (activeTab === 'mentions') {
    const list = detail.mentions || [];
    const wrap = document.createElement('div');
    wrap.className = 'inspector-section';
    const kicker = document.createElement('p');
    kicker.className = 'inspector-kicker';
    kicker.textContent = `Unlinked mentions (${list.length})`;
    wrap.appendChild(kicker);

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = `No unlinked plain-text mentions of “${detail.title}”.`;
      wrap.appendChild(empty);
    } else {
      const help = document.createElement('p');
      help.className = 'inspector-help';
      help.textContent = writable
        ? 'Notes that mention this title without [[brackets]]. Click Link to convert to a wikilink.'
        : 'Notes that mention this title in plain text.';
      wrap.appendChild(help);

      const cards = document.createElement('div');
      cards.className = 'inspector-cards';
      cards.innerHTML = connectionItemsHtml(list, '', {
        targetTitle: detail.title,
        allowLinkMention: writable,
      });
      wrap.appendChild(cards);
    }
    container.appendChild(wrap);
  } else if (activeTab === 'links') {
    const wrap = document.createElement('div');
    wrap.className = 'inspector-section';

    if (detail.evidence && detail.evidence.length) {
      const k1 = document.createElement('p');
      k1.className = 'inspector-kicker';
      k1.textContent = `Cited sources (${detail.evidence.length})`;
      const c1 = document.createElement('div');
      c1.className = 'inspector-cards';
      c1.innerHTML = connectionItemsHtml(detail.evidence, '');
      wrap.append(k1, c1);
    }

    const related = detail.related || [];
    const k2 = document.createElement('p');
    k2.className = 'inspector-kicker';
    k2.textContent = `Related notes (${related.length})`;
    const c2 = document.createElement('div');
    c2.className = 'inspector-cards';
    c2.innerHTML = connectionItemsHtml(related, 'No shared neighbors yet.');
    wrap.append(k2, c2);
    container.appendChild(wrap);
  } else if (activeTab === 'outline') {
    const wrap = document.createElement('div');
    wrap.className = 'inspector-section';
    const kicker = document.createElement('p');
    kicker.className = 'inspector-kicker';
    kicker.textContent = `Document outline (${headings.length})`;
    wrap.appendChild(kicker);

    if (!headings.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Add # Heading 1, ## Heading 2, or ### Heading 3 sections to build an outline.';
      wrap.appendChild(empty);
    } else {
      const tree = document.createElement('div');
      tree.className = 'inspector-outline';
      headings.forEach((h, idx) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `inspector-outline-item is-h${h.level}`;
        btn.textContent = h.text;
        btn.addEventListener('click', () => onJumpHeading?.(idx, h));
        tree.appendChild(btn);
      });
      wrap.appendChild(tree);
    }
    container.appendChild(wrap);
  }

  container.querySelectorAll('[data-note-id]').forEach((btn) => {
    btn.addEventListener('click', () => onOpenNote?.(btn.dataset.noteId));
  });
  container.querySelectorAll('[data-link-mention-id]').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      onLinkMention?.(btn.dataset.linkMentionId);
    });
  });
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
  const due = isReviewDue(card.review_on);
  article.className = `decision-card${due ? ' is-due' : ''}`;

  const top = document.createElement('div');
  top.className = 'decision-card-top';
  const kind = document.createElement('span');
  kind.className = 'decision-kind';
  kind.textContent = card.kind === 'idea' ? 'Idea' : 'Research brief';
  top.appendChild(kind);
  if (due) {
    const flag = document.createElement('span');
    flag.className = 'decision-review';
    flag.textContent = 'Review due';
    top.appendChild(flag);
  }
  article.appendChild(top);

  const title = document.createElement('button');
  title.type = 'button';
  title.className = 'decision-title';
  title.textContent = card.title;
  title.addEventListener('click', () => onOpen(card.id));
  article.appendChild(title);

  const hasConfidence = card.confidence !== null && card.confidence !== undefined;
  const pct = hasConfidence ? clampPct(card.confidence) : null;
  const meta = document.createElement('p');
  meta.className = 'decision-meta';
  const sources = Number(card.sources) || 0;
  meta.textContent = [
    card.folder,
    card.created,
    `${sources} ${sources === 1 ? 'source' : 'sources'}`,
    hasConfidence ? `${pct}% confidence` : '',
    card.review_on ? `review ${card.review_on}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  article.appendChild(meta);

  if (hasConfidence) {
    const meter = document.createElement('div');
    meter.className = 'confidence-meter';
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-label', 'Confidence');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.setAttribute('aria-valuenow', String(pct));
    const fill = document.createElement('span');
    fill.className = 'confidence-fill';
    fill.style.setProperty('--confidence', `${pct}%`);
    meter.appendChild(fill);
    article.appendChild(meter);
  }

  if (card.supersedes) {
    const supersedes = document.createElement('button');
    supersedes.type = 'button';
    supersedes.className = 'decision-supersedes';
    supersedes.textContent = `Supersedes ${card.supersedes.title}`;
    supersedes.addEventListener('click', () => onOpen(card.supersedes.id));
    article.appendChild(supersedes);
  }

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

  const trail = document.createElement('button');
  trail.type = 'button';
  trail.className = 'decision-supersedes decision-trail-link';
  trail.textContent = 'Open decision trail →';
  trail.addEventListener('click', () => onOpen(card.id));
  article.appendChild(trail);

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

  const total = Number(structures?.total) || cards.length;
  const openCount = Number.isFinite(Number(structures?.open))
    ? Number(structures.open)
    : cards.filter((card) => card.status === 'open' || card.status === 'refining').length;
  const settledCount = Math.max(0, total - openCount);
  const dueCount = cards.filter((card) => isReviewDue(card.review_on)).length;
  const confidences = cards
    .filter((card) => card.confidence !== null && card.confidence !== undefined)
    .map((card) => clampPct(card.confidence));

  const summary = document.createElement('div');
  summary.className = 'decisions-summary';
  summary.setAttribute('aria-label', 'Decision trail summary');
  const stats = [
    { label: total === 1 ? 'decision' : 'decisions', value: String(total) },
    { label: 'in flight', value: String(openCount) },
    { label: 'settled', value: String(settledCount) },
    { label: 'review due', value: String(dueCount), due: dueCount > 0 },
  ];
  if (confidences.length) {
    const avg = Math.round(confidences.reduce((sum, pct) => sum + pct, 0) / confidences.length);
    stats.push({ label: 'avg confidence', value: `${avg}%` });
  }
  for (const item of stats) {
    const cell = document.createElement('div');
    cell.className = `decisions-stat${item.due ? ' is-due' : ''}`;
    const value = document.createElement('span');
    value.className = 'decisions-stat-value';
    value.textContent = item.value;
    const label = document.createElement('span');
    label.className = 'decisions-stat-label';
    label.textContent = item.label;
    cell.append(value, label);
    summary.appendChild(cell);
  }
  container.appendChild(summary);

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

  // total already computed above for the summary strip
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
    meta.textContent = `${Math.round(share * 100)}% of the vault`;
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

// Restored from 2.1.0: the 2.2.0 rewrite dropped these exports, so the boot overlay never hid.
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

export function renderPaletteHits(container, hits, active) {
  if (!hits.length) {
    container.innerHTML = '<p class="palette-empty">No notes or commands match that.</p>';
    return;
  }

  let html = '';
  let lastKind = null;
  const hasBothKinds = hits.some((h) => h.kind === 'command') && hits.some((h) => h.kind !== 'command');

  hits.forEach((hit, index) => {
    const kind = hit.kind === 'command' ? 'command' : 'note';
    if (kind !== lastKind && (hasBothKinds || kind === 'command')) {
      html += `<p class="palette-group">${kind === 'command' ? 'Commands' : 'Notes'}</p>`;
      lastKind = kind;
    }
    if (kind === 'command') {
      const kbd = hit.shortcut ? `<kbd class="palette-hit-kbd">${escapeHtml(hit.shortcut)}</kbd>` : '';
      const sub = hit.subtitle ? `<span class="palette-hit-snippet">${escapeHtml(hit.subtitle)}</span>` : '';
      html += `
        <button type="button" class="palette-hit palette-hit-command${index === active ? ' is-active' : ''}" data-hit-index="${index}">
          <span class="palette-hit-main">
            <svg class="icon palette-hit-icon" aria-hidden="true"><use href="#i-bolt"></use></svg>
            <span class="palette-hit-title">${escapeHtml(hit.title)}</span>
          </span>
          <span class="palette-hit-path">${kbd}</span>
          ${sub}
        </button>`;
    } else {
      html += `
        <button type="button" class="palette-hit${index === active ? ' is-active' : ''}" data-hit-index="${index}">
          <span class="palette-hit-title">${escapeHtml(hit.title)}</span>
          <span class="palette-hit-path">${escapeHtml(hit.folder)}</span>
          <span class="palette-hit-snippet">${escapeHtml(cleanSnippet(hit.snippet || ''))}</span>
        </button>`;
    }
  });

  container.innerHTML = html;
  const activeElement = container.querySelector('.is-active');
  if (activeElement) activeElement.scrollIntoView({ block: 'nearest' });
}

/**
 * Folder explorer for the Notes studio: the vault's real folder hierarchy,
 * collapsible, with notes as single-line rows.
 */
export function renderNotesStudioTree(
  container,
  notes,
  {
    activeId = null,
    pinnedSet = new Set(),
    openFolders = new Set(),
    forceOpen = false,
    onToggleFolder,
    onSelectNote,
    onTogglePin,
  } = {},
) {
  if (!container) return;
  container.innerHTML = '';
  if (!notes.length) {
    const empty = document.createElement('div');
    empty.className = 'notes-feed-empty';
    empty.innerHTML =
      '<p>No notes match this filter.</p>' +
      '<p class="notes-feed-empty-sub">Clear the filter above or switch scope.</p>';
    container.appendChild(empty);
    return;
  }

  const root = { name: '', path: '', folders: new Map(), notes: [], count: 0 };
  for (const note of notes) {
    const parts = String(note.id).split('/');
    parts.pop();
    let node = root;
    node.count += 1;
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      if (!node.folders.has(part)) {
        node.folders.set(part, { name: part, path, folders: new Map(), notes: [], count: 0 });
      }
      node = node.folders.get(part);
      node.count += 1;
    }
    node.notes.push(note);
  }

  const frag = document.createDocumentFragment();

  const addNote = (note, depth) => {
    const row = document.createElement('div');
    row.className = `tree-note${note.id === activeId ? ' is-active' : ''}`;
    row.setAttribute('role', 'treeitem');
    row.dataset.noteId = note.id;
    row.style.setProperty('--depth', String(depth));
    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'tree-note-main';
    main.title = note.id;
    main.textContent = note.title;
    main.addEventListener('click', () => onSelectNote?.(note.id));
    row.appendChild(main);
    if (onTogglePin) {
      const pinned = pinnedSet.has(note.id);
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = `tree-note-pin${pinned ? ' is-pinned' : ''}`;
      pin.title = pinned ? `Unpin ${note.title}` : `Pin ${note.title}`;
      pin.setAttribute('aria-label', pin.title);
      pin.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-pin"></use></svg>';
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        onTogglePin(note.id);
      });
      row.appendChild(pin);
    }
    frag.appendChild(row);
  };

  const addFolder = (folder, depth) => {
    const open = forceOpen || openFolders.has(folder.path);
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `tree-folder${open ? ' is-open' : ''}`;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-expanded', String(open));
    row.style.setProperty('--depth', String(depth));
    row.dataset.folderPath = folder.path;
    const chevron = document.createElement('span');
    chevron.className = 'tree-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'tree-folder-name';
    name.textContent = folder.name;
    const count = document.createElement('span');
    count.className = 'tree-folder-count';
    count.textContent = String(folder.count);
    row.append(chevron, name, count);
    row.addEventListener('click', () => onToggleFolder?.(folder.path, !open));
    frag.appendChild(row);
    if (open) walk(folder, depth + 1);
  };

  const walk = (folder, depth) => {
    const subfolders = [...folder.folders.values()].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    for (const sub of subfolders) addFolder(sub, depth);
    for (const note of folder.notes) addNote(note, depth);
  };

  walk(root, 0);
  container.appendChild(frag);
  const active = container.querySelector('.tree-note.is-active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}