//! Parity with Node for the agent folder's files and commands (tests/golden/agent_folder.json,
//! first recorded from the Node server). Each case lists its inputs beside the output, so each
//! test feeds the Rust function the same inputs. `GS_RECORD_GOLDEN=1 cargo test -p gs-core --test
//! agent_folder_golden` writes the files and commands as they are now.

use gs_core::spaces::agent_folder::{FolderAgent, Platform, claude_settings, copy_command, mcp_json, saved_start_commands, short_folder, start_script, start_script_path, usable_folder, usable_start_command};
use gs_json::{Json, Obj, parse, stringify, stringify_pretty};

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/agent_folder.json");

fn golden() -> Json {
	parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap()
}

fn case(name: &str) -> Json {
	let all = golden();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap_or_else(|| panic!("no golden case {name}"));
	assert!(found.get("error").is_none(), "{name}: {:?}", found["error"]);
	found["output"].clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

const PLATFORMS: [(&str, Platform); 3] = [("darwin", Platform::Darwin), ("win32", Platform::Win32), ("linux", Platform::Linux)];
const AGENTS: [(&str, FolderAgent); 2] = [("claude", FolderAgent::Claude), ("codex", FolderAgent::Codex)];

/// One text per agent, keyed by its name.
fn per_agent(text: impl Fn(FolderAgent) -> String) -> Json {
	let mut out = Obj::new();
	for (name, agent) in AGENTS {
		out.insert(name, text(agent));
	}
	Json::Obj(out)
}

/// A case's files and commands on each platform as the code writes them now, for the start
/// commands the case lists.
fn platforms_now(folder: &str, was: &Json) -> Json {
	let mut out = Obj::new();
	for (name, platform) in PLATFORMS {
		let commands: Vec<Json> = was[name]["commands"]
			.items()
			.iter()
			.map(|w| {
				let commands = saved_start_commands(&w["commands"]);
				let mut row = Obj::new();
				row.insert("commands", w["commands"].clone());
				row.insert("copy", per_agent(|agent| copy_command(agent, folder, "/Users/a", platform, &commands)));
				row.insert("scripts", per_agent(|agent| start_script(agent, folder, platform, &commands)));
				Json::Obj(row)
			})
			.collect();
		let mut files = Obj::new();
		files.insert("mcp", mcp_json(folder, platform));
		files.insert("settings", claude_settings(folder, platform));
		files.insert("paths", per_agent(|agent| start_script_path(folder, agent, platform)));
		files.insert("commands", Json::Arr(commands));
		out.insert(name, Json::Obj(files));
	}
	Json::Obj(out)
}

#[test]
fn agent_folder_text_matches_node() {
	let recording = std::env::var_os("GS_RECORD_GOLDEN").is_some();
	let mut all = golden();
	let cases = all.as_arr_mut().unwrap().iter_mut().find(|c| c["name"] == Json::from("agent folder text")).unwrap();
	for c in cases.as_obj_mut().unwrap().get_mut("output").unwrap().as_arr_mut().unwrap() {
		let folder = s(&c["folder"]).to_owned();
		assert_eq!(usable_folder(&folder), c["usable"].as_bool().unwrap(), "{folder:?}");
		let short = [short_folder(&folder, "/Users/a"), short_folder("/Users/a", "/Users/a"), short_folder("/Users/ab/x", "/Users/a")];
		let want: Vec<&str> = c["short"].as_arr().unwrap().iter().map(s).collect();
		assert_eq!(short.to_vec(), want, "{folder:?}");
		if c["platforms"].is_null() {
			continue;
		}
		let now = platforms_now(&folder, &c["platforms"]);
		if recording {
			c.as_obj_mut().unwrap().insert("platforms", now);
			continue;
		}
		for (name, _) in PLATFORMS {
			for key in ["mcp", "settings", "paths", "commands"] {
				assert_eq!(stringify_pretty(&now[name][key], " "), stringify_pretty(&c["platforms"][name][key], " "), "{folder:?} {name} {key}");
			}
		}
	}
	if recording {
		std::fs::write(GOLDEN, format!("{}\n", stringify_pretty(&all, "\t"))).unwrap();
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
