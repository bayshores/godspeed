//! Parity with Node for the space rules (tests/golden/spaces.json, made by scripts/golden.ts
//! from spaces.golden.ts in America/Los_Angeles and en-US). Every case lists the inputs beside
//! the output, so each test feeds the Rust function the same inputs and prints its answer as JSON.

use std::collections::{HashMap, HashSet};

use gs_base::time;
use gs_core::spaces::agent_briefing::{BriefingSpace, BriefingInput, BriefingLesson, agent_briefing};
use gs_core::spaces::agent_folder::{FolderAgent, Platform, claude_settings, copy_command, mcp_json, short_folder, start_script, start_script_path, usable_folder};
use gs_core::spaces::space_setup::{SETUP_HOW, missing_setup};
use gs_core::spaces::space_shortcuts::{space_dirs, readme_text, safe_entry_name, shortcut_layout, unique_name};
use gs_core::spaces::space_tools::{SPACE_ARG_TEXT, SPACE_TOOL_TEXT, DEADLINE_KINDS, FILE_KINDS, lesson_started_last_turn};
use gs_core::spaces::deadline_requests::{UnlinkedDeadline, asked_deadline_ids, coverage_request, talk_quiet, unlinked_deadlines};
use gs_core::spaces::file_groups::{file_groups, pair_series};
use gs_core::spaces::file_series::{date_in_name, group_file_series};
use gs_core::spaces::lecture_transcript::{recordings_to_recheck, transcript_for};
use gs_core::spaces::linked_folder::{folder_name, folder_source, is_google_drive_folder};
use gs_core::spaces::new_files::{is_recent, is_recent_change, kinds_for_new_files};
use gs_core::spaces::old_setup::{without_json_entry, without_old_codex_server};
use gs_core::spaces::today_note::{clock_label, day_label, deadline_part_of, local_day, time_zone_label, today_note_text, today_note_to_append, wall_clock, when_label};
use gs_json::{Json, json, parse, stringify};

fn case(name: &str) -> Vec<Json> {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/spaces.json")).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap_or_else(|| panic!("no golden case {name}"));
	assert!(found.get("error").is_none(), "{name}: {:?}", found["error"]);
	match &found["output"] {
		Json::Arr(items) => items.clone(),
		single => vec![single.clone()],
	}
}

