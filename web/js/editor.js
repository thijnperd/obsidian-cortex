// Markdown editor conveniences for the note panel and the Notes Studio.
//
// The editor is a plain <textarea>: no contenteditable, no build step, no
// framework. Everything here edits the textarea through its selection API so
// native undo/redo, IME input and the browser's own spellcheck keep working.

const PAIRS = new Map([
  ['[', ']'],
  ['(', ')'],
  ['{', '}'],
  ['"', '"'],
  ["'", "'"],
]);

export const SLASH_COMMANDS = [
  { id: 'h1', label: 'Heading 1', tag: '/h1', hint: 'Large section heading', run: (ta) => toggleHeading(ta, 1) },
  { id: 'h2', label: 'Heading 2', tag: '/h2', hint: 'Medium section heading', run: (ta) => toggleHeading(ta, 2) },
  { id: 'h3', label: 'Heading 3', tag: '/h3', hint: 'Subsection heading', run: (ta) => toggleHeading(ta, 3) },
  { id: 'task', label: 'Task item', tag: '/task', hint: 'Interactive to-do checkbox', run: (ta) => toggleList(ta, 'task') },
  { id: 'tally', label: 'Tally boxes', tag: '/tally', hint: 'Clickable ☐ ballot boxes for points', run: (ta) => insertTallyBoxes(ta) },
  { id: 'bullet', label: 'Bullet list', tag: '/bullet', hint: 'Unordered list item', run: (ta) => toggleList(ta, 'bullet') },
  { id: 'ordered', label: 'Numbered list', tag: '/number', hint: 'Ordered list item', run: (ta) => toggleList(ta, 'ordered') },
  { id: 'callout', label: 'Info callout', tag: '/callout', hint: 'Obsidian [!INFO] callout block', run: (ta) => insertCallout(ta, 'INFO', 'Note') },
  { id: 'tip', label: 'Tip callout', tag: '/tip', hint: 'Obsidian [!TIP] highlight block', run: (ta) => insertCallout(ta, 'TIP', 'Key insight') },
  { id: 'warning', label: 'Warning callout', tag: '/warning', hint: 'Obsidian [!WARNING] alert block', run: (ta) => insertCallout(ta, 'WARNING', 'Watch out') },
  { id: 'table', label: 'Table', tag: '/table', hint: '3-column Markdown table', run: (ta) => insertTable(ta) },
  { id: 'math', label: 'Math block', tag: '/math', hint: 'LaTeX display equation ($$)', run: (ta) => insertMathBlock(ta) },
  { id: 'codeblock', label: 'Code block', tag: '/code', hint: 'Fenced code block (```)', run: (ta) => insertCodeBlock(ta) },
  { id: 'quote', label: 'Quote', tag: '/quote', hint: 'Blockquote line', run: (ta) => toggleQuote(ta) },
  { id: 'divider', label: 'Divider', tag: '/divider', hint: 'Horizontal section rule (---)', run: (ta) => insertDivider(ta) },
  { id: 'today', label: "Today's date", tag: '/today', hint: 'Insert current ISO date', run: (ta) => insertTodayDate(ta) },
  { id: 'wikilink', label: 'Link to note', tag: '/link', hint: 'Insert [[Wikilink]] with autocomplete', run: (ta) => wrap(ta, '[[', ']]') },
];

function lineStart(value, position) {
  if (position <= 0) return 0;
  return value.lastIndexOf('\n', position - 1) + 1;
}

function lineEnd(value, position) {
  const index = value.indexOf('\n', position);
  return index < 0 ? value.length : index;
}

/**
 * Replace [start, end) and leave the caret inside the replacement. Uses the
 * browser's insertText command first because it joins the native undo stack;
 * setRangeText is the quiet fallback when the command is unavailable.
 */
function replaceRange(textarea, start, end, text, selectStart = null, selectEnd = null) {
  textarea.focus();
  textarea.setSelectionRange(start, end);
  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }
  if (!inserted) {
    textarea.setRangeText(text, start, end, 'end');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (selectStart != null) {
    textarea.setSelectionRange(start + selectStart, start + (selectEnd ?? selectStart));
  }
}

