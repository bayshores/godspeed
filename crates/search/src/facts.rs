//! A graph scope's fact table: search_graph's ranking and the facts related to new material (the
//! facts half of src/backend/server/search-index.ts). Nodes are the graph's merged nodes
//! (`{ id, name, statement, aliases, .. }`); a scope is None for "No space" or a space id.

use std::sync::Arc;

use gs_json::{Json, Obj};

use crate::chunks::chunk_text;
use crate::embed::DIMS;
use crate::index::{Search, field, hash_of, keywords_of, rank};
use crate::keyword::KeywordIndex;
use crate::table::Table;

fn aliases(node: &Json) -> Vec<&str> {
	node["aliases"].as_arr().map(|a| a.iter().map(|x| x.as_str().unwrap_or_default()).collect()).unwrap_or_default()
}

/// What a fact's vector is made from.
fn fact_text(node: &Json) -> String {
	format!("{}: {}", field(node, "name"), field(node, "statement"))
}

impl Search {
	/// The scope's fact table brought up to date with `nodes` (new or changed facts embedded now:
	/// facts arrive between parts of one import), with its keyword index.
	async fn current_facts(&self, scope: Option<&str>, nodes: &[Json]) -> Result<(Arc<Table>, Arc<KeywordIndex>), String> {
		let at = self.facts_file(scope);
		let writer = self.writer(&at);
		let _turn = writer.lock().await;
		let old = self.read_table(&at);
		let hashes: Vec<String> = nodes.iter().map(|n| hash_of(&format!("{}\n{}", fact_text(n), aliases(n).join("\n")))).collect();
		let same = hashes.len() == old.rows.len() && nodes.iter().zip(&hashes).zip(&old.rows).all(|((n, h), r)| r["hash"] == Json::from(h.as_str()) && r["id"] == n["id"]);
		let table = if same {
			old
		} else {
			let texts: Vec<String> = nodes.iter().map(fact_text).collect();
			let vectors = self.with_vectors(&old, &hashes, &texts).await?;
			let rows = nodes
				.iter()
				.zip(hashes)
				.map(|(n, hash)| {
					let mut row = Obj::new();
					row.insert("id", n["id"].clone());
					row.insert("hash", hash);
					Json::Obj(row)
				})
				.collect();
			self.write_table(&at, Table::new(rows, vectors, Obj::new()))?
		};
		let keywords = keywords_of(&table, || {
			nodes
				.iter()
				.map(|n| {
					let words: Vec<&str> = [field(n, "name"), field(n, "statement")].into_iter().chain(aliases(n)).collect();
					(field(n, "id").to_owned(), words.join(" "))
				})
				.collect()
		})?;
		Ok((table, keywords))
	}

	/// Ids of the scope's facts (`nodes`, its graph's merged nodes) best matching a query, at most
	/// `limit`.
	pub async fn search_facts(&self, scope: Option<&str>, nodes: &[Json], query: &str, limit: usize) -> Result<Vec<String>, String> {
		if nodes.is_empty() {
			return Ok(Vec::new());
		}
		let query = [query.to_owned()];
		// Both run to the end like Promise.all's, so the table is updated even when the query fails.
		let (facts, query_vector) = tokio::join!(self.current_facts(scope, nodes), self.embed(&query, true));
		let query_vector = query_vector?;
		let (table, keywords) = facts?;
		Ok(rank(&table, &[&query_vector], &query[0], &keywords, limit))
	}

	/// The existing facts most related to a passage of new material (graph building shows the
	/// extractor these). The passage is longer than the model reads, so it is cut into ~300-token
	/// windows; a fact scores its best window.
	pub async fn related_facts(&self, scope: Option<&str>, nodes: &[Json], text: &str, limit: usize) -> Result<Vec<String>, String> {
		if nodes.is_empty() {
			return Ok(Vec::new());
		}
		let windows: Vec<String> = chunk_text(text).chunks.into_iter().map(|c| c.text).collect();
		if windows.is_empty() {
			return Ok(Vec::new());
		}
		let (facts, vectors) = tokio::join!(self.current_facts(scope, nodes), self.embed(&windows, true));
		let vectors = vectors?;
		let (table, keywords) = facts?;
		let queries: Vec<&[f32]> = vectors.chunks(DIMS).collect();
		Ok(rank(&table, &queries, text, &keywords, limit))
	}
}
