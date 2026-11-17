//! Graph payload: metrics, communities, positions. Serialised straight to the
//! browser, so field names are the public API.

use std::collections::{BTreeMap, HashMap};

use serde::Serialize;

use crate::dates;
use crate::layout::{self, LayoutOptions};
use crate::structures;
use crate::vault::Vault;

pub const PALETTE_SIZE: usize = 8;

#[derive(Debug, Clone, Serialize)]
pub struct GraphData {
    pub meta: Meta,
    pub nodes: Vec<Node>,
    pub edges: Vec<OutEdge>,
    /// The decisions view, derived from the same scan. Shipped with the graph so
    /// a static export has it too, with no second request or cache to keep.
    pub structures: structures::Board,
}

#[derive(Debug, Clone, Serialize)]
pub struct Meta {
    pub title: String,
    pub note_count: usize,
    pub link_count: usize,
    pub orphan_count: usize,
    pub word_count: usize,
    pub cluster_count: usize,
    pub folder_count: usize,
    pub density: f32,
    pub generated_at: u64,
    pub source: String,
    pub folders: Vec<Folder>,
    pub hub: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Folder {
    pub name: String,
    pub count: usize,
    pub color: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Node {
    pub id: String,
    pub title: String,
    pub folder: String,
    pub tags: Vec<String>,
    pub created: String,
    pub words: usize,
    pub degree: usize,
    pub pagerank: f32,
    pub community: usize,
    pub size: f32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    pub excerpt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct OutEdge {
    pub source: usize,
    pub target: usize,
    pub weight: u32,
}

impl GraphData {
    pub fn build(vault: &Vault, source: &str, layout_opts: &LayoutOptions) -> GraphData {
        GraphData::build_with_positions(vault, source, layout_opts, None)
    }

    /// `previous` pins notes that already exist where they were, so a live edit
    /// never makes the universe jump. Only new notes get a computed position.
    pub fn build_with_positions(
        vault: &Vault,
        source: &str,
        layout_opts: &LayoutOptions,
        previous: Option<&HashMap<String, [f32; 3]>>,
    ) -> GraphData {
        let count = vault.notes.len();
        let folder_names = collect_folders(vault);
        let folder_index: BTreeMap<&str, usize> = folder_names
            .iter()
            .enumerate()
            .map(|(index, folder)| (folder.name.as_str(), index))
            .collect();

        let groups: Vec<usize> = vault
            .notes
            .iter()
            .map(|note| folder_index.get(note.folder.as_str()).copied().unwrap_or(0))
            .collect();

        let mut degree = vec![0usize; count];
        let mut weighted_degree = vec![0usize; count];
        for edge in &vault.edges {
            degree[edge.from] += 1;
            degree[edge.to] += 1;
            weighted_degree[edge.from] += edge.weight as usize;
            weighted_degree[edge.to] += edge.weight as usize;
        }

        let pagerank = pagerank(count, &vault.edges);
        let communities = communities(count, &vault.edges);
        let cluster_count = communities.iter().copied().max().map_or(0, |m| m + 1);

        let times: Vec<i64> = vault.notes.iter().map(|note| note.created_days).collect();
        let mut positions = layout::compute(
            count,
            &vault
                .edges
                .iter()
                .map(|edge| (edge.from, edge.to, edge.weight as f32))
                .collect::<Vec<_>>(),
            &groups,
            folder_names.len(),
            &times,
            layout_opts,
        );
        if let Some(previous) = previous {
            for (index, note) in vault.notes.iter().enumerate() {
                if let Some(position) = previous.get(&note.id) {
                    positions[index] = *position;
                }
            }
        }

        let max_rank = pagerank.iter().copied().fold(0.0f32, f32::max).max(1e-6);
        let hub = pagerank
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap_or(std::cmp::Ordering::Equal))
            .map(|(index, _)| vault.notes[index].title.clone());

        let nodes = vault
            .notes
            .iter()
            .enumerate()
            .map(|(index, note)| {
                let position = positions.get(index).copied().unwrap_or([0.0; 3]);
                let relative = (pagerank[index] / max_rank).clamp(0.0, 1.0);
                Node {
                    id: note.id.clone(),
                    title: note.title.clone(),
                    folder: note.folder.clone(),
                    tags: note.tags.iter().take(6).cloned().collect(),
                    created: note.created.clone(),
                    words: note.words,
                    degree: degree[index],
                    pagerank: round3(pagerank[index]),
                    community: communities[index],
                    size: round3(0.55 + 1.85 * relative.sqrt()),
                    x: round4(position[0]),
                    y: round4(position[1]),
                    z: round4(position[2]),
                    excerpt: note.excerpt.clone(),
                    body: None,
                }
            })
            .collect();

        let edges = vault
            .edges
            .iter()
            .map(|edge| OutEdge {
                source: edge.from,
                target: edge.to,
                weight: edge.weight,
            })
            .collect::<Vec<_>>();

        let orphan_count = degree.iter().filter(|d| **d == 0).count();
        let density = if count > 1 {
            (2.0 * edges.len() as f32) / (count as f32 * (count as f32 - 1.0))
        } else {
            0.0
        };

        GraphData {
            meta: Meta {
                title: vault.title.clone(),
                note_count: count,
                link_count: edges.len(),
                orphan_count,
                word_count: vault.total_words,
                cluster_count,
                folder_count: folder_names.len(),
                density: round4(density),
                generated_at: dates::now_millis(),
                source: source.to_string(),
                folders: folder_names,
                hub,
            },
            nodes,
            edges,
            structures: structures::board(vault),
        }
    }

    /// Adds note bodies for a fully static (GitHub Pages) build.
    pub fn with_bodies(mut self, vault: &Vault) -> Self {
        for node in &mut self.nodes {
            if let Some(note) = vault.notes.iter().find(|note| note.id == node.id) {
                node.body = Some(note.body.clone());
            }
        }
        self
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| "{}".to_string())
    }
}

fn collect_folders(vault: &Vault) -> Vec<Folder> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for note in &vault.notes {
        *counts.entry(note.folder.as_str()).or_insert(0) += 1;
    }
    counts
        .into_iter()
        .enumerate()
        .map(|(index, (name, count))| Folder {
            name: name.to_string(),
            count,
            color: index % PALETTE_SIZE,
        })
        .collect()
}

