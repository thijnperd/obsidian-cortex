//! Small BM25 index; built once per reindex and queried from the ⌘K palette.

use std::collections::HashMap;

use serde::Serialize;

use crate::vault::Vault;

const MAX_TERMS_PER_DOC: usize = 40_000;
const MAX_QUERY_TERMS: usize = 8;
const MAX_PREFIX_EXPANSIONS: usize = 512;

#[derive(Debug, Serialize)]
pub struct Hit {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub score: f32,
    pub snippet: String,
}

pub struct SearchIndex {
    docs: Vec<Doc>,
    postings: HashMap<String, Vec<(u32, u32)>>,
    avg_len: f32,
}

struct Doc {
    id: String,
    title: String,
    folder: String,
    excerpt: String,
    len: f32,
    lower_title: String,
}

impl SearchIndex {
    pub fn build(vault: &Vault) -> SearchIndex {
        let mut postings: HashMap<String, Vec<(u32, u32)>> = HashMap::new();
        let mut docs = Vec::with_capacity(vault.notes.len());

        for (index, note) in vault.notes.iter().enumerate() {
            let mut terms: HashMap<String, u32> = HashMap::new();
            for (position, term) in tokenize(&note.body).into_iter().enumerate() {
                if position >= MAX_TERMS_PER_DOC {
                    break;
                }
                *terms.entry(term).or_insert(0) += 1;
            }
            // Titles weigh more than body matches.
            for term in tokenize(&note.title) {
                *terms.entry(term).or_insert(0) += 4;
            }
            for (term, frequency) in terms {
                postings
                    .entry(term)
                    .or_default()
                    .push((index as u32, frequency));
            }
            docs.push(Doc {
                id: note.id.clone(),
                title: note.title.clone(),
                folder: note.folder.clone(),
                excerpt: note.excerpt.clone(),
                len: (note.body.split_whitespace().count() as f32).max(1.0),
                lower_title: note.title.to_lowercase(),
            });
        }

        let avg_len = if docs.is_empty() {
            1.0
        } else {
            docs.iter().map(|doc| doc.len).sum::<f32>() / docs.len() as f32
        };

        SearchIndex {
            docs,
            postings,
            avg_len,
        }
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<Hit> {
        let mut terms = tokenize(query);
        if terms.is_empty() {
            return Vec::new();
        }
        terms.truncate(MAX_QUERY_TERMS);
        let doc_count = self.docs.len().max(1) as f32;
        let mut scores: HashMap<u32, f32> = HashMap::new();
        let phrase = query.trim().to_lowercase();

        for (position, term) in terms.iter().enumerate() {
            let mut matched: Vec<(&String, &Vec<(u32, u32)>)> = Vec::new();
            if let Some(list) = self.postings.get(term) {
                matched.push((term, list));
            }
            // Last term behaves like a prefix filter (type-ahead).
            if position + 1 == terms.len() {
                for (key, list) in self.postings.iter() {
                    if key != term && key.starts_with(term.as_str()) {
                        matched.push((key, list));
                        if matched.len() >= MAX_PREFIX_EXPANSIONS {
                            break;
                        }
                    }
                }
            }
            let df = matched
                .iter()
                .map(|(_, list)| list.len())
                .sum::<usize>()
                .max(1) as f32;
            let idf = (1.0 + (doc_count - df + 0.5) / (df + 0.5)).ln();
            for (_, list) in matched {
                for (doc, frequency) in list {
                    let doc_len = self.docs[*doc as usize].len;
                    let tf = *frequency as f32;
                    let denominator = tf + 1.2 * (1.0 - 0.75 + 0.75 * doc_len / self.avg_len);
                    let score = idf * (tf * 2.2) / denominator.max(1e-3);
                    *scores.entry(*doc).or_insert(0.0) += score;
                }
            }
        }

        let mut ranked: Vec<(u32, f32)> = scores.into_iter().collect();
        for (doc, score) in &mut ranked {
            let title = &self.docs[*doc as usize].lower_title;
            if !phrase.is_empty() && title.contains(&phrase) {
                *score *= 1.6;
            }
            if title.starts_with(&phrase) {
                *score *= 1.3;
            }
        }
        ranked.sort_by(|a, b| {
            b.1.partial_cmp(&a.1)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.0.cmp(&b.0))
        });
        ranked.truncate(limit.min(50));

        ranked
            .into_iter()
            .map(|(doc, score)| {
                let doc = &self.docs[doc as usize];
                Hit {
                    id: doc.id.clone(),
                    title: doc.title.clone(),
                    folder: doc.folder.clone(),
                    score: (score * 1000.0).round() / 1000.0,
                    snippet: doc.excerpt.clone(),
                }
            })
            .collect()
    }
}

fn tokenize(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|term| (2..=40).contains(&term.chars().count()))
        .map(|term| term.to_lowercase())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index() -> SearchIndex {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("Deep Work.md"),
            "# Deep Work\n\nFocus is the skill of the century. [[Attention]]",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("Attention.md"),
            "# Attention\n\nThe attention economy fragments focus.",
        )
        .unwrap();
        std::fs::write(
            dir.path().join("Groceries.md"),
            "# Groceries\n\nmilk, bread, coffee",
        )
        .unwrap();
        let vault = Vault::load(dir.path(), "Test", Default::default()).unwrap();
        SearchIndex::build(&vault)
    }

    #[test]
    fn ranks_title_matches_first() {
        let hits = index().search("attention", 10);
        assert_eq!(hits[0].title, "Attention");
        assert!(hits.iter().any(|hit| hit.title == "Deep Work"));
    }

    #[test]
    fn supports_prefix_queries() {
        let hits = index().search("att", 10);
        assert!(!hits.is_empty());
        assert!(hits.iter().any(|hit| hit.title == "Attention"));
    }

    #[test]
    fn ignores_empty_queries_and_punctuation() {
        let index = index();
        assert!(index.search("", 10).is_empty());
        assert!(index.search("   !!!  ", 10).is_empty());
    }

    #[test]
    fn no_match_returns_nothing() {
        assert!(index().search("xylophone", 10).is_empty());
    }
}