function wrap(textarea, before, after = before, placeholder = '') {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;

  if (
    start !== end
    && value.slice(start - before.length, start) === before
    && value.slice(end, end + after.length) === after
  ) {
    const inner = value.slice(start, end);
    replaceRange(textarea, start - before.length, end + after.length, inner, 0, inner.length);
    return;
  }

  if (start === end) {
    replaceRange(
      textarea,
      start,
      end,
      before + placeholder + after,
      before.length,
      before.length + placeholder.length,
    );
    return;
  }

  const inner = value.slice(start, end);
  replaceRange(
    textarea,
    start,
    end,
    before + inner + after,
    before.length,
    before.length + inner.length,
  );
}

function caretAfterLineEdit(textarea, start, oldLength, next, caret) {
  const delta = next.length - oldLength;
  const position = Math.max(0, caret + delta);
  replaceRange(textarea, start, start + oldLength, next, position, position);
}

function toggleHeading(textarea, level) {
  const start = lineStart(textarea.value, textarea.selectionStart);
  const end = lineEnd(textarea.value, textarea.selectionStart);
  const line = textarea.value.slice(start, end);
  const caret = textarea.selectionStart - start;
  const match = /^(\s*)(#{1,6})\s+/.exec(line);
  let next;

  if (match && match[2].length === level) {
    next = match[1] + line.slice(match[0].length);
  } else if (match) {
    next = `${match[1]}${'#'.repeat(level)} ${line.slice(match[0].length)}`;
  } else {
    next = `${'#'.repeat(level)} ${line}`;
  }
  caretAfterLineEdit(textarea, start, line.length, next, caret);
}

function toggleList(textarea, kind) {
  const start = lineStart(textarea.value, textarea.selectionStart);
  const end = lineEnd(textarea.value, textarea.selectionStart);
  const line = textarea.value.slice(start, end);
  const caret = textarea.selectionStart - start;
  const match = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line);
  const indent = match ? match[1] : '';
  const body = match ? line.slice(match[0].length) : line;
  const ordered = Boolean(match && /^\d/.test(match[2]));
  const task = Boolean(match && match[3]);
  const same = kind === 'ordered' ? ordered : kind === 'task' ? task : Boolean(match) && !ordered && !task;
  const marker = kind === 'ordered' ? '1. ' : kind === 'task' ? '- [ ] ' : '- ';
  const next = same ? indent + body : indent + marker + body;
  caretAfterLineEdit(textarea, start, line.length, next, caret);
}

/**
 * Toggle checkbox status on the current line (Obsidian Ctrl/Cmd+L or Ctrl/Cmd+Enter on a task line).
 * Cycles: plain line -> `- [ ] line` -> `- [x] line` -> `- [ ] line`.
 * If the line contains ballot tally boxes (☐ / ☑), toggles the first ☐ to ☑ (or resets if all ☑).
 */
function toggleCheckboxStatus(textarea, onlyIfExisting = false) {
  const start = lineStart(textarea.value, textarea.selectionStart);
  const end = lineEnd(textarea.value, textarea.selectionStart);
  const line = textarea.value.slice(start, end);
  const caret = textarea.selectionStart - start;

  const taskMatch = /^(\s*[-*+]\s+\[)([ xX])(\]\s*)/.exec(line);
  if (taskMatch) {
    const nextChar = taskMatch[2] === ' ' ? 'x' : ' ';
    const next = `${taskMatch[1]}${nextChar}${taskMatch[3]}${line.slice(taskMatch[0].length)}`;
    caretAfterLineEdit(textarea, start, line.length, next, caret);
    return true;
  }

  if (line.includes('\u2610') || line.includes('\u2611')) {
    let next;
    if (line.includes('\u2610')) {
      next = line.replace('\u2610', '\u2611');
    } else {
      next = line.replace('\u2611', '\u2610');
    }
    caretAfterLineEdit(textarea, start, line.length, next, caret);
    return true;
  }

  if (onlyIfExisting) return false;

  const bulletMatch = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line);
  if (bulletMatch) {
    const next = `${bulletMatch[1]}- [ ] ${line.slice(bulletMatch[0].length)}`;
    caretAfterLineEdit(textarea, start, line.length, next, caret);
    return true;
  }

  const indentMatch = /^(\s*)/.exec(line);
  const indent = indentMatch ? indentMatch[1] : '';
  const next = `${indent}- [ ] ${line.slice(indent.length)}`;
  caretAfterLineEdit(textarea, start, line.length, next, caret);
  return true;
}

