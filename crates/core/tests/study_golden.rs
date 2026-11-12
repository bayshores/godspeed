//! Parity with Node for the study rules (tests/golden/study.json, made by scripts/golden.ts from
//! study.golden.ts in America/Los_Angeles and en-US). Every case is `{ args, result }`; the args
//! feed the Rust function and its output must print the same JSON as the TypeScript result.

use std::collections::{HashMap, HashSet};

use gs_core::study::cheat_sheet::{self, ParsedSheet};
use gs_core::study::{continue_study, deadline_plan, homework, progress, study};
use gs_json::{Json, json, parse, stringify};

fn golden() -> Vec<Json> {
	let text = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/study.json")).unwrap();
	parse(&text).unwrap().as_arr().unwrap().to_vec()
}

fn find(cases: &[Json], name: &str) -> Json {
	cases.iter().find(|c| c["name"] == Json::from(name)).unwrap_or_else(|| panic!("no case {name}"))["output"].clone()
}

fn list(v: &Json) -> Vec<Json> {
	v.as_arr().unwrap().to_vec()
}

fn each(v: &Json, f: impl Fn(&Json) -> Json) -> Json {
	Json::Arr(v.as_arr().unwrap().iter().map(f).collect())
}

fn strings(v: &Json) -> Vec<String> {
	v.as_arr().unwrap().iter().map(|s| s.as_str().unwrap().to_string()).collect()
}

fn text(v: &Json) -> &str {
	v.as_str().unwrap()
}

fn opt_str(v: &Json) -> Option<&str> {
	v.as_str()
}

fn strs(items: Vec<String>) -> Json {
	Json::Arr(items.into_iter().map(Json::from).collect())
}

fn parsed(v: &Json) -> Option<ParsedSheet> {
	match v {
		Json::Str(s) if s == "newer" => Some(ParsedSheet::Newer),
		Json::Obj(_) => Some(ParsedSheet::Sheet(v.clone())),
		_ => None,
	}
}

fn parsed_json(sheet: Option<ParsedSheet>) -> Json {
	match sheet {
		Some(ParsedSheet::Sheet(s)) => s,
		Some(ParsedSheet::Newer) => Json::from("newer"),
		None => Json::Null,
	}
}

/// The derive input of a derive case: its own, or its base's with the patch laid over it.
fn derive_input(cases: &[Json], args: &Json) -> Json {
	if !args["input"].is_null() {
		return args["input"].clone();
	}
	let mut input = derive_input(cases, &find(cases, text(&args["base"]))["args"]);
	for (k, v) in args["patch"].as_obj().unwrap().iter() {
		input.as_obj_mut().unwrap().insert(k.clone(), v.clone());
	}
	input
}

fn space_order(cases: &[Json], from: &str) -> HashMap<String, usize> {
	let case = find(cases, from);
	let input = derive_input(cases, &case["args"]);
	study::fact_space_order(&list(&case["result"]["facts"]), &list(&input["files"]))
}

fn same(name: &str, got: Json, want: &Json) {
	assert_eq!(stringify(&got), stringify(want), "{name}");
}

fn order_json(order: &HashMap<String, usize>, want: &Json) -> (usize, usize) {
	let want = want.as_obj().unwrap();
	let mut matched = 0;
	for (id, rank) in want.iter() {
		assert_eq!(order.get(id).copied(), rank.as_f64().map(|r| r as usize), "rank of {id}");
		matched += 1;
	}
	(order.len(), matched)
}

