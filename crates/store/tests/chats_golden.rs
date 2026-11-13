//! Parity with Node for the lesson store (tests/golden/chats.json, recorded from the Node server): the same files in, the same lists, records and bytes out.
//!
//! The seed case needs a copy of real app data kept outside the repo (`GODSPEED_SEED_CHATS`) and its
//! expected output in tests/golden/chats-seed.lab.json (git ignores it); it copies the lessons to a
//! temp folder and skips with a printed notice when either is absent.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use gs_base::config::Paths;
use gs_base::events::Events;
use gs_base::fsx;
use gs_base::hash::{sha256_hex, sha256_text};
use gs_base::locks::Locks;
use gs_base::re::Re;
use gs_json::{Json, json, parse, stringify};
use gs_store::chats::ChatStore;

static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// A fresh chats folder and a store over it, removed when the test ends.
struct Lab {
	root: PathBuf,
	chats: PathBuf,
	store: ChatStore,
}

impl Lab {
	fn new() -> Lab {
		let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("chats-golden-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
		let _ = std::fs::remove_dir_all(&root);
		let paths = Paths::new(root.clone(), root.join("home"), root.join("tmp"), root.join("resources"));
		std::fs::create_dir_all(&paths.chats).unwrap();
		let store = ChatStore::new(&paths, &Events::new(), &Locks::new());
		Lab { chats: paths.chats, root, store }
	}
}

impl Drop for Lab {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.root);
	}
}

fn golden(case: &str) -> Json {
	golden_in("chats.json", case)
}

