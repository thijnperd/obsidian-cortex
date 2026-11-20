//! Structure notes: turn a selection of vault notes into a research brief or
//! an idea-refinement note, extracting line-cited claims, shared references,
//! unlinked overlaps, tensions, and open questions deterministically.
//!
//! The output is deliberately plain Markdown with a small frontmatter block, so
//! it stays portable and works in Obsidian/Logseq as well as Cortex.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, HashSet};

use crate::dates;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Template {
    Research,
    Idea,
}

impl Template {
    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "research" => Some(Template::Research),
            "idea" => Some(Template::Idea),
            _ => None,
        }
    }

    pub fn slug(self) -> &'static str {
        match self {
            Template::Research => "research",
            Template::Idea => "idea",
        }
    }

    pub fn status(self) -> &'static str {
        match self {
            Template::Research => "open",
            Template::Idea => "refining",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Template::Research => "Research brief",
            Template::Idea => "Idea refinement",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Evidence {
    pub title: String,
    pub folder: String,
    pub excerpt: String,
    pub created: String,
    pub tags: Vec<String>,
    pub body: String,
    pub links: Vec<String>,
}

/// Hard cap: a structure note with 50 links stops being a synthesis.
pub const MAX_EVIDENCE: usize = 24;

const TENSION_WORDS: &[&str] = &[
    "however",
    "instead",
    "unlike",
    "whereas",
    "disagree",
    "disagrees",
    "conflict",
    "conflicts",
    "trade-off",
    "tradeoff",
    "tension",
    "contrary",
    "although",
    "despite",
    "caveat",
    "limitation",
    "drawback",
    "risk",
    "fails",
    "cannot",
    "never",
    "but",
];

/// Builds the Markdown for a structure note. Deterministic and frontmatter-safe:
/// the question is single-lined and quoted so it cannot inject YAML.
pub fn build(template: Template, question: &str, evidence: &[Evidence]) -> String {
    let question = one_line(question);
    let created = dates::iso_date(dates::today_days());
    let mut lines = Vec::with_capacity(48);

    lines.push("---".to_string());
    lines.push(format!("type: {}", template.slug()));
    lines.push(format!("status: {}", template.status()));
    lines.push(format!("created: {created}"));
    lines.push(format!("title: {}", quote(&question)));
    lines.push(format!("sources: {}", evidence.len()));
    lines.push("tags:".to_string());
    lines.push(format!("  - {}", template.slug()));
    lines.push("---".to_string());
    lines.push(String::new());
    lines.push(format!("# {question}"));
    lines.push(String::new());

    match template {
        Template::Research => build_research(&mut lines, &question, evidence),
        Template::Idea => build_idea(&mut lines, evidence),
    }

    lines.push("## Evidence".to_string());
    lines.push(String::new());
    if evidence.is_empty() {
        lines.push("_No notes collected._".to_string());
    } else {
        for item in evidence {
            lines.push(format!(
                "- [[{}]] — *{}*{}",
                escape_link(&item.title),
                one_line(&item.folder),
                excerpt_tail(&item.excerpt)
            ));
        }
    }
    lines.push(String::new());
    lines.push(format!("<!-- cortex:{} -->", template.slug()));
    lines.join("\n")
}

fn build_research(lines: &mut Vec<String>, question: &str, evidence: &[Evidence]) {
    lines.push("## Question".to_string());
    lines.push(String::new());
    lines.push(question.to_string());
    lines.push(String::new());

    let comparisons = comparison_bullets(evidence);
    if !comparisons.is_empty() {
        lines.push("## Source comparison".to_string());
        lines.push(String::new());
        lines.extend(comparisons);
        lines.push(String::new());
    }

    lines.push("## What the sources say".to_string());
    lines.push(String::new());
    let mut source_bullets = 0usize;
    for item in evidence {
        let link = escape_link(&item.title);
        for (line_no, claim) in extract_claims(item) {
            match line_no {
                Some(line) => lines.push(format!("- [[{link}]] (L{line}): {claim}")),
                None => lines.push(format!("- [[{link}]]: {claim}")),
            }
            source_bullets += 1;
        }
    }
    if source_bullets == 0 {
        lines.push("- ".to_string());
    }
    lines.push(String::new());

    lines.push("## Tensions".to_string());
    lines.push(String::new());
    let tensions = find_tensions(evidence);
    if tensions.is_empty() {
        lines.push("No contrast markers found; note where the sources disagree.".to_string());
        lines.push(String::new());
        lines.push("- ".to_string());
    } else {
        for (title, line_no, text) in tensions {
            let link = escape_link(&title);
            lines.push(format!("- [[{link}]] (L{line_no}): {text}"));
        }
    }
    lines.push(String::new());

    lines.push("## Synthesis".to_string());
    lines.push(String::new());
    lines.push("Your conclusion in your own words, grounded in the lines above.".to_string());
    lines.push(String::new());
    lines.push("- ".to_string());
    lines.push(String::new());

    lines.push("## Open questions".to_string());
    lines.push(String::new());
    let questions = extract_questions(evidence);
    for (title, line_no, text) in questions {
        let link = escape_link(&title);
        lines.push(format!("- [ ] [[{link}]] (L{line_no}): {text}"));
    }
    lines.push("- [ ] ".to_string());
    lines.push(String::new());
}

fn build_idea(lines: &mut Vec<String>, evidence: &[Evidence]) {
    lines.push("## Situation".to_string());
    lines.push(String::new());
    let comparisons = comparison_bullets(evidence);
    let has_comparisons = !comparisons.is_empty();
    if has_comparisons {
        lines.extend(comparisons);
    }
    let mut claim_count = 0usize;
    for item in evidence {
        if let Some((line_no, claim)) = extract_claims(item).into_iter().next() {
            let link = escape_link(&item.title);
            match line_no {
                Some(line) => lines.push(format!("- [[{link}]] (L{line}): {claim}")),
                None => lines.push(format!("- [[{link}]]: {claim}")),
            }
            claim_count += 1;
        }
    }
    if !has_comparisons && claim_count == 0 {
        lines.push("What is true today, and who feels it?".to_string());
        lines.push(String::new());
        lines.push("- ".to_string());
    }
    lines.push(String::new());

    lines.push("## Assumptions".to_string());
    lines.push(String::new());
    for (title, line_no, text) in find_tensions(evidence).into_iter().take(3) {
        let link = escape_link(&title);
        lines.push(format!(
            "- [ ] load-bearing ([[{link}]] L{line_no}): {text}"
        ));
    }
    lines.push("- [ ] load-bearing: ".to_string());
    lines.push("- [ ] cosmetic: ".to_string());
    lines.push(String::new());

    lines.push("## Options".to_string());
    lines.push(String::new());
    lines.push("### A. ".to_string());
    lines.push(String::new());
    lines.push("- Effort: ".to_string());
    lines.push("- Risk: ".to_string());
    lines.push("- Reversible: ".to_string());
    lines.push(String::new());
    lines.push("### B. ".to_string());
    lines.push(String::new());
    lines.push("- Effort: ".to_string());
    lines.push("- Risk: ".to_string());
    lines.push("- Reversible: ".to_string());
    lines.push(String::new());

    lines.push("## Recommendation".to_string());
    lines.push(String::new());
    lines.push("Pick one, in two sentences. Name the runner-up and when to switch.".to_string());
    lines.push(String::new());
    lines.push("- ".to_string());
    lines.push(String::new());

    lines.push("## What would change my mind".to_string());
    lines.push(String::new());
    for (title, line_no, text) in extract_questions(evidence).into_iter().take(3) {
        let link = escape_link(&title);
        lines.push(format!("- [[{link}]] (L{line_no}): {text}"));
    }
    lines.push("- ".to_string());
    lines.push(String::new());
}

fn comparison_bullets(evidence: &[Evidence]) -> Vec<String> {
    if evidence.len() < 2 {
        return Vec::new();
    }
    let mut out = Vec::new();

    if let Some((first, last)) = date_span(evidence) {
        let count = evidence.len();
        out.push(format!(
            "- **Span:** {first} to {last} across {count} notes."
        ));
    }

    let tags = shared_tags(evidence);
    if !tags.is_empty() {
        let joined = tags
            .into_iter()
            .map(|(tag, count)| format!("#{tag} ({count})"))
            .collect::<Vec<_>>()
            .join(", ");
        out.push(format!("- **Shared tags:** {joined}"));
    }

    let refs = shared_links(evidence);
    if !refs.is_empty() {
        let joined = refs
            .into_iter()
            .map(|(target, count)| format!("[[{}]] ({count})", escape_link(&target)))
            .collect::<Vec<_>>()
            .join(", ");
        out.push(format!("- **Shared references:** {joined}"));
    }

    let direct = direct_cross_links(evidence);
    if !direct.is_empty() {
        let joined = direct
            .into_iter()
            .map(|(from, to)| format!("[[{}]] → [[{}]]", escape_link(&from), escape_link(&to)))
            .collect::<Vec<_>>()
            .join(", ");
        out.push(format!("- **Direct links:** {joined}"));
    }

    for (a, b, topic) in unlinked_overlaps(evidence) {
        let a = escape_link(&a);
        let b = escape_link(&b);
        let line = format!(
            "- **Unlinked overlap:** [[{a}]] and [[{b}]] both touch {topic} without linking."
        );
        out.push(line);
    }

    out
}

fn date_span(evidence: &[Evidence]) -> Option<(String, String)> {
    let mut dates: Vec<&str> = evidence
        .iter()
        .map(|item| item.created.trim())
        .filter(|date| !date.is_empty())
        .collect();
    dates.sort();
    let first = dates.first()?;
    let last = dates.last()?;
    (first != last).then(|| ((*first).to_string(), (*last).to_string()))
}

fn shared_tags(evidence: &[Evidence]) -> Vec<(String, usize)> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for item in evidence {
        let unique: BTreeSet<String> = item
            .tags
            .iter()
            .map(|tag| tag.trim().trim_start_matches('#').to_ascii_lowercase())
            .filter(|tag| !tag.is_empty())
            .collect();
        for tag in unique {
            *counts.entry(tag).or_insert(0) += 1;
        }
    }
    let mut ranked: Vec<(String, usize)> = counts
        .into_iter()
        .filter(|(_, count)| *count >= 2)
        .collect();
    ranked.sort_by_key(|(tag, count)| (Reverse(*count), tag.clone()));
    ranked.truncate(6);
    ranked
}

