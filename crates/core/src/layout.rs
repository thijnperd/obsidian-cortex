//! Deterministic 3D layout: folder galaxies on a sphere, local force layout
//! inside each galaxy. Barnes–Hut keeps it usable for thousands of notes.

const EMPTY: u32 = u32::MAX;
const MAX_TREE_DEPTH: u32 = 24;
const REPULSION: f64 = 0.0009;
const SPRING: f64 = 0.55;
const REST_LENGTH: f64 = 0.14;
const GRAVITY: f64 = 0.12;
const MAX_STEP: f64 = 0.02;

#[derive(Debug, Clone, Copy)]
pub struct LayoutOptions {
    pub seed: u64,
    pub iterations: usize,
    pub target_radius: f32,
}

impl Default for LayoutOptions {
    fn default() -> Self {
        Self {
            seed: 0x9E37_79B9_7F4A_7C15,
            iterations: 260,
            target_radius: 1.0,
        }
    }
}

/// Returns one position per node, normalised into a ball of `target_radius`.
pub fn compute(
    count: usize,
    edges: &[(usize, usize, f32)],
    groups: &[usize],
    group_count: usize,
    times: &[i64],
    opts: &LayoutOptions,
) -> Vec<[f32; 3]> {
    if count == 0 {
        return Vec::new();
    }
    let group_count = group_count.max(1);
    let mut positions = vec![[0.0f64; 3]; count];

    let mut members: Vec<Vec<usize>> = vec![Vec::new(); group_count];
    for (index, group) in groups.iter().enumerate() {
        members[(*group).min(group_count - 1)].push(index);
    }

    for (group, list) in members.iter().enumerate() {
        if list.is_empty() {
            continue;
        }
        // Very large folders that are diaries (a daily journal) become a ring
        // of time around the rest of the vault instead of a blob that swallows
        // the map. A 120-note topic folder is not a diary, even though it is
        // large, so density of dates decides.
        if looks_like_journal(list, times) {
            let ring = layout_ring(list, times, opts.seed ^ (group as u64));
            for (slot, node) in list.iter().enumerate() {
                positions[*node] = ring[slot];
            }
            continue;
        }
        let center = galaxy_center(group, group_count);
        let local = layout_local(
            list,
            edges,
            opts.seed ^ (group as u64).wrapping_mul(0x9E37_79B9),
        );
        let radius = (0.20 + 0.35 * (list.len() as f64 / 100.0).sqrt()).min(0.55);
        for (slot, node) in list.iter().enumerate() {
            positions[*node] = [
                center[0] + local[slot][0] * radius,
                center[1] + local[slot][1] * radius,
                center[2] + local[slot][2] * radius,
            ];
        }
    }

    normalize(&mut positions, opts.target_radius as f64);
    positions
        .into_iter()
        .map(|p| [p[0] as f32, p[1] as f32, p[2] as f32])
        .collect()
}

const RING_THRESHOLD: usize = 48;

/// Is this folder a diary? Large is not enough: a 120-note topic folder is
/// large too. A diary has many distinct dates, a long span, and little more
/// than a day or three between entries.
fn looks_like_journal(list: &[usize], times: &[i64]) -> bool {
    if list.len() <= RING_THRESHOLD {
        return false;
    }
    let mut days: Vec<i64> = list
        .iter()
        .map(|node| times.get(*node).copied().unwrap_or(0))
        .collect();
    days.sort_unstable();
    days.dedup();
    if days.len() < 48 {
        return false;
    }
    let span = days[days.len() - 1] - days[0];
    if span < 180 {
        return false;
    }
    let mut gaps: Vec<i64> = days.windows(2).map(|pair| pair[1] - pair[0]).collect();
    gaps.sort_unstable();
    gaps[gaps.len() / 2] <= 3
}

/// Chronological ring for large, diary-like folders.
fn layout_ring(list: &[usize], times: &[i64], seed: u64) -> Vec<[f64; 3]> {
    let count = list.len();
    let mut order: Vec<usize> = list.to_vec();
    order.sort_by_key(|index| (times.get(*index).copied().unwrap_or(0), *index));

    let mut rank = std::collections::HashMap::with_capacity(count);
    for (position, node) in order.iter().enumerate() {
        rank.insert(*node, position);
    }

    let mut rng = XorShift::new(seed | 1);
    let mut out = vec![[0.0; 3]; count];
    for (slot, node) in list.iter().enumerate() {
        let t = rank.get(node).copied().unwrap_or(slot) as f64 / count.max(1) as f64;
        let angle = t * std::f64::consts::TAU;
        let wobble = 1.0 + 0.04 * (angle * 3.0 + 0.6).sin() + rng.range(-0.012, 0.012);
        let radius = 2.35 * wobble;
        let height = 0.22 * (angle * 2.0 + 0.7).sin() + rng.range(-0.05, 0.05);
        out[slot] = [radius * angle.cos(), height, radius * angle.sin()];
    }

    // Tilt each ring a little so it reads as an orbit, not a hoop.
    // A steep tilt keeps the orbit readable from the default camera instead of
    // collapsing into a horizontal line.
    let tilt = 1.02 + ((seed % 997) as f64 / 997.0 - 0.5) * 0.14;
    let (sin_tilt, cos_tilt) = tilt.sin_cos();
    // Proper rotation (not a skew): the orbit stays circular in its own plane.
    for point in &mut out {
        let y = point[1];
        let z = point[2];
        point[1] = y * cos_tilt - z * sin_tilt;
        point[2] = z * cos_tilt + y * sin_tilt;
    }
    out
}

