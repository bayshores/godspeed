//! Parity with Node for the agent folder's files and commands (tests/golden/agent_folder.json,
//! recorded from the Node server). Each case lists its inputs beside the
//! output, so each test feeds the Rust function the same inputs.

use gs_core::spaces::agent_folder::{FolderAgent, Platform, StartTarget, claude_settings, copy_command, mcp_json, saved_start_commands, short_folder, start_script, start_script_path, usable_folder, usable_start_command};
use gs_json::{Json, parse, stringify};

fn case(name: &str) -> Json {
	let all = parse(&std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/agent_folder.json")).unwrap()).unwrap();
	let found = all.as_arr().unwrap().iter().find(|c| c["name"] == Json::from(name)).unwrap_or_else(|| panic!("no golden case {name}"));
	assert!(found.get("error").is_none(), "{name}: {:?}", found["error"]);
	found["output"].clone()
}

fn s(v: &Json) -> &str {
	v.as_str().unwrap()
}

const PLATFORMS: [(&str, Platform); 3] = [("darwin", Platform::Darwin), ("win32", Platform::Win32), ("linux", Platform::Linux)];
const AGENTS: [(&str, FolderAgent); 2] = [("claude", FolderAgent::Claude), ("codex", FolderAgent::Codex)];
const TARGETS: [(&str, StartTarget); 4] = [("claude", StartTarget::Claude), ("claude-helper", StartTarget::ClaudeHelper), ("codex", StartTarget::Codex), ("codex-helper", StartTarget::CodexHelper)];

#[test]
fn agent_folder_text_matches_node() {
	for c in case("agent folder text").as_arr().unwrap() {
		let folder = s(&c["folder"]);
		assert_eq!(usable_folder(folder), c["usable"].as_bool().unwrap(), "{folder:?}");
		let short = [short_folder(folder, "/Users/a"), short_folder("/Users/a", "/Users/a"), short_folder("/Users/ab/x", "/Users/a")];
		let want: Vec<&str> = c["short"].as_arr().unwrap().iter().map(s).collect();
		assert_eq!(short.to_vec(), want, "{folder:?}");
		if c["platforms"].is_null() {
			continue;
		}
		for (name, platform) in PLATFORMS {
			let want = &c["platforms"][name];
			assert_eq!(mcp_json(folder, platform), s(&want["mcp"]), "{folder:?} {name} mcp");
			assert_eq!(claude_settings(folder, platform), s(&want["settings"]), "{folder:?} {name} settings");
			for (target_name, target) in TARGETS {
				assert_eq!(start_script_path(folder, target, platform), s(&want["paths"][target_name]), "{folder:?} {name} {target_name} path");
			}
			for w in want["commands"].as_arr().unwrap() {
				// The golden's inputs are all usable, so reading them back is the identity.
				let commands = saved_start_commands(&w["commands"]);
				let label = stringify(&w["commands"]);
				for (agent_name, agent) in AGENTS {
					assert_eq!(copy_command(agent, folder, "/Users/a", platform, &commands), s(&w["copy"][agent_name]), "{folder:?} {name} {label} {agent_name} copy");
				}
				for (target_name, target) in TARGETS {
					assert_eq!(start_script(target, folder, platform, &commands), s(&w["scripts"][target_name]), "{folder:?} {name} {label} {target_name} script");
				}
			}
		}
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