fn shared_links(evidence: &[Evidence]) -> Vec<(String, usize)> {
    let collected: HashSet<String> = evidence
        .iter()
        .map(|item| item.title.trim().to_ascii_lowercase())
        .collect();
    let mut counts: BTreeMap<String, (String, usize)> = BTreeMap::new();
    for item in evidence {
        let mut seen = HashSet::new();
        for target in &item.links {
            let clean = one_line(target);
            let key = clean.to_ascii_lowercase();
            if key.is_empty() || collected.contains(&key) || !seen.insert(key.clone()) {
                continue;
            }
            let entry = counts.entry(key).or_insert_with(|| (clean, 0));
            entry.1 += 1;
        }
    }
    let mut ranked: Vec<(String, usize)> = counts
        .into_values()
        .filter(|(_, count)| *count >= 2)
        .collect();
    ranked.sort_by_key(|(title, count)| (Reverse(*count), title.to_ascii_lowercase()));
    ranked.truncate(6);
    ranked
}

fn direct_cross_links(evidence: &[Evidence]) -> Vec<(String, String)> {
    let titles: BTreeMap<String, &str> = evidence
        .iter()
        .map(|item| (item.title.trim().to_ascii_lowercase(), item.title.as_str()))
        .collect();
    let mut pairs = BTreeSet::new();
    for item in evidence {
        for link in &item.links {
            let key = link.trim().to_ascii_lowercase();
            let Some(&target) = titles.get(&key) else {
                continue;
            };
            if !target.eq_ignore_ascii_case(&item.title) {
                pairs.insert((item.title.clone(), target.to_string()));
            }
        }
    }
    pairs.into_iter().take(8).collect()
}