fn golden_in(file: &str, case: &str) -> Json {
	let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden").join(file);
	let all = parse(&std::fs::read_to_string(path).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap_or_else(|| panic!("no golden case {case}"));
	assert!(found.get("error").is_none(), "{case}: {:?}", found["error"]);
	found["output"].clone()
}

fn same(got: &Json, want: &Json, what: &str) {
	assert_eq!(stringify(got), stringify(want), "{what}");
}

fn arr(v: &Json) -> &[Json] {
	v.as_arr().unwrap().as_slice()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

/// What the store's callers see: the value, or the refusal's message.
fn outcome(result: Result<Json, String>) -> Json {
	match result {
		Ok(v) => json!({ "ok": v }),
		Err(e) => json!({ "error": e }),
	}
}

/// Every file in the folder by name: its text, or null for a folder.
fn bytes_of(dir: &Path) -> Json {
	let mut names: Vec<String> = std::fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
	names.sort();
	Json::Obj(names.into_iter().map(|name| (name.clone(), std::fs::read_to_string(dir.join(&name)).map_or(Json::Null, Json::from))).collect())
}

fn run(store: &ChatStore, step: &Json) -> Result<Json, String> {
	let id = s(&step["id"]);
	match s(&step["op"]) {
		"rename" => store.rename_chat(id, s(&step["title"])),
		"setSpace" => store.set_chat_space(id, step["spaceId"].as_str()),
		"turnUsage" => store.append_turn_usage(id, &step["entry"]).map(|()| Json::Null),
		"extractionUsage" => store.append_extraction_usage(id, &step["entry"]).map(|()| Json::Null),
		"tree" => store.save_tree(id, &step["tree"]).map(|()| Json::Null),
		"saveMessages" => store.save_messages(id, &[]).map(|()| Json::Null),
		"delete" => Ok(Json::Bool(store.delete_chat(id))),
		"attachment" => {
			let file = store.save_attachment(id, s(&step["name"]), &[1, 2, 3])?;
			Ok(Json::from(gs_base::ids::hex(&std::fs::read(file).unwrap())))
		}
		other => panic!("unknown step {other}"),
	}
}

#[test]
fn synthetic_store_matches_node() {
	let case = golden("synthetic store");
	let lab = Lab::new();
	let files: &gs_json::Obj = case["files"].as_obj().unwrap();
	for (name, text) in files.iter() {
		if name == "chat_dir" {
			std::fs::create_dir(lab.chats.join(name)).unwrap();
		} else {
			fsx::write_text_atomic(&lab.chats.join(name), s(text)).unwrap();
		}
	}
	for read in arr(&case["reads"]) {
		same(&lab.store.get_chat(s(&read["id"])).unwrap_or(Json::Null), &read["chat"], &format!("get_chat {}", read["id"].as_str().unwrap()));
	}
	same(&lab.store.list_chats().into_iter().collect(), &case["list"], "list");
	for (i, after) in arr(&case["afterSteps"]).iter().enumerate() {
		let what = format!("step {i} {}", stringify(&after["step"]));
		let got = outcome(run(&lab.store, &after["step"]));
		let want: gs_json::Obj = ["ok", "error"].iter().filter_map(|k| after.get(k).map(|v| ((*k).to_owned(), v.clone()))).collect();
		same(&got, &Json::Obj(want), &what);
		same(&bytes_of(&lab.chats), &after["files"], &format!("{what}: files"));
		same(&lab.store.list_chats().into_iter().collect(), &after["list"], &format!("{what}: list"));
	}
}

/// `maskCreated` in the Node recorder.
fn mask_created(text: &str) -> String {
	let ids = Re::new(r"chat_[0-9a-z]+_[0-9a-f]{8}", "g").replace(text, "<id>");
	Re::new(r"\d{4}-\d\d-\d\dT[\d:.]+Z", "g").replace(&ids, "<time>")
}

#[test]
fn created_lessons_match_node() {
	let lab = Lab::new();
	let made = [
		lab.store.create_chat("  Limits  ", None, Some("cls_1"), Some("")),
		lab.store.create_chat("", None, None, Some("deadline_1")),
		lab.store.create_chat("Quick chat", Some("talk"), None, None),
		lab.store.create_chat("Study", Some("study"), Some("cls_2"), Some("d2")),
	];
	let want = golden("created lessons");
	for (chat, want) in made.iter().zip(arr(&want)) {
		let chat = chat.as_ref().unwrap();
		same(&parse(&mask_created(&stringify(chat))).unwrap(), &want["masked"], "record");
		same(&chat.as_obj().unwrap().keys().map(|k| Json::from(k.as_str())).collect(), &want["keys"], "key order");
		let text = std::fs::read_to_string(lab.chats.join(format!("{}.json", s(&chat["id"])))).unwrap();
		assert_eq!(mask_created(&text), s(&want["text"]));
	}
}

fn copy_seed(seed: &Path, to: &Path) {
	for entry in std::fs::read_dir(seed).unwrap().flatten() {
		assert!(entry.file_type().unwrap().is_file(), "seed copy holds a folder: {:?}", entry.file_name());
		std::fs::copy(entry.path(), to.join(entry.file_name())).unwrap();
	}
}

#[test]
fn seed_chats_match_node() {
	let seed = std::env::var_os("GODSPEED_SEED_CHATS").map_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../rewrite-lab/seed-data/chats"), PathBuf::from);
	let lab_file = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/golden/chats-seed.lab.json");
	if !seed.is_dir() || !lab_file.is_file() {
		eprintln!("skipped: no seed copy of the lessons at {} or no {}", seed.display(), lab_file.display());
		return;
	}
	let want = golden_in("chats-seed.lab.json", "seed chats");
	if want.is_null() {
		eprintln!("skipped: chats-seed.lab.json was made without the seed copy");
		return;
	}
	let lab = Lab::new();
	copy_seed(&seed, &lab.chats);
	let sha = |path: &Path| {
		let bytes = std::fs::read(path).unwrap();
		json!({ "sha": sha256_hex(&bytes), "length": bytes.len() })
	};
	let files = arr(&want["files"]);
	assert_eq!(files.len() as f64, want["count"].as_f64().unwrap());
	for file in files {
		let id = s(&file["id"]);
		let path = lab.chats.join(format!("{id}.json"));
		let original = std::fs::read(&path).unwrap();
		assert_eq!(sha256_hex(&original), s(&file["before"]), "{id}: copy");
		let text = String::from_utf8(original).unwrap();
		let round = gs_json::stringify_pretty(&parse(&text).unwrap(), "\t");
		assert_eq!(round == text, file["roundTrips"].truthy(), "{id}: tab-indented round trip");
		let record = lab.store.get_chat(id).map(|r| Json::from(sha256_text(&stringify(&r))));
		same(&record.unwrap_or(Json::Null), &file["record"], &format!("{id}: record"));
		let edits: [Box<dyn Fn() -> Result<(), String>>; 5] = [
			Box::new(|| lab.store.rename_chat(id, "Golden title").map(drop)),
			Box::new(|| lab.store.append_turn_usage(id, &json!({ "id": "golden-turn" }))),
			Box::new(|| lab.store.append_extraction_usage(id, &json!({ "startedAt": "golden-run" }))),
			Box::new(|| lab.store.save_tree(id, &json!({ "nodes": [] }))),
			Box::new(|| lab.store.set_chat_space(id, Some("cls_golden")).map(drop)),
		];
		for (i, edit) in edits.iter().enumerate() {
			edit().unwrap();
			same(&sha(&path), &file["steps"][i], &format!("{id}: edit {i}"));
		}
	}

	let fresh = Lab::new();
	copy_seed(&seed, &fresh.chats);
	let list = fresh.store.list_chats();
	let want_list = arr(&want["list"]);
	assert_eq!(list.len(), want_list.len(), "list length");
	for (got, want) in list.iter().zip(want_list) {
		let id = s(&want["id"]);
		assert_eq!(s(&got["id"]), id, "list order");
		assert_eq!(sha256_text(&stringify(got)), s(&want["sha"]), "{id}: summary");
		for field in ["phase", "messageCount", "pendingQuestion", "pendingProblem", "kind"] {
			same(&got[field], &want[field], &format!("{id}: {field}"));
		}
	}
}