fn galaxy_center(group: usize, group_count: usize) -> [f64; 3] {
    if group_count <= 1 {
        return [0.0; 3];
    }
    // Two offset crowns: symmetric around the origin from any angle, with a
    // clear upper/lower hemisphere instead of a flat band.
    let half = group_count.div_ceil(2);
    let lane = group / 2;
    let theta = lane as f64 * std::f64::consts::TAU / half as f64 + (group % 2) as f64 * 0.55;
    let y = if group % 2 == 0 { 1.05 } else { -1.05 };
    [theta.cos() * 1.5, y, theta.sin() * 1.5]
}

/// Force layout inside one galaxy, returned normalised to a unit ball.
fn layout_local(nodes: &[usize], edges: &[(usize, usize, f32)], seed: u64) -> Vec<[f64; 3]> {
    let count = nodes.len();
    if count == 1 {
        return vec![[0.0, 0.0, 0.0]];
    }
    let mut slot_of = std::collections::HashMap::with_capacity(count);
    for (slot, node) in nodes.iter().enumerate() {
        slot_of.insert(*node, slot);
    }

    let mut local_edges: Vec<(usize, usize, f64)> = Vec::new();
    for (from, to, weight) in edges {
        if let (Some(a), Some(b)) = (slot_of.get(from), slot_of.get(to)) {
            if a != b {
                local_edges.push((*a, *b, (*weight as f64).clamp(1.0, 4.0)));
            }
        }
    }

    let mut rng = XorShift::new(seed | 1);
    let radius = 0.05 + 0.35 / (count as f64).sqrt();
    let mut positions = Vec::with_capacity(count);
    for index in 0..count {
        // Fibonacci sphere start: stable, evenly spread, no clumping.
        let t = (index as f64 + 0.5) / count as f64;
        let y = 1.0 - 2.0 * t;
        let ring = (1.0 - y * y).max(0.0).sqrt();
        let theta = index as f64 * 2.399_963_229_728_653;
        positions.push([
            ring * theta.cos() * radius + rng.range(-0.01, 0.01),
            y * radius + rng.range(-0.01, 0.01),
            ring * theta.sin() * radius + rng.range(-0.01, 0.01),
        ]);
    }

    let iterations = 260usize;
    for iteration in 0..iterations {
        let cooling = 1.0 - iteration as f64 / (iterations as f64 * 1.15);
        let step = MAX_STEP * cooling.max(0.05);
        let mut displacement = vec![[0.0f64; 3]; count];

        // Repulsion (Barnes–Hut above a small threshold, exact below it).
        if count > 96 {
            let tree = Octree::build(&positions);
            for (index, point) in positions.iter().enumerate() {
                tree.repel(*point, &mut displacement[index]);
            }
        } else {
            for i in 0..count {
                for j in (i + 1)..count {
                    let d = sub(positions[j], positions[i]);
                    let d2 = dot(d, d) + 0.0004;
                    let inv = REPULSION / (d2 * d2.sqrt());
                    displacement[i] = sub(displacement[i], scale(d, inv));
                    displacement[j] = add(displacement[j], scale(d, inv));
                }
            }
        }

        // Springs.
        for (a, b, weight) in &local_edges {
            let d = sub(positions[*b], positions[*a]);
            let dist = dot(d, d).sqrt().max(1e-4);
            let force = SPRING * weight * (dist - REST_LENGTH) / dist;
            displacement[*a] = add(displacement[*a], scale(d, force));
            displacement[*b] = sub(displacement[*b], scale(d, force));
        }

        // Keep the galaxy together and centred.
        for (index, point) in positions.iter().enumerate() {
            displacement[index] = sub(displacement[index], scale(*point, GRAVITY));
        }

        for (index, point) in positions.iter_mut().enumerate() {
            let d = clamp_length(displacement[index], step);
            *point = add(*point, d);
            if !point[0].is_finite() || !point[1].is_finite() || !point[2].is_finite() {
                *point = [0.0, 0.0, 0.0];
            }
        }
    }

    normalize(&mut positions, 1.0);
    positions
}