/// Power iteration PageRank with dangling-mass redistribution.
pub fn pagerank(count: usize, edges: &[crate::vault::Edge]) -> Vec<f32> {
    if count == 0 {
        return Vec::new();
    }
    let damping = 0.85f32;
    let mut out_degree = vec![0usize; count];
    let mut incoming = vec![Vec::new(); count];
    for edge in edges {
        out_degree[edge.from] += 1;
        incoming[edge.to].push(edge.from);
    }
    let mut rank = vec![1.0 / count as f32; count];
    for _ in 0..40 {
        let mut next = vec![(1.0 - damping) / count as f32; count];
        let mut dangling = 0.0f32;
        for (index, rank_value) in rank.iter().enumerate() {
            if out_degree[index] == 0 {
                dangling += *rank_value;
            }
        }
        let dangling_share = damping * dangling / count as f32;
        for value in next.iter_mut() {
            *value += dangling_share;
        }
        for (index, sources) in incoming.iter().enumerate() {
            let mut sum = 0.0f32;
            for source in sources {
                sum += rank[*source] / out_degree[*source] as f32;
            }
            next[index] += damping * sum;
        }
        let delta: f32 = rank
            .iter()
            .zip(next.iter())
            .map(|(a, b)| (a - b).abs())
            .sum();
        rank = next;
        if delta < 1e-6 {
            break;
        }
    }
    rank
}

