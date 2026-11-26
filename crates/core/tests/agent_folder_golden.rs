//! Parity with Node for the godspeed folder's names and start commands
//! (tests/golden/agent_folder.json, first recorded from the Node server). Each case lists its
//! inputs beside the output, so each test feeds the Rust function the same inputs.

use gs_core::spaces::agent_folder::{saved_start_commands, short_folder, usable_folder, usable_start_command};
use gs_json::{Json, parse, stringify};

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/agent_folder.json");

fn case(name: &str) -> Json {
	let all = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap_or_else(|| panic!("no golden case {name}"));
	assert!(found.get("error").is_none(), "{name}: {:?}", found["error"]);
	found["output"].clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

#[test]
fn folder_names_match_node() {
	for c in case("agent folder names").as_arr().unwrap() {
		let folder = s(&c["folder"]);
		assert_eq!(usable_folder(folder), c["usable"].as_bool().unwrap(), "{folder:?}");
		let short = [short_folder(folder, "/Users/a"), short_folder("/Users/a", "/Users/a"), short_folder("/Users/ab/x", "/Users/a")];
		let want: Vec<&str> = c["short"].as_arr().unwrap().iter().map(s).collect();
		assert_eq!(short.to_vec(), want, "{folder:?}");
	}
}

#[test]
fn start_commands_match_node() {
	let c = case("start commands");
	for u in c["usable"].as_arr().unwrap() {
		assert_eq!(usable_start_command(s(&u["command"])), u["output"].as_bool().unwrap(), "{:?}", u["command"]);
	}
	for w in c["saved"].as_arr().unwrap() {
		assert_eq!(stringify(&saved_start_commands(&w["raw"]).to_json()), stringify(&w["output"]), "{}", stringify(&w["raw"]));
	}
}
