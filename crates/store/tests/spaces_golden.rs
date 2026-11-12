//! Parity with Node for the space store (crates/core/tests/golden/spaces_store.json, made by
//! scripts/golden.ts from spaces_store.golden.ts): the same steps in, the same answers, events
//! and space.json files out. Times and minted ids are masked as the TypeScript masks them: a
//! time to the step that made it, an id to the order it appeared in.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use gs_base::config::Paths;
use gs_base::events::{EventKind, Events};
use gs_base::hash::sha256_text;
use gs_base::locks::Locks;
use gs_base::{clock, fsx, text, time};
use gs_core::contracts::space::{CURRENT_SPACE_VERSION, is_space_color, next_space_color};
use gs_core::spaces::space_record::{read_space_record, summarize};
use gs_json::{Json, Obj, json, parse, stringify, stringify_pretty};
use gs_store::spaces::{SpaceError, SpaceStore};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

const STEP_MS: i64 = 10_000;

fn golden(case: &str) -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../core/tests/golden/spaces_store.json")).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(case)).unwrap_or_else(|| panic!("no golden case {case}"));
	assert!(found.get("error").is_none(), "{case}: {:?}", found["error"]);
	found["output"].clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

/// A fresh data folder, removed when the test ends.
struct Lab {
	root: PathBuf,
	spaces: PathBuf,
	store: SpaceStore,
	events: Events,
}

impl Lab {
	fn new() -> Lab {
		let root = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!("spaces-golden-{}-{}", std::process::id(), COUNTER.fetch_add(1, Ordering::Relaxed)));
		let _ = std::fs::remove_dir_all(&root);
		let paths = Paths::new(root.clone(), root.join("home"), root.join("tmp"), root.join("resources"));
		let events = Events::new();
		let store = SpaceStore::new(&paths, &events, &Locks::new());
		Lab { spaces: paths.spaces, root, store, events }
	}
}

impl Drop for Lab {
	fn drop(&mut self) {
		let _ = std::fs::remove_dir_all(&self.root);
	}
}

/// Aliases (`$A`) become the ids the store made; `$now` becomes the clock's time.
fn resolve(value: &Json, aliases: &HashMap<String, String>) -> Json {
	match value {
		Json::Str(text) if text == "$now" => Json::from(time::iso_now()),
		Json::Str(text) => aliases.get(text).map_or_else(|| value.clone(), |id| Json::from(id.as_str())),
		Json::Arr(items) => items.iter().map(|v| resolve(v, aliases)).collect(),
		Json::Obj(o) => Json::Obj(o.iter().map(|(k, v)| (k.clone(), resolve(v, aliases))).collect::<Obj>()),
		other => other.clone(),
	}
}

/// `2030-01-01T00:00:00.000Z`: 24 bytes of this shape.
fn is_iso_at(b: &[u8]) -> bool {
	b.len() >= 24
		&& b[..24].iter().enumerate().all(|(i, c)| match i {
			4 | 7 => *c == b'-',
			10 => *c == b'T',
			13 | 16 => *c == b':',
			19 => *c == b'.',
			23 => *c == b'Z',
			_ => c.is_ascii_digit(),
		})
}

struct Masks {
	names: Vec<(String, String)>,
	/// Each step's first and last clock reading.
	windows: Vec<(i64, i64)>,
}

impl Masks {
	fn text(&self, value: &str) -> String {
		let mut out = value.to_owned();
		for (real, alias) in &self.names {
			out = out.replace(real.as_str(), alias);
		}
		let mut masked = String::new();
		let mut at = 0;
		while at < out.len() {
			let tail = &out.as_bytes()[at..];
			if is_iso_at(tail) {
				let step = time::parse_date(&out[at..at + 24]).and_then(|ms| self.windows.iter().position(|(from, to)| (*from..=*to).contains(&ms)));
				masked.push_str(&step.map_or_else(|| out[at..at + 24].to_owned(), |k| format!("<t{k}>")));
				at += 24;
			} else {
				let ch = out[at..].chars().next().unwrap();
				masked.push(ch);
				at += ch.len_utf8();
			}
		}
		masked
	}

	fn value(&self, value: &Json) -> Json {
		match value {
			Json::Str(t) => Json::from(self.text(t)),
			Json::Arr(items) => items.iter().map(|v| self.value(v)).collect(),
			Json::Obj(o) => Json::Obj(o.iter().map(|(k, v)| (self.text(k), self.value(v))).collect::<Obj>()),
			other => other.clone(),
		}
	}
}

fn outcome(result: Result<Json, SpaceError>) -> Json {
	match result {
		Ok(v) => json!({ "ok": v }),
		Err(SpaceError::Deadline(e)) => json!({ "error": e.message, "code": e.code }),
		Err(SpaceError::Other(message)) => json!({ "error": message }),
	}
}

fn other(result: Result<Json, String>) -> Json {
	outcome(result.map_err(SpaceError::Other))
}

