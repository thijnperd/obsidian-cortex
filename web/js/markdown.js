// Safe Markdown -> HTML with GFM Tables, LaTeX Math, Obsidian Callouts,
// nested lists, task checkboxes, highlights, and wikilinks.
// No raw HTML is passed through; strict CSP (no inline style attributes).

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

const LATEX_SYMBOLS = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'ϕ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷', ast: '∗', star: '⋆',
  circ: '∘', bullet: '∙', oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙',
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
  equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', implies: '⟹',
  iff: '⟺', mapsto: '↦', uparrow: '↑', downarrow: '↓',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃',
  supseteq: '⊇', cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅',
  varnothing: '∅', forall: '∀', exists: '∃', nexists: '∄', neg: '¬',
  lnot: '¬', land: '∧', lor: '∨', top: '⊤', bot: '⊥', vdash: '⊢', models: '⊨',
  infty: '∞', partial: '∂', nabla: '∇', aleph: 'ℵ', hbar: 'ℏ', ell: 'ℓ',
  Re: 'ℜ', Im: 'ℑ', wp: '℘',
  sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭',
  oint: '∮', bigcup: '⋃', bigcap: '⋂', bigoplus: '⨁', bigotimes: '⨂',
  perp: '⊥', parallel: '∥', angle: '∠', triangle: '△',Box: '□',
  dots: '…', ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱',
  prime: '′', degree: '°', dagger: '†', ddagger: '‡',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  quad: ' ', qquad: '  ', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
};

const LATEX_FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan',
  'sinh', 'cosh', 'tanh', 'log', 'ln', 'lg', 'exp', 'lim', 'sup', 'inf',
  'min', 'max', 'det', 'dim', 'ker', 'deg', 'gcd', 'Pr', 'hom', 'arg', 'mod',
]);

const BLACKBOARD_MAP = {
  R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', F: '𝔽', E: '𝔼', H: 'ℍ',
};

function readBraced(src, pos) {
  let i = pos;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] !== '{') {
    if (src[i] === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(src.slice(i));
      if (m) return { content: m[0], next: i + m[0].length };
    }
    return { content: src[i] || '', next: Math.min(src.length, i + 1) };
  }
  let depth = 0;
  const start = i + 1;
  for (; i < src.length; i += 1) {
    if (src[i] === '\\') {
      i += 1;
      continue;
    }
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return { content: src.slice(start, i), next: i + 1 };
      }
    }
  }
  return { content: src.slice(start), next: src.length };
}

function readBracketed(src, pos) {
  let i = pos;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] !== '[') return null;
  const end = src.indexOf(']', i + 1);
  if (end < 0) return null;
  return { content: src.slice(i + 1, end), next: end + 1 };
}

export function renderLatex(tex, display = false) {
  const src = String(tex || '').trim();
  if (!src) return '';
  return `<span class="math-expr${display ? ' is-display' : ''}">${parseLatexSegment(src)}</span>`;
}

