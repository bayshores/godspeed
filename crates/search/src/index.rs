//! The stored search index (src/backend/server/search-index.ts). Each graph scope keeps its tables
//! next to its graph, in `search/`: `passages` (every class file cut into passages) and `facts`
//! (the graph's facts), see table.rs. A row's hash is of its text, so a changed file or fact
//! re-embeds only what changed. Search fuses the embedding ranking with BM25 keyword ranking;
//! brute-force cosine is fine for tens of thousands of rows.
//!
//! Callers pass what the TS read from the stores: a class's files (`[{ id, name, .. }]`) and a
//! graph's merged nodes. A class id must name a class the caller found.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::hash::sha256_text;
use gs_json::Json;
use parking_lot::Mutex;

use crate::embed::{DIMS, Embedder};
use crate::fusion::{KEYWORD_WEIGHT, VECTOR_WEIGHT, fuse_rankings, vector_ranking};
use crate::keyword::{KeywordIndex, keyword_index, keyword_ranking};
use crate::table::{self, Table};

/// The model's instruction for queries (documents get none).
const QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";
const EMBED_BATCH: usize = 8;
/// How deep each ranking goes before fusion.
const CANDIDATES: usize = 50;

/// Which passage(s) read_passage opens: one by id, or every passage of a file at a place
/// ("p. 12", "12:30", "lines 40"), e.g. a whole page.
pub enum PassageRef {
	Passage(String),
	Place { file_id: String, range: String },
}

/// The search model and the per-scope index tables. Keep this constructor's signature. The class
/// files' methods are in passages.rs, the facts' in facts.rs.
pub struct Search {
	data: PathBuf,
	classes: PathBuf,
	embedder: Embedder,
	/// Tables read from disk or last written, by base path.
	tables: Mutex<HashMap<PathBuf, Arc<Table>>>,
	/// One writer per table at a time.
	writers: Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>,
}

impl Search {
	pub fn new(paths: &Paths) -> Search {
		Search {
			data: paths.data.clone(),
			classes: paths.classes.clone(),
			embedder: Embedder::new(paths.resources.join("models")),
			tables: Mutex::default(),
			writers: Mutex::default(),
		}
	}

	/// `search/` beside the scope's graph: data/search for "No class", else the class folder's.
	fn search_dir(&self, scope: Option<&str>) -> PathBuf {
		scope.map_or_else(|| self.data.join("search"), |id| self.classes.join(id).join("search"))
	}

	pub(crate) fn passages_file(&self, class_id: &str) -> PathBuf {
		self.search_dir(Some(class_id)).join("passages")
	}

	pub(crate) fn facts_file(&self, scope: Option<&str>) -> PathBuf {
		self.search_dir(scope).join("facts")
	}

	/// A table from disk, cached.
	pub(crate) fn read_table(&self, base: &Path) -> Arc<Table> {
		if let Some(t) = self.tables.lock().get(base) {
			return t.clone();
		}
		let table = Arc::new(table::load(base));
		self.tables.lock().entry(base.to_owned()).or_insert(table).clone()
	}

	/// Forget a cached table (its files stay).
	pub(crate) fn drop_cached(&self, base: &Path) {
		self.tables.lock().remove(base);
	}

	pub(crate) fn write_table(&self, base: &Path, table: Table) -> Result<Arc<Table>, String> {
		table::save(base, &table).map_err(|e| e.to_string())?;
		let table = Arc::new(table);
		self.tables.lock().insert(base.to_owned(), table.clone());
		Ok(table)
	}

	pub(crate) fn writer(&self, base: &Path) -> Arc<tokio::sync::Mutex<()>> {
		self.writers.lock().entry(base.to_owned()).or_default().clone()
	}

	/// Normalized vectors, row after row. One batch in flight per call, so a search waits behind at
	/// most one batch of an indexing run.
	pub(crate) async fn embed(&self, texts: &[String], as_query: bool) -> Result<Vec<f32>, String> {
		let mut out = Vec::with_capacity(texts.len() * DIMS);
		for batch in texts.chunks(EMBED_BATCH) {
			let batch = batch.iter().map(|t| if as_query { format!("{QUERY_PREFIX}{t}") } else { t.clone() }).collect();
			out.extend(self.embedder.embed_batch(batch).await?);
		}
		Ok(out)
	}