function toggleQuote(textarea) {
  const start = lineStart(textarea.value, textarea.selectionStart);
  const end = lineEnd(textarea.value, textarea.selectionStart);
  const line = textarea.value.slice(start, end);
  const caret = textarea.selectionStart - start;
  const match = /^(\s*>\s?)/.exec(line);
  const indent = match ? match[1].match(/^\s*/)[0] : '';
  const next = match ? indent + line.slice(match[0].length) : '> ' + line;
  caretAfterLineEdit(textarea, start, line.length, next, caret);
}

function insertCodeBlock(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  if (selected) {
    const text = `\`\`\`\n${selected}\n\`\`\``;
    replaceRange(textarea, start, end, text, text.length, text.length);
    return;
  }
  const text = '```\n\n```';
  replaceRange(textarea, start, end, text, 4, 4);
}

function insertMathBlock(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end);
  if (selected) {
    const text = `$$\n${selected}\n$$`;
    replaceRange(textarea, start, end, text, text.length, text.length);
    return;
  }
  const text = '$$\n\n$$';
  replaceRange(textarea, start, end, text, 3, 3);
}

function insertCallout(textarea, kind = 'INFO', title = 'Note') {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selected = textarea.value.slice(start, end).trim();
  const prefix = start > 0 && textarea.value[start - 1] !== '\n' ? '\n' : '';
  const body = selected || 'Write callout details here…';
  const text = `${prefix}> [!${kind}] ${title}\n> ${body}\n`;
  const selectFrom = prefix.length + `> [!${kind}] `.length;
  const selectTo = selectFrom + title.length;
  replaceRange(textarea, start, end, text, selectFrom, selectTo);
}

function insertTable(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const prefix = start > 0 && textarea.value[start - 1] !== '\n' ? '\n' : '';
  const table = `${prefix}| Column 1 | Column 2 | Column 3 |\n| --- | --- | --- |\n| Value | Value | Value |\n`;
  const selectFrom = prefix.length + 2;
  const selectTo = selectFrom + 'Column 1'.length;
  replaceRange(textarea, start, end, table, selectFrom, selectTo);
}

function insertTallyBoxes(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = '\u2610 \u2610 \u2610 \u2610 \u2610 ';
  replaceRange(textarea, start, end, text, text.length, text.length);
}

function insertDivider(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const prefix = start > 0 && textarea.value[start - 1] !== '\n' ? '\n' : '';
  const text = `${prefix}---\n`;
  replaceRange(textarea, start, end, text, text.length, text.length);
}

function insertTodayDate(textarea) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const today = new Date().toISOString().slice(0, 10);
  replaceRange(textarea, start, end, today, today.length, today.length);
}

function moveLineVertically(textarea, direction) {
  const value = textarea.value;
  const start = lineStart(value, textarea.selectionStart);
  const end = lineEnd(value, textarea.selectionEnd);
  const caretOffset = textarea.selectionStart - start;
  const selLength = textarea.selectionEnd - textarea.selectionStart;

  if (direction < 0) {
    if (start === 0) return;
    const prevStart = lineStart(value, start - 1);
    const prevLine = value.slice(prevStart, start - 1);
    const currentBlock = value.slice(start, end);
    const replacement = `${currentBlock}\n${prevLine}`;
    replaceRange(
      textarea,
      prevStart,
      end,
      replacement,
      caretOffset,
      caretOffset + selLength,
    );
  } else {
    if (end >= value.length) return;
    const nextEnd = lineEnd(value, end + 1);
    const nextLine = value.slice(end + 1, nextEnd);
    const currentBlock = value.slice(start, end);
    const replacement = `${nextLine}\n${currentBlock}`;
    const shift = nextLine.length + 1;
    replaceRange(
      textarea,
      start,
      nextEnd,
      replacement,
      shift + caretOffset,
      shift + caretOffset + selLength,
    );
  }
}

function duplicateLineOrSelection(textarea) {
  const value = textarea.value;
  const start = lineStart(value, textarea.selectionStart);
  const end = lineEnd(value, textarea.selectionEnd);
  const block = value.slice(start, end);
  const caretOffset = textarea.selectionStart - start;
  const selLength = textarea.selectionEnd - textarea.selectionStart;
  const replacement = `${block}\n${block}`;
  const shift = block.length + 1;
  replaceRange(
    textarea,
    start,
    end,
    replacement,
    shift + caretOffset,
    shift + caretOffset + selLength,
  );
}