function parseLatexSegment(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === '{') {
      const group = readBraced(src, i);
      out += `<span class="math-group">${parseLatexSegment(group.content)}</span>`;
      i = group.next;
      continue;
    }

    if (ch === '^' || ch === '_') {
      let sup = null;
      let sub = null;
      while (i < src.length && (src[i] === '^' || src[i] === '_')) {
        const kind = src[i];
        const arg = readBraced(src, i + 1);
        if (kind === '^') sup = parseLatexSegment(arg.content);
        else sub = parseLatexSegment(arg.content);
        i = arg.next;
      }
      if (sup !== null && sub !== null) {
        out += `<span class="math-scripts"><sup class="math-sup">${sup}</sup><sub class="math-sub">${sub}</sub></span>`;
      } else if (sup !== null) {
        out += `<sup class="math-sup">${sup}</sup>`;
      } else if (sub !== null) {
        out += `<sub class="math-sub">${sub}</sub>`;
      }
      continue;
    }

    if (ch === '\\') {
      if (src[i + 1] === '\\') {
        out += '<br/>';
        i += 2;
        continue;
      }
      if ('{};,!:%$#_&'.includes(src[i + 1] || '')) {
        const esc = src[i + 1];
        out += LATEX_SYMBOLS[esc] !== undefined ? LATEX_SYMBOLS[esc] : escapeHtml(esc);
        i += 2;
        continue;
      }
      const match = /^\\([a-zA-Z]+)/.exec(src.slice(i));
      if (!match) {
        i += 1;
        continue;
      }
      const cmd = match[1];
      i += match[0].length;

      if (cmd === 'left' || cmd === 'right') {
        while (i < src.length && /\s/.test(src[i])) i += 1;
        if (src[i] === '.') {
          i += 1;
        } else if (src.slice(i).startsWith('\\{') || src.slice(i).startsWith('\\}')) {
          out += `<span class="math-delim">${escapeHtml(src[i + 1])}</span>`;
          i += 2;
        } else if (src[i] === '\\') {
          const dm = /^\\([a-zA-Z]+)/.exec(src.slice(i));
          if (dm && LATEX_SYMBOLS[dm[1]]) {
            out += `<span class="math-delim">${LATEX_SYMBOLS[dm[1]]}</span>`;
            i += dm[0].length;
          }
        } else if (src[i]) {
          out += `<span class="math-delim">${escapeHtml(src[i])}</span>`;
          i += 1;
        }
        continue;
      }

      if (cmd === 'frac' || cmd === 'dfrac' || cmd === 'tfrac') {
        const num = readBraced(src, i);
        const den = readBraced(src, num.next);
        out += `<span class="math-frac"><span class="math-num">${parseLatexSegment(num.content)}</span><span class="math-den">${parseLatexSegment(den.content)}</span></span>`;
        i = den.next;
        continue;
      }

      if (cmd === 'sqrt') {
        const opt = readBracketed(src, i);
        const rad = readBraced(src, opt ? opt.next : i);
        const rootHtml = opt ? `<sup class="math-root">${parseLatexSegment(opt.content)}</sup>` : '';
        out += `<span class="math-sqrt">${rootHtml}<span class="math-radic">√</span><span class="math-radicand">${parseLatexSegment(rad.content)}</span></span>`;
        i = rad.next;
        continue;
      }

      if (cmd === 'overline' || cmd === 'bar' || cmd === 'hat' || cmd === 'vec' || cmd === 'tilde' || cmd === 'dot') {
        const arg = readBraced(src, i);
        const cls = cmd === 'overline' || cmd === 'bar' ? 'math-overline' : `math-accent math-accent-${cmd}`;
        out += `<span class="${cls}">${parseLatexSegment(arg.content)}</span>`;
        i = arg.next;
        continue;
      }

      if (cmd === 'text' || cmd === 'textrm' || cmd === 'mathrm' || cmd === 'operatorname') {
        const arg = readBraced(src, i);
        out += `<span class="math-rm">${escapeHtml(arg.content)}</span>`;
        i = arg.next;
        continue;
      }

      if (cmd === 'mathbf' || cmd === 'boldsymbol' || cmd === 'bm') {
        const arg = readBraced(src, i);
        out += `<strong class="math-bf">${parseLatexSegment(arg.content)}</strong>`;
        i = arg.next;
        continue;
      }

      if (cmd === 'mathit' || cmd === 'emph') {
        const arg = readBraced(src, i);
        out += `<em class="math-it">${parseLatexSegment(arg.content)}</em>`;
        i = arg.next;
        continue;
      }

      if (cmd === 'mathbb') {
        const arg = readBraced(src, i);
        const mapped = arg.content.replace(/[A-Z]/g, (c) => BLACKBOARD_MAP[c] || c);
        out += `<span class="math-bb">${escapeHtml(mapped)}</span>`;
        i = arg.next;
        continue;
      }

      if (cmd === 'mathcal' || cmd === 'mathscr') {
        const arg = readBraced(src, i);
        out += `<span class="math-cal">${parseLatexSegment(arg.content)}</span>`;
        i = arg.next;
        continue;
      }

      if (cmd === 'begin') {
        const env = readBraced(src, i);
        const endTag = `\\end{${env.content}}`;
        const endIdx = src.indexOf(endTag, env.next);
        if (endIdx >= 0) {
          const body = src.slice(env.next, endIdx);
          i = endIdx + endTag.length;
          const rows = body.trim().split(/\\\\/).filter((r) => r.trim().length > 0);
          const cellsHtml = rows
            .map((row) => {
              const cols = row.split('&').map((c) => `<span class="math-matrix-cell">${parseLatexSegment(c.trim())}</span>`).join('');
              return `<span class="math-matrix-row">${cols}</span>`;
            })
            .join('');
          const kind = env.content.replace(/[^a-zA-Z]/g, '');
          out += `<span class="math-matrix math-matrix-${kind}">${cellsHtml}</span>`;
          continue;
        }
      }

      if (LATEX_FUNCTIONS.has(cmd)) {
        out += `<span class="math-fn">${escapeHtml(cmd)}</span>`;
        continue;
      }

      if (LATEX_SYMBOLS[cmd] !== undefined) {
        const sym = LATEX_SYMBOLS[cmd];
        const isBig = ['sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint', 'bigcup', 'bigcap'].includes(cmd);
        out += isBig ? `<span class="math-op">${sym}</span>` : sym;
        continue;
      }

      out += `<span class="math-fn">${escapeHtml(cmd)}</span>`;
      continue;
    }

    if (ch === '-') {
      out += '−';
      i += 1;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }
  return out;
}

