//! Structure notes: turn a selection of vault notes into a research brief or
//! an idea-refinement scaffold, keeping every claim linked to its source note.
//!
//! The output is deliberately plain Markdown with a small frontmatter block, so
//! it stays portable and works in Obsidian/Logseq as well as Cortex.

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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Evidence {
    pub title: String,
    pub folder: String,
    pub excerpt: String,
}

/// Hard cap: a structure note with 50 links stops being a synthesis.
pub const MAX_EVIDENCE: usize = 24;

/// Builds the Markdown for a structure note. Deterministic and frontmatter-safe:
/// the question is single-lined and quoted so it cannot inject YAML.
pub fn build(template: Template, question: &str, evidence: &[Evidence]) -> String {
    let question = one_line(question);
    let created = dates::iso_date(dates::today_days());
    let mut lines = Vec::with_capacity(32);

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
        Template::Research => {
            lines.push("## Question".to_string());
            lines.push(String::new());
            lines.push("What am I actually trying to answer?".to_string());
            lines.push(String::new());
            lines.push("## What the sources say".to_string());
            lines.push(String::new());
            lines.push("- ".to_string());
            lines.push(String::new());
            lines.push("## Tensions".to_string());
            lines.push(String::new());
            lines.push("Where do the sources disagree, and why?".to_string());
            lines.push(String::new());
            lines.push("- ".to_string());
            lines.push(String::new());
            lines.push("## Synthesis".to_string());
            lines.push(String::new());
            lines.push("My own answer, in my own words.".to_string());
            lines.push(String::new());
            lines.push("- ".to_string());
            lines.push(String::new());
            lines.push("## Open questions".to_string());
            lines.push(String::new());
            lines.push("- [ ] ".to_string());
            lines.push(String::new());
        }
        Template::Idea => {
            lines.push("## Situation".to_string());
            lines.push(String::new());
            lines.push("What is true today, and who feels it?".to_string());
            lines.push(String::new());
            lines.push("- ".to_string());
            lines.push(String::new());
            lines.push("## Assumptions".to_string());
            lines.push(String::new());
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
            lines.push(
                "Pick one, in two sentences. Name the runner-up and when to switch.".to_string(),
            );
            lines.push(String::new());
            lines.push("- ".to_string());
            lines.push(String::new());
            lines.push("## What would change my mind".to_string());
            lines.push(String::new());
            lines.push("- ".to_string());
            lines.push(String::new());
        }
    }

    if evidence.is_empty() {
        lines.push("## Evidence".to_string());
        lines.push(String::new());
        lines.push("_No notes collected._".to_string());
    } else {
        lines.push("## Evidence".to_string());
        lines.push(String::new());
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

fn excerpt_tail(excerpt: &str) -> String {
    let excerpt = one_line(excerpt);
    if excerpt.is_empty() {
        return String::new();
    }
    let clipped: String = excerpt.chars().take(160).collect();
    let ellipsis = if excerpt.chars().count() > 160 {
        "…"
    } else {
        ""
    };
    format!(" — {clipped}{ellipsis}")
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
            },
            Evidence {
                title: "Deep Work".into(),
                folder: "Ideas".into(),
                excerpt: "".into(),
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
