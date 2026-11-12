//! data/agent-actions.json, the activity log,
//! oldest first. Rewritten whole on each change; small by design.

use std::path::PathBuf;

use gs_base::config::Paths;
use gs_base::fsx;
use gs_base::locks::{LockKey, Locks};
use gs_json::{Json, Obj, json, stringify_pretty};

const FILE_NAME: &str = "agent-actions.json";
const VERSION: i64 = 1;
const TARGET_KINDS: [&str; 4] = ["deadline", "file", "space", "lesson"];

pub struct AgentActionsStore {
	file: PathBuf,
	locks: Locks,
}

impl AgentActionsStore {
	pub fn new(paths: &Paths, locks: &Locks) -> AgentActionsStore {
		AgentActionsStore { file: paths.data.join(FILE_NAME), locks: locks.clone() }
	}

	/// Oldest first. A missing file reads as no actions; a broken one is set aside.
	pub fn read_agent_actions(&self) -> Vec<Json> {
		let Some(raw) = fsx::read_json_or_set_aside(&self.file) else { return Vec::new() };
		raw["actions"].as_arr().map_or_else(Vec::new, |list| list.iter().filter_map(parse_action).collect())
	}

	pub fn write_agent_actions(&self, actions: &[Json]) -> Result<(), String> {
		let _guard = self.locks.lock(LockKey::AppFile(FILE_NAME));
		let record = json!({ "version": VERSION, "actions": actions.to_vec() });
		fsx::write_text_atomic(&self.file, &stringify_pretty(&record, "\t")).map_err(|err| fsx::node_error_message(&err, "open", &self.file))
	}
}

/// Where a page lives now: /space was /class before the rename.
fn page_now(page: &str) -> String {
	match page.strip_prefix("/class") {
		Some(rest) if rest.is_empty() || rest.starts_with('/') => format!("/space{rest}"),
		_ => page.to_owned(),
	}
}

/// One logged action made safe to use; None when a required text field is missing. `classId` and
/// the target kind "class" are the names from before the rename.
fn parse_action(entry: &Json) -> Option<Json> {
	let (id, at, agent, label, page) = (entry["id"].as_str()?, entry["at"].as_str()?, entry["agent"].as_str()?, entry["label"].as_str()?, entry["page"].as_str()?);
	let target = &entry["target"];
	let kind = target["kind"].as_str().map(|k| if k == "class" { "space" } else { k });
	let target = match (kind.filter(|k| TARGET_KINDS.contains(k)), target["id"].as_str()) {
		(Some(kind), Some(target_id)) => json!({ "kind": kind, "id": target_id }),
		_ => Json::Null,
	};
	let mut out = Obj::new();
	out.insert("id", id);
	out.insert("at", at);
	out.insert("agent", agent);
	out.insert("label", label);
	let space_id = if entry["spaceId"].is_null() { &entry["classId"] } else { &entry["spaceId"] };
	out.insert("spaceId", space_id.as_str().map_or(Json::Null, Json::from));
	out.insert("target", target);
	out.insert("page", page_now(page));
	if entry["removed"].as_bool() == Some(true) {
		out.insert("removed", true);
	}
	if entry["open"].as_bool() == Some(true) {
		out.insert("open", true);
	}
	Some(Json::Obj(out))
}

#[cfg(test)]
mod tests {
	use gs_json::{parse, stringify};

	use super::*;

	#[test]
	fn actions_keep_their_shape_and_drop_the_rest() {
		let raw = parse(r#"[{"id":"a","at":"t","agent":"x","label":"l","page":"p","spaceId":5,"target":{"kind":"file","id":"f_1"},"removed":true,"open":false,"junk":1},{"id":"b","at":"t","agent":"x","label":"l","page":"p","spaceId":"cls_a","target":{"kind":"nope","id":"f"}},{"id":"c","at":"t","agent":"x","label":"l"},"x",null]"#).unwrap();
		let kept: Vec<String> = raw.as_arr().unwrap().iter().filter_map(parse_action).map(|a| stringify(&a)).collect();
		assert_eq!(
			kept,
			[
				r#"{"id":"a","at":"t","agent":"x","label":"l","spaceId":null,"target":{"kind":"file","id":"f_1"},"page":"p","removed":true}"#,
				r#"{"id":"b","at":"t","agent":"x","label":"l","spaceId":"cls_a","target":null,"page":"p"}"#
			]
		);
	}

	#[test]
	fn actions_from_before_spaces_take_the_new_names() {
		let raw = parse(r#"[{"id":"a","at":"t","agent":"x","label":"l","page":"/class/files","classId":"cls_a","target":{"kind":"class","id":"cls_a"}},{"id":"b","at":"t","agent":"x","label":"l","page":"/class","spaceId":null,"classId":"cls_b"},{"id":"c","at":"t","agent":"x","label":"l","page":"/classes","spaceId":"spc_c","classId":"cls_x"}]"#).unwrap();
		let kept: Vec<String> = raw.as_arr().unwrap().iter().filter_map(parse_action).map(|a| stringify(&a)).collect();
		assert_eq!(
			kept,
			[
				r#"{"id":"a","at":"t","agent":"x","label":"l","spaceId":"cls_a","target":{"kind":"space","id":"cls_a"},"page":"/space/files"}"#,
				r#"{"id":"b","at":"t","agent":"x","label":"l","spaceId":"cls_b","target":null,"page":"/space"}"#,
				r#"{"id":"c","at":"t","agent":"x","label":"l","spaceId":"spc_c","target":null,"page":"/classes"}"#
			]
		);
	}
}