/**
 * Splits a Markdown table row on `|` delimiters while ignoring `|` inside
 * `[[wikilink|alias]]`, inline `` `code` ``, `$math$`, or escaped `\|`.
 */
function splitTableCells(line) {
  let raw = line.trim();
  if (raw.startsWith('|')) raw = raw.slice(1);
  if (raw.endsWith('|') && !raw.endsWith('\\|')) raw = raw.slice(0, -1);

  const cells = [];
  let current = '';
  let bracketDepth = 0;
  let inCode = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === '\\' && i + 1 < raw.length) {
      if (raw[i + 1] === '|') {
        current += '|';
      } else {
        current += ch + raw[i + 1];
      }
      i += 1;
      continue;
    }
    if (ch === '`') {
      inCode = !inCode;
      current += ch;
      continue;
    }
    if (!inCode) {
      if (ch === '[' && raw[i + 1] === '[') {
        bracketDepth += 1;
        current += '[[';
        i += 1;
        continue;
      }
      if (ch === ']' && raw[i + 1] === ']' && bracketDepth > 0) {
        bracketDepth -= 1;
        current += ']]';
        i += 1;
        continue;
      }
      if (ch === '|' && bracketDepth === 0) {
        cells.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function isTableDelimiter(line) {
  const trimmed = line.trim();
  if (!trimmed.includes('|') || !trimmed.includes('-')) return null;
  const cells = splitTableCells(trimmed);
  if (!cells.length) return null;
  const aligns = [];
  for (const cell of cells) {
    if (!/^:?-{2,}:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    if (left && right) aligns.push('center');
    else if (right) aligns.push('right');
    else aligns.push('left');
  }
  return aligns;
}

const CALLOUT_LABELS = {
  info: 'Info',
  note: 'Note',
  tip: 'Tip',
  hint: 'Hint',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
  attention: 'Attention',
  danger: 'Danger',
  error: 'Error',
  bug: 'Bug',
  quote: 'Quote',
  cite: 'Quote',
  example: 'Example',
  question: 'Question',
  help: 'Help',
  faq: 'FAQ',
  success: 'Success',
  check: 'Check',
  done: 'Done',
  abstract: 'Summary',
  summary: 'Summary',
  tldr: 'TL;DR',
  todo: 'To do',
};

function calloutKind(rawType) {
  const t = String(rawType || 'note').toLowerCase();
  if (['info', 'todo', 'abstract', 'summary', 'tldr'].includes(t)) return 'info';
  if (['tip', 'hint', 'important', 'success', 'check', 'done'].includes(t)) return 'tip';
  if (['warning', 'caution', 'attention', 'question', 'help', 'faq'].includes(t)) return 'warning';
  if (['danger', 'error', 'bug', 'fail', 'failure', 'missing'].includes(t)) return 'danger';
  if (['quote', 'cite'].includes(t)) return 'quote';
  return 'note';
}

export function renderMarkdown(markdown, exists = () => true) {
  const text = String(markdown || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n?/, '');
  const lines = text.split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listStack = [];
  let inCode = false;
  let code = [];
  let inMathBlock = false;
  let mathLines = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${inline(paragraph.join(' '), exists)}</p>`);
      paragraph = [];
    }
  };
  const closeAllLists = () => {
    while (listStack.length) {
      const top = listStack.pop();
      output.push(`</${top.type}>`);
    }
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const raw = lines[idx];
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();

    if (inCode) {
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        inCode = false;
        code = [];
      } else {
        code.push(raw);
      }
      continue;
    }

    if (inMathBlock) {
      if (trimmed.endsWith('$$') || trimmed.endsWith('\\]')) {
        const tail = trimmed.replace(/(\$\$|\\\])$/, '').trim();
        if (tail) mathLines.push(tail);
        output.push(`<div class="math-block" role="math">${renderLatex(mathLines.join('\n'), true)}</div>`);
        inMathBlock = false;
        mathLines = [];
      } else {
        mathLines.push(raw);
      }
      continue;
    }

    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      flushParagraph();
      closeAllLists();
      inCode = true;
      continue;
    }

    // Single-line or multi-line display math: $$ ... $$ or \[ ... \]
    if (trimmed.startsWith('$$') || trimmed.startsWith('\\[')) {
      flushParagraph();
      closeAllLists();
      const closeToken = trimmed.startsWith('$$') ? '$$' : '\\]';
      const inner = trimmed.slice(2).trim();
      if (inner.endsWith(closeToken) && inner.length >= closeToken.length) {
        const expr = inner.slice(0, -closeToken.length).trim();
        output.push(`<div class="math-block" role="math">${renderLatex(expr, true)}</div>`);
      } else {
        inMathBlock = true;
        mathLines = inner ? [inner] : [];
      }
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      closeAllLists();
      continue;
    }

    if (/^<!--[\s\S]*-->$/.test(trimmed)) {
      flushParagraph();
      closeAllLists();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeAllLists();
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2], exists)}</h${level}>`);
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeAllLists();
      output.push('<hr/>');
      continue;
    }

    // GFM Table block: header line + delimiter line (| --- | --- |)
    if (
      trimmed.includes('|')
      && idx + 1 < lines.length
      && isTableDelimiter(lines[idx + 1])
    ) {
      flushParagraph();
      closeAllLists();
      const aligns = isTableDelimiter(lines[idx + 1]);
      const headers = splitTableCells(trimmed);
      const colCount = Math.max(headers.length, aligns.length);
      const alignClass = (col) => {
        const a = aligns[col] || 'left';
        return a === 'center' ? ' class="is-center"' : a === 'right' ? ' class="is-right"' : '';
      };

      const ths = [];
      for (let c = 0; c < colCount; c += 1) {
        ths.push(`<th${alignClass(c)}>${inline(headers[c] || '', exists)}</th>`);
      }

      idx += 2;
      const bodyRows = [];
      while (idx < lines.length) {
        const rowLine = lines[idx].trim();
        if (!rowLine || !rowLine.includes('|') || /^(#{1,6})\s+/.test(rowLine) || rowLine.startsWith('>')) {
          idx -= 1;
          break;
        }
        const cells = splitTableCells(rowLine);
        const tds = [];
        for (let c = 0; c < colCount; c += 1) {
          tds.push(`<td${alignClass(c)}>${inline(cells[c] || '', exists)}</td>`);
        }
        bodyRows.push(`<tr>${tds.join('')}</tr>`);
        idx += 1;
      }

      output.push(
        `<div class="table-wrap"><table class="md-table"><thead><tr>${ths.join('')}</tr></thead>` +
        `<tbody>${bodyRows.join('')}</tbody></table></div>`,
      );
      continue;
    }

    // Blockquote or Obsidian Callout (> [!info] Title)
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeAllLists();
      const blockLines = [quote[1]];
      while (idx + 1 < lines.length) {
        const nextLine = lines[idx + 1].replace(/\s+$/, '');
        const nextQuote = /^>\s?(.*)$/.exec(nextLine);
        if (nextQuote) {
          blockLines.push(nextQuote[1]);
          idx += 1;
        } else {
          break;
        }
      }

      const calloutMatch = /^\[!([a-zA-Z0-9_-]+)\]([+-])?(?:\s+(.*))?$/.exec(blockLines[0].trim());
      if (calloutMatch) {
        const rawType = calloutMatch[1].toLowerCase();
        const kind = calloutKind(rawType);
        const defaultTitle = CALLOUT_LABELS[rawType]
          || (rawType.charAt(0).toUpperCase() + rawType.slice(1));
        const titleHtml = calloutMatch[3]
          ? inline(calloutMatch[3].trim(), exists)
          : escapeHtml(defaultTitle);
        const innerMd = blockLines.slice(1).join('\n').trim();
        const bodyHtml = innerMd ? `<div class="callout-body">${renderMarkdown(innerMd, exists)}</div>` : '';
        output.push(
          `<aside class="callout callout-${kind}" data-callout="${escapeHtml(rawType)}">` +
          `<div class="callout-title"><span class="callout-badge">${escapeHtml(CALLOUT_LABELS[rawType] || rawType)}</span>` +
          `<span class="callout-heading">${titleHtml}</span></div>${bodyHtml}</aside>`,
        );
      } else {
        const innerHtml = renderMarkdown(blockLines.join('\n'), exists);
        output.push(`<blockquote>${innerHtml}</blockquote>`);
      }
      continue;
    }

    const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
    const numbered = /^(\s*)\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const match = bullet || numbered;
      const indent = match[1].replace(/\t/g, '  ').length;
      const level = Math.floor(indent / 2);
      const type = bullet ? 'ul' : 'ol';
      let itemText = match[2];

      while (listStack.length > level + 1) {
        const top = listStack.pop();
        output.push(`</${top.type}>`);
      }
      if (listStack.length === level + 1 && listStack[listStack.length - 1].type !== type) {
        const top = listStack.pop();
        output.push(`</${top.type}>`);
      }
      while (listStack.length < level + 1) {
        output.push(`<${type}>`);
        listStack.push({ type });
      }

      const task = /^\[([ xX])\]\s+(.*)$/.exec(itemText);
      if (task) {
        const checked = task[1].toLowerCase() === 'x';
        itemText = task[2];
        output.push(
          `<li class="task-item${checked ? ' is-done' : ''}">` +
          `<span class="task-box" aria-hidden="true">${checked ? '✓' : ''}</span>` +
          `<span>${inline(itemText, exists)}</span></li>`,
        );
      } else {
        output.push(`<li>${inline(itemText, exists)}</li>`);
      }
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCode) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  if (inMathBlock) output.push(`<div class="math-block" role="math">${renderLatex(mathLines.join('\n'), true)}</div>`);
  flushParagraph();
  closeAllLists();
  return output.join('\n');
}