fn unlinked_overlaps(evidence: &[Evidence]) -> Vec<(String, String, String)> {
    let mut linked_pairs: HashSet<(String, String)> = HashSet::new();
    for (from, to) in direct_cross_links(evidence) {
        linked_pairs.insert(ordered_pair(&from, &to));
    }

    let note_tags: Vec<BTreeSet<String>> = evidence
        .iter()
        .map(|item| {
            item.tags
                .iter()
                .map(|tag| tag.trim().trim_start_matches('#').to_ascii_lowercase())
                .filter(|tag| !tag.is_empty())
                .collect()
        })
        .collect();

    let note_links: Vec<BTreeMap<String, String>> = evidence
        .iter()
        .map(|item| {
            let mut map = BTreeMap::new();
            for link in &item.links {
                let clean = one_line(link);
                let key = clean.to_ascii_lowercase();
                if !key.is_empty() {
                    map.entry(key).or_insert(clean);
                }
            }
            map
        })
        .collect();

    let mut out = Vec::new();
    for i in 0..evidence.len() {
        for j in (i + 1)..evidence.len() {
            let pair = ordered_pair(&evidence[i].title, &evidence[j].title);
            if linked_pairs.contains(&pair) {
                continue;
            }
            let shared_tag = note_tags[i]
                .intersection(&note_tags[j])
                .next()
                .map(|tag| format!("#{tag}"));
            let shared_ref = if shared_tag.is_some() {
                None
            } else {
                note_links[i]
                    .iter()
                    .find(|(key, _)| note_links[j].contains_key(*key))
                    .map(|(_, label)| format!("[[{}]]", escape_link(label)))
            };
            if let Some(topic) = shared_tag.or(shared_ref) {
                out.push((evidence[i].title.clone(), evidence[j].title.clone(), topic));
                if out.len() >= 4 {
                    return out;
                }
            }
        }
    }
    out
}

