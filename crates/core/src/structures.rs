//! Structure notes: the research briefs and idea refinements Cortex writes.
//!
//! The decisions view asks one question the four graph views cannot answer:
//! *what have I concluded, and on which notes does it rest?* The answer is a
//! small board built once per vault build, from frontmatter Cortex itself
//! wrote (`type`, `status`) and the wikilinks already in the note.
//!
//! Read-only by design: status is a frontmatter field the user owns and can
//! change in any editor. Cortex reports it, it does not take it over.

use std::collections::HashSet;

use serde::Serialize;

use crate::vault::Vault;

/// The `type` values `synthesis::build` writes. Anything else — `meeting`,
/// `book`, a vault's own vocabulary — is not a Cortex structure note.
pub const KINDS: [&str; 2] = ["research", "idea"];

/// A vault with more structure notes than this is a problem the board cannot
/// solve by showing all of them; keep the payload bounded.
pub const MAX_CARDS: usize = 240;

/// Evidence is a chip on a card, not a table of contents.
pub const MAX_EVIDENCE: usize = 12;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Board {
    /// Every structure note in the vault, before the display cap.
    pub total: usize,
    /// Notes whose status is still `open` or `refining`: the work in flight.
    pub open: usize,
    pub cards: Vec<Card>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Card {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub status: String,
    pub folder: String,
    pub created: String,
    /// Frontmatter `confidence`, normalised to 0–100.
    pub confidence: Option<u8>,
    /// Frontmatter `review_on`, as YYYY-MM-DD.
    pub review_on: Option<String>,
    /// The decision this card replaces, when that note resolves.
    pub supersedes: Option<Source>,
    /// Resolved wikilinks in the note, capped at `MAX_EVIDENCE`.
    pub sources: usize,
    /// Wikilinks that point at a note the vault does not have.
    pub missing: usize,
    pub evidence: Vec<Source>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Source {
    pub id: String,
    pub title: String,
    pub folder: String,
}

/// The status a structure note starts with, matching `synthesis::Template`.
pub fn default_status(kind: &str) -> &'static str {
    match kind {
        "idea" => "refining",
        _ => "open",
    }
}

/// `open` and `refining` are the two values Cortex writes. A status edited to
/// anything else is treated as settled: guessing that `blocked` is unfinished
/// would be inventing a vocabulary the vault never agreed to.
fn is_open(status: &str) -> bool {
    matches!(status, "open" | "refining")
}

fn status_rank(status: &str) -> u8 {
    match status {
        "open" => 0,
        "refining" => 1,
        _ => 2,
    }
}

pub fn board(vault: &Vault) -> Board {
    let mut cards = Vec::new();
    for note in &vault.notes {
        let Some(kind) = note.kind.as_deref() else {
            continue;
        };
        if !KINDS.contains(&kind) {
            continue;
        }
        let status = note
            .status
            .clone()
            .unwrap_or_else(|| default_status(kind).to_string());

        let mut seen: HashSet<&str> = HashSet::new();
        let mut missing: HashSet<String> = HashSet::new();
        let mut evidence = Vec::new();
        let mut sources = 0usize;
        for link in &note.links {
            match vault.resolve(&link.target) {
                Some(index) if vault.notes[index].id != note.id => {
                    let target = &vault.notes[index];
                    if !seen.insert(target.id.as_str()) {
                        continue;
                    }
                    sources += 1;
                    if evidence.len() < MAX_EVIDENCE {
                        evidence.push(Source {
                            id: target.id.clone(),
                            title: target.title.clone(),
                            folder: target.folder.clone(),
                        });
                    }
                }
                Some(_) => {}
                None => {
                    missing.insert(link.target.to_lowercase());
                }
            }
        }

        let supersedes = note
            .supersedes
            .as_deref()
            .and_then(|target| vault.resolve(target))
            .filter(|index| vault.notes[*index].id != note.id)
            .map(|index| Source {
                id: vault.notes[index].id.clone(),
                title: vault.notes[index].title.clone(),
                folder: vault.notes[index].folder.clone(),
            });

        cards.push(Card {
            id: note.id.clone(),
            title: note.title.clone(),
            kind: kind.to_string(),
            status,
            folder: note.folder.clone(),
            created: note.created.clone(),
            confidence: note.confidence,
            review_on: note.review_on.clone(),
            supersedes,
            sources,
            missing: missing.len(),
            evidence,
        });
    }

    let total = cards.len();
    let open = cards.iter().filter(|card| is_open(&card.status)).count();
    // Open first, then refining, then whatever the vault calls its own states;
    // newest first inside a column, so the board reads like a work queue.
    cards.sort_by(|a, b| {
        status_rank(&a.status)
            .cmp(&status_rank(&b.status))
            .then_with(|| b.created.cmp(&a.created))
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
            .then_with(|| a.id.cmp(&b.id))
    });
    cards.truncate(MAX_CARDS);

    Board { total, open, cards }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault(files: &[(&str, &str)]) -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        for (name, body) in files {
            let path = dir.path().join(name);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).unwrap();
            }
            std::fs::write(path, body).unwrap();
        }
        let vault = Vault::load(dir.path(), "T", Default::default()).unwrap();
        (dir, vault)
    }

    #[test]
    fn classifies_cortex_structure_notes_and_defaults_status() {
        let (_dir, vault) = vault(&[
            (
                "Synthesis/Brief.md",
                "---\ntype: research\ntitle: \"A question\"\n---\n\n# A question\n",
            ),
            (
                "Synthesis/Idea.md",
                "---\ntype: IDEA\nstatus: Decided\ntitle: \"An idea\"\n---\n\n# An idea\n",
            ),
        ]);
        let board = board(&vault);
        assert_eq!(board.total, 2);
        assert_eq!(board.open, 1, "only the brief is still open");
        let brief = board
            .cards
            .iter()
            .find(|card| card.kind == "research")
            .unwrap();
        assert_eq!(brief.status, "open");
        let idea = board.cards.iter().find(|card| card.kind == "idea").unwrap();
        assert_eq!(
            idea.status, "decided",
            "a user-set status is kept, lowercased"
        );
    }

    #[test]
    fn carries_decision_trail_metadata_and_resolves_supersession() {
        let (_dir, vault) = vault(&[
            (
                "Synthesis/Old.md",
                "---\ntype: idea\nstatus: accepted\n---\n\n# Old\n",
            ),
            (
                "Synthesis/New.md",
                "---\ntype: idea\nstatus: accepted\nconfidence: 0.8\nreview_on: 2027-01-15\nsupersedes: \"[[Old]]\"\n---\n\n# New\n",
            ),
        ]);
        let card = board(&vault)
            .cards
            .into_iter()
            .find(|card| card.title == "New")
            .unwrap();
        assert_eq!(card.confidence, Some(80));
        assert_eq!(card.review_on.as_deref(), Some("2027-01-15"));
        assert_eq!(card.supersedes.unwrap().title, "Old");
    }

    #[test]
    fn other_types_are_not_structure_notes() {
        let (_dir, vault) = vault(&[(
            "Meetings/Standup.md",
            "---\ntype: meeting\nstatus: open\n---\n\n# Standup\n",
        )]);
        assert_eq!(board(&vault).total, 0);
    }

    #[test]
    fn counts_resolved_evidence_and_missing_links() {
        let (_dir, vault) = vault(&[
            ("Ideas/One.md", "# One\n"),
            ("Ideas/Two.md", "# Two\n"),
            (
                "Synthesis/Brief.md",
                "---\ntype: research\n---\n\n# Brief\n\n- [[One]]\n- [[One|again]]\n- [[Two]]\n- [[Gone]]\n",
            ),
        ]);
        let card = &board(&vault).cards[0];
        assert_eq!(card.sources, 2, "the same note linked twice counts once");
        assert_eq!(card.missing, 1);
        assert_eq!(card.evidence.len(), 2);
        assert_eq!(card.evidence[0].title, "One");
    }

    #[test]
    fn open_work_sorts_first_then_newest() {
        let (_dir, vault) = vault(&[
            (
                "Synthesis/Old.md",
                "---\ntype: research\ndate: 2024-01-01\n---\n\n# Old\n",
            ),
            (
                "Synthesis/New.md",
                "---\ntype: research\ndate: 2025-01-01\n---\n\n# New\n",
            ),
            (
                "Synthesis/Idea.md",
                "---\ntype: idea\ndate: 2026-01-01\n---\n\n# Idea\n",
            ),
        ]);
        let board = board(&vault);
        assert_eq!(board.cards[0].title, "New");
        assert_eq!(board.cards[1].title, "Old");
        assert_eq!(board.cards[2].title, "Idea");
    }

    #[test]
    fn empty_vault_has_an_empty_board() {
        let board = board(&vault(&[("Plain.md", "# Plain\n")]).1);
        assert_eq!(board.total, 0);
        assert_eq!(board.open, 0);
        assert!(board.cards.is_empty());
    }
}
