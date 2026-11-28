//! Vector ranking over normalized embeddings and the fusion of two rankings (vectorRanking,
//! fuseRankings in src/shared/core/search.ts).

use std::cmp::Ordering;
use std::collections::HashMap;

/// The constant of reciprocal-rank fusion.
const RRF_K: f64 = 60.0;

/// The embedding ranking counts double the keyword one: equal weights did worse on questions
/// worded unlike the material.
pub(crate) const VECTOR_WEIGHT: f64 = 1.0;
pub(crate) const KEYWORD_WEIGHT: f64 = 0.5;

/// Rows of `vectors` (row-major, `dims` floats each, normalized) by their best cosine against any
/// of `queries`, best first, at most `n`. Dots add up in f64 and are kept as f32 like the TS's
/// Float32Array of scores, so ties fall the same way.
pub fn vector_ranking(queries: &[&[f32]], vectors: &[f32], dims: usize, n: usize) -> Vec<usize> {
	let scores: Vec<f32> = vectors
		.chunks_exact(dims)
		.map(|row| {
			let mut best = f64::NEG_INFINITY;
			for q in queries {
				let dot = dot(q, row);
				if dot > best {
					best = dot;
				}
			}
			best as f32
		})
		.collect();
	let mut rows: Vec<usize> = (0..scores.len()).collect();
	rows.sort_by(|&a, &b| scores[b].partial_cmp(&scores[a]).unwrap_or(Ordering::Equal));
	rows.truncate(n);
	rows
}

/// Rows of `vectors` (as in `vector_ranking`) by their cosine with `query`, best first, at most
/// `n`, with the cosines.
pub(crate) fn cosine_ranking(query: &[f32], vectors: &[f32], dims: usize, n: usize) -> Vec<(usize, f32)> {
	let mut scored: Vec<(usize, f32)> = vectors.chunks_exact(dims).map(|row| dot(query, row) as f32).enumerate().collect();
	scored.sort_by(|a, b| b.1.total_cmp(&a.1));
	scored.truncate(n);
	scored
}

/// Normalized vectors' dot product is their cosine.
fn dot(a: &[f32], b: &[f32]) -> f64 {
	a.iter().zip(b).fold(0f64, |sum, (x, y)| sum + f64::from(*x) * f64::from(*y))
}

/// Reciprocal-rank fusion: each ranking adds weight / (60 + rank) to an id (rank from 1). Best
/// first; equal scores keep the order ids were first seen.
pub fn fuse_rankings(rankings: &[(&[String], f64)]) -> Vec<String> {
	let mut scored: Vec<(&str, f64)> = Vec::new();
	let mut at: HashMap<&str, usize> = HashMap::new();
	for (ids, weight) in rankings {
		for (rank, id) in ids.iter().enumerate() {
			let add = weight / (RRF_K + rank as f64 + 1.0);
			match at.get(id.as_str()) {
				Some(&i) => scored[i].1 += add,
				None => {
					at.insert(id, scored.len());
					scored.push((id, 0.0 + add));
				}
			}
		}
	}
	scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(Ordering::Equal));
	scored.into_iter().map(|(id, _)| id.to_owned()).collect()
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn rows_rank_by_their_best_query() {
		let vectors = [1.0, 0.0, 0.0, 1.0, 0.6, 0.8];
		assert_eq!(vector_ranking(&[&[1.0, 0.0]], &vectors, 2, 3), vec![0, 2, 1]);
		assert_eq!(vector_ranking(&[&[1.0, 0.0], &[0.0, 1.0]], &vectors, 2, 2), vec![0, 1]);
	}

	#[test]
	fn cosine_ranking_keeps_the_cosines_best_first() {
		let vectors = [1.0, 0.0, 0.0, 1.0, 0.6, 0.8];
		assert_eq!(cosine_ranking(&[1.0, 0.0], &vectors, 2, 2), vec![(0, 1.0), (2, 0.6)]);
		assert_eq!(cosine_ranking(&[0.0, 1.0], &vectors, 2, 5), vec![(1, 1.0), (2, 0.8), (0, 0.0)]);
	}

	#[test]
	fn fusion_adds_weighted_reciprocal_ranks() {
		let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
		let (a, b) = (s(&["x", "y", "z"]), s(&["z", "w"]));
		assert_eq!(fuse_rankings(&[(&a, VECTOR_WEIGHT), (&b, KEYWORD_WEIGHT)]), s(&["z", "x", "y", "w"]));
		assert_eq!(fuse_rankings(&[(&s(&["p", "q"]), 1.0), (&s(&["q", "p"]), 1.0)]), s(&["p", "q"]));
	}
}
