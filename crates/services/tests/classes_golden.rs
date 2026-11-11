//! Parity with the TypeScript for classes (tests/golden/classes.json, made by
//! classes.golden.ts from three synthetic classes): source ids, folder names, the class card, the
//! list_classes and read_class tools, and the shortcuts a sync makes, keeps and clears.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::{fsx, ids};
use gs_core::classes::class_tools::ToolOutcome;
use gs_json::{Json, json, parse, stringify, stringify_pretty};
use gs_services::App;
use gs_services::classes::class_actions::{SendFirstMessage, class_actions, folder_name};
use gs_services::classes::class_card::class_card_for;
use gs_services::classes::class_shortcuts::sync_shortcuts_safely;
use gs_services::classes::source_id_for;

fn golden() -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/classes.json")).unwrap()).unwrap();
	let case = &all.as_arr().unwrap()[0];
	assert!(case.get("error").is_none(), "the golden case failed in TypeScript: {:?}", case.get("error"));
	case["output"].clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

/// An app over a fresh folder holding the case's class records and files.
fn app_with(before: &Json) -> (Arc<App>, PathBuf) {
	let root = std::env::temp_dir().join(format!("gs-classes-golden-{}", ids::uuid()));
	let data = root.join("data");
	for record in before["records"].as_arr().unwrap() {
		let text = format!("{}\n", stringify_pretty(record, "\t")).replace("<root>", &root.to_string_lossy());
		let at = data.join("classes").join(s(&record["id"])).join("class.json");
		std::fs::create_dir_all(at.parent().unwrap()).unwrap();
		fsx::write_text_atomic(&at, &text).unwrap();
	}
	for pair in before["files"].as_arr().unwrap() {
		let at = root.join(s(&pair[0]));
		std::fs::create_dir_all(at.parent().unwrap()).unwrap();
		fsx::write_text_atomic(&at, s(&pair[1])).unwrap();
	}
	(App::new(Paths::new(data, root.join("home"), root.join("tmp"), root.clone())), root)
}

fn mask(v: &Json, root: &Path) -> Json {
	parse(&stringify(v).replace(&*root.to_string_lossy(), "<root>")).unwrap()
}

fn outcome(o: ToolOutcome) -> Json {
	match o {
		ToolOutcome::Ok { value, changes } => {
			json!({ "ok": true, "value": value, "changes": Json::Arr(changes.into_iter().map(|c| json!({ "label": c.label, "page": c.page })).collect()) })
		}
		ToolOutcome::Err(error) => json!({ "ok": false, "error": error }),
	}
}

/// Everything under `dir`, sorted by path: folders, links (with targets) and files (with text).
fn tree(dir: &Path, root: &Path) -> Json {
	fn walk(dir: &Path, at: &Path, out: &mut Vec<Json>) {
		for entry in std::fs::read_dir(at).unwrap().flatten() {
			let p = entry.path();
			let rel = p.strip_prefix(dir).unwrap().to_string_lossy().into_owned();
			let meta = std::fs::symlink_metadata(&p).unwrap();
			if meta.file_type().is_symlink() {
				out.push(json!({ "path": rel, "type": "link", "target": std::fs::read_link(&p).unwrap().to_string_lossy().into_owned() }));
			} else if meta.is_dir() {
				out.push(json!({ "path": rel, "type": "dir" }));
				walk(dir, &p, out);
			} else {
				out.push(json!({ "path": rel, "type": "file", "text": std::fs::read_to_string(&p).unwrap() }));
			}
		}
	}
	let mut out = Vec::new();
	if dir.exists() {
		walk(dir, dir, &mut out);
	}
	sorted(&mask(&Json::Arr(out), root))
}

fn sorted(entries: &Json) -> Json {
	let mut list = entries.as_arr().unwrap().clone();
	list.sort_by(|a, b| s(&a["path"]).cmp(s(&b["path"])));
	Json::Arr(list)
}

#[test]
fn ids_and_folder_names_match_node() {
	let out = golden();
	for c in out["sourceIds"].as_arr().unwrap() {
		assert_eq!(source_id_for(s(&c[0]), s(&c[1])), s(&c[2]));
	}
	for c in out["folderNames"].as_arr().unwrap() {
		assert_eq!(folder_name(c[0].as_str()), s(&c[1]), "{:?}", c[0]);
	}
}

#[tokio::test]
async fn cards_and_tools_match_node() {
	let out = golden();
	let (app, root) = app_with(&out["before"]);
	let cards: Vec<Json> = ["cls_golden_a", "cls_golden_b", "cls_golden_c"].iter().map(|id| class_card_for(&app, &app.stores.classes.get_class(id).unwrap()).unwrap()).collect();
	assert_eq!(stringify(&mask(&Json::Arr(cards), &root)), stringify(&out["cards"]));

	let send: SendFirstMessage = Arc::new(|_, _| Box::pin(async { Ok(()) }));
	let actions = class_actions(&app, None, send, false);
	// "today" is the wall clock's minute, so only its shape is compared.
	let read = |key: &str, class_id: &str| {
		let Json::Obj(mut outcome) = outcome(actions.read_class(&json!({ "class_id": class_id }))) else { unreachable!() };
		if let Some(Json::Obj(value)) = outcome.get_mut("value") {
			let today = value.get("today").and_then(Json::as_str).unwrap().to_owned();
			assert_eq!(today.len(), "2026-01-05 10:00".len(), "{today}");
			value.insert("today", out["tools"][key]["value"]["today"].clone());
		}
		Json::Obj(outcome)
	};
	let tools = json!({
		"list": outcome(actions.list_classes(&json!({}))),
		"readA": read("readA", "cls_golden_a"),
		"readC": read("readC", "cls_golden_c"),
		"readMissing": read("readMissing", "cls_missing"),
	});
	assert_eq!(stringify(&mask(&tools, &root)), stringify(&out["tools"]));
	let _ = std::fs::remove_dir_all(root);
}

#[test]
fn shortcuts_match_node() {
	let out = golden();
	let (app, root) = app_with(&out["before"]);
	let steps = out["shortcuts"].as_arr().unwrap();
	let folder = root.join("gs");

	sync_shortcuts_safely(&app, &folder, false);
	assert_eq!(stringify(&tree(&folder, &root)), stringify(&sorted(&steps[0]["tree"])), "first sync");
	for copy in steps[0]["copies"].as_arr().unwrap() {
		let mode = std::fs::metadata(root.join(s(&copy["path"]))).unwrap().permissions().mode();
		assert_eq!(mode & 0o222 != 0, copy["writable"].as_bool().unwrap(), "{}", s(&copy["path"]));
	}

	std::fs::remove_file(root.join("linked/la/week1/notes.md")).unwrap();
	fsx::write_text_atomic(&folder.join("classes").join("mine.txt"), "the learner's own file\n").unwrap();
	sync_shortcuts_safely(&app, &folder, false);
	assert_eq!(stringify(&tree(&folder, &root)), stringify(&sorted(&steps[1]["tree"])), "after a file went");

	sync_shortcuts_safely(&app, &folder, true);
	assert_eq!(stringify(&tree(&folder, &root)), stringify(&sorted(&steps[2]["tree"])), "cleared");
	let _ = std::fs::remove_dir_all(root);
}
