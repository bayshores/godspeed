//! The index replays the contract scenario search-vectors without a server: the same files and
//! facts, indexed in the same order, must give the recorded tables byte for byte (passages.json,
//! facts.json and the hashes of every stored vector) and the recorded search answers
//! (tests/fixtures/search-vectors.json, taken from the recording). Needs models/ at the repo root.

use std::path::{Path, PathBuf};

use gs_base::config::Paths;
use gs_base::hash::sha256_hex;
use gs_json::{Json, json, parse};
use gs_search::index::Search;

const TEXTS: [(&str, &str); 10] = [
	("photosynthesis.txt", "Photosynthesis turns sunlight, water and carbon dioxide into glucose and oxygen inside the chloroplasts of plant cells.\n"),
	("mitosis.txt", "Mitosis is the cell division that produces two identical daughter cells, each with the same number of chromosomes as the parent.\n"),
	("binary-search.txt", "Binary search finds an item in a sorted array by repeatedly halving the range that could still hold it.\n"),
	("quicksort.txt", "Quicksort picks a pivot, partitions the array into smaller and larger items, and sorts each side the same way.\n"),
	("french-revolution.txt", "The French Revolution began in 1789 when the Estates General met, and it ended the absolute monarchy in France.\n"),
	("supply-demand.txt", "In a market the price settles where the quantity supplied equals the quantity demanded.\n"),
	("newton.txt", "Newton's second law says the net force on an object equals its mass times its acceleration.\n"),
	("sonnets.txt", "Shall I compare thee to a summer's day? Thou art more lovely and more temperate.\n"),
	("unicode.txt", "Les protéines sont synthétisées par les ribosomes.\n蛋白质由核糖体合成。\n"),
	("one-word.txt", "ok\n"),
];

const TOPICS: [&str; 6] = ["Graphs store nodes and edges", "A heap keeps its smallest item on top", "Hash maps trade memory for fast lookups", "Dynamic programming reuses answers to subproblems", "Recursion needs a base case", "Big O notation hides constant factors"];

fn long_notes() -> String {
	let step = "The idea is easiest to see on a small example worked by hand, one step at a time, with every choice written down. ".repeat(4);
	TOPICS.iter().map(|t| format!("{t}. {step}")).collect::<Vec<_>>().join("\n\n")
}

fn recorded() -> Json {
	parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/search-vectors.json")).unwrap()).unwrap()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

/// The recording's view of a table: a short hash of the whole .f32 file and of each row.
fn assert_vectors(base: &Path, want: &Json) {
	let bytes = std::fs::read(base.with_extension("f32")).unwrap();
	let rows: Json = parse(&std::fs::read_to_string(base.with_extension("json")).unwrap()).unwrap()["rows"].clone();
	assert_eq!(&sha256_hex(&bytes)[..16], s(&want["fileSha256"]), "{}", base.display());
	for (i, (row, w)) in rows.as_arr().unwrap().iter().zip(want["rows"].as_arr().unwrap()).enumerate() {
		assert_eq!(row["id"], w[0], "row {i}");
		assert_eq!(&sha256_hex(&bytes[i * 1536..(i + 1) * 1536])[..16], s(&w[1]), "row {i} of {}", base.display());
	}
}

fn fact(id: &str, name: &str, statement: &str) -> Json {
	json!({ "id": id, "name": name, "statement": statement, "aliases": [] })
}

#[tokio::test]
async fn the_search_vectors_scenario_comes_out_as_recorded() {
	let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../.."));
	let dir = std::env::temp_dir().join(format!("gs-search-recorded-{}", std::process::id()));
	let paths = Paths::new(dir.join("data"), dir.join("home"), dir.join("tmp"), root);
	let search = Search::new(&paths);
	let want = recorded();
	let fps = parse(s(&want["passagesJson"])).unwrap()["files"].clone();

	let long = long_notes();
	let mut files = Vec::new();
	for (n, (name, text)) in TEXTS.iter().copied().chain([("long-notes.md", long.as_str())]).enumerate() {
		let id = format!("<f#{}>", n + 1);
		search.index_class_file("cls_test", &id, name, s(&fps[id.as_str()]["fp"]), text, || Some(())).await.unwrap();
		files.push(json!({ "id": id, "name": name }));
	}
	let passages = dir.join("data/classes/cls_test/search/passages");
	assert_eq!(std::fs::read_to_string(passages.with_extension("json")).unwrap(), s(&want["passagesJson"]));
	assert_vectors(&passages, &want["passages"]);
	for q in want["searches"].as_arr().unwrap() {
		let got = search.search_class_files("cls_test", &files, s(&q["query"]), q["limit"].as_f64().unwrap() as usize).await.unwrap();
		assert_eq!(got, s(&q["text"]));
	}

	// Facts: the first import's two, then the merged five (two reused, three embedded together).
	let bio = [fact("<n#1>", "Photosynthesis", "Photosynthesis turns sunlight, water and carbon dioxide into glucose and oxygen."), fact("<n#2>", "Mitosis", "Mitosis divides one cell into two genetically identical daughter cells.")];
	let cs = [
		fact("<n#5>", "Quicksort", "Quicksort partitions an array around a pivot and sorts each side recursively."),
		fact("<n#3>", "Binary search", "Binary search finds an item in a sorted array by halving the candidate range."),
		fact("<n#4>", "Logarithmic time", "Halving the range each step makes binary search take logarithmic time."),
	];
	search.related_facts(None, &bio, "# Sorting\nQuicksort partitions around a pivot.\nBinary search halves a sorted range.", 25).await.unwrap();
	let all: Vec<Json> = bio.iter().chain(&cs).cloned().collect();
	for q in want["graphSearches"].as_arr().unwrap() {
		let got = search.search_facts(None, &all, s(&q["query"]), q["limit"].as_f64().unwrap() as usize).await.unwrap();
		let want: Vec<&str> = q["ids"].as_arr().unwrap().iter().map(s).collect();
		assert_eq!(got, want, "{:?}", q["query"]);
	}
	let facts = dir.join("data/search/facts");
	assert_eq!(std::fs::read_to_string(facts.with_extension("json")).unwrap(), s(&want["factsJson"]));
	assert_vectors(&facts, &want["facts"]);
	std::fs::remove_dir_all(dir).unwrap();
}
