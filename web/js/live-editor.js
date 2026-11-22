// Obsidian-inspired Live Preview editor and headless Markdown document/block utilities.
//
// Zero framework, no build step, native ES modules, strict CSP (no inline style
// attributes or raw unescaped HTML injection). Pure parsing/joining functions
// run headlessly in Node without DOM globals.

import { attachEditor, attachSelectionBubble, runEditorCommand } from './editor.js';
import { renderMarkdown, toggleNthBallotBox, toggleNthTaskBox } from './markdown.js';

const FRONTMATTER_RE = /^(\uFEFF?---\r?\n(?:[\s\S]*?\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/;
const TITLE_LINE_RE = /^((?:[ \t]*\r?\n)*)(#[ \t]+([^\r\n]*)(\r?\n|$))/;
const BLOCK_KINDS = ['code', 'math', 'callout', 'quote', 'table', 'heading', 'hr', 'list', 'paragraph'];

function stripEol(line) {
  return line.replace(/\r?\n$/, '');
}

function splitLinesWithEndings(text) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '\n') {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

function unquoteYaml(raw) {
  const value = String(raw ?? '').trim();
  if (value.length >= 2) {
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1).replace(/\\(["\\])/g, '$1');
    }
    if (value.startsWith("'") && value.endsWith("'")) {
      return value.slice(1, -1).replace(/''/g, "'");
    }
  }
  return value;
}

function parseInlineYamlList(raw) {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  const items = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote) {
      if (ch === '\\' && quote === '"' && i + 1 < inner.length) {
        current += ch + inner[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          current += "''";
          i += 1;
          continue;
        }
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      const cleaned = unquoteYaml(current);
      if (cleaned) items.push(cleaned);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = unquoteYaml(current);
  if (tail) items.push(tail);
  return items;
}

function formatTagYaml(tag) {
  const str = String(tag);
  if (/[\s,:[\]{}#"'\\]/.test(str) || str === '') {
    return JSON.stringify(str);
  }
  return str;
}

function normalizeTagList(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of tags || []) {
    const cleaned = String(raw ?? '').trim().replace(/^#+/, '').trim();
    if (!cleaned) continue;
    const lower = cleaned.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(cleaned);
  }
  return out;
}

function extractFrontmatterTags(frontmatter) {
  const props = parseFrontmatterBlock(frontmatter);
  const tagProp = props.find((p) => p.key.toLowerCase() === 'tags' || p.key.toLowerCase() === 'tag');
  if (!tagProp) return [];
  if (tagProp.isList) return normalizeTagList(tagProp.items);
  if (!tagProp.value) return [];
  if (tagProp.value.includes(',')) {
    return normalizeTagList(tagProp.value.split(','));
  }
  return normalizeTagList(tagProp.value.split(/\s+/));
}

function isTableDelimiterLine(rawLine) {
  const trimmed = stripEol(rawLine).trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return false;
  let core = trimmed;
  if (core.startsWith('|')) core = core.slice(1);
  if (core.endsWith('|') && !core.endsWith('\\|')) core = core.slice(0, -1);
  const cells = core.split('|').map((c) => c.trim());
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function isHorizontalRuleLine(content) {
  return /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(content);
}

function isHeadingLine(content) {
  return /^ {0,3}#{1,6}(?:[ \t]+.*|[ \t]*)$/.test(content);
}

function isCodeFenceStart(content) {
  return /^ {0,3}(`{3,}|~{3,})/.exec(content);
}

function isMathBlockStart(trimmed) {
  return trimmed.startsWith('$$') || trimmed.startsWith('\\[');
}

function isQuoteLine(content) {
  return /^ {0,3}>/.test(content);
}

function isListLine(content) {
  return /^\s*(?:[-*+]|\d+[.)])\s+/.test(content);
}

function isTableStart(lines, idx) {
  const content = stripEol(lines[idx]);
  const trimmed = content.trim();
  if (!trimmed.includes('|')) return false;
  if (idx + 1 < lines.length && isTableDelimiterLine(lines[idx + 1])) return true;
  if (/^ {0,3}\|/.test(content)) {
    if (trimmed.indexOf('|', 1) > 0) return true;
    if (idx + 1 < lines.length && /^ {0,3}\|/.test(stripEol(lines[idx + 1]))) return true;
  }
  return false;
}

function startsStructuralBlock(lines, idx) {
  const content = stripEol(lines[idx]);
  const trimmed = content.trim();
  if (!trimmed) return false;
  return Boolean(
    isCodeFenceStart(content)
    || isMathBlockStart(trimmed)
    || isHeadingLine(content)
    || isHorizontalRuleLine(content)
    || isQuoteLine(content)
    || isTableStart(lines, idx)
    || isListLine(content),
  );
}

function inferBlockKind(raw) {
  const blocks = splitMarkdownBlocks(String(raw ?? ''));
  return blocks.length ? blocks[0].kind : 'paragraph';
}

function splitBlockEnvelope(raw) {
  const text = String(raw ?? '');
  const leadMatch = /^((?:[ \t]*\r?\n)+)/.exec(text);
  const lead = leadMatch ? leadMatch[1] : '';
  const afterLead = text.slice(lead.length);
  const trailMatch = /(\r?\n(?:[ \t]*\r?\n)*)$/.exec(afterLead);
  const trail = trailMatch ? trailMatch[1] : '';
  const core = afterLead.slice(0, afterLead.length - trail.length);
  return { lead, core, trail };
}

/**
 * Pure, headless document splitter separating optional leading YAML frontmatter
 * (`---` .. `---` / `...`) and optional leading `# H1` title line right after
 * frontmatter. Calling `joinDocument(splitDocument(raw))` reconstructs `raw`
 * identically.
 *
 * @param {string} raw
 * @returns {{ frontmatter: string, titleLine: string, titleText: string, body: string }}
 */
export function splitDocument(raw) {
  const source = String(raw ?? '');
  let offset = 0;

  let frontmatter = '';
  const fmMatch = FRONTMATTER_RE.exec(source);
  if (fmMatch) {
    frontmatter = fmMatch[1];
    offset = frontmatter.length;
  }

  const afterFm = source.slice(offset);
  let titleLine = '';
  let titleText = '';
  const titleMatch = TITLE_LINE_RE.exec(afterFm);
  if (titleMatch) {
    titleLine = titleMatch[0];
    titleText = titleMatch[3].trim();
    offset += titleLine.length;
  }

  const body = source.slice(offset);
  return { frontmatter, titleLine, titleText, body };
}

/**
 * Losslessly reconstructs a raw Markdown document from its frontmatter,
 * leading title line, and body parts.
 *
 * @param {{ frontmatter?: string, titleLine?: string, body?: string }} parts
 * @returns {string}
 */
export function joinDocument({ frontmatter = '', titleLine = '', body = '' } = {}) {
  const fm = String(frontmatter ?? '');
  const tl = String(titleLine ?? '');
  const bd = String(body ?? '');

  let out = fm;
  if (out && (tl || bd) && !out.endsWith('\n')) {
    out += '\n';
  }
  out += tl;
  if (tl && bd && !tl.endsWith('\n')) {
    out += '\n';
  }
  out += bd;
  return out;
}

/**
 * Pure YAML frontmatter subset parser supporting inline lists (`tags: [a, b]`),
 * block lists (`- a`), and scalar `key: value` pairs.
 *
 * @param {string} frontmatter
 * @returns {Array<{ key: string, value: string, isList: boolean, items: string[] }>}
 */
export function parseFrontmatterBlock(frontmatter) {
  const source = String(frontmatter ?? '');
  if (!source.trim()) return [];
  const lines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return [];

  const props = [];
  for (let i = 1; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed === '---' || trimmed === '...') break;
    if (!trimmed || trimmed.startsWith('#')) continue;

    const keyMatch = /^([A-Za-z0-9_.-]+)[ \t]*:(?:[ \t]*(.*))?$/.exec(rawLine);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rest = (keyMatch[2] ?? '').trim();

    if (rest.startsWith('[') && rest.endsWith(']')) {
      const items = parseInlineYamlList(rest);
      props.push({
        key,
        value: items.join(', '),
        isList: true,
        items,
      });
      continue;
    }

    if (!rest) {
      const items = [];
      let j = i + 1;
      while (j < lines.length) {
        const nextLine = lines[j];
        const nextTrimmed = nextLine.trim();
        if (nextTrimmed === '---' || nextTrimmed === '...') break;
        if (!nextTrimmed || nextTrimmed.startsWith('#')) {
          j += 1;
          continue;
        }
        const itemMatch = /^[ \t]*-[ \t]+(.+)$/.exec(nextLine);
        if (itemMatch) {
          items.push(unquoteYaml(itemMatch[1]));
          j += 1;
          continue;
        }
        break;
      }
      if (items.length > 0) {
        props.push({
          key,
          value: items.join(', '),
          isList: true,
          items,
        });
        i = j - 1;
        continue;
      }
      props.push({ key, value: '', isList: false, items: [] });
      continue;
    }

    props.push({
      key,
      value: unquoteYaml(rest),
      isList: false,
      items: [],
    });
  }

  return props;
}

/**
 * Pure helper updating or inserting `tags:` inside a YAML frontmatter block
 * while preserving all other properties and line endings. Creates a new
 * `---\ntags: [...]\n---\n` block when frontmatter is empty and `tags` is
 * non-empty; removes `tags:` (and empty frontmatter) cleanly when empty.
 *
 * @param {string} frontmatter
 * @param {string[]} tags
 * @returns {string}
 */
export function updateFrontmatterTags(frontmatter, tags) {
  const cleanTags = normalizeTagList(tags);
  const source = String(frontmatter ?? '');
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const tagLine = cleanTags.length
    ? `tags: [${cleanTags.map(formatTagYaml).join(', ')}]`
    : null;

  if (!source.trim()) {
    if (!tagLine) return '';
    return `---${eol}${tagLine}${eol}---${eol}`;
  }

  const hasBom = source.startsWith('\uFEFF');
  const bodySrc = hasBom ? source.slice(1) : source;
  const hadTrailingNewline = /\r?\n$/.test(bodySrc);
  const lines = bodySrc.replace(/\r?\n$/, '').split(/\r?\n/);

  if (lines[0].trim() !== '---') {
    if (!tagLine) return source;
    return `---${eol}${tagLine}${eol}---${eol}${source}`;
  }

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i += 1) {
    const t = lines[i].trim();
    if (t === '---' || t === '...') {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex < 0) {
    if (!tagLine) return source;
    return `---${eol}${tagLine}${eol}---${eol}`;
  }

  const opening = lines[0];
  const closing = lines[closeIndex];
  const inner = lines.slice(1, closeIndex);
  const nextInner = [];
  let replaced = false;

  for (let i = 0; i < inner.length; i += 1) {
    const line = inner[i];
    const match = /^(tags?)[ \t]*:(?:[ \t]*(.*))?$/i.exec(line);
    if (match) {
      // Skip any block-list items (`  - foo`) belonging to this tags key.
      let j = i + 1;
      if (!(match[2] ?? '').trim()) {
        while (j < inner.length) {
          const next = inner[j];
          if (/^[ \t]*-[ \t]+/.test(next)) {
            j += 1;
            continue;
          }
          break;
        }
      }
      if (tagLine && !replaced) {
        nextInner.push(tagLine);
        replaced = true;
      }
      i = j - 1;
      continue;
    }
    nextInner.push(line);
  }

  if (tagLine && !replaced) {
    nextInner.push(tagLine);
  }

  const hasAnyContent = nextInner.some((l) => l.trim().length > 0);
  if (!hasAnyContent) {
    return '';
  }

  const rebuilt = [opening, ...nextInner, closing].join(eol) + (hadTrailingNewline ? eol : '');
  return (hasBom ? '\uFEFF' : '') + rebuilt;
}

/**
 * Pure, lossless Markdown block splitter. Partitions `body` into contiguous
 * `{ kind, raw }` slices so `joinMarkdownBlocks(splitMarkdownBlocks(body)) === body`
 * holds identically for every input string.
 *
 * Block kinds: `'code'`, `'math'`, `'callout'`, `'quote'`, `'table'`,
 * `'heading'`, `'hr'`, `'list'`, `'paragraph'`.
 *
 * @param {string} body
 * @returns {Array<{ kind: string, raw: string }>}
 */
export function splitMarkdownBlocks(body) {
  const source = String(body ?? '');
  if (!source) return [];

  const lines = splitLinesWithEndings(source);
  const blocks = [];
  let i = 0;
  let pendingLead = '';

  const consumeTrailingBlanks = () => {
    let trailing = '';
    while (i < lines.length && stripEol(lines[i]).trim() === '') {
      trailing += lines[i];
      i += 1;
    }
    return trailing;
  };

  while (i < lines.length && stripEol(lines[i]).trim() === '') {
    pendingLead += lines[i];
    i += 1;
  }

  if (i >= lines.length) {
    return [{ kind: 'paragraph', raw: pendingLead }];
  }

  while (i < lines.length) {
    const startLine = lines[i];
    const content = stripEol(startLine);
    const trimmed = content.trim();
    let kind = 'paragraph';
    let chunk = '';

    const fenceMatch = isCodeFenceStart(content);
    if (fenceMatch) {
      kind = 'code';
      const fenceChar = fenceMatch[1][0];
      const fenceLen = fenceMatch[1].length;
      const closeRe = new RegExp(`^ {0,3}${fenceChar}{${fenceLen},}[ \\t]*$`);
      chunk += lines[i];
      i += 1;
      while (i < lines.length) {
        const line = lines[i];
        chunk += line;
        i += 1;
        if (closeRe.test(stripEol(line))) break;
      }
    } else if (isMathBlockStart(trimmed)) {
      kind = 'math';
      const closeToken = trimmed.startsWith('$$') ? '$$' : '\\]';
      chunk += lines[i];
      i += 1;
      const singleLineClosed = trimmed.length >= 4 && trimmed.endsWith(closeToken);
      if (!singleLineClosed) {
        while (i < lines.length) {
          const line = lines[i];
          chunk += line;
          i += 1;
          if (stripEol(line).trim().endsWith(closeToken)) break;
        }
      }
    } else if (isHeadingLine(content)) {
      kind = 'heading';
      chunk += lines[i];
      i += 1;
    } else if (isHorizontalRuleLine(content)) {
      kind = 'hr';
      chunk += lines[i];
      i += 1;
    } else if (isQuoteLine(content)) {
      kind = /^ {0,3}>\s*\[![a-zA-Z0-9_-]+\]/.test(content) ? 'callout' : 'quote';
      chunk += lines[i];
      i += 1;
      while (i < lines.length && isQuoteLine(stripEol(lines[i]))) {
        chunk += lines[i];
        i += 1;
      }
    } else if (isTableStart(lines, i)) {
      kind = 'table';
      chunk += lines[i];
      i += 1;
      while (i < lines.length) {
        const nextContent = stripEol(lines[i]);
        const nextTrimmed = nextContent.trim();
        if (
          !nextTrimmed
          || !nextTrimmed.includes('|')
          || isHeadingLine(nextContent)
          || isQuoteLine(nextContent)
          || isCodeFenceStart(nextContent)
          || isHorizontalRuleLine(nextContent)
        ) {
          break;
        }
        chunk += lines[i];
        i += 1;
      }
    } else if (isListLine(content)) {
      kind = 'list';
      chunk += lines[i];
      i += 1;
      while (i < lines.length) {
        const nextContent = stripEol(lines[i]);
        const nextTrimmed = nextContent.trim();
        if (!nextTrimmed) break;
        if (isHorizontalRuleLine(nextContent)) break;
        if (isListLine(nextContent)) {
          chunk += lines[i];
          i += 1;
          continue;
        }
        if (/^(?: {2,}|\t+)\S/.test(nextContent) && !isCodeFenceStart(nextContent)) {
          chunk += lines[i];
          i += 1;
          continue;
        }
        break;
      }
    } else {
      kind = 'paragraph';
      chunk += lines[i];
      i += 1;
      while (i < lines.length) {
        const nextTrimmed = stripEol(lines[i]).trim();
        if (!nextTrimmed) break;
        if (startsStructuralBlock(lines, i)) break;
        chunk += lines[i];
        i += 1;
      }
    }

    chunk += consumeTrailingBlanks();

    if (pendingLead) {
      chunk = pendingLead + chunk;
      pendingLead = '';
    }
    blocks.push({ kind, raw: chunk });
  }

  return blocks;
}

/**
 * Pure reconstructor joining split Markdown blocks back into the exact original
 * body string.
 *
 * @param {Array<{ kind?: string, raw: string }>} blocks
 * @returns {string}
 */
export function joinMarkdownBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return '';
  return blocks.map((block) => (block ? String(block.raw ?? '') : '')).join('');
}

function autoResizeTextarea(ta) {
  if (!ta) return;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content')) {
    return;
  }
  ta.style.height = 'auto';
  ta.style.height = `${Math.max(28, ta.scrollHeight || 28)}px`;
}

function isCaretInsideOpenFence(kind, value, caret) {
  if (kind !== 'code' && kind !== 'math') return false;
  const lines = value.split('\n');
  const beforeLines = value.slice(0, caret).split('\n').length;
  if (lines.length >= 2 && beforeLines < lines.length) {
    const lastTrimmed = lines[lines.length - 1].trim();
    if (kind === 'code' && (/^`{3,}$/.test(lastTrimmed) || /^~{3,}$/.test(lastTrimmed))) {
      return true;
    }
    if (kind === 'math' && (lastTrimmed.endsWith('$$') || lastTrimmed.endsWith('\\]'))) {
      return true;
    }
  }
  return false;
}

/**
 * Mount the Obsidian-inspired Live Preview editor into `container`.
 *
 * @param {HTMLElement} container
 * @param {object} [opts]
 * @param {string} [opts.raw]
 * @param {string} [opts.title]
 * @param {object} [opts.detail]
 * @param {(markdown: string) => string} [opts.renderBlockHtml]
 * @param {(nextRaw: string) => void} [opts.onInput]
 * @param {() => void} [opts.onSave]
 * @param {(target: string, el: HTMLElement) => void} [opts.onOpenLink]
 * @param {(kind: 'task'|'pip', index: number) => void} [opts.onToggleCheckbox]
 * @param {(tag: string) => void} [opts.onFilterTag]
 * @param {() => Array<object>} [opts.getNotes]
 * @param {() => Array<string|object>} [opts.getTags]
 * @param {(textarea: HTMLTextAreaElement|null) => void} [opts.onActiveTextarea]
 * @returns {{ destroy: () => void, getValue: () => string, focusBlock: (idx: number, options?: { caret?: number|'end' }) => void, getActiveTextarea: () => HTMLTextAreaElement|null }}
 */
export function mountLiveEditor(container, opts = {}) {
  const editable = typeof opts.onInput === 'function';
  const renderHtml = typeof opts.renderBlockHtml === 'function'
    ? opts.renderBlockHtml
    : (md) => renderMarkdown(md);

  const doc = splitDocument(opts.raw ?? '');
  let blocks = splitMarkdownBlocks(doc.body);

  // Preserve title line envelope when editing the inline title
  let titleLead = '';
  let titleEol = doc.body ? '\n\n' : '\n';
  if (doc.titleLine) {
    const tm = /^((?:[ \t]*\r?\n)*)#[ \t]+([^\r\n]*)(\r?\n?)$/.exec(doc.titleLine);
    if (tm) {
      titleLead = tm[1];
      titleEol = tm[3] || (doc.body ? '\n' : '');
    }
  }

  let activeIndex = -1;
  let activeTextarea = null;
  let activeEditorHandle = null;
  let activeEnvelope = { lead: '', trail: '' };
  let suppressBlur = false;

  container.innerHTML = '';

  const getValue = () => joinDocument({
    frontmatter: doc.frontmatter,
    titleLine: doc.titleLine,
    body: joinMarkdownBlocks(blocks),
  });

  const emitChange = () => {
    doc.body = joinMarkdownBlocks(blocks);
    if (editable) {
      opts.onInput(getValue());
    }
  };

  // 1. Collapsible Properties Panel (<details class="studio-properties">)
  const propsDetails = document.createElement('details');
  propsDetails.className = 'studio-properties';

  const propsSummary = document.createElement('summary');
  propsSummary.className = 'studio-properties-summary';
  propsDetails.appendChild(propsSummary);

  const propsBody = document.createElement('div');
  propsBody.className = 'studio-properties-body';
  propsDetails.appendChild(propsBody);

  function renderProperties(focusTagInput = false) {
    const allProps = parseFrontmatterBlock(doc.frontmatter);
    const nonTagProps = allProps.filter((p) => {
      const lower = p.key.toLowerCase();
      return lower !== 'tags' && lower !== 'tag';
    });
    const tags = extractFrontmatterTags(doc.frontmatter);

    const propLabel = `${nonTagProps.length} ${nonTagProps.length === 1 ? 'property' : 'properties'}`;
    const tagLabel = `${tags.length} ${tags.length === 1 ? 'tag' : 'tags'}`;
    propsSummary.textContent = `Properties · ${propLabel} · ${tagLabel}`;

    propsBody.innerHTML = '';

    if (nonTagProps.length) {
      const propList = document.createElement('div');
      propList.className = 'studio-props-list';
      for (const prop of nonTagProps) {
        const chip = document.createElement('span');
        chip.className = 'studio-prop studio-prop-chip';

        const keyEl = document.createElement('span');
        keyEl.className = 'studio-prop-key';
        keyEl.textContent = prop.key;

        const valEl = document.createElement('span');
        valEl.className = 'studio-prop-val';
        valEl.textContent = prop.isList ? prop.items.join(', ') : prop.value;

        chip.append(keyEl, valEl);
        propList.appendChild(chip);
      }
      propsBody.appendChild(propList);
    }

    const tagsRow = document.createElement('div');
    tagsRow.className = 'studio-tags-list';

    for (const tag of tags) {
      const pill = document.createElement('span');
      pill.className = 'studio-tag-pill';

      const tagBtn = document.createElement('button');
      tagBtn.type = 'button';
      tagBtn.className = 'studio-tag-btn';
      tagBtn.dataset.filterTag = tag;
      tagBtn.textContent = `#${tag}`;
      tagBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        if (typeof opts.onFilterTag === 'function') opts.onFilterTag(tag);
      });
      pill.appendChild(tagBtn);

      if (editable) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'studio-tag-remove';
        removeBtn.title = `Remove #${tag}`;
        removeBtn.setAttribute('aria-label', `Remove tag ${tag}`);
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          const remaining = tags.filter((t) => t.toLowerCase() !== tag.toLowerCase());
          doc.frontmatter = updateFrontmatterTags(doc.frontmatter, remaining);
          renderProperties(false);
          emitChange();
        });
        pill.appendChild(removeBtn);
      }

      tagsRow.appendChild(pill);
    }

    let tagInputEl = null;
    if (editable) {
      tagInputEl = document.createElement('input');
      tagInputEl.className = 'studio-tag-add';
      tagInputEl.type = 'text';
      tagInputEl.placeholder = '+ Tag';
      tagInputEl.setAttribute('aria-label', 'Add tag');
      tagInputEl.autocomplete = 'off';
      tagInputEl.spellcheck = false;

      let tagComposing = false;
      tagInputEl.addEventListener('compositionstart', () => {
        tagComposing = true;
      });
      tagInputEl.addEventListener('compositionend', () => {
        tagComposing = false;
      });

      const commitTagInput = (keepFocus) => {
        const rawTag = tagInputEl.value.trim().replace(/^#+/, '').trim();
        if (!rawTag) {
          tagInputEl.value = '';
          return;
        }
        const nextTags = normalizeTagList([...tags, ...rawTag.split(/[,\s]+/)]);
        doc.frontmatter = updateFrontmatterTags(doc.frontmatter, nextTags);
        renderProperties(keepFocus);
        emitChange();
      };

      tagInputEl.addEventListener('keydown', (event) => {
        if (tagComposing || event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          commitTagInput(true);
        } else if (event.key === 'Escape') {
          tagInputEl.value = '';
          tagInputEl.blur();
        }
      });

      tagInputEl.addEventListener('blur', () => {
        if (!tagComposing && tagInputEl.value.trim()) {
          commitTagInput(false);
        }
      });

      tagsRow.appendChild(tagInputEl);
    }

    propsBody.appendChild(tagsRow);

    if (focusTagInput && tagInputEl) {
      tagInputEl.focus();
    }
  }

  renderProperties(false);
  container.appendChild(propsDetails);

  // 2. Obsidian Inline Title (<input class="studio-inline-title">)
  const titleInput = document.createElement('input');
  titleInput.className = 'studio-inline-title';
  titleInput.type = 'text';
  titleInput.setAttribute('aria-label', 'Note title');
  titleInput.placeholder = 'Untitled note';
  titleInput.value = doc.titleText || opts.title || opts.detail?.title || '';
  if (!editable) {
    titleInput.readOnly = true;
  }

  let titleComposing = false;
  const syncTitle = () => {
    const cleaned = titleInput.value.replace(/[\r\n]+/g, ' ').trim();
    if (cleaned) {
      doc.titleLine = `${titleLead}# ${cleaned}${titleEol}`;
      doc.titleText = cleaned;
    } else {
      doc.titleLine = '';
      doc.titleText = '';
    }
    emitChange();
  };

  titleInput.addEventListener('compositionstart', () => {
    titleComposing = true;
  });
  titleInput.addEventListener('compositionend', () => {
    titleComposing = false;
    syncTitle();
  });
  titleInput.addEventListener('input', () => {
    if (!titleComposing) syncTitle();
  });
  titleInput.addEventListener('keydown', (event) => {
    if (titleComposing || event.isComposing || event.keyCode === 229) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (typeof opts.onSave === 'function') opts.onSave();
      return;
    }
    if ((event.key === 'Enter' || event.key === 'ArrowDown') && editable) {
      event.preventDefault();
      if (!blocks.length) {
        blocks.push({ kind: 'paragraph', raw: '' });
        renderAllBlocks();
      }
      focusBlock(0, { caret: 0 });
    }
  });

  container.appendChild(titleInput);

  // 3. Live Preview Block Canvas (.live-editor)
  const liveRoot = document.createElement('div');
  liveRoot.className = 'live-editor';

  const blocksContainer = document.createElement('div');
  blocksContainer.className = 'live-blocks';
  liveRoot.appendChild(blocksContainer);

  let appendButton = null;
  if (editable) {
    appendButton = document.createElement('button');
    appendButton.type = 'button';
    appendButton.className = 'live-block-append';
    appendButton.textContent = 'Tap to write below…';
    appendButton.addEventListener('click', () => {
      appendNewParagraphBlock();
    });
    liveRoot.appendChild(appendButton);
  }

  container.appendChild(liveRoot);

  // Attach floating selection bubble inside container
  const cleanupBubble = editable
    ? attachSelectionBubble(
      container,
      () => activeTextarea,
      (cmd) => {
        if (activeTextarea) runEditorCommand(activeTextarea, cmd);
      },
    )
    : () => {};

  function setBlockKindClass(blockEl, kind) {
    for (const k of BLOCK_KINDS) {
      blockEl.classList.remove(`is-${k}`);
    }
    if (kind) blockEl.classList.add(`is-${kind}`);
  }

  function reindexInteractiveCheckboxes() {
    let taskCursor = 0;
    let pipCursor = 0;
    blocksContainer.querySelectorAll('.live-block-view').forEach((viewEl) => {
      viewEl.querySelectorAll('.task-box[data-task-index]').forEach((btn, localIdx) => {
        btn.dataset.taskIndex = String(taskCursor);
        btn.dataset.localTaskIndex = String(localIdx);
        taskCursor += 1;
      });
      viewEl.querySelectorAll('.tally-pip[data-pip-index]').forEach((btn, localIdx) => {
        btn.dataset.pipIndex = String(pipCursor);
        btn.dataset.localPipIndex = String(localIdx);
        pipCursor += 1;
      });
    });
  }

  function buildBlockViewElement(block, index) {
    const view = document.createElement('div');
    view.className = 'prose live-block-view';
    const html = renderHtml(block.raw);
    view.innerHTML = html && html.trim() ? html : '<p class="live-block-empty">&nbsp;</p>';

    view.addEventListener('click', (event) => {
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;

      const wikilink = target.closest('.wikilink');
      if (wikilink) {
        if (typeof opts.onOpenLink === 'function') {
          event.preventDefault();
          event.stopPropagation();
          opts.onOpenLink(wikilink.dataset.target || '', wikilink);
        }
        return;
      }

      const taskBtn = target.closest('.task-box');
      if (taskBtn) {
        if (typeof opts.onToggleCheckbox === 'function') {
          event.preventDefault();
          event.stopPropagation();
          const globalIdx = Number(taskBtn.dataset.taskIndex);
          const localIdx = Number(taskBtn.dataset.localTaskIndex ?? 0);
          blocks[index].raw = toggleNthTaskBox(blocks[index].raw, localIdx);
          renderAllBlocks();
          opts.onToggleCheckbox('task', globalIdx);
        }
        return;
      }

      const pipBtn = target.closest('.tally-pip');
      if (pipBtn) {
        if (typeof opts.onToggleCheckbox === 'function') {
          event.preventDefault();
          event.stopPropagation();
          const globalIdx = Number(pipBtn.dataset.pipIndex);
          const localIdx = Number(pipBtn.dataset.localPipIndex ?? 0);
          blocks[index].raw = toggleNthBallotBox(blocks[index].raw, localIdx);
          renderAllBlocks();
          opts.onToggleCheckbox('pip', globalIdx);
        }
        return;
      }

      if (target.closest('a, button')) {
        return;
      }

      if (editable) {
        focusBlock(index, { caret: 'end' });
      }
    });

    return view;
  }

  function renderAllBlocks() {
    blocksContainer.innerHTML = '';
    blocks.forEach((block, index) => {
      const blockEl = document.createElement('div');
      blockEl.className = 'live-block';
      blockEl.dataset.blockIndex = String(index);
      setBlockKindClass(blockEl, block.kind);
      blockEl.appendChild(buildBlockViewElement(block, index));
      blocksContainer.appendChild(blockEl);
    });
    reindexInteractiveCheckboxes();
  }

  function teardownActiveEditor(notifyNull = true) {
    if (activeEditorHandle) {
      activeEditorHandle.destroy();
      activeEditorHandle = null;
    }
    const hadTextarea = activeTextarea !== null;
    activeTextarea = null;
    activeIndex = -1;
    if (notifyNull && hadTextarea && typeof opts.onActiveTextarea === 'function') {
      opts.onActiveTextarea(null);
    }
  }

  function commitActiveBlock({ resplit = true, notifyNull = true } = {}) {
    if (activeIndex < 0 || !activeTextarea) return;
    const idx = activeIndex;
    const core = activeTextarea.value;
    blocks[idx].raw = activeEnvelope.lead + core + activeEnvelope.trail;
    blocks[idx].kind = inferBlockKind(blocks[idx].raw);

    teardownActiveEditor(notifyNull);

    if (resplit) {
      const joined = joinMarkdownBlocks(blocks);
      blocks = splitMarkdownBlocks(joined);
    }
    renderAllBlocks();
  }

  function appendNewParagraphBlock() {
    if (!editable) return;
    if (activeIndex >= 0 && activeIndex === blocks.length - 1 && activeTextarea && activeTextarea.value === '') {
      activeTextarea.focus();
      return;
    }

    suppressBlur = true;
    if (activeIndex >= 0) {
      commitActiveBlock({ resplit: false, notifyNull: false });
    }

    if (blocks.length > 0) {
      const last = blocks[blocks.length - 1];
      if (last.raw && !/\r?\n[ \t]*\r?\n$/.test(last.raw)) {
        last.raw = last.raw.endsWith('\n') ? `${last.raw}\n` : `${last.raw}\n\n`;
      }
    }
    blocks.push({ kind: 'paragraph', raw: '' });
    renderAllBlocks();
    suppressBlur = false;
    focusBlock(blocks.length - 1, { caret: 0 });
  }

  function focusBlock(idx, { caret = 'end' } = {}) {
    if (!editable) return;
    if (!blocks.length) {
      blocks.push({ kind: 'paragraph', raw: '' });
      renderAllBlocks();
    }

    const targetIndex = Math.max(0, Math.min(idx, blocks.length - 1));
    if (activeIndex === targetIndex && activeTextarea) {
      activeTextarea.focus();
      const pos = caret === 'end'
        ? activeTextarea.value.length
        : Math.max(0, Math.min(Number(caret) || 0, activeTextarea.value.length));
      activeTextarea.setSelectionRange(pos, pos);
      return;
    }

    suppressBlur = true;
    if (activeIndex >= 0) {
      commitActiveBlock({ resplit: false, notifyNull: false });
    }

    let blockEl = blocksContainer.querySelector(`.live-block[data-block-index="${targetIndex}"]`);
    if (!blockEl) {
      renderAllBlocks();
      blockEl = blocksContainer.querySelector(`.live-block[data-block-index="${targetIndex}"]`);
    }
    if (!blockEl) {
      suppressBlur = false;
      return;
    }

    const block = blocks[targetIndex];
    const env = splitBlockEnvelope(block.raw);
    activeEnvelope = { lead: env.lead, trail: env.trail };

    blockEl.innerHTML = '';
    blockEl.classList.add('is-editing');
    setBlockKindClass(blockEl, block.kind);

    const ta = document.createElement('textarea');
    ta.className = 'live-block-input';
    ta.spellcheck = true;
    ta.rows = Math.max(1, env.core.split('\n').length);
    ta.value = env.core;
    ta.setAttribute('aria-label', `Edit ${block.kind} block`);
    blockEl.appendChild(ta);

    activeIndex = targetIndex;
    activeTextarea = ta;

    activeEditorHandle = attachEditor(ta, {
      getNotes: opts.getNotes,
      getTags: opts.getTags,
      onSave: () => {
        blocks[targetIndex].raw = activeEnvelope.lead + ta.value + activeEnvelope.trail;
        emitChange();
        if (typeof opts.onSave === 'function') opts.onSave();
      },
      onCancel: () => {
        suppressBlur = true;
        commitActiveBlock({ resplit: true, notifyNull: true });
        suppressBlur = false;
      },
      onChange: () => {
        if (activeIndex !== targetIndex) return;
        blocks[targetIndex].raw = activeEnvelope.lead + ta.value + activeEnvelope.trail;
        const nextKind = inferBlockKind(ta.value);
        if (nextKind !== blocks[targetIndex].kind) {
          blocks[targetIndex].kind = nextKind;
          setBlockKindClass(blockEl, nextKind);
        }
        autoResizeTextarea(ta);
        emitChange();
      },
    });

    // Obsidian keyboard flow inside `.live-block-input`
    ta.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      // 1. ArrowUp on first line -> commit and focus end of previous block
      if (event.key === 'ArrowUp' && !event.shiftKey && ta.selectionStart === ta.selectionEnd) {
        const onFirstLine = !ta.value.slice(0, ta.selectionStart).includes('\n');
        if (onFirstLine) {
          if (targetIndex > 0) {
            event.preventDefault();
            focusBlock(targetIndex - 1, { caret: 'end' });
          } else if (ta.selectionStart === 0) {
            event.preventDefault();
            suppressBlur = true;
            commitActiveBlock({ resplit: true, notifyNull: true });
            suppressBlur = false;
            titleInput.focus();
            titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
          }
        }
        return;
      }

      // 2. ArrowDown on last line -> commit and focus start of next block
      if (event.key === 'ArrowDown' && !event.shiftKey && ta.selectionStart === ta.selectionEnd) {
        const onLastLine = !ta.value.slice(ta.selectionStart).includes('\n');
        if (onLastLine && targetIndex < blocks.length - 1) {
          event.preventDefault();
          focusBlock(targetIndex + 1, { caret: 0 });
        }
        return;
      }

      // 3. Enter inside a heading block OR double-Enter (Enter on an empty trailing line)
      if (event.key === 'Enter' && !event.shiftKey) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const before = ta.value.slice(0, start);
        const after = ta.value.slice(end);
        const isHeading = blocks[targetIndex].kind === 'heading' || isHeadingLine(ta.value);

        if (isHeading) {
          event.preventDefault();
          suppressBlur = true;
          blocks[targetIndex].raw = `${activeEnvelope.lead}${before}\n\n`;
          blocks[targetIndex].kind = inferBlockKind(before);
          blocks.splice(targetIndex + 1, 0, {
            kind: inferBlockKind(after),
            raw: `${after}${activeEnvelope.trail}`,
          });
          teardownActiveEditor(false);
          renderAllBlocks();
          emitChange();
          suppressBlur = false;
          focusBlock(targetIndex + 1, { caret: 0 });
          return;
        }

        const insideFence = isCaretInsideOpenFence(blocks[targetIndex].kind, ta.value, start);
        if (!insideFence && start === end && after.trim() === '' && /\r?\n[ \t]*$/.test(before)) {
          event.preventDefault();
          suppressBlur = true;
          const leftCore = before.replace(/\r?\n[ \t]*$/, '');
          blocks[targetIndex].raw = `${activeEnvelope.lead}${leftCore}\n\n`;
          blocks[targetIndex].kind = inferBlockKind(leftCore);
          blocks.splice(targetIndex + 1, 0, {
            kind: 'paragraph',
            raw: activeEnvelope.trail,
          });
          teardownActiveEditor(false);
          renderAllBlocks();
          emitChange();
          suppressBlur = false;
          focusBlock(targetIndex + 1, { caret: 0 });
          return;
        }
      }

      // 4. Backspace at caret 0 when block > 0 -> merge into end of previous block
      if (
        event.key === 'Backspace'
        && !event.shiftKey
        && ta.selectionStart === 0
        && ta.selectionEnd === 0
        && targetIndex > 0
      ) {
        event.preventDefault();
        suppressBlur = true;
        const prevEnv = splitBlockEnvelope(blocks[targetIndex - 1].raw);
        const currCore = ta.value;
        const joinOffset = prevEnv.core.length;
        const mergedCore = prevEnv.core + currCore;

        blocks[targetIndex - 1] = {
          kind: inferBlockKind(mergedCore),
          raw: prevEnv.lead + mergedCore + activeEnvelope.trail,
        };
        blocks.splice(targetIndex, 1);

        teardownActiveEditor(false);
        renderAllBlocks();
        emitChange();
        suppressBlur = false;
        focusBlock(targetIndex - 1, { caret: joinOffset });
      }
    });

    ta.addEventListener('blur', (event) => {
      if (suppressBlur || activeIndex !== targetIndex || activeTextarea !== ta) return;
      const next = event.relatedTarget;
      if (next && typeof next.closest === 'function' && next.closest('.editor-bar, .selection-bubble, .editor-popover')) {
        return;
      }
      commitActiveBlock({ resplit: true, notifyNull: true });
    });

    ta.focus();
    const pos = caret === 'end'
      ? ta.value.length
      : Math.max(0, Math.min(Number(caret) || 0, ta.value.length));
    ta.setSelectionRange(pos, pos);
    autoResizeTextarea(ta);

    if (typeof opts.onActiveTextarea === 'function') {
      opts.onActiveTextarea(ta);
    }
    suppressBlur = false;
  }

  // Clicking empty whitespace on the live editor canvas appends/focuses a paragraph
  liveRoot.addEventListener('click', (event) => {
    if (!editable) return;
    if (event.target === liveRoot || event.target === blocksContainer) {
      appendNewParagraphBlock();
    }
  });

  renderAllBlocks();

  return {
    destroy() {
      suppressBlur = true;
      teardownActiveEditor(true);
      cleanupBubble();
      container.innerHTML = '';
      suppressBlur = false;
    },
    getValue,
    focusBlock,
    getActiveTextarea() {
      return activeTextarea;
    },
  };
}
