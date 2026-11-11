//! Parity with the TypeScript for the app package (tests/golden/app-misc.json, made by
//! app-misc.golden.ts over a synthetic class): the settings parsers, the prompt segment list, the
//! activity log, the saved-rules code and the reading view.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gs_base::config::Paths;
use gs_base::hash::sha256_hex;
use gs_base::{fsx, ids, text};
use gs_core::records::agent_rules::parse_where;
use gs_json::{Json, json, parse, stringify};
use gs_services::App;
use gs_services::app::agent_actions::{note_agent_action, recent_agent_actions, record_answer, record_deadline_change, record_folder_files};
use gs_services::app::agent_rules::{RuleFailure, agent_saved_rules, edit_rule, remove_rule, save_rule_by_agent};
use gs_services::app::prompt_segments::{prompt_segments, save_prompt_segment};
use gs_services::app::reading_pages::{ReadingError, reading_document, reading_pdf_page};
use gs_services::app::settings_body::parse_section;

const CLASS: &str = "cls_golden01_00000001";
const GONE: &str = "cls_gone0000_00000000";
const AT: &str = "2029-03-01T10:00:00.000Z";

fn case(name: &str) -> Json {
	let golden = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/app-misc.json")).unwrap()).unwrap();
	golden.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap()["output"].clone()
}

/// An app over fresh data and home folders holding the synthetic class.
fn synthetic_app() -> (Arc<App>, PathBuf) {
	let dir = std::env::temp_dir().join(format!("gs-app-misc-golden-{}", ids::uuid()));
	let (data, home) = (dir.join("data"), dir.join("home"));
	std::fs::create_dir_all(&home).unwrap();
	let class = json!({ "id": CLASS, "name": "Golden Class", "description": "", "createdAt": AT, "updatedAt": AT, "archived": false, "files": [], "removedFiles": [], "deadlines": [], "version": 1 });
	fsx::write_text_atomic(&data.join("classes").join(CLASS).join("class.json"), &format!("{}\n", gs_json::stringify_pretty(&class, "\t"))).unwrap();
	(App::new(Paths::new(data, home, dir.join("tmp"), dir.clone())), dir)
}

fn masked(list: &[Json]) -> Json {
	Json::Arr(
		list.iter()
			.map(|entry| {
				let mut entry = entry.clone();
				let fields = entry.as_obj_mut().unwrap();
				fields.insert("id", "<id>");
				fields.insert("at", "<now>");
				entry
			})
			.collect(),
	)
}

#[test]
fn settings_parsers_match_node() {
	for case in case("settings section bodies").as_arr().unwrap() {
		let (section, body) = (case["section"].as_str().unwrap(), &case["body"]);
		let result = match parse_section(section, body).unwrap() {
			Ok(settings) => json!({ "ok": true, "settings": settings }),
			Err(error) => json!({ "ok": false, "error": error }),
		};
		assert_eq!(stringify(&result), stringify(&case["result"]), "{section} {}", stringify(body));
	}
}

