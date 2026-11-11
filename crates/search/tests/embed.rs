//! The embedder against vectors the Node worker made for the same batches (tests/golden/embed.json,
//! from embed.golden.ts). Needs models/ at the repo root (node scripts/fetch-model.mjs).

use std::path::PathBuf;

use gs_json::{Json, parse};
use gs_search::embed::{DIMS, Embedder};

fn golden(name: &str) -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/embed.json")).unwrap()).unwrap();
	all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap()["output"].clone()
}

fn models() -> PathBuf {
	let dir = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../../models"));
	assert!(dir.join("Snowflake").exists(), "models/ is missing: run node scripts/fetch-model.mjs");
	dir
}

fn hex(v: &[f32]) -> String {
	v.iter().flat_map(|f| f.to_le_bytes()).map(|b| format!("{b:02x}")).collect()
}

/// Same batch, same bytes: stored tables stay valid and the recorded vector hashes hold.
#[tokio::test]
async fn vectors_match_the_node_worker_bit_for_bit() {
	let embedder = Embedder::new(models());
	let want = golden("vectors");
	for (name, batch) in golden("batches").as_obj().unwrap().iter() {
		let texts = batch.as_arr().unwrap().iter().map(|t| t.as_str().unwrap().to_owned()).collect();
		let got = embedder.embed_batch(texts).await.unwrap();
		let rows: Vec<String> = got.chunks(DIMS).map(hex).collect();
		let want: Vec<&str> = want[name.as_str()].as_arr().unwrap().iter().map(|r| r.as_str().unwrap()).collect();
		assert_eq!(rows, want, "{name}");
	}
}