function isAttachmentTarget(target) {
  const base = String(target || '').split(/[#|^]/)[0].trim().toLowerCase();
  return /\.(pdf|png|jpe?g|webp|gif|svg|mp3|mp4|wav|csv|zip)$/.test(base);
}

function inline(value, exists) {
  let text = escapeHtml(value);
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };

  // 1. Inline code (`...`) first so math/wikilinks inside backticks stay literal
  text = text.replace(/`([^`]+)`/g, (match, inner) => stash(`<code>${inner}</code>`));

  // 2. Display math inline $$...$$ or \[...\]
  text = text.replace(/\$\$([^$]+)\$\$/g, (match, expr) =>
    stash(`<span class="math-inline is-display" role="math">${renderLatex(expr, true)}</span>`),
  );
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (match, expr) =>
    stash(`<span class="math-inline is-display" role="math">${renderLatex(expr, true)}</span>`),
  );

  // 3. Inline math $...$ (must not start/end with space, and closing $ not followed by digit) or \(...\)
  text = text.replace(/\\\((.+?)\\\)/g, (match, expr) =>
    stash(`<span class="math-inline" role="math">${renderLatex(expr, false)}</span>`),
  );
  text = text.replace(/(^|[^\\$])\$([^\s$](?:[^$]*[^\s$])?)\$(?!\d)/g, (match, prefix, expr) =>
    `${prefix}${stash(`<span class="math-inline" role="math">${renderLatex(expr, false)}</span>`)}`,
  );

  // 4. Wikilinks [[target|alias]]
  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, alias) => {
    const cleanTarget = target.trim();
    const name = (alias || cleanTarget).trim();
    if (isAttachmentTarget(cleanTarget)) {
      return stash(
        `<a class="wikilink wikilink-file" data-target="${cleanTarget}" data-file="true" title="Attachment: ${cleanTarget}">${name}</a>`,
      );
    }
    const found = exists(cleanTarget);
    const classes = `wikilink${found ? '' : ' is-missing'}`;
    return stash(
      `<a class="${classes}" data-target="${cleanTarget}"${found ? '' : ' aria-disabled="true"'}>${name}</a>`,
    );
  });

  // 5. External links [label](https://...)
  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (match, label, url) => stash(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`),
  );

  // 6. Highlights ==text==, Strikethrough ~~text~~, Bold **text**, Italic *text* / _text_
  text = text.replace(/==([^=]+)==/g, '<mark>$1</mark>');
  text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');

  // Restore stashed tokens (may be nested one level if callout title had wikilinks)
  text = text.replace(/\u0000(\d+)\u0000/g, (match, index) => tokens[Number(index)]);
  return text;
}