#[test]
fn the_prompt_segment_list_matches_node() {
	let expected = case("prompt segment list");
	let (app, dir) = synthetic_app();
	let listed = prompt_segments(&app);
	let segments: Vec<Json> = listed["segments"]
		.as_arr()
		.unwrap()
		.iter()
		.map(|s| json!({ "path": s["path"], "shared": s["shared"], "sourceSha": sha256_hex(s["sourceText"].as_str().unwrap().as_bytes()) }))
		.collect();
	assert_eq!(stringify(&Json::Arr(segments)), stringify(&expected["segments"]));
	let (_, refused) = save_prompt_segment(&app, "talk/00-base.md", &json!({ "text": "x" })).unwrap();
	assert_eq!(stringify(&refused["supported"]), stringify(&expected["supported"]));
	let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn the_activity_log_matches_node() {
	let expected = case("activity log");
	let (app, dir) = synthetic_app();
	let target = json!({ "kind": "deadline", "id": "ddl_gold00000001" });
	let act = |label: &str, target: &Json, page: &str, removed: bool, open: bool| {
		let mut change = json!({ "label": label, "classId": CLASS, "target": target, "page": page });
		let fields = change.as_obj_mut().unwrap();
		if removed {
			fields.insert("removed", true);
		}
		if open {
			fields.insert("open", true);
		}
		change
	};
	note_agent_action(&app, Some("Claude"), &act("Added Test 2", &target, "/", false, false));
	note_agent_action(&app, Some("Claude"), &act("Added Test 2", &target, "/", false, false));
	note_agent_action(&app, Some("Codex"), &act("Added Test 2", &target, "/", false, false));
	note_agent_action(&app, None, &act("  Wrote   a   lesson\n plan  ", &Json::Null, "/chat", false, false));
	note_agent_action(&app, Some("  "), &act("Removed a file", &Json::Null, "/", true, false));
	note_agent_action(&app, Some("  "), &act("Removed a file", &Json::Null, "/", true, false));
	note_agent_action(&app, Some("Claude"), &act(&"word ".repeat(30), &Json::Null, "/", false, true));
	record_folder_files(&app, CLASS, 1, "Google Drive");
	record_folder_files(&app, CLASS, 2, "Google Drive");
	record_folder_files(&app, CLASS, 1, "a folder");
	let lesson = json!({ "id": "chat_a", "classId": CLASS });
	record_answer(&app, &lesson, &json!({ "kind": "quiz", "correct": true }));
	record_answer(&app, &lesson, &json!({ "kind": "quiz", "correct": false }));
	record_answer(&app, &lesson, &json!({ "kind": "quiz", "correct": true, "dontKnow": true }));
	record_answer(&app, &lesson, &json!({ "kind": "open" }));
	record_answer(&app, &json!({ "id": "chat_b" }), &json!({ "kind": "quiz", "correct": false }));
	let quiz = json!({ "id": "ddl_gold00000002", "name": "Quiz 1" });
	record_deadline_change(&app, CLASS, &quiz, &Json::from("added"));
	record_deadline_change(&app, CLASS, &quiz, &json!({ "date": "2030-01-01", "time": "10:00" }));
	record_deadline_change(&app, CLASS, &quiz, &json!({ "done": true }));
	record_deadline_change(&app, CLASS, &quiz, &json!({ "name": "Quiz one" }));
	let shown = masked(&recent_agent_actions(&app));
	let saved = masked(&app.stores.agent_actions.read_agent_actions());
	assert_eq!(stringify(&shown), stringify(&expected["shown"]));
	assert_eq!(stringify(&saved), stringify(&expected["saved"]));
	let _ = std::fs::remove_dir_all(dir);
}

fn saved_rule(outcome: Result<Json, String>) -> Json {
	match outcome {
		Ok(saved) => saved,
		Err(error) => json!({ "ok": false, "error": error }),
	}
}

fn edited_rule(outcome: Result<Json, RuleFailure>) -> Json {
	let refused = |error: &str, code: Option<&str>| match code {
		Some(code) => json!({ "ok": false, "error": error, "code": code }),
		None => json!({ "ok": false, "error": error }),
	};
	match outcome {
		Ok(edited) => edited,
		Err(RuleFailure::NotFound) => refused("That rule was removed.", Some("not_found")),
		Err(RuleFailure::Conflict) => refused("You already have that rule.", Some("conflict")),
		Err(RuleFailure::Refused(message)) => refused(&message, None),
		Err(RuleFailure::Disk(message)) => panic!("{message}"),
	}
}

#[test]
fn saved_rules_match_node() {
	let expected = case("saved rules");
	let (app, dir) = synthetic_app();
	let place = |raw: Json| parse_where(&raw).unwrap();
	let (voice, mine, missing) = (place(json!({ "area": "voice" })), place(json!({ "classId": CLASS })), place(json!({ "classId": GONE })));
	let marks = |app: &App| masked_marks(&agent_saved_rules(app).unwrap());
	let outcomes = vec![
		saved_rule(save_rule_by_agent(&app, "Be brief", &voice, Some("Claude"))),
		saved_rule(save_rule_by_agent(&app, "Be brief", &voice, None)),
		saved_rule(save_rule_by_agent(&app, "  Use   one\n line ", &voice, None)),
		saved_rule(save_rule_by_agent(&app, "   ", &voice, None)),
		saved_rule(save_rule_by_agent(&app, &"x".repeat(400), &voice, None)),
		saved_rule(save_rule_by_agent(&app, "Show the proof first", &mine, Some("Codex"))),
		saved_rule(save_rule_by_agent(&app, "Anything", &missing, None)),
		marks(&app),
		edited_rule(edit_rule(&app, &voice, "Be brief", "Be very brief")),
		edited_rule(edit_rule(&app, &voice, "Be very brief", "Use one line")),
		edited_rule(edit_rule(&app, &voice, "Not here", "Anything")),
		edited_rule(edit_rule(&app, &missing, "Not here", "Anything")),
		edited_rule(edit_rule(&app, &voice, "Be very brief", " ")),
		Json::from(remove_rule(&app, &mine, "Show the proof first").unwrap()),
		Json::from(remove_rule(&app, &mine, "Show the proof first").unwrap()),
		Json::from(remove_rule(&app, &missing, "x").unwrap()),
		marks(&app),
	];
	let steps = expected["steps"].as_arr().unwrap();
	assert_eq!(outcomes.len(), steps.len());
	for (outcome, step) in outcomes.iter().zip(steps) {
		assert_eq!(stringify(outcome), stringify(&step["outcome"]), "{}", step["op"].as_str().unwrap());
	}
	assert_eq!(stringify(&app.stores.settings.read_settings().unwrap().unwrap()), stringify(&expected["settings"]));
	let _ = std::fs::remove_dir_all(dir);
}

fn masked_marks(list: &[Json]) -> Json {
	Json::Arr(
		list.iter()
			.map(|mark| {
				let mut mark = mark.clone();
				mark.as_obj_mut().unwrap().insert("at", "<now>");
				mark
			})
			.collect(),
	)
}

fn put(home: &Path, name: &str, content: &[u8]) {
	fsx::write_atomic(&home.join(name), content, None).unwrap();
}

fn refused(outcome: ReadingError) -> Json {
	match outcome {
		ReadingError::Refused(status, error) => json!({ "ok": false, "status": status, "error": error }),
		ReadingError::Failed(message) => panic!("{message}"),
	}
}

#[tokio::test]
async fn the_reading_view_matches_node() {
	let expected = case("reading documents");
	let (app, dir) = synthetic_app();
	let (home, data) = (dir.join("home"), dir.join("data"));
	put(&home, "notes/a.txt", b"hello\nworld");
	put(&home, "notes/zero.txt", b"a\0b");
	put(&home, "notes/big.txt", "x".repeat(2 * 1024 * 1024 + 1).as_bytes());
	put(&home, "notes/edge.txt", "x".repeat(2 * 1024 * 1024).as_bytes());
	put(&home, "notes/bytes.txt", &[0x68, 0xff, 0x69]);
	put(&home, ".hidden/a.txt", b"x");
	put(&home, "notes/.dot.txt", b"x");
	put(&home, "notes/empty.txt", b"");
	put(&home, "notes/page.png", b"not a pdf");
	std::fs::create_dir_all(home.join("notes/folder")).unwrap();
	let cases: Vec<(&str, String)> = [
		("text", home.join("notes/a.txt")),
		("with a nul byte", home.join("notes/zero.txt")),
		("over two megabytes", home.join("notes/big.txt")),
		("exactly two megabytes", home.join("notes/edge.txt")),
		("bad utf-8", home.join("notes/bytes.txt")),
		("empty", home.join("notes/empty.txt")),
		("missing", home.join("notes/none.txt")),
		("a folder", home.join("notes/folder")),
		("in a dot folder", home.join(".hidden/a.txt")),
		("a dot file", home.join("notes/.dot.txt")),
		("the home folder", home.clone()),
		("outside home", data.join("agent-actions.json")),
		("a dotted way out", home.join("notes/../../etc/hosts")),
		("a way back in", home.join("notes/../notes/a.txt")),
		("a pdf name on a text file", home.join("notes/page.png")),
	]
	.into_iter()
	.map(|(name, file)| (name, file.to_string_lossy().into_owned()))
	.collect();
	let documents = expected["documents"].as_arr().unwrap();
	assert_eq!(cases.len(), documents.len());
	for ((name, file), want) in cases.iter().zip(documents) {
		assert_eq!(want["name"].as_str(), Some(*name));
		let outcome = match reading_document(&app, file).await {
			Ok(document) if document["kind"].as_str() == Some("text") => {
				let shown = document["text"].as_str().unwrap();
				json!({ "ok": true, "value": { "kind": "text", "textSha": sha256_hex(shown.as_bytes()), "length": text::len16(shown) } })
			}
			Ok(other) => panic!("{name}: {}", stringify(&other)),
			Err(error) => refused(error),
		};
		assert_eq!(stringify(&outcome), stringify(&want["outcome"]), "{name}");
	}
	let not_pdf = reading_pdf_page(&app, &home.join("notes/a.txt").to_string_lossy(), 1).await.unwrap_err();
	let hidden = reading_pdf_page(&app, &home.join(".hidden/a.txt").to_string_lossy(), 1).await.unwrap_err();
	assert_eq!(stringify(&refused(not_pdf)), stringify(&expected["notPdf"]));
	assert_eq!(stringify(&refused(hidden)), stringify(&expected["hiddenPage"]));
	let _ = std::fs::remove_dir_all(dir);
}
