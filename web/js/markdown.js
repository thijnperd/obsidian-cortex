// Safe Markdown -> HTML. No raw HTML is passed through; links are limited to
// http(s) and wikilinks become data-target anchors.

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

export function renderMarkdown(markdown, exists = () => true) {
  const text = String(markdown || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\r?\n?/, '');
  const lines = text.split(/\r?\n/);
  const output = [];
  let paragraph = [];
  let listType = null;
  let inCode = false;
  let code = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      output.push(`<p>${inline(paragraph.join(' '), exists)}</p>`);
      paragraph = [];
    }
  };
  const closeList = () => {
    if (listType) {
      output.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
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
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      flushParagraph();
      closeList();
      inCode = true;
      continue;
    }
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      output.push(`<h${level}>${inline(heading[2], exists)}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      closeList();
      output.push('<hr/>');
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      closeList();
      output.push(`<blockquote>${inline(quote[1], exists)}</blockquote>`);
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (listType !== type) {
        closeList();
        output.push(`<${type}>`);
        listType = type;
      }
      output.push(`<li>${inline((bullet || numbered)[1], exists)}</li>`);
      continue;
    }
    paragraph.push(trimmed);
  }

  if (inCode) output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  flushParagraph();
  closeList();
  return output.join('\n');
}

function inline(value, exists) {
  let text = escapeHtml(value);
  const code = [];
  text = text.replace(/`([^`]+)`/g, (match, inner) => {
    code.push(inner);
    return `\u0000${code.length - 1}\u0000`;
  });

  text = text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (match, target, alias) => {
    const name = (alias || target).trim();
    const found = exists(target.trim());
    const classes = `wikilink${found ? '' : ' is-missing'}`;
    return `<a class="${classes}" data-target="${target.trim()}"${found ? '' : ' aria-disabled="true"'}>${name}</a>`;
  });

  text = text.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>');
  text = text.replace(/\u0000(\d+)\u0000/g, (match, index) => `<code>${code[Number(index)]}</code>`);
  return text;
}
