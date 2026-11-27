//! The teacher panel chat's data tools refuse bad arguments with zod's texts, byte for byte
//! (tests/golden/talk_tool_arguments.json, first recorded from the Node server's MCP handler).
//! Arguments that pass the schema run, and the tool's own refusal is the answer.

use gs_base::config::Paths;
use gs_base::ids;
use gs_json::{Json, parse};
use gs_services::App;
use gs_services::talk::tools::reply::failure;
use gs_services::talk::tools::{ToolCall, checked_arguments, run_tool};

const GOLDEN: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/golden/talk_tool_arguments.json");

#[tokio::test]
async fn bad_arguments_are_refused_like_the_ts_handler() {
	let root = std::env::temp_dir().join(format!("gs-talk-arguments-{}", ids::uuid()));
	for name in ["data", "home", "tmp", "res"] {
		std::fs::create_dir_all(root.join(name)).unwrap();
	}
	let app = App::new(Paths::new(root.join("data"), root.join("home"), root.join("tmp"), root.join("res")), None);
	let golden = parse(&std::fs::read_to_string(GOLDEN).unwrap()).unwrap();
	for case in golden.as_arr().unwrap() {
		let (name, tool) = (case["name"].str_or_empty(), case["tool"].str_or_empty());
		let answer = match checked_arguments(tool, &case["arguments"]) {
			Err(refused) => failure(&refused),
			Ok(args) => run_tool(&ToolCall { app: &app, caller: None }, tool, &args).await,
		};
		assert_eq!(answer["isError"], Json::Bool(true), "{name}: refused");
		assert_eq!(answer["content"][0]["text"], case["refusal"], "{name}: text");
	}
}
