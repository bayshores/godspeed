//! Parity with src/shared/core/search.ts (tests/golden/search.json, made by scripts/golden.ts from
//! search.golden.ts): passages, places, snippets, MiniSearch hits with their exact scores, fusion
//! and vector ranking.

use gs_json::{Json, parse};
use gs_search::chunks::{ChunkedFile, chunk_file, chunk_text, range_point, snippet_of};
use gs_search::fusion::{fuse_rankings, vector_ranking};
use gs_search::keyword::keyword_index;

fn golden() -> Json {
	parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/search.json")).unwrap()).unwrap()
}

fn case(name: &str) -> Json {
	golden().as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap().clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

fn fixture(file: &str) -> String {
	gs_base::fsx::read_text(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(file)).unwrap()
}

/// A chunked file as the TS returns it: `{ chunks: [{ range, from, to, text }], extent }`.
fn assert_chunks(got: &ChunkedFile, want: &Json, label: &str) {
	assert_eq!(got.extent, s(&want["extent"]), "{label} extent");
	let chunks = want["chunks"].as_arr().unwrap();
	assert_eq!(got.chunks.len(), chunks.len(), "{label} chunk count");
	for (i, (g, w)) in got.chunks.iter().zip(chunks).enumerate() {
		assert_eq!(g.range, s(&w["range"]), "{label} chunk {i} range");
		// JSON writes NaN as null.
		let num = |n: f64| if n.is_finite() { Json::from(n) } else { Json::Null };
		assert_eq!(num(g.from), w["from"], "{label} chunk {i} from");
		assert_eq!(num(g.to), w["to"], "{label} chunk {i} to");
		assert_eq!(g.text, s(&w["text"]), "{label} chunk {i} text");
	}
}

#[test]
fn fixture_files_chunk_like_the_ts() {
	for f in case("files")["output"].as_arr().unwrap() {
		assert_chunks(&chunk_file(s(&f["name"]), &fixture(s(&f["file"]))), f, s(&f["file"]));
	}
}

#[test]
fn odd_files_chunk_like_the_ts() {
	for f in case("edges")["output"].as_arr().unwrap() {
		assert_chunks(&chunk_file(s(&f["name"]), s(&f["text"])), f, s(&f["name"]));
	}
}

#[test]
fn chunk_text_matches() {
	let inputs = [fixture("problem-set.txt"), "a\n\nb".to_owned(), String::new()];
	for (text, want) in inputs.iter().zip(case("chunkText")["output"].as_arr().unwrap()) {
		assert_chunks(&chunk_text(text), want, "chunkText");
	}
}

#[test]
fn range_points_match() {
	for r in case("ranges")["output"].as_arr().unwrap() {
		assert_eq!(range_point(s(&r["range"])), r["point"].as_f64(), "{:?}", r["range"]);
	}
}

#[test]
fn snippets_match() {
	let out = case("snippets")["output"].clone();
	let queries = out["queries"].as_arr().unwrap();
	for t in out["texts"].as_arr().unwrap() {
		for (q, want) in queries.iter().zip(t["snippets"].as_arr().unwrap()) {
			assert_eq!(snippet_of(s(&t["text"]), s(q)), s(want), "query {q:?}");
		}
	}
}

fn assert_hits(index: &gs_search::keyword::KeywordIndex, cases: &Json) {
	for c in cases.as_arr().unwrap() {
		let got: Vec<(String, f64)> = index.search(s(&c["query"])).into_iter().map(|(id, score)| (id.to_owned(), score)).collect();
		let want: Vec<(String, f64)> = c["hits"].as_arr().unwrap().iter().map(|h| (s(&h[0]).to_owned(), h[1].as_f64().unwrap())).collect();
		assert_eq!(got, want, "query {:?}", c["query"]);
	}
}

#[test]
fn keyword_hits_and_scores_match_minisearch() {
	let files = case("files")["output"].clone();
	let mut docs = Vec::new();
	for f in files.as_arr().unwrap() {
		for (n, c) in f["chunks"].as_arr().unwrap().iter().enumerate() {
			docs.push((format!("{}:{}", s(&f["file"]), n + 1), s(&c["text"]).to_owned()));
		}
	}
	let index = keyword_index(docs.iter().map(|(id, text)| (id.as_str(), text.as_str()))).unwrap();
	assert_hits(&index, &case("keywords")["output"]);
}

#[test]
fn keyword_edges_match_minisearch() {
	let docs = [
		("a", "The cat sat on the mat. The cat!"),
		("b", "the CAT; the hat — and a bat…"),
		("c", ""),
		("d", "...!!!"),
		("e", "İstanbul café naïve ΣΑΣ"),
		("f", "cats dogs\u{a0}birds\u{2003}fish\nnewt\r\neel"),
		("7", "numbers 1789 and 2026"),
		("g", "emoji 😀 cat 😀 hat"),
	];
	assert_hits(&keyword_index(docs).unwrap(), &case("keywordEdges")["output"]);
	assert_eq!(keyword_index([("x", "a"), ("x", "b")]).err().as_deref(), case("duplicateId")["error"].as_str());
}

#[test]
fn fusion_matches() {
	for c in case("fusion")["output"].as_arr().unwrap() {
		let lists: Vec<(Vec<String>, f64)> = c["rankings"]
			.as_arr()
			.unwrap()
			.iter()
			.map(|r| (r["ids"].as_arr().unwrap().iter().map(|i| s(i).to_owned()).collect(), r["weight"].as_f64().unwrap()))
			.collect();
		let rankings: Vec<(&[String], f64)> = lists.iter().map(|(ids, w)| (ids.as_slice(), *w)).collect();
		let want: Vec<String> = c["fused"].as_arr().unwrap().iter().map(|i| s(i).to_owned()).collect();
		assert_eq!(fuse_rankings(&rankings), want);
	}
}

#[test]
fn vector_ranking_matches() {
	let f32s = |v: &Json| v.as_arr().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect::<Vec<f32>>();
	for c in case("vectors")["output"].as_arr().unwrap() {
		let queries: Vec<Vec<f32>> = c["queries"].as_arr().unwrap().iter().map(f32s).collect();
		let refs: Vec<&[f32]> = queries.iter().map(Vec::as_slice).collect();
		let want: Vec<usize> = c["ranked"].as_arr().unwrap().iter().map(|i| i.as_f64().unwrap() as usize).collect();
		let dims = c["dims"].as_f64().unwrap() as usize;
		let n = c["n"].as_f64().unwrap() as usize;
		assert_eq!(vector_ranking(&refs, &f32s(&c["table"]), dims, n), want);
	}
}