fn ordered_pair(a: &str, b: &str) -> (String, String) {
    let left = a.trim().to_ascii_lowercase();
    let right = b.trim().to_ascii_lowercase();
    if left <= right {
        (left, right)
    } else {
        (right, left)
    }
}

fn source_lines(body: &str) -> Vec<(usize, String)> {
    let raw_lines: Vec<&str> = body.lines().collect();
    let mut index = 0usize;
    if raw_lines.first().is_some_and(|line| line.trim() == "---") {
        let mut cursor = 1usize;
        while cursor < raw_lines.len() {
            let candidate = raw_lines[cursor].trim();
            if candidate == "---" || candidate == "..." {
                index = cursor + 1;
                break;
            }
            cursor += 1;
        }
    }

    let mut out = Vec::new();
    let mut fence: Option<&'static str> = None;
    while index < raw_lines.len() {
        let line_no = index + 1;
        let trimmed = raw_lines[index].trim();
        index += 1;

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
        if trimmed.is_empty() || is_heading(trimmed) || trimmed == "---" || trimmed == "***" {
            continue;
        }
        out.push((line_no, trimmed.to_string()));
    }
    out
}

fn is_heading(trimmed: &str) -> bool {
    let hashes = trimmed.bytes().take_while(|byte| *byte == b'#').count();
    (1..=6).contains(&hashes)
        && trimmed
            .as_bytes()
            .get(hashes)
            .is_some_and(|byte| byte.is_ascii_whitespace())
}

fn clean_line(line: &str) -> String {
    let mut rest = line.trim();
    loop {
        if let Some(after) = rest.strip_prefix("> ") {
            rest = after.trim_start();
            continue;
        }
        if let Some(after) = rest
            .strip_prefix("- [ ] ")
            .or_else(|| rest.strip_prefix("- [x] "))
            .or_else(|| rest.strip_prefix("- [X] "))
            .or_else(|| rest.strip_prefix("* [ ] "))
            .or_else(|| rest.strip_prefix("* [x] "))
            .or_else(|| rest.strip_prefix("* [X] "))
        {
            rest = after.trim_start();
            continue;
        }
        if let Some(after) = rest.strip_prefix("- ").or_else(|| rest.strip_prefix("* ")) {
            rest = after.trim_start();
            continue;
        }
        break;
    }
    one_line(rest)
}

fn non_link_chars(text: &str) -> usize {
    let mut rest = text;
    let mut count = 0usize;
    while let Some(start) = rest.find("[[") {
        count += rest[..start]
            .chars()
            .filter(|ch| ch.is_alphanumeric())
            .count();
        let after = &rest[start + 2..];
        if let Some(end) = after.find("]]") {
            rest = &after[end + 2..];
        } else {
            rest = after;
            break;
        }
    }
    count + rest.chars().filter(|ch| ch.is_alphanumeric()).count()
}