/** Continue the current list (or quote) when Enter is pressed. */
function continueBlock(textarea) {
  if (textarea.selectionStart !== textarea.selectionEnd) return false;
  const start = lineStart(textarea.value, textarea.selectionStart);
  const end = lineEnd(textarea.value, textarea.selectionStart);
  const line = textarea.value.slice(start, end);
  const item = /^(\s*)([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/.exec(line);

  if (item) {
    const body = line.slice(item[0].length);
    if (!body.trim()) {
      replaceRange(textarea, start, start + item[0].length, '', 0, 0);
      return true;
    }
    const ordered = /^\d/.test(item[2]);
    const marker = ordered
      ? `${Number.parseInt(item[2], 10) + 1}${item[2].slice(-1)} `
      : item[3]
        ? '- [ ] '
        : `${item[2]} `;
    const insertion = `\n${item[1]}${marker}`;
    const caret = textarea.selectionStart;
    replaceRange(textarea, caret, caret, insertion, insertion.length, insertion.length);
    return true;
  }

  const quote = /^(\s*>\s?)/.exec(line);
  if (quote && line.slice(quote[0].length).trim()) {
    const insertion = `\n${quote[0]}`;
    const caret = textarea.selectionStart;
    replaceRange(textarea, caret, caret, insertion, insertion.length, insertion.length);
    return true;
  }
  return false;
}

function indentLines(textarea, outdent) {
  const start = lineStart(textarea.value, textarea.selectionStart);
  const end = lineEnd(textarea.value, textarea.selectionEnd);
  const activeLine = textarea.value.slice(start, lineEnd(textarea.value, textarea.selectionStart));
  const listLine = /^\s*([-*+]|\d+[.)])\s+/.test(activeLine);
  const hasSelection = textarea.selectionStart !== textarea.selectionEnd;

  if (!hasSelection && outdent) {
    const indent = /^ {1,2}/.exec(activeLine);
    if (indent) {
      const caret = Math.max(0, textarea.selectionStart - indent[0].length - start);
      replaceRange(textarea, start, start + indent[0].length, '', caret, caret);
    }
    return;
  }

  if (!hasSelection) {
    const caret = textarea.selectionStart;
    if (listLine) {
      const offset = caret - start + 2;
      replaceRange(textarea, start, start, '  ', offset, offset);
    } else {
      replaceRange(textarea, caret, caret, '  ', 2, 2);
    }
    return;
  }

  const block = textarea.value.slice(start, end);
  const next = block
    .split('\n')
    .map((line) => {
      if (!line.trim()) return line;
      if (outdent) return line.replace(/^ {1,2}/, '');
      return '  ' + line;
    })
    .join('\n');
  if (next === block) return;

  const caret = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const nextCaret = Math.max(start, caret + (next.length - block.length));
  replaceRange(textarea, start, end, next, nextCaret - start, selectionEnd + (next.length - block.length) - start);
}

function deletePair(textarea) {
  const start = textarea.selectionStart;
  if (start !== textarea.selectionEnd || start === 0) return false;
  const opening = textarea.value[start - 1];
  const closing = PAIRS.get(opening);
  if (!closing || textarea.value[start] !== closing) return false;
  replaceRange(textarea, start - 1, start + 1, '', 0, 0);
  return true;
}

function typePair(textarea, event) {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return false;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const value = textarea.value;
  const closing = PAIRS.get(event.key);

  if (closing) {
    const previous = value[start - 1] || '';
    const next = value[end] || '';
    // Do not turn an apostrophe inside a word into an empty quote pair.
    if ((event.key === '"' || event.key === "'") && (/\w/.test(previous) || /\w/.test(next))) {
      return false;
    }
    event.preventDefault();
    if (start !== end) {
      const selected = value.slice(start, end);
      replaceRange(textarea, start, end, event.key + selected + closing, 1, 1 + selected.length);
    } else {
      replaceRange(textarea, start, end, event.key + closing, 1, 1);
    }
    return true;
  }

  if (start === end && value[start] === event.key && [...PAIRS.values()].includes(event.key)) {
    event.preventDefault();
    textarea.setSelectionRange(start + 1, start + 1);
    return true;
  }
  return false;
}

/**
 * Inspect the text leading up to the caret for an active `[[wikilink` or `/slash` trigger.
 */
function detectAutocompleteContext(textarea) {
  if (textarea.selectionStart !== textarea.selectionEnd) return null;
  const caret = textarea.selectionStart;
  const start = lineStart(textarea.value, caret);
  const before = textarea.value.slice(start, caret);

  // 1. Check for unclosed [[wikilink query on current line
  const openIdx = before.lastIndexOf('[[');
  if (openIdx >= 0) {
    const afterOpen = before.slice(openIdx + 2);
    if (!afterOpen.includes(']]') && !afterOpen.includes('\n') && afterOpen.length <= 64) {
      const pipeIdx = afterOpen.indexOf('|');
      const query = pipeIdx >= 0 ? afterOpen.slice(0, pipeIdx) : afterOpen;
      return {
        kind: 'wikilink',
        query,
        replaceFrom: start + openIdx,
        replaceTo: caret,
      };
    }
  }

  // 2. Check for /slash command at start of line or after whitespace
  const slashMatch = /(?:^|\s)(\/([a-z0-9-]{0,18}))$/i.exec(before);
  if (slashMatch) {
    const token = slashMatch[1];
    const query = slashMatch[2].toLowerCase();
    return {
      kind: 'slash',
      query,
      replaceFrom: caret - token.length,
      replaceTo: caret,
    };
  }

  return null;
}

function buildPopoverController(textarea, getNotes) {
  const host = textarea.parentElement;
  if (!host || typeof document === 'undefined') {
    return { update() {}, handleKeyDown() { return false; }, close() {} };
  }
  host.classList.add('editor-host');

  const popover = document.createElement('div');
  popover.className = 'editor-popover';
  popover.hidden = true;
  popover.setAttribute('role', 'listbox');
  host.appendChild(popover);

  let activeContext = null;
  let items = [];
  let selectedIndex = 0;

  function close() {
    activeContext = null;
    items = [];
    selectedIndex = 0;
    popover.hidden = true;
    popover.innerHTML = '';
  }

  function applySelection(index) {
    const item = items[index];
    if (!item || !activeContext) return false;
    const ctx = activeContext;
    close();

    if (ctx.kind === 'wikilink') {
      const after = textarea.value.slice(ctx.replaceTo, ctx.replaceTo + 2);
      const endPos = after === ']]' ? ctx.replaceTo + 2 : ctx.replaceTo;
      const insertion = `[[${item.title}]]`;
      replaceRange(textarea, ctx.replaceFrom, endPos, insertion, insertion.length, insertion.length);
      return true;
    }

    if (ctx.kind === 'slash') {
      replaceRange(textarea, ctx.replaceFrom, ctx.replaceTo, '', 0, 0);
      item.run(textarea);
      return true;
    }
    return false;
  }

  function render() {
    if (!activeContext || !items.length) {
      close();
      return;
    }
    popover.hidden = false;
    const headerLabel = activeContext.kind === 'wikilink'
      ? 'Link to note · ↑↓ · ↵ insert'
      : 'Slash commands · ↑↓ · ↵ run';

    popover.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'editor-popover-head';
    head.textContent = headerLabel;
    popover.appendChild(head);

    const list = document.createElement('div');
    list.className = 'editor-popover-list';

    items.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `editor-popover-item${idx === selectedIndex ? ' is-selected' : ''}`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', idx === selectedIndex ? 'true' : 'false');

      const main = document.createElement('span');
      main.className = 'editor-popover-main';
      main.textContent = item.label || item.title;

      const meta = document.createElement('span');
      meta.className = 'editor-popover-meta';
      meta.textContent = item.meta || item.hint || '';

      btn.append(main, meta);
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        applySelection(idx);
      });
      list.appendChild(btn);
    });

    popover.appendChild(list);
  }

  function update() {
    const ctx = detectAutocompleteContext(textarea);
    if (!ctx) {
      close();
      return;
    }

    if (ctx.kind === 'wikilink') {
      const allNotes = typeof getNotes === 'function' ? (getNotes() || []) : [];
      const q = ctx.query.trim().toLowerCase();
      const scored = [];
      for (const n of allNotes) {
        if (!n || !n.title) continue;
        const lower = n.title.toLowerCase();
        if (!q) {
          scored.push({ note: n, score: (n.links?.length || 0) });
        } else if (lower === q) {
          scored.push({ note: n, score: 1000 });
        } else if (lower.startsWith(q)) {
          scored.push({ note: n, score: 500 - lower.length });
        } else if (lower.includes(q)) {
          scored.push({ note: n, score: 200 - lower.indexOf(q) });
        } else if ((n.folder || '').toLowerCase().includes(q)) {
          scored.push({ note: n, score: 80 });
        }
      }
      scored.sort((a, b) => b.score - a.score || a.note.title.localeCompare(b.note.title));
      const matches = scored.slice(0, 8).map(({ note }) => ({
        title: note.title,
        label: note.title,
        meta: note.folder || 'root',
      }));

      const rawTitle = ctx.query.trim();
      if (rawTitle && !matches.some((m) => m.title.toLowerCase() === rawTitle.toLowerCase())) {
        matches.push({
          title: rawTitle,
          label: `Create “${rawTitle}”`,
          meta: 'new wikilink',
        });
      }

      if (!matches.length) {
        close();
        return;
      }
      activeContext = ctx;
      items = matches;
      selectedIndex = Math.min(selectedIndex, items.length - 1);
      render();
      return;
    }

    if (ctx.kind === 'slash') {
      const q = ctx.query;
      const matches = SLASH_COMMANDS.filter((cmd) => (
        !q
        || cmd.id.includes(q)
        || cmd.tag.slice(1).includes(q)
        || cmd.label.toLowerCase().includes(q)
      )).slice(0, 9).map((cmd) => ({
        ...cmd,
        meta: `${cmd.tag} · ${cmd.hint}`,
      }));

      if (!matches.length) {
        close();
        return;
      }
      activeContext = ctx;
      items = matches;
      selectedIndex = Math.min(selectedIndex, items.length - 1);
      render();
    }
  }

  function handleKeyDown(event) {
    if (!activeContext || popover.hidden || !items.length) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      selectedIndex = (selectedIndex + 1) % items.length;
      render();
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      render();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      return applySelection(selectedIndex);
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return true;
    }
    return false;
  }

  return { update, handleKeyDown, close };
}

