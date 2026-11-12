//! Parity with Node for the record rules (tests/golden/records.json, made by scripts/golden.ts
//! from records.golden.ts in America/Los_Angeles and en-US). Outputs are compared as JSON text,
//! so key order and number text have to match too.

use gs_core::records::agent_notes::{clean_note_text, parse_agent_notes};
use gs_core::records::agent_rules::{parse_saved_rules, parse_where, rule_for, same_where, where_label};
use gs_core::records::agent_seen::{SeenMark, parse_agent_seen, seen_mark, with_seen};
use gs_core::records::changelog::{changelog, compare_versions, entries_since, entry_for, is_version};
use gs_core::records::prompt_segments::is_valid_segment_path;
use gs_core::records::settings::{is_hex_color, sanitize_teacher_name, sanitize_user_settings};
use gs_core::records::settings_resolution::{graph_tools_enabled, resolve_settings};
use gs_core::records::teaching_areas::{learner_rules_section, one_line, sanitize_area_rules, sanitize_rules};
use gs_json::{Json, json, parse, stringify};

fn case(name: &str) -> Json {
	let file = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/records.json");
	let all = parse(&std::fs::read_to_string(file).unwrap()).unwrap();
	all.as_arr().unwrap().iter().find(|c| c["name"].as_str() == Some(name)).unwrap_or_else(|| panic!("no golden case {name}"))["output"].clone()
}

fn same(label: &str, got: &Json, want: &Json) {
	assert_eq!(stringify(got), stringify(want), "{label}");
}

fn strings(list: &[String]) -> Json {
	Json::from(list.to_vec())
}

fn rows(name: &str) -> Vec<Json> {
	case(name).as_arr().unwrap().clone()
}

#[test]
fn settings_match_node() {
	for row in rows("sanitizeUserSettings") {
		let got = sanitize_user_settings(&row["input"]).unwrap_or(Json::Null);
		same(&stringify(&row["input"]), &got, &row["output"]);
	}
}

#[test]
fn resolved_settings_match_node() {
	for row in rows("resolveSettings") {
		let got = resolve_settings(Some(&row["input"]).filter(|i| !i.is_null()));
		same(&stringify(&row["input"]), &got, &row["output"]);
		assert_eq!(graph_tools_enabled(&got), row["graphTools"].as_bool().unwrap());
	}
	for row in rows("resolveSettings of sanitized") {
		let record = sanitize_user_settings(&row["input"]);
		let got = resolve_settings(record.as_ref());
		same(&stringify(&row["input"]), &got, &row["output"]);
		assert_eq!(graph_tools_enabled(&got), row["graphTools"].as_bool().unwrap());
	}
}

#[test]
fn names_colors_and_rules_match_node() {
	let both = case("teacher names and colors");
	for row in both["names"].as_arr().unwrap() {
		assert_eq!(sanitize_teacher_name(row["input"].as_str().unwrap()), row["output"].as_str().unwrap(), "{}", stringify(&row["input"]));
	}
	for row in both["colors"].as_arr().unwrap() {
		assert_eq!(is_hex_color(row["input"].as_str().unwrap()), row["output"].as_bool().unwrap(), "{}", stringify(&row["input"]));
	}
	for row in rows("oneLine") {
		let got = one_line(row["input"].as_str().unwrap(), row["max"].as_i64().unwrap() as usize);
		assert_eq!(got, row["output"].as_str().unwrap(), "{} {}", stringify(&row["input"]), stringify(&row["max"]));
	}
	for row in rows("sanitizeRules") {
		same(&stringify(&row["input"]), &strings(&sanitize_rules(&row["input"])), &row["output"]);
	}
	for row in rows("sanitizeAreaRules") {
		same(&stringify(&row["input"]), &sanitize_area_rules(&row["input"]), &row["output"]);
	}
}

#[test]
fn learner_rules_section_matches_node() {
	for row in rows("learnerRulesSection") {
		let space = &row["lessonSpace"];
		let space_rules: Vec<String> = space["rules"].as_arr().into_iter().flatten().map(|r| r.as_str().unwrap().to_owned()).collect();
		let lesson_space = space.as_obj().map(|_| (space["name"].as_str().unwrap(), space_rules.as_slice()));
		assert_eq!(learner_rules_section(&row["rules"], lesson_space), row["output"].as_str().unwrap(), "{}", stringify(&row["rules"]));
	}
}

#[test]
fn agent_notes_match_node() {
	let both = case("agent notes");
	for row in both["parsed"].as_arr().unwrap() {
		same(&stringify(&row["input"]), &Json::from(parse_agent_notes(&row["input"])), &row["output"]);
	}
	for row in both["cleaned"].as_arr().unwrap() {
		same(&stringify(&row["input"]), &Json::from(clean_note_text(row["input"].as_str().unwrap())), &row["output"]);
	}
}

