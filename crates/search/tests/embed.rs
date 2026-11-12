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

fn unhex(h: &str) -> Vec<f32> {
	(0..h.len() / 8).map(|i| f32::from_le_bytes(std::array::from_fn(|k| u8::from_str_radix(&h[i * 8 + k * 2..][..2], 16).unwrap()))).collect()
}

/// Both vectors have length 1, so their dot product is their cosine.
fn cosine(a: &[f32], b: &[f32]) -> f32 {
	a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// On the Apple silicon the recording came from: same batch, same bytes, so stored tables stay
/// valid. Other CPUs run the quantized model through other ONNX Runtime kernels that differ in
/// the low bits (the Node worker does too), so there the vectors must point the same way.
#[tokio::test]
async fn vectors_match_the_node_worker_bit_for_bit() {
	let embedder = Embedder::new(models());
	let want = golden("vectors");
	for (name, batch) in golden("batches").as_obj().unwrap().iter() {
		let texts = batch.as_arr().unwrap().iter().map(|t| t.as_str().unwrap().to_owned()).collect();
		let got = embedder.embed_batch(texts).await.unwrap();
		let rows: Vec<String> = got.chunks(DIMS).map(hex).collect();
		let want: Vec<&str> = want[name.as_str()].as_arr().unwrap().iter().map(|r| r.as_str().unwrap()).collect();
		if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
			assert_eq!(rows, want, "{name}");
		} else {
			assert_eq!(rows.len(), want.len(), "{name}");
			for (row, want) in rows.iter().zip(&want) {
				assert!(cosine(&unhex(row), &unhex(want)) > 0.995, "{name}");
			}
		}
	}
}