/**
 * Wire the note textarea. `onChange`, `onSave` and `onCancel` are the host's
 * own callbacks, and `getNotes` optionally supplies vault notes for `[[`
 * wikilink autocomplete.
 */
export function attachEditor(textarea, { onChange, onSave, onCancel, getNotes } = {}) {
  const popover = buildPopoverController(textarea, getNotes);

  textarea.addEventListener('input', (event) => {
    if (typeof onChange === 'function') onChange(event);
    popover.update();
  });

  textarea.addEventListener('click', () => popover.update());
  textarea.addEventListener('blur', () => {
    setTimeout(() => popover.close(), 140);
  });

  // Smart URL paste: pasting a URL over a selection wraps it as [selection](url)
  textarea.addEventListener('paste', (event) => {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    if (start === end) return;
    const pasted = (event.clipboardData?.getData('text/plain') || '').trim();
    if (!/^https?:\/\/\S+$/i.test(pasted)) return;
    const selected = textarea.value.slice(start, end);
    if (!selected || selected.includes('\n')) return;
    event.preventDefault();
    const link = `[${selected}](${pasted})`;
    replaceRange(textarea, start, end, link, 1, 1 + selected.length);
  });

  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;

    if (popover.handleKeyDown(event)) {
      return;
    }

    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (event.key === 'Escape' && !mod) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onCancel === 'function') onCancel();
      return;
    }

    // Alt + ArrowUp / ArrowDown: move current line up or down
    if (event.altKey && !mod && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      event.stopPropagation();
      moveLineVertically(textarea, event.key === 'ArrowUp' ? -1 : 1);
      return;
    }

    // Ctrl/Cmd + S saves immediately; Ctrl/Cmd + Enter toggles task/tally if on one, else saves
    if (mod && key === 's') {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onSave === 'function') onSave();
      return;
    }
    if (mod && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      if (!event.shiftKey && toggleCheckboxStatus(textarea, true)) {
        return;
      }
      if (typeof onSave === 'function') onSave();
      return;
    }

    if (mod && !event.altKey) {
      // Ctrl/Cmd + L: toggle checkbox / task status on current line (Obsidian shortcut)
      if (!event.shiftKey && key === 'l') {
        event.preventDefault();
        event.stopPropagation();
        toggleCheckboxStatus(textarea, false);
        return;
      }
      // Ctrl/Cmd + Shift + D: duplicate current line or selection
      if (event.shiftKey && key === 'd') {
        event.preventDefault();
        event.stopPropagation();
        duplicateLineOrSelection(textarea);
        return;
      }
      if (event.shiftKey && key === 'x') {
        event.preventDefault();
        event.stopPropagation();
        wrap(textarea, '~~');
        return;
      }
      if (event.shiftKey && key === 'h') {
        event.preventDefault();
        event.stopPropagation();
        wrap(textarea, '==');
        return;
      }
      if (event.shiftKey && key === 'k') {
        event.preventDefault();
        event.stopPropagation();
        insertCodeBlock(textarea);
        return;
      }
      if (event.shiftKey && key === 'm') {
        event.preventDefault();
        event.stopPropagation();
        insertMathBlock(textarea);
        return;
      }
      if (event.shiftKey && event.code === 'Digit7') {
        event.preventDefault();
        event.stopPropagation();
        toggleList(textarea, 'ordered');
        return;
      }
      if (event.shiftKey && event.code === 'Digit8') {
        event.preventDefault();
        event.stopPropagation();
        toggleList(textarea, 'bullet');
        return;
      }
      if (event.shiftKey && event.code === 'Digit9') {
        event.preventDefault();
        event.stopPropagation();
        toggleList(textarea, 'task');
        return;
      }
      if (event.shiftKey && event.code === 'Period') {
        event.preventDefault();
        event.stopPropagation();
        toggleQuote(textarea);
        return;
      }
      if (!event.shiftKey && key === 'b') {
        event.preventDefault();
        event.stopPropagation();
        wrap(textarea, '**');
        return;
      }
      if (!event.shiftKey && key === 'i') {
        event.preventDefault();
        event.stopPropagation();
        wrap(textarea, '*');
        return;
      }
      if (!event.shiftKey && key === 'e') {
        event.preventDefault();
        event.stopPropagation();
        wrap(textarea, '`');
        return;
      }
      if (!event.shiftKey && key === 'k') {
        event.preventDefault();
        event.stopPropagation();
        wrap(textarea, '[[', ']]');
        popover.update();
        return;
      }
      if (!event.shiftKey && ['Digit1', 'Digit2', 'Digit3'].includes(event.code)) {
        event.preventDefault();
        event.stopPropagation();
        toggleHeading(textarea, Number(event.code.slice(-1)));
        return;
      }
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      indentLines(textarea, event.shiftKey);
      return;
    }
    if (event.key === 'Enter' && continueBlock(textarea)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === 'Backspace' && deletePair(textarea)) {
      event.preventDefault();
      event.stopPropagation();
      popover.update();
      return;
    }
    if (!mod && !event.altKey && typePair(textarea, event)) {
      event.stopPropagation();
      popover.update();
    }
  });
}