	/// New rows' vectors: reused by hash from `old`, the rest embedded.
	pub(crate) async fn with_vectors(&self, old: &Table, hashes: &[String], texts: &[String]) -> Result<Vec<f32>, String> {
		let known: HashMap<&str, usize> = old.rows.iter().enumerate().filter_map(|(i, r)| Some((r["hash"].as_str()?, i))).collect();
		let missing: Vec<usize> = (0..hashes.len()).filter(|&i| !known.contains_key(hashes[i].as_str())).collect();
		let fresh = self.embed(&missing.iter().map(|&i| texts[i].clone()).collect::<Vec<_>>(), false).await?;
		let mut vectors = vec![0f32; hashes.len() * DIMS];
		for (k, &row) in missing.iter().enumerate() {
			vectors[row * DIMS..(row + 1) * DIMS].copy_from_slice(&fresh[k * DIMS..(k + 1) * DIMS]);
		}
		for (i, hash) in hashes.iter().enumerate() {
			if let Some(&at) = known.get(hash.as_str()) {
				vectors[i * DIMS..(i + 1) * DIMS].copy_from_slice(old.vector(at));
			}
		}
		Ok(vectors)
	}
}

/// The first 16 hex digits of the text's SHA-256.
pub(crate) fn hash_of(text: &str) -> String {
	sha256_text(text)[..16].to_owned()
}

/// A row's string field (`row.id`, `row.text`); "" when it is not a string.
pub(crate) fn field<'a>(row: &'a Json, key: &str) -> &'a str {
	row[key].as_str().unwrap_or_default()
}

/// A table's keyword index, built once from (id, text) pairs.
pub(crate) fn keywords_of(table: &Table, docs: impl FnOnce() -> Vec<(String, String)>) -> Result<Arc<KeywordIndex>, String> {
	table
		.keywords
		.get_or_init(|| {
			let docs = docs();
			keyword_index(docs.iter().map(|(id, text)| (id.as_str(), text.as_str()))).map(Arc::new)
		})
		.clone()
}

/// A table's best `limit` row ids for queries (vectors) and keyword text.
pub(crate) fn rank(table: &Table, queries: &[&[f32]], keyword_query: &str, keywords: &KeywordIndex, limit: usize) -> Vec<String> {
	let depth = CANDIDATES.max(limit);
	let by_vector: Vec<String> = vector_ranking(queries, &table.vectors, DIMS, depth).into_iter().map(|i| field(&table.rows[i], "id").to_owned()).collect();
	let by_keyword = keyword_ranking(keywords, keyword_query, depth);
	let mut fused = fuse_rankings(&[(&by_vector, VECTOR_WEIGHT), (&by_keyword, KEYWORD_WEIGHT)]);
	fused.truncate(limit);
	fused
}

#[cfg(test)]
mod tests {
	use super::*;

	fn spawnable<T: Send>(_: &T) {}

	/// Routes and jobs run these on spawned tasks.
	#[test]
	fn searches_can_be_spawned() {
		let s = Search::new(&Paths::new("/d".into(), "/h".into(), "/t".into(), "/r".into()));
		// The class lock's guard is not Send; it is held only over the write, after the last await.
		spawnable(&s.index_class_file("c", "f", "n.txt", "fp", "text", || Some(std::rc::Rc::new(()))));
		spawnable(&s.drop_class_file("c", "f"));
		spawnable(&s.search_class_files("c", &[], "q", 3));
		spawnable(&s.search_facts(None, &[], "q", 3));
		spawnable(&s.related_facts(None, &[], "text", 3));
		assert_eq!(s.passages_file("cls_x"), Path::new("/d/classes/cls_x/search/passages"));
		assert_eq!(s.facts_file(None), Path::new("/d/search/facts"));
		assert_eq!(hash_of("a"), "ca978112ca1bbdca");
	}
}
