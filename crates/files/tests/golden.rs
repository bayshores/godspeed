//! Parity with the TypeScript class-file code (tests/golden/files.json, made by scripts/golden.ts
//! from files.golden.ts): office text, captions, text sniffing, reading rules, folder walks,
//! fingerprints.

mod support;

use std::fs;
#[cfg(unix)]
use std::os::unix::fs::{PermissionsExt, symlink};
#[cfg(unix)]
use std::path::Path;

#[cfg(unix)]
use gs_base::fsx::node_error_message;
use gs_files::fingerprint::fingerprint_file;
use gs_files::office::office_text;
use gs_files::text::{FileTextError, file_to_text, is_readable_class_file, looks_like_text, transcript_to_text};
#[cfg(unix)]
use gs_files::text::TextChecks;
#[cfg(unix)]
use gs_files::walk::walk_linked_folder;
use gs_json::{Json, parse};
use gs_pdf::worker::Pdf;
use support::{TempDir, write};

fn golden(case: &str) -> Vec<Json> {
	let all = parse(&fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/files.json")).unwrap()).unwrap();
	let case = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap();
	assert!(case.get("error").is_none(), "the golden case failed in TypeScript: {:?}", case.get("error"));
	case["output"].as_arr().unwrap().clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

fn unhex(h: &str) -> Vec<u8> {
	(0..h.len()).step_by(2).map(|i| u8::from_str_radix(&h[i..i + 2], 16).unwrap()).collect()
}

#[test]
fn captions_match_node() {
	for c in golden("transcripts") {
		assert_eq!(transcript_to_text(s(&c["raw"])), s(&c["text"]), "{:?}", c["raw"]);
	}
}

#[test]
fn text_sniffing_matches_node() {
	let cases = golden("sniffing");
	assert!(cases.len() > 400);
	for c in cases {
		assert_eq!(looks_like_text(&unhex(s(&c["hex"]))), c["text"].as_bool().unwrap(), "{}", s(&c["hex"]));
	}
}

#[test]
fn reading_rules_match_node() {
	for c in golden("reading rules") {
		let is_text = c["isText"].as_bool();
		let want = c["readable"].as_bool();
		assert_eq!(is_readable_class_file(s(&c["name"]), || is_text), want, "{} with {is_text:?}", s(&c["name"]));
	}
}

#[test]
fn office_text_matches_node() {
	let dir = TempDir::new();
	for c in golden("office") {
		let file = dir.path().join(s(&c["file"]));
		write(&file, unhex(s(&c["hex"])));
		let got = office_text(&file);
		match c.get("error") {
			Some(error) => assert_eq!(got, Err(s(error).to_owned()), "{}", s(&c["name"])),
			None => assert_eq!(got, Ok(s(&c["text"]).to_owned()), "{}", s(&c["name"])),
		}
	}
}

#[tokio::test]
async fn file_to_text_matches_node() {
	let dir = TempDir::new();
	let pdf = Pdf::new(dir.path());
	for c in golden("file to text") {
		let file = dir.path().join(s(&c["file"]));
		if c["folder"].as_bool().unwrap() {
			fs::create_dir(&file).unwrap();
		} else if let Some(hex) = c["hex"].as_str() {
			write(&file, unhex(hex));
		}
		let got = file_to_text(&pdf, &file).await;
		let name = s(&c["name"]);
		match c.get("error") {
			Some(error) => {
				let err = got.unwrap_err();
				assert_eq!(matches!(err, FileTextError::NeedsTranscript), c["needsTranscript"].as_bool().unwrap(), "{name}");
				assert_eq!(err.to_string().replace(dir.path().to_str().unwrap(), "<dir>"), s(error), "{name}");
			}
			None => assert_eq!(got, Ok(s(&c["text"]).to_owned()), "{name}"),
		}
	}
}

#[cfg(unix)]
fn build_tree(root: &Path, nodes: &[Json]) {
	let mut locked = Vec::new();
	for n in nodes {
		let names: Vec<String> = match n["count"].as_i64() {
			Some(count) => (0..count).map(|i| format!("{}{i:03}{}", s(&n["p"]), n["ext"].as_str().unwrap_or(""))).collect(),
			None => vec![s(&n["p"]).to_owned()],
		};
		for name in names {
			let target = root.join(name);
			fs::create_dir_all(target.parent().unwrap()).unwrap();
			if n["dir"].as_bool() == Some(true) {
				fs::create_dir_all(&target).unwrap();
			} else if let Some(link) = n["link"].as_str() {
				symlink(link, &target).unwrap();
			} else {
				write(&target, unhex(n["hex"].as_str().unwrap_or("")));
			}
		}
		if let Some(mode) = n["mode"].as_i64() {
			locked.push((root.join(s(&n["p"])), mode as u32));
		}
	}
	for (path, mode) in locked.into_iter().rev() {
		fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
	}
}

#[cfg(unix)]
fn strings(v: &Json) -> Vec<String> {
	v.as_arr().unwrap().iter().map(|e| s(e).to_owned()).collect()
}

#[cfg(unix)]
#[test]
fn folder_walks_match_node() {
	let dir = TempDir::new();
	let checks = TextChecks::default();
	for (i, c) in golden("walks").into_iter().enumerate() {
		let name = s(&c["name"]).to_owned();
		if let Some(error) = c.get("error") {
			let root = match name.as_str() {
				"root missing" => dir.path().join("missing"),
				"root is a file" => {
					write(dir.path().join("a-file"), "x");
					dir.path().join("a-file")
				}
				_ => {
					let locked = dir.path().join("locked-root");
					fs::create_dir(&locked).unwrap();
					fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).unwrap();
					locked
				}
			};
			let got = walk_linked_folder(&root, &checks).unwrap_err();
			assert_eq!(node_error_message(&got, "scandir", &root).replace(dir.path().to_str().unwrap(), "<dir>"), s(&error["message"]), "{name}");
			continue;
		}
		let root = dir.path().join(format!("case-{i}"));
		fs::create_dir(&root).unwrap();
		build_tree(&root, c["tree"].as_arr().unwrap());
		let got = walk_linked_folder(&root, &checks).unwrap();
		let want = &c["result"];
		let mut want_files = strings(&want["files"]);
		// The recording came from a case-insensitive disk, where library/ is the skipped Library/.
		// On a case-sensitive disk it is a folder of its own, so its file is walked.
		if name == "mixed" && !root.join("LIBRARY").exists() {
			let before = want_files.iter().position(|f| f == "nested/deep/file.py").unwrap();
			want_files.insert(before, "library/x.txt".to_owned());
		}
		assert_eq!(got.files, want_files, "{name} files");
		assert_eq!(got.capped, want["capped"].as_bool().unwrap(), "{name} capped");
		assert_eq!(got.unreadable, strings(&want["unreadable"]), "{name} unreadable");
		assert_eq!(got.skipped.count as i64, want["skipped"]["count"].as_i64().unwrap(), "{name} skipped count");
		assert_eq!(got.skipped.examples, strings(&want["skipped"]["examples"]), "{name} skipped examples");
		assert_eq!(got.skipped.google as i64, want["skipped"]["google"].as_i64().unwrap(), "{name} google");
	}
}

#[tokio::test]
async fn fingerprints_match_node() {
	let dir = TempDir::new();
	for c in golden("fingerprints") {
		let name = s(&c["name"]);
		let file = match name {
			"missing" => dir.path().join("gone.bin"),
			"folder" => dir.path().to_owned(),
			_ => {
				let size = c["size"].as_i64().unwrap() as usize;
				let bytes: Vec<u8> = match name {
					"empty" => vec![],
					"abc" => b"abc".to_vec(),
					_ => (0..size).map(|i| (i % 251) as u8).collect(),
				};
				let file = dir.path().join("f.bin");
				write(&file, bytes);
				file
			}
		};
		let got = fingerprint_file(&file).await;
		match c.get("error") {
			Some(error) => assert_eq!(got.unwrap_err().replace(dir.path().to_str().unwrap(), "<dir>"), s(error), "{name}"),
			None => assert_eq!(got, Ok(s(&c["fp"]).to_owned()), "{name}"),
		}
	}
}
