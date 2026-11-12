//! Parity with the TypeScript file, web and PDF tools (tests/golden/fs_tools.json, made by
//! scripts/golden.ts from fs_tools.golden.ts): the same made-up folder is built from the
//! `fixture` case, then every recorded call is replayed on the Rust tools and must answer the
//! same, byte for byte. The recorded paths are POSIX ones, so it runs only there.

#![cfg(unix)]

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_agent::fs_tools::find::find_tool;
use gs_agent::fs_tools::grep::grep_tool;
use gs_agent::fs_tools::ls::ls_tool;
use gs_agent::fs_tools::pdf_read::create_pdf_read_tools;
use gs_agent::fs_tools::read::read_tool;
use gs_agent::fs_tools::web::web_tools;
use gs_base::fsx;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::tool::{Tool, ToolContext};
use gs_json::{Json, parse, stringify};
use gs_pdf::Pdf;

/// A folder under the system temp folder, removed (locked parts unlocked first) when dropped.
struct Fixture {
	root: PathBuf,
	locked: Vec<PathBuf>,
}

impl Drop for Fixture {
	fn drop(&mut self) {
		for path in &self.locked {
			let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
		}
		let _ = fs::remove_dir_all(&self.root);
	}
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

fn unhex(h: &str) -> Vec<u8> {
	(0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
}

/// The bytes of one `files` entry: hex, numbered lines, or pieces (a pair is a piece repeated).
fn content(spec: &Json) -> Vec<u8> {
	if let Some(hex) = spec["hex"].as_str() {
		return unhex(hex);
	}
	if let Some(numbered) = spec["numbered"].as_arr() {
		let (prefix, count) = (s(&numbered[0]), numbered[1].as_i64().unwrap());
		return (1..=count).map(|i| format!("{prefix} {i}")).collect::<Vec<_>>().join("\n").into_bytes();
	}
	let mut out = String::new();
	for piece in spec["content"].as_arr().unwrap() {
		match piece.as_arr() {
			Some(pair) => out.push_str(&s(&pair[0]).repeat(pair[1].as_i64().unwrap() as usize)),
			None => out.push_str(s(piece)),
		}
	}
	out.into_bytes()
}

fn build(spec: &Json) -> Fixture {
	let root = fs::canonicalize(std::env::temp_dir()).unwrap().join(format!("gs-fs-tools-golden-{}", std::process::id()));
	let _ = fs::remove_dir_all(&root);
	fs::create_dir_all(&root).unwrap();
	let mut fixture = Fixture { root: root.clone(), locked: Vec::new() };
	for file in spec["files"].as_arr().unwrap() {
		let path = root.join(s(&file["path"]));
		fs::create_dir_all(path.parent().unwrap()).unwrap();
		fsx::write_atomic(&path, &content(file), None).unwrap();
	}
	for dir in spec["dirs"].as_arr().unwrap() {
		fs::create_dir_all(root.join(s(dir))).unwrap();
	}
	for group in spec["generated"].as_arr().unwrap() {
		let dir = root.join(s(&group["dir"]));
		fs::create_dir_all(&dir).unwrap();
		for i in 1..=group["count"].as_i64().unwrap() {
			fsx::write_atomic(&dir.join(s(&group["name"]).replace("{i}", &format!("{i:04}"))), b"", None).unwrap();
		}
	}
	for link in spec["links"].as_arr().unwrap() {
		let link = link.as_arr().unwrap();
		symlink(root.join(s(&link[1])), root.join(s(&link[0]))).unwrap();
	}
	for entry in spec["modes"].as_arr().unwrap() {
		let entry = entry.as_arr().unwrap();
		let path = root.join(s(&entry[0]));
		fs::set_permissions(&path, fs::Permissions::from_mode(entry[1].as_i64().unwrap() as u32)).unwrap();
		fixture.locked.push(path);
	}
	fixture
}

/// The recorded value with the placeholder replaced by this run's folder.
fn at(value: &Json, root: &Path) -> Json {
	parse(&stringify(value).replace("<ROOT>", root.to_str().unwrap())).unwrap()
}

/// The recording was made on a case-insensitive disk, where case/b.txt is case/B.txt and the
/// folder holds one file. On a case-sensitive disk both exist, and names that differ only in case
/// list in byte order, so b.txt follows B.txt.
fn for_this_disk(name: &str, recorded: Json, case_sensitive: bool) -> Json {
	if case_sensitive && name == "ls: mixed case and accents" {
		return parse(&stringify(&recorded).replace("B.txt\\n", "B.txt\\nb.txt\\n")).unwrap();
	}
	recorded
}

fn tools_for(root: &Path) -> Vec<Arc<dyn Tool>> {
	let pdf = Pdf::new(Path::new("/nonexistent"));
	[read_tool(), ls_tool(), find_tool(), grep_tool()].into_iter().chain(web_tools()).chain(create_pdf_read_tools(&pdf, &root.join("pdf-job"))).collect()
}

#[tokio::test]
async fn the_tools_answer_like_the_typescript_ones() {
	let cases = parse(&fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/fs_tools.json")).unwrap()).unwrap();
	let cases = cases.as_arr().unwrap();
	let case = |name: &str| cases.iter().find(|c| s(&c["name"]) == name).unwrap_or_else(|| panic!("no golden case {name}"))["output"].clone();

	let fixture = build(&case("fixture"));
	let case_sensitive = !fixture.root.join("CASE").exists();
	let tools = tools_for(&fixture.root);
	let mut failures: Vec<String> = Vec::new();

	let definitions = case("definitions");
	let definitions = definitions.as_arr().unwrap();
	assert_eq!(tools.len(), definitions.len());
	for (tool, def) in tools.iter().zip(definitions) {
		let name = s(&def["name"]);
		if tool.name() != name || tool.description() != s(&def["description"]) || stringify(tool.parameters()) != stringify(&def["parameters"]) {
			failures.push(format!("definition of {name} differs:\n  rust: {} / {}\n  node: {} / {}", tool.description(), stringify(tool.parameters()), s(&def["description"]), stringify(&def["parameters"])));
		}
	}

	let mut replayed = 0;
	for c in cases.iter().filter(|c| !matches!(s(&c["name"]), "fixture" | "definitions")) {
		let (name, recorded) = (s(&c["name"]), &c["output"]);
		assert!(c.get("error").is_none(), "{name} failed in TypeScript: {:?}", c.get("error"));
		let tool = tools.iter().find(|t| t.name() == s(&recorded["tool"])).unwrap();
		let abort = Abort::new();
		if recorded["aborted"].as_bool() == Some(true) {
			abort.abort();
		}
		let got = tool.execute(at(&recorded["args"], &fixture.root), ToolContext { tool_call_id: "call".to_owned(), abort }).await;
		let want = match recorded.get("error") {
			Some(error) => Err(s(&at(error, &fixture.root)).to_owned()),
			None => Ok(for_this_disk(name, at(&recorded["result"], &fixture.root), case_sensitive)),
		};
		if got != want {
			let show = |r: &Result<Json, String>| match r {
				Ok(v) => stringify(v).chars().take(400).collect::<String>(),
				Err(e) => format!("throws {e}"),
			};
			failures.push(format!("{name}\n  rust: {}\n  node: {}", show(&got), show(&want)));
		}
		replayed += 1;
	}
	assert!(replayed > 100, "only {replayed} calls replayed");
	assert!(failures.is_empty(), "{} of {replayed} calls differ:\n{}", failures.len(), failures.join("\n"));
}