fn normalize(positions: &mut [[f64; 3]], radius: f64) {
    if positions.is_empty() {
        return;
    }
    let mut centroid = [0.0; 3];
    for point in positions.iter() {
        centroid = add(centroid, *point);
    }
    centroid = scale(centroid, 1.0 / positions.len() as f64);
    let mut max = 0.0f64;
    for point in positions.iter_mut() {
        *point = sub(*point, centroid);
        max = max.max(dot(*point, *point).sqrt());
    }
    if max > 1e-9 {
        let factor = radius / max;
        for point in positions.iter_mut() {
            *point = scale(*point, factor);
        }
    }
}

fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

fn scale(a: [f64; 3], k: f64) -> [f64; 3] {
    [a[0] * k, a[1] * k, a[2] * k]
}

fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn clamp_length(v: [f64; 3], max: f64) -> [f64; 3] {
    let len = dot(v, v).sqrt();
    if len > max && len > 1e-12 {
        scale(v, max / len)
    } else {
        v
    }
}

struct XorShift(u64);

impl XorShift {
    fn new(seed: u64) -> Self {
        Self(seed.max(1))
    }
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn range(&mut self, min: f64, max: f64) -> f64 {
        let unit = (self.next() >> 11) as f64 / (1u64 << 53) as f64;
        min + (max - min) * unit
    }
}

/// Flat octree; nodes are stored in a Vec and referenced by index.
struct Octree {
    nodes: Vec<OctNode>,
    points: Vec<[f64; 3]>,
}

struct OctNode {
    center: [f64; 3],
    half: f64,
    mass: f64,
    center_of_mass: [f64; 3],
    children: [u32; 8],
    body: u32,
}

impl Octree {
    fn build(points: &[[f64; 3]]) -> Self {
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        for point in points {
            for axis in 0..3 {
                min[axis] = min[axis].min(point[axis]);
                max[axis] = max[axis].max(point[axis]);
            }
        }
        let center = [
            (min[0] + max[0]) * 0.5,
            (min[1] + max[1]) * 0.5,
            (min[2] + max[2]) * 0.5,
        ];
        let half =
            ((max[0] - min[0]).max(max[1] - min[1]).max(max[2] - min[2]) * 0.5 + 1e-6).max(1e-6);
        let mut tree = Octree {
            nodes: vec![OctNode {
                center,
                half,
                mass: 0.0,
                center_of_mass: [0.0; 3],
                children: [EMPTY; 8],
                body: EMPTY,
            }],
            points: points.to_vec(),
        };
        for body in 0..points.len() {
            tree.insert(0, body as u32, 0);
        }
        tree
    }

    fn insert(&mut self, node: usize, body: u32, depth: u32) {
        let point = self.points[body as usize];
        let (existing, has_children) = {
            let n = &mut self.nodes[node];
            let mass = n.mass;
            n.center_of_mass = [
                (n.center_of_mass[0] * mass + point[0]) / (mass + 1.0),
                (n.center_of_mass[1] * mass + point[1]) / (mass + 1.0),
                (n.center_of_mass[2] * mass + point[2]) / (mass + 1.0),
            ];
            n.mass = mass + 1.0;
            (n.body, n.children.iter().any(|c| *c != EMPTY))
        };

        if existing == body {
            return;
        }
        if depth >= MAX_TREE_DEPTH {
            return;
        }
        if existing != EMPTY {
            self.nodes[node].body = EMPTY;
            self.subdivide(node);
            self.insert_child(node, existing, depth + 1);
            self.insert_child(node, body, depth + 1);
            return;
        }
        if has_children {
            self.insert_child(node, body, depth + 1);
            return;
        }
        self.nodes[node].body = body;
    }

    fn subdivide(&mut self, node: usize) {
        let (center, half) = (self.nodes[node].center, self.nodes[node].half);
        let child_half = half * 0.5;
        for octant in 0..8 {
            let offset = [
                if octant & 1 != 0 {
                    child_half
                } else {
                    -child_half
                },
                if octant & 2 != 0 {
                    child_half
                } else {
                    -child_half
                },
                if octant & 4 != 0 {
                    child_half
                } else {
                    -child_half
                },
            ];
            self.nodes.push(OctNode {
                center: [
                    center[0] + offset[0],
                    center[1] + offset[1],
                    center[2] + offset[2],
                ],
                half: child_half,
                mass: 0.0,
                center_of_mass: [0.0; 3],
                children: [EMPTY; 8],
                body: EMPTY,
            });
            self.nodes[node].children[octant] = (self.nodes.len() - 1) as u32;
        }
    }

