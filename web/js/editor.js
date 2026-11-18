// Markdown editor conveniences for the note panel.
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
 * Wire the note textarea. `onChange`, `onSave` and `onCancel` are the panel's
 * own callbacks, so the editor never needs to know how a draft is persisted.
 */
export function attachEditor(textarea, { onChange, onSave, onCancel }) {
  textarea.addEventListener('input', onChange);

  textarea.addEventListener('keydown', (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (event.key === 'Escape' && !mod) {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
      return;
    }
    if (mod && (event.key === 'Enter' || key === 's')) {
      event.preventDefault();
      event.stopPropagation();
      onSave();
      return;
    }

    if (mod && !event.altKey) {
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
      return;
    }
    if (!mod && !event.altKey && typePair(textarea, event)) {
      event.stopPropagation();
    }
  });
}