/// Weighted label propagation. Cheap, deterministic and good enough to reveal
/// topical clusters in a personal vault.
pub fn communities(count: usize, edges: &[crate::vault::Edge]) -> Vec<usize> {
    if count == 0 {
        return Vec::new();
    }
    let mut neighbours: Vec<Vec<(usize, f32)>> = vec![Vec::new(); count];
    for edge in edges {
        let weight = edge.weight as f32;
        neighbours[edge.from].push((edge.to, weight));
        neighbours[edge.to].push((edge.from, weight));
    }
    let mut labels: Vec<usize> = (0..count).collect();
    for _ in 0..24 {
        let mut changed = false;
        for node in 0..count {
            if neighbours[node].is_empty() {
                continue;
            }
            let mut scores: BTreeMap<usize, f32> = BTreeMap::new();
            for (other, weight) in &neighbours[node] {
                *scores.entry(labels[*other]).or_insert(0.0) += weight;
            }
            let best = scores
                .iter()
                .max_by(|a, b| {
                    a.1.partial_cmp(b.1)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(b.0.cmp(a.0))
                })
                .map(|(label, _)| *label);
            if let Some(best) = best {
                if best != labels[node] {
                    labels[node] = best;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }
    // Compact labels by descending cluster size for stable colours.
    let mut sizes: BTreeMap<usize, usize> = BTreeMap::new();
    for label in &labels {
        *sizes.entry(*label).or_insert(0) += 1;
    }
    let mut ordered: Vec<(usize, usize)> = sizes.into_iter().collect();
    ordered.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    let remap: BTreeMap<usize, usize> = ordered
        .into_iter()
        .enumerate()
        .map(|(index, (label, _))| (label, index))
        .collect();
    labels
        .into_iter()
        .map(|label| remap.get(&label).copied().unwrap_or(0))
        .collect()
}

fn round3(value: f32) -> f32 {
    (value * 1000.0).round() / 1000.0
}

fn round4(value: f32) -> f32 {
    (value * 10_000.0).round() / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pagerank_is_a_distribution() {
        let edges = vec![
            crate::vault::Edge {
                from: 0,
                to: 1,
                weight: 1,
            },
            crate::vault::Edge {
                from: 0,
                to: 2,
                weight: 1,
            },
            crate::vault::Edge {
                from: 1,
                to: 2,
                weight: 1,
            },
            crate::vault::Edge {
                from: 2,
                to: 0,
                weight: 1,
            },
        ];
        let rank = pagerank(3, &edges);
        let sum: f32 = rank.iter().sum();
        assert!((sum - 1.0).abs() < 1e-3, "sum was {sum}");
        assert!(rank[2] > rank[0], "more linked node should rank higher");
    }

    #[test]
    fn communities_separate_components() {
        let edges = vec![
            crate::vault::Edge {
                from: 0,
                to: 1,
                weight: 1,
            },
            crate::vault::Edge {
                from: 1,
                to: 2,
                weight: 1,
            },
            crate::vault::Edge {
                from: 2,
                to: 0,
                weight: 1,
            },
            crate::vault::Edge {
                from: 3,
                to: 4,
                weight: 1,
            },
            crate::vault::Edge {
                from: 4,
                to: 5,
                weight: 1,
            },
            crate::vault::Edge {
                from: 5,
                to: 3,
                weight: 1,
            },
        ];
        let labels = communities(6, &edges);
        assert_eq!(labels[0], labels[1]);
        assert_eq!(labels[3], labels[4]);
        assert_ne!(labels[0], labels[3]);
    }

    #[test]
    fn previous_positions_are_kept() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("A.md"), "# A\n[[B]]").unwrap();
        std::fs::write(dir.path().join("B.md"), "# B").unwrap();
        let vault = Vault::load(dir.path(), "T", Default::default()).unwrap();
        let first = GraphData::build(&vault, "t", &LayoutOptions::default());
        let mut pinned = HashMap::new();
        for node in &first.nodes {
            pinned.insert(node.id.clone(), [9.0, 9.0, 9.0]);
        }
        let second =
            GraphData::build_with_positions(&vault, "t", &LayoutOptions::default(), Some(&pinned));
        assert!(second.nodes.iter().all(|node| node.x == 9.0));
    }

    #[test]
    fn handles_empty_graph() {
        assert!(pagerank(0, &[]).is_empty());
        assert!(communities(0, &[]).is_empty());
    }

    #[test]
    fn ships_structure_notes_with_the_graph() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Source.md"), "# Source\n").unwrap();
        std::fs::write(
            dir.path().join("Brief.md"),
            "---\ntype: research\ntitle: \"A question\"\n---\n\n# A question\n\n- [[Source]]\n",
        )
        .unwrap();
        let vault = Vault::load(dir.path(), "T", Default::default()).unwrap();
        let graph = GraphData::build(&vault, "t", &LayoutOptions::default());
        assert_eq!(graph.structures.total, 1);
        assert_eq!(graph.structures.open, 1);
        assert_eq!(graph.structures.cards[0].sources, 1);
        assert!(graph.to_json().contains("\"structures\""));
    }
}