#[test]
fn agent_rules_match_node() {
	let all = case("agent rules");
	let mut wheres: Vec<Option<Json>> = Vec::new();
	for row in all["where"].as_arr().unwrap() {
		let got = parse_where(&row["input"]);
		same(&stringify(&row["input"]), &Json::from(got.clone()), &row["output"]);
		wheres.push(got);
	}
	for row in all["same"].as_arr().unwrap() {
		let (a, b) = (row["a"].as_i64().unwrap() as usize, row["b"].as_i64().unwrap() as usize);
		assert_eq!(same_where(wheres[a].as_ref().unwrap(), wheres[b].as_ref().unwrap()), row["output"].as_bool().unwrap(), "{a} {b}");
	}
	for row in all["labels"].as_arr().unwrap() {
		let name = row["name"].as_str();
		assert_eq!(rule_for(&row["where"], name), row["ruleFor"].as_str().unwrap());
		assert_eq!(where_label(&row["where"], name), row["whereLabel"].as_str().unwrap());
	}
	for row in all["saved"].as_arr().unwrap() {
		same(&stringify(&row["input"]), &Json::from(parse_saved_rules(&row["input"])), &row["output"]);
	}
}

#[test]
fn agent_seen_matches_node() {
	let all = case("agent seen");
	for row in all["parsed"].as_arr().unwrap() {
		same(&stringify(&row["input"]), &parse_agent_seen(&row["input"]), &row["output"]);
	}
	let prints: Vec<String> = ["a", "b", "c", "😀", "", "x\u{0}y"].map(String::from).to_vec();
	for row in all["marks"].as_arr().unwrap() {
		let mark = seen_mark(&prints[..row["n"].as_i64().unwrap() as usize]);
		same("mark", &json!({ "count": mark.count, "hash": mark.hash.as_str() }), &row["output"]);
	}
	let mut file = parse_agent_seen(&Json::Null);
	for (i, step) in all["steps"].as_arr().unwrap().iter().enumerate() {
		let conversation = if i % 3 == 0 { "chat".to_owned() } else { format!("chat{i}") };
		let mark = SeenMark { count: i, hash: format!("h{i}") };
		file = with_seen(&file, &format!("agent{}", i % 23), &conversation, &mark, &format!("2026-01-{:02}T00:00:00.000Z", (i % 28) + 1));
		same(&format!("step {i}"), &file, step);
	}
	let mark = SeenMark { count: 1, hash: "h".into() };
	let ties = with_seen(&with_seen(&parse_agent_seen(&Json::Null), "x", "c", &mark, "T"), "y", "c", &mark, "T");
	same("ties", &ties, &all["ties"]);
	let start = parse_agent_seen(&json!({ "agents": { "Zed": { "at": "b", "conversations": {} }, "apple": { "at": "B", "conversations": {} }, "mid": { "at": "a", "conversations": {} } } }));
	let mixed = with_seen(&start, "new", "c", &SeenMark { count: 2, hash: "q".into() }, "A");
	same("mixed", &mixed, &all["mixed"]);
}

#[test]
fn segment_paths_match_node() {
	for row in rows("segment paths") {
		assert_eq!(is_valid_segment_path(row["input"].as_str().unwrap()), row["output"].as_bool().unwrap(), "{}", stringify(&row["input"]));
	}
}

#[test]
fn changelog_matches_node() {
	let all = case("changelog");
	for row in all["isVersion"].as_arr().unwrap() {
		assert_eq!(is_version(&row["input"]), row["output"].as_bool().unwrap(), "{}", stringify(&row["input"]));
	}
	for row in all["compare"].as_arr().unwrap() {
		let got = compare_versions(row["a"].as_str().unwrap(), row["b"].as_str().unwrap());
		same(&format!("{} vs {}", stringify(&row["a"]), stringify(&row["b"])), &Json::from(got), &row["output"]);
	}
	let small = vec![
		json!({ "version": "0.5.2", "date": "d", "changes": [] }),
		json!({ "version": "0.5.10", "date": "d", "changes": [] }),
		json!({ "version": "0.4.0", "date": "d", "changes": [] }),
		json!({ "version": "bad", "date": "d", "changes": [] }),
	];
	let versions = |entries: Vec<Json>| Json::from(entries.iter().map(|e| e["version"].clone()).collect::<Vec<_>>());
	for row in all["since"].as_arr().unwrap() {
		let (since, current) = (row["since"].as_str().unwrap(), row["current"].as_str().unwrap());
		same(&format!("since {since} {current}"), &versions(entries_since(since, current, changelog())), &row["output"]);
		same(&format!("small since {since} {current}"), &versions(entries_since(since, current, &small)), &row["small"]);
	}
	for row in all["entry"].as_arr().unwrap() {
		let version = row["version"].as_str().unwrap();
		let date = entry_for(version, changelog()).map(|e| e["date"].clone());
		same(version, &Json::from(date), &row["output"]);
		same(version, &Json::from(entry_for(version, &small)), &row["small"]);
	}
	assert_eq!(changelog().len() as i64, all["length"].as_i64().unwrap());
	same("first", &changelog()[0], &all["first"]);
	same("last", &changelog()[changelog().len() - 1], &all["last"]);
}