fn one(name: &str) -> Json {
	case(name).remove(0)
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

fn list(v: &Json) -> &[Json] {
	v.as_arr().unwrap()
}

fn strings(v: &Json) -> Vec<String> {
	list(v).iter().map(|x| s(x).to_owned()).collect()
}

fn opt(x: Option<String>) -> Json {
	x.map_or(Json::Null, Json::from)
}

fn same(got: &Json, want: &Json, context: &str) {
	assert_eq!(stringify(got), stringify(want), "{context}");
}

fn position(files: &[Json], file: &Json) -> usize {
	files.iter().position(|f| std::ptr::eq(f, file)).unwrap()
}

fn ms(iso: &str) -> i64 {
	time::parse_date(iso).unwrap()
}

#[test]
fn dates_in_names_match_node() {
	for c in case("date in name") {
		assert_eq!(date_in_name(s(&c["name"])), c["output"].as_str().map(str::to_owned), "{}", s(&c["name"]));
	}
}

#[test]
fn file_series_match_node() {
	for c in case("file series") {
		let files = list(&c["files"]);
		let (series, other) = group_file_series(files);
		let got = json!({
			"series": series.iter().map(|s| json!({
				"key": s.key,
				"label": s.label,
				"items": s.items.iter().map(|i| json!({ "number": i.number, "files": i.files, "date": i.date })).collect::<Vec<_>>(),
			})).collect::<Vec<_>>(),
			"other": other,
		});
		let want = json!({ "series": c["series"], "other": c["other"] });
		same(&got, &want, s(&c["set"]));
	}
}

#[test]
fn file_groups_match_node() {
	for c in case("file groups") {
		let files = list(&c["files"]);
		let (series, _) = group_file_series(files);
		let mut pairs: Vec<(usize, usize)> = pair_series(files, &series).into_iter().collect();
		pairs.sort_unstable();
		let groups: Vec<Json> = file_groups(files)
			.iter()
			.map(|g| {
				let items: Vec<Json> = g
					.items
					.iter()
					.map(|i| json!({ "key": i.key, "label": i.label, "date": i.date, "files": i.files.iter().map(|f| position(files, f)).collect::<Vec<_>>() }))
					.collect();
				json!({ "key": g.key, "label": g.label, "count": g.count, "items": items })
			})
			.collect();
		let got = json!({ "pairs": pairs.iter().map(|(t, n)| json!([t, n])).collect::<Vec<_>>(), "groups": groups });
		let want = json!({ "pairs": c["pairs"], "groups": c["groups"] });
		same(&got, &want, s(&c["set"]));
	}
}

#[test]
fn lecture_transcripts_match_node() {
	for c in case("lecture transcripts") {
		let files = list(&c["files"]);
		let got: Vec<i64> = files.iter().map(|f| transcript_for(f, files).map_or(-1, |t| position(files, t) as i64)).collect();
		assert_eq!(Json::from(got.iter().map(|&n| Json::from(n)).collect::<Vec<_>>()), c["transcripts"], "{}", s(&c["set"]));
		assert_eq!(recordings_to_recheck(files), strings(&c["recheck"]), "{}", s(&c["set"]));
	}
}

#[test]
fn recent_times_match_node() {
	for c in case("recent times") {
		let now = c["now"].as_i64().unwrap();
		let at = s(&c["at"]);
		let flag = |key: &str| c[key].as_bool().unwrap();
		assert_eq!(is_recent(Some(at), now), flag("recent"), "{at:?}");
		assert_eq!(is_recent_change(at, now), flag("change"), "{at:?}");
		assert_eq!(is_recent(None, now), flag("noAt"));
	}
}

#[test]
fn kinds_for_new_files_match_node() {
	for c in case("kinds for new files") {
		let got = kinds_for_new_files(list(&c["existing"]), list(&c["added"]));
		let want = c["kinds"].as_obj().unwrap();
		assert_eq!(got.len(), want.len());
		for (id, kind) in want.iter() {
			assert_eq!(got.get(id).map(String::as_str), kind.as_str(), "{id}");
		}
	}
}

#[test]
fn linked_folders_match_node() {
	for c in case("linked folders") {
		let folder = s(&c["folder"]);
		assert_eq!(is_google_drive_folder(folder), c["drive"].as_bool().unwrap(), "{folder:?}");
		assert_eq!(folder_name(folder), s(&c["name"]), "{folder:?}");
		assert_eq!(folder_source(folder), s(&c["source"]), "{folder:?}");
	}
}

#[test]
fn missing_setup_matches_node() {
	let c = one("missing setup");
	assert_eq!(SETUP_HOW, s(&c["how"]));
	for case in list(&c["cases"]) {
		assert_eq!(missing_setup(case), strings(&case["missing"]), "{case:?}");
	}
}

#[test]
fn space_tool_text_matches_node() {
	let c = one("space tool text");
	let tools: Vec<(String, String)> = c["tools"].as_obj().unwrap().iter().map(|(k, v)| (k.clone(), s(v).to_owned())).collect();
	let ours: Vec<(String, String)> = SPACE_TOOL_TEXT.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect();
	assert_eq!(ours, tools);
	let a = &*SPACE_ARG_TEXT;
	let args = [
		("files", a.files),
		("query", a.query),
		("limit", a.limit),
		("passageId", a.passage_id),
		("fileId", a.file_id),
		("range", a.range),
		("name", a.name),
		("description", a.description),
		("signature", &a.signature),
		("icon", &a.icon),
		("filePath", a.file_path),
		("folderPath", a.folder_path),
		("fileKind", a.file_kind),
		("fileIds", a.file_ids),
		("deadlineKind", a.deadline_kind),
		("deadlineName", a.deadline_name),
		("date", a.date),
		("time", a.time),
		("coveredFiles", a.covered_files),
		("leftOutFiles", a.left_out_files),
		("source", a.source),
		("assignmentFile", a.assignment_file),
		("newTime", a.new_time),
		("prepDate", a.prep_date),
		("prepAbout", a.prep_about),
		("prepMock", a.prep_mock),
		("addTopics", a.add_topics),
		("removeTopics", a.remove_topics),
		("topic", a.topic),
		("lessonSpace", a.lesson_space),
	];
	let want: Vec<(String, String)> = c["args"].as_obj().unwrap().iter().map(|(k, v)| (k.clone(), s(v).to_owned())).collect();
	assert_eq!(args.iter().map(|(k, v)| ((*k).to_owned(), (*v).to_owned())).collect::<Vec<_>>(), want);
	assert_eq!(DEADLINE_KINDS.to_vec(), strings(&c["deadlineKinds"]));
	assert_eq!(FILE_KINDS.to_vec(), strings(&c["fileKinds"]));
}

#[test]
fn lesson_started_last_turn_matches_node() {
	for c in case("lesson started last turn") {
		assert_eq!(lesson_started_last_turn(list(&c["messages"])), c["output"].as_str().map(str::to_owned), "{:?}", c["messages"]);
	}
}

#[test]
fn entry_names_match_node() {
	for c in case("safe names") {
		assert_eq!(safe_entry_name(s(&c["name"])), s(&c["output"]), "{:?}", c["name"]);
	}
	for c in case("unique names") {
		let mut taken = HashSet::new();
		let got: Vec<String> = list(&c["names"]).iter().map(|n| unique_name(s(n), &mut taken)).collect();
		assert_eq!(got, strings(&c["output"]), "{:?}", c["names"]);
	}
	for c in case("readme text") {
		assert_eq!(readme_text(&strings(&c["skipped"])), s(&c["output"]));
	}
}

#[test]
fn shortcut_layout_matches_node() {
	let c = one("shortcut layout");
	let spaces = list(&c["spaces"]);
	let dirs: HashMap<String, Vec<String>> = space_dirs(spaces);
	let want = c["dirs"].as_obj().unwrap();
	assert_eq!(dirs.len(), want.len());
	for (id, path) in want.iter() {
		assert_eq!(dirs[id], strings(path), "{id}");
	}
	let got: Vec<Json> = shortcut_layout(spaces).iter().map(|sc| json!({ "at": sc.at, "fileId": sc.file_id })).collect();
	same(&Json::Arr(got), &c["layout"], "layout");
}

#[test]
fn agent_folder_text_matches_node() {
	for c in case("agent folder text") {
		let folder = s(&c["folder"]);
		assert_eq!(usable_folder(folder), c["usable"].as_bool().unwrap(), "{folder:?}");
		let short = [short_folder(folder, "/Users/a"), short_folder("/Users/a", "/Users/a"), short_folder("/Users/ab/x", "/Users/a")];
		assert_eq!(short.to_vec(), strings(&c["short"]), "{folder:?}");
		if c["platforms"].is_null() {
			continue;
		}
		for (name, platform) in [("darwin", Platform::Darwin), ("win32", Platform::Win32), ("linux", Platform::Linux)] {
			let want = &c["platforms"][name];
			assert_eq!(mcp_json(folder, platform), s(&want["mcp"]), "{folder:?} {name} mcp");
			assert_eq!(claude_settings(folder, platform), s(&want["settings"]), "{folder:?} {name} settings");
			for (agent_name, agent) in [("claude", FolderAgent::Claude), ("codex", FolderAgent::Codex)] {
				let w = &want["agents"][agent_name];
				assert_eq!(start_script_path(folder, agent, platform), s(&w["path"]), "{folder:?} {name} {agent_name} path");
				assert_eq!(copy_command(agent, folder, "/Users/a", platform), s(&w["copy"]), "{folder:?} {name} {agent_name} copy");
				assert_eq!(start_script(agent, folder, platform), s(&w["script"]), "{folder:?} {name} {agent_name} script");
			}
		}
	}
}

#[test]
fn old_setup_matches_node() {
	let c = one("old setup");
	for t in list(&c["toml"]) {
		assert_eq!(opt(without_old_codex_server(s(&t["toml"]))), t["output"], "{:?}", t["toml"]);
	}
	for t in list(&c["json"]) {
		let keys = strings(&t["keys"]);
		let keys: Vec<&str> = keys.iter().map(String::as_str).collect();
		assert_eq!(opt(without_json_entry(s(&t["text"]), &keys)), t["output"], "{:?}", t["text"]);
	}
}

#[test]
fn time_labels_match_node() {
	let c = one("time labels");
	for i in list(&c["instants"]) {
		let at = ms(s(&i["iso"]));
		let clock = wall_clock(at);
		assert_eq!((clock.day.as_str(), clock.time.as_str()), (s(&i["wall"]["day"]), s(&i["wall"]["time"])), "{}", s(&i["iso"]));
		assert_eq!(time_zone_label(), s(&i["zone"]));
		assert_eq!(local_day(at), s(&i["local"]), "{}", s(&i["iso"]));
	}
	for d in list(&c["days"]) {
		assert_eq!(day_label(s(&d["day"])), s(&d["output"]), "{:?}", d["day"]);
	}
	for t in list(&c["clocks"]) {
		assert_eq!(clock_label(s(&t["time"])), s(&t["output"]), "{:?}", t["time"]);
	}
	for w in list(&c["whens"]) {
		assert_eq!(when_label(&w["deadline"]), s(&w["output"]), "{:?}", w["deadline"]);
	}
	// The zone comes from the computer, so only the zone this test runs in can be compared.
	let own = list(&c["zones"]).iter().find(|z| s(&z["zone"]) == "America/Los_Angeles").unwrap();
	assert_eq!(time_zone_label(), s(&own["label"]));
}

#[test]
fn today_notes_match_node() {
	for c in case("today note") {
		let space = (!c["cls"].is_null()).then(|| &c["cls"]);
		assert_eq!(today_note_text(ms(s(&c["iso"])), space), s(&c["output"]), "{} space {:?}", s(&c["iso"]), c["space"]);
	}
}

#[test]
fn today_note_append_matches_node() {
	for c in case("today note append") {
		let got = today_note_to_append(list(&c["messages"]), s(&c["text"]), s(&c["day"])).map(|mut m| {
			let obj = m.as_obj_mut().unwrap();
			obj.remove("id");
			obj.remove("timestamp");
			m
		});
		let want = (!c["output"].is_null()).then(|| stringify(&c["output"]));
		assert_eq!(got.as_ref().map(stringify), want, "{:?}", c["messages"]);
		assert_eq!(deadline_part_of(s(&c["text"])), s(&c["deadlinePart"]));
	}
}

#[test]
fn briefings_match_node() {
	for c in case("briefing") {
		let spaces = list(&c["spaces"])
			.iter()
			.map(|k| BriefingSpace {
				id: s(&k["id"]).to_owned(),
				name: s(&k["name"]).to_owned(),
				archived: k["archived"].as_bool().unwrap(),
				deadlines: list(&k["deadlines"]).to_vec(),
				missing_setup: strings(&k["missingSetup"]),
			})
			.collect();
		let lessons = list(&c["lessons"])
			.iter()
			.map(|l| BriefingLesson {
				id: s(&l["id"]).to_owned(),
				title: s(&l["title"]).to_owned(),
				space_id: l["spaceId"].as_str().map(str::to_owned),
				updated_at: s(&l["updatedAt"]).to_owned(),
				waiting: l["waiting"].as_bool().unwrap(),
			})
			.collect();
		let input = BriefingInput { now_ms: ms(s(&c["now"])), spaces, lessons, notes: list(&c["notes"]).to_vec(), max_chars: c["maxChars"].as_i64().unwrap() as usize };
		let got = agent_briefing(&input).unwrap_or_else(|err| format!("error: {err}"));
		assert_eq!(got, s(&c["output"]), "now {} max {:?}", s(&c["now"]), c["maxChars"]);
	}
}

fn unlinked(d: &Json) -> UnlinkedDeadline {
	UnlinkedDeadline {
		id: s(&d["id"]).to_owned(),
		name: s(&d["name"]).to_owned(),
		space_name: s(&d["spaceName"]).to_owned(),
		space_id: s(&d["spaceId"]).to_owned(),
		date: s(&d["date"]).to_owned(),
		time: d["time"].as_str().map(str::to_owned),
	}
}

fn unlinked_json(d: &UnlinkedDeadline) -> Json {
	let mut out = json!({ "id": d.id, "name": d.name, "spaceName": d.space_name, "spaceId": d.space_id, "date": d.date });
	if let Some(time) = &d.time {
		out.as_obj_mut().unwrap().insert("time", time.as_str());
	}
	out
}

#[test]
fn deadline_requests_match_node() {
	let c = one("deadline requests");
	for f in list(&c["found"]) {
		let asked: HashSet<String> = strings(&f["asked"]).into_iter().collect();
		let got: Vec<Json> = unlinked_deadlines(list(&c["spaces"]), s(&f["today"]), &asked).iter().map(unlinked_json).collect();
		same(&Json::Arr(got), &f["found"], &format!("asked {:?}", f["asked"]));
	}
	for t in list(&c["talks"]) {
		let talk = (!t["talk"].is_null()).then(|| &t["talk"]);
		assert_eq!(talk_quiet(talk, t["now"].as_i64().unwrap()), t["quiet"].as_bool().unwrap(), "{:?}", t["talk"]);
	}
	for r in list(&c["requests"]) {
		let deadlines: Vec<UnlinkedDeadline> = list(&r["deadlines"]).iter().map(unlinked).collect();
		let mut got = coverage_request(&deadlines);
		let obj = got.as_obj_mut().unwrap();
		obj.remove("id");
		obj.remove("timestamp");
		same(&got, &r["output"], &format!("{} deadlines", deadlines.len()));
	}
	for a in list(&c["asked"]) {
		let mut got: Vec<String> = asked_deadline_ids(list(&a["messages"])).into_iter().collect();
		let mut want = strings(&a["ids"]);
		got.sort();
		want.sort();
		assert_eq!(got, want);
	}
}