fn replay(cases: &[Json], c: &Json) {
	let name = text(&c["name"]);
	let out = &c["output"];
	let (args, want) = (&out["args"], &out["result"]);
	assert!(c["error"].is_null(), "{name}: node threw {:?}", c["error"]);
	let from_progress = |key: &str| list(&find(cases, text(&args["from"]))["result"][key]);

	if name.starts_with("derive ") {
		let mut got = progress::derive_progress(&derive_input(cases, args));
		if args["slim"].truthy() {
			for key in ["facts", "topics", "topicLinks", "files"] {
				got.as_obj_mut().unwrap().remove(key);
			}
		}
		same(name, got, want);
	} else if name.starts_with("collect answers ") {
		same(name, Json::Arr(progress::collect_answers(text(&args["chatId"]), &list(&args["messages"]))), want);
	} else if name == "ramp color and status" {
		let rows = each(&args["rates"], |r| {
			let rate = r.as_f64();
			json!({ "color": progress::ramp_color(rate), "status": progress::topic_status(rate).as_str() })
		});
		same(name, rows, want);
	} else if name == "days between" {
		same(name, each(&args["pairs"], |p| Json::from(progress::days_between(text(&p[0]), text(&p[1])))), want);
	} else if name.starts_with("fact space order ") {
		let order = space_order(cases, text(&args["from"]));
		let (total, matched) = order_json(&order, want);
		assert_eq!(total, matched, "{name}: extra facts ranked");
	} else if name.starts_with("study topics ") {
		let order = space_order(cases, text(&args["from"]));
		let topics = from_progress("topics");
		same(name, Json::Arr(study::study_topics(&strings(&args["factIds"]), &topics, &order, text(&args["freeTopic"]))), want);
	} else if name.starts_with("topic study ") {
		let order = space_order(cases, text(&args["from"]));
		let (topics, facts) = (from_progress("topics"), from_progress("facts"));
		let studied: Option<HashSet<String>> = args["studiedToday"].as_arr().map(|_| strings(&args["studiedToday"]).into_iter().collect());
		same(name, Json::Arr(study::topic_study(&strings(&args["topicIds"]), &topics, &facts, &order, studied.as_ref())), want);
	} else if name.starts_with("deadline study topics ") {
		let topics = if args["from"].is_null() { list(&args["topics"]) } else { from_progress("topics") };
		same(name, strs(study::deadline_study_topic_ids(text(&args["today"]), &args["deadline"], &topics)), want);
	} else if name.starts_with("plan days") {
		same(name, Json::Arr(deadline_plan::plan_days(text(&args["today"]), text(&args["due"]), &list(&args["topics"]))), want);
	} else if name.starts_with("topics to work on") {
		same(name, Json::Arr(deadline_plan::topics_to_work_on(&list(&args["topics"]))), want);
	} else if name == "is latest wrong" {
		same(name, each(&args["pairs"], |p| Json::from(study::is_latest_wrong(text(&p[0]), opt_str(&p[1])))), want);
	} else if name.starts_with("study title") {
		same(name, Json::from(study::study_title(&list(&args["topics"]))), want);
	} else if name == "study context text" {
		same(name, Json::from(study::study_context_text(&list(&args["topics"]))), want);
	} else if name.starts_with("study plan tree") {
		let got = match study::study_plan_tree(&list(&args["topics"])) {
			Ok(tree) => json!({ "tree": tree }),
			Err(error) => json!({ "error": error }),
		};
		same(name, got, want);
	} else if name.starts_with("continue study") {
		let got = continue_study::continue_study_for(text(&args["deadlineId"]), &list(&args["sessions"]));
		same(name, got.unwrap_or(Json::Null), want);
	} else if name == "has problems" {
		same(name, Json::Arr(strings(&args["kinds"]).iter().map(|k| Json::from(homework::has_problems(k))).collect()), want);
	} else if name.starts_with("merge problems") {
		same(name, Json::Arr(homework::merge_problems(&list(&args["previous"]), &list(&args["posted"]))), want);
	} else if name.starts_with("problems done ") {
		same(name, homework::problems_done(&args["problems"]).unwrap_or(Json::Null), want);
	} else if name.starts_with("latest homework ") {
		let got = homework::latest_homework(text(&args["deadlineId"]), &list(&args["sessions"]));
		same(name, got.map_or(Json::Null, Json::from), want);
	} else if name == "conclude marks done" {
		same(name, Json::Arr(list(&args["outcomes"]).iter().map(|o| Json::from(homework::conclude_marks_done(o))).collect()), want);
	} else if name.starts_with("homework context ") {
		same(name, Json::from(homework::homework_context_text(text(&args["spaceId"]), &args["deadline"], &args["assignment"], &list(&args["problems"]))), want);
	} else if name.starts_with("parse cheat sheet ") {
		same(name, parsed_json(cheat_sheet::parse_cheat_sheet(&args["raw"])), want);
	} else if name.starts_with("sheet cards ") {
		let sheets = args["sheets"].clone();
		let running = strings(&args["running"]);
		let cards = cheat_sheet::sheet_cards(&list(&args["deadlines"]), |id| parsed(&sheets[id]), |id| running.iter().any(|r| r == id), text(&args["today"]));
		same(name, Json::Arr(cards), want);
	} else if name.starts_with("sheet mistakes") {
		same(name, Json::Arr(cheat_sheet::sheet_mistakes(&list(&args["answers"]), &strings(&args["topicIds"]))), want);
	} else if name.starts_with("mistake counts") {
		let got = cheat_sheet::mistake_counts(&list(&args["answers"]), &strings(&args["topicIds"]));
		let want_pairs = list(want);
		assert_eq!(got.len(), want_pairs.len(), "{name}");
		for pair in want_pairs {
			assert_eq!(got.get(text(&pair[0])).map(|n| *n as f64), pair[1].as_f64(), "{name}");
		}
	} else if name == "pdf problem" {
		let rows = each(&args["inputs"], |p| {
			let pages = p["pages"].as_arr().map(|a| a.as_slice());
			cheat_sheet::pdf_problem(p["bytes"].as_f64().unwrap() as u64, opt_str(&p["head"]), pages).map_or(Json::Null, Json::from)
		});
		same(name, rows, want);
	} else if name.starts_with("page size label") {
		let label = |w: f64, h: f64, n: usize| cheat_sheet::page_size_label(&vec![json!({ "widthPt": w, "heightPt": h }); n]);
		let sizes = list(&args["sizes"]);
		if sizes.is_empty() {
			same(name, Json::from(cheat_sheet::page_size_label(&[])), want);
		} else {
			let labels = sizes.iter().map(|s| Json::from(label(s[0].as_f64().unwrap(), s[1].as_f64().unwrap(), s[2].as_f64().unwrap() as usize)));
			same(name, Json::Arr(labels.collect()), want);
		}
	} else if name == "sheet folder name" {
		same(name, each(&args["names"], |p| Json::from(cheat_sheet::sheet_folder_name(text(&p[0]), text(&p[1])))), want);
	} else if name.starts_with("newer folder pdf") {
		let files: Vec<(String, f64)> = list(&args["files"]).iter().map(|f| (text(&f["name"]).to_string(), f["mtimeMs"].as_f64().unwrap())).collect();
		same(name, cheat_sheet::newer_folder_pdf(&files, opt_str(&args["at"])).map_or(Json::Null, Json::from), want);
	} else if name == "region problem" {
		let versions = list(&args["versions"]);
		same(name, each(&args["regions"], |r| cheat_sheet::region_problem(r, &versions).map_or(Json::Null, Json::from)), want);
	} else if name == "region text" {
		same(name, each(&args["cases"], |c| Json::from(cheat_sheet::region_text(&c[0], c[1].as_f64().unwrap() as usize))), want);
	} else if name == "new cheat sheet" {
		same(name, cheat_sheet::new_cheat_sheet(text(&args["deadlineId"]), text(&args["now"])), want);
	} else if name.starts_with("current version") {
		same(name, cheat_sheet::current_version(&args["sheet"]).cloned().unwrap_or(Json::Null), want);
	} else if name.starts_with("with message") {
		same(name, cheat_sheet::with_message(&args["sheet"], &args["message"]), want);
	} else if name.starts_with("with rules") || name.starts_with("with too many rules") {
		let (sheet, added) = cheat_sheet::with_rules(&args["sheet"], &strings(&args["texts"]), text(&args["at"]));
		same(name, json!({ "sheet": sheet, "added": strs(added) }), want);
	} else if name.starts_with("without a rule") || name.starts_with("without rule") {
		same(name, cheat_sheet::without_rule(&args["sheet"], text(&args["text"])), want);
	} else if name.starts_with("with version") {
		let (sheet, dropped) = cheat_sheet::with_version(&args["sheet"], &args["version"]);
		same(name, json!({ "sheet": sheet, "dropped": Json::Arr(dropped.into_iter().map(Json::from).collect()) }), want);
	} else if name.starts_with("cheat sheet request ") {
		same(name, Json::from(cheat_sheet::cheat_sheet_request_text(&args["request"])), want);
	} else {
		panic!("no replay for case {name}");
	}
}

#[test]
fn study_rules_match_node() {
	let cases = golden();
	assert!(cases.len() > 150, "only {} cases", cases.len());
	for c in &cases {
		replay(&cases, c);
	}
}
