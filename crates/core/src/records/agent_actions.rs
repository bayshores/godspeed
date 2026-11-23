//! The activity log's entries in data/agent-actions.json, and the length their labels are cut to.

use gs_base::re::collapse_spaces;
use gs_base::text;
use gs_json::{Json, Obj, json};

use super::space_id_of;

const TARGET_KINDS: [&str; 4] = ["deadline", "file", "space", "lesson"];
pub const LABEL_MAX: usize = 80;

/// A label cut to a readable length: one line, at most `LABEL_MAX` characters.
pub fn short_label(raw: &str) -> String {
	let spaced = collapse_spaces(raw);
	let one = text::trim(&spaced);
	if text::len16(one) > LABEL_MAX { format!("{}…", text::trim_end(&text::slice16(one, 0, Some(LABEL_MAX as i64 - 1)))) } else { one.to_owned() }
}

/// The actions in a parsed agent-actions.json, oldest first; malformed entries are dropped.
pub fn parse_agent_actions(raw: &Json) -> Vec<Json> {
	raw["actions"].items().iter().filter_map(parse_action).collect()
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
	out.insert("spaceId", space_id_of(entry).as_str().map_or(Json::Null, Json::from));
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
	use gs_json::{json, parse, stringify};

	use super::*;

	#[test]
	fn actions_keep_their_shape_and_drop_the_rest() {
		let raw = parse(r#"[{"id":"a","at":"t","agent":"x","label":"l","page":"p","spaceId":5,"target":{"kind":"file","id":"f_1"},"removed":true,"open":false,"junk":1},{"id":"b","at":"t","agent":"x","label":"l","page":"p","spaceId":"cls_a","target":{"kind":"nope","id":"f"}},{"id":"c","at":"t","agent":"x","label":"l"},"x",null]"#).unwrap();
		let kept: Vec<String> = parse_agent_actions(&json!({ "actions": raw })).iter().map(stringify).collect();
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
		let kept: Vec<String> = parse_agent_actions(&json!({ "actions": raw })).iter().map(stringify).collect();
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