#[test]
fn the_scenario_matches_node() {
	let want = golden("store scenario");
	let lab = Lab::new();
	let mut rx = lab.events.subscribe();
	let mut aliases: HashMap<String, String> = HashMap::new();
	let mut masks = Masks { names: Vec::new(), windows: Vec::new() };
	let mut counts = [0, 0];
	let store = &lab.store;
	for (k, raw) in want["steps"].as_arr().unwrap().iter().enumerate() {
		let step = resolve(raw, &aliases);
		let first = clock::now_ms();
		let id = step["id"].as_str().unwrap_or("");
		let result = match s(&step["op"]) {
			"list" => outcome(Ok(Json::Arr(store.list_spaces()))),
			"records" => outcome(Ok(Json::Arr(store.list_space_records()))),
			"create" => other(store.create_space(&step["init"])),
			"get" => outcome(Ok(store.get_space(id).unwrap_or(Json::Null))),
			"update" => other(store.update_space(id, &step["patch"])),
			"saveFiles" => other(store.save_files(id, step["files"].as_arr().unwrap().clone(), step["removed"].as_arr().map_or(&[][..], Vec::as_slice))),
			"add" => outcome(store.add_deadline(id, &step["init"])),
			"updateDeadline" => outcome(store.update_deadline(id, s(&step["deadline"]), &step["patch"])),
			"removeDeadline" => other(store.remove_deadline(id, s(&step["deadline"])).map(Json::Bool)),
			"delete" => other(store.delete_space(id).map(Json::Bool)),
			"closeWork" => other(store.close_work(id).map(Json::Bool)),
			"raw" => {
				fsx::write_text_atomic(&lab.spaces.join(s(&step["dir"])).join("space.json"), s(&step["text"])).unwrap();
				outcome(Ok(step["dir"].clone()))
			}
			op => panic!("unknown op {op}"),
		};
		masks.windows.push((first, clock::now_ms()));
		clock::advance(STEP_MS);

		let mut events = 0;
		while let Ok(event) = rx.try_recv() {
			events += i32::from(event.kind == EventKind::SpacesChanged);
		}
		if s(&step["op"]) == "raw" {
			counts[0] += 1;
			masks.names.push((s(&step["dir"]).to_owned(), format!("<cls{}>", counts[0])));
		}
		if let (Some(alias), Some(made)) = (raw["as"].as_str(), result["ok"]["id"].as_str()) {
			let (index, kind) = if s(&step["op"]) == "add" { (1, "ddl") } else { (0, "cls") };
			counts[index] += 1;
			aliases.insert(format!("${alias}"), made.to_owned());
			masks.names.push((made.to_owned(), format!("<{kind}{}>", counts[index])));
		}
		let mut names: Vec<String> = std::fs::read_dir(&lab.spaces).map(|d| d.flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect()).unwrap_or_default();
		names.retain(|n| lab.spaces.join(n).join("space.json").exists());
		let disk: Vec<(String, Json)> = names.iter().map(|n| (n.clone(), Json::from(std::fs::read_to_string(lab.spaces.join(n).join("space.json")).unwrap()))).collect();
		let mut disk = masks.value(&Json::Obj(disk.into_iter().collect::<Obj>()));
		let mut entries: Vec<(String, Json)> = disk.as_obj().unwrap().iter().map(|(k, v)| (k.clone(), v.clone())).collect();
		entries.sort_by(|a, b| a.0.cmp(&b.0));
		disk = Json::Obj(entries.into_iter().collect::<Obj>());
		let got = masks.value(&json!({ "step": k, "op": step["op"], "outcome": result, "events": events, "disk": Json::Null }));
		let mut got = got;
		got.as_obj_mut().unwrap().insert("disk", disk);
		assert_eq!(stringify(&got), stringify(&want["log"][k]), "step {k}: {}", stringify(raw));
	}
}

#[test]
fn the_fixture_spaces_read_and_write_like_node() {
	let want = golden("fixture spaces");
	let now = time::parse_date(s(&want["now"])).unwrap();
	let mut records: Vec<Json> = Vec::new();
	for c in want["spaces"].as_arr().unwrap() {
		let file = format!("{}/../core/tests/fixtures/spaces/{}/space.json", env!("CARGO_MANIFEST_DIR"), s(&c["id"]));
		let fixture = std::fs::read_to_string(file).unwrap();
		assert_eq!(sha256_text(&fixture), s(&c["fixtureSha"]));
		let parsed = parse(&fixture).unwrap();
		let taken: Vec<i64> = records.iter().map(|r| r["color"].as_f64().unwrap() as i64).collect();
		let mut record = read_space_record(&parsed, now, || next_space_color(&taken)).unwrap();
		// The store saves a record it just gave a color, stamped with this build's version.
		if !is_space_color(&parsed["color"]) {
			record.as_obj_mut().unwrap().insert("version", CURRENT_SPACE_VERSION);
		}
		assert_eq!(sha256_text(&stringify(&record)), s(&c["recordSha"]), "{}", s(&c["id"]));
		assert_eq!(record.as_obj().unwrap().keys().cloned().collect::<Vec<_>>(), c["keys"].as_arr().unwrap().iter().map(|k| s(k).to_owned()).collect::<Vec<_>>());
		assert_eq!(record["files"].as_arr().unwrap().len(), c["files"].as_i64().unwrap() as usize);
		assert_eq!(record["removedFiles"].as_arr().map_or(0, Vec::len), c["removedFiles"].as_i64().unwrap() as usize);
		assert_eq!(stringify(&record["deadlines"]), stringify(&c["deadlines"]));
		assert_eq!(stringify(&summarize(&record)), stringify(&c["summary"]));
		let written = stringify_pretty(&record, "\t");
		assert_eq!(sha256_text(&written), s(&c["writtenSha"]));
		assert_eq!(text::len16(&written) as i64, c["writtenLength"].as_i64().unwrap());
		assert_eq!(written == fixture, c["sameAsFixture"].as_bool().unwrap());
		records.push(record);
	}
	records.sort_by(|a, b| b["updatedAt"].as_str().cmp(&a["updatedAt"].as_str()));
	let order: Vec<&str> = records.iter().map(|r| s(&r["id"])).collect();
	assert_eq!(order, want["order"].as_arr().unwrap().iter().map(s).collect::<Vec<_>>());
}