fn extract_claims(item: &Evidence) -> Vec<(Option<usize>, String)> {
    let mut claims = Vec::new();
    for (line_no, raw) in source_lines(&item.body) {
        let cleaned = clean_line(&raw);
        if cleaned.chars().count() < 20
            || non_link_chars(&cleaned) < 16
            || cleaned.starts_with("Pulled toward [[")
            || cleaned.starts_with("Mood:")
        {
            continue;
        }
        claims.push((Some(line_no), clip_text(&cleaned, 180)));
        if claims.len() >= 2 {
            break;
        }
    }
    if claims.is_empty() && !item.excerpt.trim().is_empty() {
        claims.push((None, clip_text(&item.excerpt, 180)));
    }
    claims
}

fn find_tensions(evidence: &[Evidence]) -> Vec<(String, usize, String)> {
    let mut out = Vec::new();
    for item in evidence {
        let mut per_note = 0usize;
        for (line_no, raw) in source_lines(&item.body) {
            let cleaned = clean_line(&raw);
            if cleaned.chars().count() < 24
                || cleaned.ends_with('?')
                || non_link_chars(&cleaned) < 16
            {
                continue;
            }
            if has_tension_word(&cleaned) {
                out.push((item.title.clone(), line_no, clip_text(&cleaned, 180)));
                per_note += 1;
                if per_note >= 2 || out.len() >= 8 {
                    break;
                }
            }
        }
        if out.len() >= 8 {
            break;
        }
    }
    out
}

fn has_tension_word(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    lower
        .split(|ch: char| !ch.is_alphanumeric() && ch != '-')
        .any(|word| TENSION_WORDS.contains(&word))
}

fn extract_questions(evidence: &[Evidence]) -> Vec<(String, usize, String)> {
    let mut out = Vec::new();
    for item in evidence {
        let mut per_note = 0usize;
        for (line_no, raw) in source_lines(&item.body) {
            let trimmed = raw.trim();
            let is_task = trimmed.starts_with("- [ ] ") || trimmed.starts_with("* [ ] ");
            if !is_task && !trimmed.ends_with('?') {
                continue;
            }
            let cleaned = clean_line(&raw);
            if cleaned.chars().count() < 12 {
                continue;
            }
            out.push((item.title.clone(), line_no, clip_text(&cleaned, 160)));
            per_note += 1;
            if per_note >= 2 || out.len() >= 6 {
                break;
            }
        }
        if out.len() >= 6 {
            break;
        }
    }
    out
}

fn clip_text(text: &str, max_chars: usize) -> String {
    let clean = one_line(text);
    if clean.chars().count() <= max_chars {
        return clean;
    }
    let clipped: String = clean.chars().take(max_chars).collect();
    format!("{clipped}…")
}

fn excerpt_tail(excerpt: &str) -> String {
    let excerpt = one_line(excerpt);
    if excerpt.is_empty() {
        return String::new();
    }
    let clipped = clip_text(&excerpt, 160);
    format!(" — {clipped}")
}

/// Wikilinks cannot contain brackets or newlines; keep titles linkable.
fn escape_link(title: &str) -> String {
    one_line(title)
        .replace('|', "-")
        .replace('[', "(")
        .replace(']', ")")
}

