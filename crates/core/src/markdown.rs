//! Minimal Markdown/Obsidian parser.
//!
//! It deliberately does not render Markdown: it only extracts what the graph
//! needs (frontmatter, `[[links]]`, `#tags`, headings, a plain-text excerpt).
//! Parsing is bounded so a hostile note cannot blow up memory or CPU.

use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};

/// Hard caps: a single note can contain at most this many extracted items.
const MAX_LINKS: usize = 4_096;
const MAX_TAGS: usize = 256;
const MAX_HEADINGS: usize = 512;
const EXCERPT_CHARS: usize = 220;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Frontmatter {
    pub title: Option<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub date: Option<String>,
    /// Frontmatter `type`: `research` and `idea` mark a structure note.
    pub kind: Option<String>,
    /// Frontmatter `status`: the column a structure note sits in.
    pub status: Option<String>,
    #[serde(default)]
    pub extra: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Link {
    /// Text before `|`, with any `#heading` removed.
    pub target: String,
    pub anchor: Option<String>,
    pub alias: Option<String>,
    pub embed: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Heading {
    pub level: u8,
    pub text: String,
}

#[derive(Debug, Clone, Default)]
pub struct ParsedNote {
    pub frontmatter: Frontmatter,
    pub links: Vec<Link>,
    pub tags: Vec<String>,
    pub headings: Vec<Heading>,
    pub body: String,
    pub words: usize,
    pub excerpt: String,
}

/// Parses a note, returning only the graph-relevant structure.
pub fn parse(raw: &str) -> ParsedNote {
    let raw = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let (frontmatter_block, body) = split_frontmatter(raw);
    let frontmatter = frontmatter_block.map(parse_frontmatter).unwrap_or_default();

    let mut links: Vec<Link> = Vec::new();
    let mut tags: Vec<String> = Vec::new();
    let mut headings: Vec<Heading> = Vec::new();
    let mut fence: Option<&'static str> = None;

    for line in body.lines() {
        let trimmed = line.trim_start();

        if let Some(marker) = fence {
            if trimmed.starts_with(marker) {
                fence = None;
            }
            continue;
        }
        if trimmed.starts_with("```") {
            fence = Some("```");
            continue;
        }
        if trimmed.starts_with("~~~") {
            fence = Some("~~~");
            continue;
        }

        if let Some(heading) = parse_heading(trimmed) {
            if headings.len() < MAX_HEADINGS {
                headings.push(heading);
            }
        }
        scan_inline(line, &mut links, &mut tags);
    }

    // Frontmatter tags are part of the tag vocabulary too.
    for tag in &frontmatter.tags {
        push_tag(&mut tags, tag);
    }
    dedupe_tags(&mut tags);
    let links = dedupe_links(links);

    ParsedNote {
        body: body.to_string(),
        words: body.split_whitespace().count(),
        excerpt: build_excerpt(body),
        headings,
        links,
        tags,
        frontmatter,
    }
}

fn split_frontmatter(raw: &str) -> (Option<&str>, &str) {
    let mut lines = raw.split_inclusive('\n');
    let first = lines.next().unwrap_or("");
    if first.trim_end() != "---" {
        return (None, raw);
    }
    let start = first.len();
    let mut offset = start;
    for line in lines {
        offset += line.len();
        let candidate = line.trim_end();
        if candidate == "---" || candidate == "..." {
            return (Some(&raw[start..offset - line.len()]), &raw[offset..]);
        }
    }
    // Unterminated frontmatter: treat the whole file as body.
    (None, raw)
}

fn parse_frontmatter(block: &str) -> Frontmatter {
    let mut fm = Frontmatter::default();
    let lines: Vec<&str> = block.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        i += 1;
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        if key.is_empty() || key.len() > 64 {
            continue;
        }
        let value = value.trim();
        let mut items = if value.is_empty() {
            let mut block_items = Vec::new();
            while i < lines.len() {
                let next = lines[i].trim();
                if let Some(item) = next.strip_prefix("- ") {
                    block_items.push(unquote(item.trim()));
                    i += 1;
                } else {
                    break;
                }
            }
            block_items
        } else {
            split_list(value)
        };
        items.retain(|item| !item.is_empty());

        match key.as_str() {
            "title" | "name" => {
                if let Some(title) = items.first() {
                    fm.title = Some(truncate_chars(title, 200));
                }
            }
            "aliases" | "alias" => {
                fm.aliases = items
                    .into_iter()
                    .take(32)
                    .map(|a| truncate_chars(&a, 120))
                    .collect();
            }
            "tags" | "tag" => fm.tags = items,
            "date" | "created" | "created_at" | "published" => {
                if let Some(date) = items.first() {
                    fm.date = Some(truncate_chars(date, 40));
                }
            }
            "type" | "kind" => fm.kind = items.first().and_then(|value| label(value)),
            "status" | "state" => fm.status = items.first().and_then(|value| label(value)),
            _ => {
                fm.extra.insert(key, truncate_chars(value, 300));
            }
        }
    }
    fm
}

fn split_list(value: &str) -> Vec<String> {
    let inner = value
        .strip_prefix('[')
        .and_then(|v| v.strip_suffix(']'))
        .unwrap_or(value);
    inner
        .split(',')
        .map(|item| unquote(item.trim()))
        .map(|item| item.trim_start_matches('#').to_string())
        .filter(|item| !item.is_empty())
        .take(64)
        .collect()
}

/// A frontmatter label Cortex groups by (`type`, `status`). Single line, lower
/// case and bounded: it is shown in the decisions view, never used as a path.
fn label(value: &str) -> Option<String> {
    let text = value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let text: String = text.chars().filter(|c| !c.is_control()).take(40).collect();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn unquote(value: &str) -> String {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        let last = bytes[bytes.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }
    value.to_string()
}

fn parse_heading(line: &str) -> Option<Heading> {
    if !line.starts_with('#') {
        return None;
    }
    let hashes = line.bytes().take_while(|b| *b == b'#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }
    let rest = line.get(hashes..)?;
    let text = rest.strip_prefix(' ').or_else(|| rest.strip_prefix('\t'))?;
    let text = text.trim().trim_end_matches('#').trim();
    if text.is_empty() {
        return None;
    }
    Some(Heading {
        level: hashes as u8,
        text: truncate_chars(text, 200),
    })
}

/// Walks one line, extracting `[[wikilinks]]` and `#tags` outside code spans.
fn scan_inline(line: &str, links: &mut Vec<Link>, tags: &mut Vec<String>) {
    let bytes = line.as_bytes();
    let mut i = 0;
    let mut in_code = false;
    while i < bytes.len() {
        match bytes[i] {
            b'`' => {
                in_code = !in_code;
                i += 1;
            }
            b'[' if !in_code && bytes.get(i + 1) == Some(&b'[') => {
                let Some(close) = line[i + 2..].find("]]") else {
                    i += 2;
                    continue;
                };
                let inner = &line[i + 2..i + 2 + close];
                let embed = i > 0 && bytes[i - 1] == b'!';
                if let Some(link) = parse_link(inner, embed) {
                    if links.len() < MAX_LINKS {
                        links.push(link);
                    }
                }
                i += 2 + close + 2;
            }
            b'#' if !in_code => {
                let previous = line[..i].chars().next_back();
                let boundary = match previous {
                    None => true,
                    Some(c) => {
                        !(c.is_alphanumeric() || matches!(c, '_' | '/' | ':' | '#' | '&' | '\\'))
                    }
                };
                if !boundary {
                    i += 1;
                    continue;
                }
                let mut end = i + 1;
                for (offset, c) in line[i + 1..].char_indices() {
                    if c.is_alphanumeric() || matches!(c, '_' | '-' | '/') {
                        end = i + 1 + offset + c.len_utf8();
                    } else {
                        break;
                    }
                }
                if end > i + 1 {
                    let tag = line[i + 1..end].trim_end_matches(['-', '/']);
                    push_tag(tags, tag);
                }
                i = end.max(i + 1);
            }
            _ => i += 1,
        }
    }
}

fn parse_link(inner: &str, embed: bool) -> Option<Link> {
    let inner = inner.trim();
    if inner.is_empty() || inner.len() > 400 || inner.contains('\n') {
        return None;
    }
    let (target_with_anchor, alias) = match inner.split_once('|') {
        Some((target, alias)) => (target, Some(truncate_chars(alias.trim(), 200))),
        None => (inner, None),
    };
    let (path, anchor) = match target_with_anchor.split_once('#') {
        Some((path, anchor)) => (path, Some(anchor.trim().to_string())),
        None => (target_with_anchor, None),
    };
    let target = path.trim();
    // `[[#heading]]` points inside the same note; nothing to add to the graph.
    if target.is_empty() {
        return None;
    }
    Some(Link {
        target: truncate_chars(target, 300),
        anchor: anchor
            .filter(|a| !a.is_empty())
            .map(|a| truncate_chars(&a, 120)),
        alias: alias.filter(|a| !a.is_empty()),
        embed,
    })
}

fn push_tag(tags: &mut Vec<String>, raw: &str) {
    if tags.len() >= MAX_TAGS {
        return;
    }
    let tag = raw.trim().trim_start_matches('#').to_lowercase();
    if tag.is_empty() || tag.len() > 64 || tag.chars().all(|c| c.is_ascii_digit()) {
        return;
    }
    tags.push(tag);
}

fn dedupe_tags(tags: &mut Vec<String>) {
    let mut seen = HashSet::new();
    tags.retain(|tag| seen.insert(tag.clone()));
}

fn dedupe_links(links: Vec<Link>) -> Vec<Link> {
    let mut seen = HashSet::new();
    links
        .into_iter()
        .filter(|link| seen.insert((link.target.to_lowercase(), link.anchor.clone(), link.embed)))
        .collect()
}

fn build_excerpt(body: &str) -> String {
    let mut out = String::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('#')
            || trimmed.starts_with("---")
            || trimmed.starts_with("```")
            || trimmed.starts_with("![")
        {
            continue;
        }
        let cleaned = clean_inline(trimmed);
        if cleaned.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&cleaned);
        if out.chars().count() >= EXCERPT_CHARS {
            break;
        }
    }
    truncate_chars(&out, EXCERPT_CHARS)
}

/// Strips the noisiest Markdown syntax so excerpts read as plain prose.
fn clean_inline(line: &str) -> String {
    let mut text = line
        .trim_start_matches(['-', '*', '+', '>', ' '])
        .to_string();
    text = text.replace("**", "").replace("__", "").replace('`', "");
    // Wikilinks: keep the alias when there is one, otherwise the target.
    while let Some(start) = text.find("[[") {
        let Some(close) = text[start + 2..].find("]]") else {
            break;
        };
        let end = start + 2 + close;
        let label = text[start + 2..end]
            .rsplit('|')
            .next()
            .unwrap_or("")
            .trim()
            .to_string();
        text.replace_range(start..end + 2, &label);
    }
    // `[label](url)` -> `label`
    while let Some(open) = text.find('[') {
        let Some(close) = text[open..].find(']') else {
            break;
        };
        let close = open + close;
        let after = &text[close + 1..];
        if after.starts_with('(') {
            if let Some(paren) = after.find(')') {
                let label = text[open + 1..close].to_string();
                text.replace_range(open..close + 1 + paren + 1, &label);
                continue;
            }
        }
        text.replace_range(open..open + 1, "");
    }
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn truncate_chars(value: &str, max: usize) -> String {
    if value.chars().count() <= max {
        return value.to_string();
    }
    let mut out: String = value.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter_scalars_and_lists() {
        let raw = "---\ntitle: \"Deep Work\"\ntags: [focus, craft]\naliases:\n  - Deep\n  - Focus\n---\n# Heading\nBody";
        let parsed = parse(raw);
        assert_eq!(parsed.frontmatter.title.as_deref(), Some("Deep Work"));
        assert_eq!(parsed.frontmatter.tags, vec!["focus", "craft"]);
        assert_eq!(parsed.frontmatter.aliases, vec!["Deep", "Focus"]);
        assert!(parsed.body.starts_with("# Heading"));
    }

    #[test]
    fn reads_type_and_status_as_bounded_labels() {
        let parsed = parse("---\ntype: IDEA\nstatus:  \"In Progress\"\n---\n# X");
        assert_eq!(parsed.frontmatter.kind.as_deref(), Some("idea"));
        assert_eq!(parsed.frontmatter.status.as_deref(), Some("in progress"));

        let missing = parse("# X");
        assert!(missing.frontmatter.kind.is_none());
        assert!(missing.frontmatter.status.is_none());
    }

    #[test]
    fn extracts_wikilinks_with_alias_and_anchor() {
        let parsed =
            parse("See [[Notes/Deep Work|the book]] and [[Attention#Flow]] and ![[diagram.png]].");
        assert_eq!(parsed.links.len(), 3);
        assert_eq!(parsed.links[0].target, "Notes/Deep Work");
        assert_eq!(parsed.links[0].alias.as_deref(), Some("the book"));
        assert_eq!(parsed.links[1].anchor.as_deref(), Some("Flow"));
        assert!(parsed.links[2].embed);
    }

    #[test]
    fn ignores_links_and_tags_inside_code() {
        let parsed = parse("```\n[[nope]] #nope\n```\n`[[inline]]`\nreal [[yes]] #yes");
        assert_eq!(parsed.links.len(), 1);
        assert_eq!(parsed.links[0].target, "yes");
        assert_eq!(parsed.tags, vec!["yes"]);
    }

    #[test]
    fn does_not_treat_urls_or_headings_as_tags() {
        let parsed =
            parse("https://example.com#anchor\n## Heading\ncolor rgb(126, 231, 255) and #real-tag");
        assert_eq!(parsed.tags, vec!["real-tag"]);
    }

    #[test]
    fn same_note_anchor_is_not_a_link() {
        let parsed = parse("[[#Section]]");
        assert!(parsed.links.is_empty());
    }

    #[test]
    fn excerpt_skips_headings_and_markup() {
        let parsed = parse("# Title\n\n**Bold** opening with [[Link|label]].");
        assert_eq!(parsed.excerpt, "Bold opening with label.");
    }

    #[test]
    fn unterminated_frontmatter_is_body() {
        let parsed = parse("---\ntitle: broken\n");
        assert!(parsed.frontmatter.title.is_none());
        assert!(parsed.body.contains("title: broken"));
    }

    #[test]
    fn caps_links_per_note() {
        let raw: String = (0..MAX_LINKS + 50)
            .map(|index| format!("[[target-{index}]] "))
            .collect();
        let parsed = parse(&raw);
        assert_eq!(parsed.links.len(), MAX_LINKS);
    }

    #[test]
    fn duplicate_links_collapse() {
        let parsed = parse("[[x]] and [[x|other]] and [[x]]");
        assert_eq!(parsed.links.len(), 1);
    }

    #[test]
    fn handles_crlf_and_bom() {
        let parsed = parse("\u{feff}---\r\ntitle: Win\r\n---\r\n[[a]]\r\n");
        assert_eq!(parsed.frontmatter.title.as_deref(), Some("Win"));
        assert_eq!(parsed.links[0].target, "a");
    }
}