    fn insert_child(&mut self, node: usize, body: u32, depth: u32) {
        let point = self.points[body as usize];
        let center = self.nodes[node].center;
        let octant = ((point[0] > center[0]) as usize)
            | (((point[1] > center[1]) as usize) << 1)
            | (((point[2] > center[2]) as usize) << 2);
        let child = self.nodes[node].children[octant];
        if child == EMPTY {
            return;
        }
        self.insert(child as usize, body, depth);
    }

    fn repel(&self, point: [f64; 3], out: &mut [f64; 3]) {
        self.repel_node(0, point, out);
    }

    fn repel_node(&self, node: usize, point: [f64; 3], out: &mut [f64; 3]) {
        let n = &self.nodes[node];
        if n.mass == 0.0 {
            return;
        }
        let d = sub(n.center_of_mass, point);
        let d2 = dot(d, d) + 0.0004;
        let distance = d2.sqrt();
        let aggregate = n.body != EMPTY || (n.half * 2.0) / distance < 0.85;
        if aggregate {
            let force = REPULSION * n.mass / (d2 * distance);
            // Soften very close encounters instead of launching nodes away.
            let falloff = (distance / (n.half + 1e-6)).clamp(0.25, 1.0);
            *out = add(*out, scale(d, force * falloff));
        } else {
            for child in n.children {
                if child != EMPTY {
                    self.repel_node(child as usize, point, out);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn finite(positions: &[[f32; 3]]) -> bool {
        positions
            .iter()
            .all(|p| p[0].is_finite() && p[1].is_finite() && p[2].is_finite())
    }

    #[test]
    fn empty_graph_is_empty() {
        assert!(compute(0, &[], &[], 0, &[], &LayoutOptions::default()).is_empty());
    }

    #[test]
    fn deterministic_and_normalised() {
        let edges = vec![(0, 1, 1.0), (1, 2, 1.0), (3, 4, 1.0)];
        let groups = vec![0, 0, 0, 1, 1];
        let times = [0, 1, 2, 3, 4];
        let a = compute(5, &edges, &groups, 2, &times, &LayoutOptions::default());
        let b = compute(5, &edges, &groups, 2, &times, &LayoutOptions::default());
        assert_eq!(a, b, "layout must be reproducible");
        assert!(finite(&a));
        let max = a
            .iter()
            .map(|p| (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt())
            .fold(0.0f32, f32::max);
        assert!(max <= 1.001, "positions must fit the unit ball, got {max}");
    }

    #[test]
    fn separate_galaxies_stay_apart() {
        let edges = vec![(0, 1, 1.0), (1, 2, 1.0)];
        let groups = vec![0, 0, 0, 1, 1, 1];
        let positions = compute(6, &edges, &groups, 2, &[0; 6], &LayoutOptions::default());
        let centroid = |range: std::ops::Range<usize>| {
            let mut c = [0.0f32; 3];
            for i in range {
                c[0] += positions[i][0] / 3.0;
                c[1] += positions[i][1] / 3.0;
                c[2] += positions[i][2] / 3.0;
            }
            c
        };
        let a = centroid(0..3);
        let b = centroid(3..6);
        let distance =
            ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt();
        assert!(
            distance > 0.4,
            "galaxies should not overlap, got {distance}"
        );
    }

    #[test]
    fn large_groups_become_a_ring() {
        let count = 240;
        let groups = vec![0; count];
        let times: Vec<i64> = (0..count as i64).collect();
        let positions = compute(count, &[], &groups, 1, &times, &LayoutOptions::default());
        // The ring is tilted, so measure the full 3D radius and require real
        // extent on every axis: a line or a point would fail both checks.
        let radii: Vec<f32> = positions
            .iter()
            .map(|p| (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt())
            .collect();
        let min = radii.iter().copied().fold(f32::INFINITY, f32::min);
        let max = radii.iter().copied().fold(0.0f32, f32::max);
        assert!(min > 0.5, "ring should not collapse, min={min}");
        assert!(max <= 1.01);
        for axis in 0..3 {
            let lo = positions
                .iter()
                .map(|p| p[axis])
                .fold(f32::INFINITY, f32::min);
            let hi = positions
                .iter()
                .map(|p| p[axis])
                .fold(f32::NEG_INFINITY, f32::max);
            assert!(
                hi - lo > 0.6,
                "ring should span axis {axis}, extent={}",
                hi - lo
            );
        }
    }

    #[test]
    fn single_node_sits_at_origin() {
        let positions = compute(1, &[], &[0], 1, &[0], &LayoutOptions::default());
        assert_eq!(positions.len(), 1);
        assert!(finite(&positions));
    }
}