fn one_line(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn quote(value: &str) -> String {
    format!(
        "\"{}\"",
        one_line(value).replace('\\', "\\\\").replace('"', "\\\"")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn evidence() -> Vec<Evidence> {
        vec![
            Evidence {
                title: "Cognitive Load".into(),
                folder: "Ideas".into(),
                excerpt: "Working memory holds a handful of things at once.".into(),
                ..Evidence::default()
            },
            Evidence {
                title: "Deep Work".into(),
                folder: "Ideas".into(),
                excerpt: "".into(),
                ..Evidence::default()
            },
        ]
    }

    #[test]
    fn research_note_links_every_source_and_has_sections() {
        let note = build(
            Template::Research,
            "How does attention shape work?",
            &evidence(),
        );
        assert!(note.starts_with("---\ntype: research"));
        assert!(note.contains("# How does attention shape work?"));
        assert!(note.contains("[[Cognitive Load]] — *Ideas* — Working memory"));
        assert!(note.contains("[[Deep Work]] — *Ideas*\n"));
        assert!(note.contains("## Tensions"));
        assert!(note.contains("## Synthesis"));
        assert!(note.contains("## Open questions"));
        assert!(note.contains("sources: 2"));
    }

    #[test]
    fn extracts_line_cited_claims_shared_themes_tensions_and_questions() {
        let first_body = "# Local First\n\nFiles outlive apps when kept in plain text.\nHowever, sync conflicts require explicit recovery?\n- [ ] Test offline conflict merging.\n";
        let second_body = "# Sync\n\nLast-write-wins fails silently on concurrent edits.\nWhat merge strategy preserves intent?\n";
        let items = vec![
            Evidence {
                title: "Local First".into(),
                folder: "Systems".into(),
                created: "2026-01-10".into(),
                tags: vec!["software".into(), "durability".into()],
                body: first_body.into(),
                links: vec!["Plain Text".into(), "Sync".into()],
                ..Evidence::default()
            },
            Evidence {
                title: "Sync".into(),
                folder: "Systems".into(),
                created: "2026-06-15".into(),
                tags: vec!["software".into()],
                body: second_body.into(),
                links: vec!["Plain Text".into()],
                ..Evidence::default()
            },
        ];

        let note = build(Template::Research, "How should local notes sync?", &items);
        assert!(note.contains("## Source comparison"));
        assert!(note.contains("2026-01-10 to 2026-06-15 across 2 notes."));
        assert!(note.contains("#software (2)"));
        assert!(note.contains("[[Plain Text]] (2)"));
        assert!(note.contains("[[Local First]] → [[Sync]]"));
        assert!(note.contains("[[Local First]] (L3): Files outlive apps"));
        assert!(note.contains("[[Sync]] (L3): Last-write-wins fails silently"));
        assert!(note.contains("- [ ] [[Local First]] (L5): Test offline conflict merging."));
        assert!(note.contains("- [ ] [[Sync]] (L4): What merge strategy preserves intent?"));
    }

    #[test]
    fn flags_unlinked_overlapping_sources() {
        let items = vec![
            Evidence {
                title: "Attention".into(),
                folder: "Ideas".into(),
                tags: vec!["focus".into()],
                body: "Protect morning blocks from interruption.".into(),
                ..Evidence::default()
            },
            Evidence {
                title: "Constraints".into(),
                folder: "Research".into(),
                tags: vec!["focus".into()],
                body: "Tight limits reduce decision fatigue, whereas open schedules drift.".into(),
                ..Evidence::default()
            },
        ];

        let note = build(Template::Idea, "Should mornings be locked?", &items);
        assert!(note.contains("[[Attention]] and [[Constraints]] both touch #focus"));
        assert!(note.contains("[[Constraints]] L1"));
    }

    #[test]
    fn idea_note_has_options_and_recommendation() {
        let note = build(
            Template::Idea,
            "Should I ship the graph first?",
            &evidence(),
        );
        assert!(note.contains("type: idea"));
        assert!(note.contains("status: refining"));
        assert!(note.contains("## Assumptions"));
        assert!(note.contains("### A."));
        assert!(note.contains("### B."));
        assert!(note.contains("## Recommendation"));
        assert!(note.contains("## What would change my mind"));
    }

    #[test]
    fn frontmatter_cannot_be_injected() {
        let note = build(
            Template::Research,
            "Line one\nstatus: hacked\n\"quoted\\",
            &evidence(),
        );
        assert!(!note.contains("hacked\n"));
        assert_eq!(note.lines().filter(|line| *line == "---").count(), 2);
        assert!(note.contains("title: \"Line one status: hacked \\\"quoted\\\\\""));
    }

    #[test]
    fn empty_selection_is_still_valid_markdown() {
        let note = build(Template::Research, "Only a question", &[]);
        assert!(note.contains("_No notes collected._"));
        assert!(note.contains("sources: 0"));
    }

    #[test]
    fn templates_parse_case_insensitively() {
        assert_eq!(Template::parse(" Research "), Some(Template::Research));
        assert_eq!(Template::parse("IDEA"), Some(Template::Idea));
        assert_eq!(Template::parse("other"), None);
    }
}