/**
 * Invoke a formatting command from the compact edit toolbar using the exact
 * same selection-safe helpers as keyboard shortcuts so native undo stays intact.
 */
export function runEditorCommand(textarea, command) {
  if (!textarea) return;
  switch (command) {
    case 'bold':
      wrap(textarea, '**');
      break;
    case 'italic':
      wrap(textarea, '*');
      break;
    case 'strike':
      wrap(textarea, '~~');
      break;
    case 'highlight':
      wrap(textarea, '==');
      break;
    case 'code':
      wrap(textarea, '`');
      break;
    case 'wikilink':
      wrap(textarea, '[[', ']]');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      break;
    case 'h1':
      toggleHeading(textarea, 1);
      break;
    case 'heading':
    case 'h2':
      toggleHeading(textarea, 2);
      break;
    case 'h3':
      toggleHeading(textarea, 3);
      break;
    case 'bullet':
      toggleList(textarea, 'bullet');
      break;
    case 'ordered':
      toggleList(textarea, 'ordered');
      break;
    case 'task':
      toggleList(textarea, 'task');
      break;
    case 'tally':
      insertTallyBoxes(textarea);
      break;
    case 'quote':
      toggleQuote(textarea);
      break;
    case 'callout':
      insertCallout(textarea, 'INFO', 'Note');
      break;
    case 'table':
      insertTable(textarea);
      break;
    case 'math':
      insertMathBlock(textarea);
      break;
    case 'codeblock':
      insertCodeBlock(textarea);
      break;
    case 'divider':
      insertDivider(textarea);
      break;
    case 'today':
      insertTodayDate(textarea);
      break;
    default:
      break;
  }
}
