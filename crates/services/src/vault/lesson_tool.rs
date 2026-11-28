//! The lesson's write_vault_note: present in a lesson started while a vault is picked, for the
//! lesson's whole length.

use std::sync::Arc;

use gs_agent::tools::vault_note::WriteVaultNote;
use gs_core::session::plan_step_bar::current_step_id;
use gs_json::Json;

use super::write::{picked_vault, write_vault_note};
use crate::App;

/// Whether the lesson has the tool. The first agent build of a lesson stamps `vaultPicked` on its
/// record; a lesson that already has teacher messages and no stamp began before vaults and has
/// none.
fn vault_picked_at_start(app: &App, chat_id: &str, record: &Json) -> bool {
	if let Some(stamped) = record["vaultPicked"].as_bool() {
		return stamped;
	}
	let begun = record["messages"].items().iter().any(|m| m["role"].as_str() == Some("assistant"));
	let picked = !begun && picked_vault(app);
	if let Err(why) = app.stores.chats.set_vault_picked(chat_id, picked) {
		eprintln!("[vault] could not stamp {chat_id}: {why}");
	}
	picked
}

/// The tool for the lesson `chat_id`, which writes for the lesson's space. A topic left out is
/// the topic of the lesson's current step.
pub(crate) fn lesson_vault_tool(app: &Arc<App>, chat_id: &str, record: &Json) -> Option<WriteVaultNote> {
	let space_id = record["spaceId"].as_str()?.to_owned();
	if !vault_picked_at_start(app, chat_id, record) {
		return None;
	}
	let (app, chat_id) = (app.clone(), chat_id.to_owned());
	Some(Arc::new(move |args: &Json| {
		let mut args = args.clone();
		args.set("space_id", space_id.as_str());
		if args["topic_id"].as_str().is_none_or(str::is_empty) {
			let chat = app.stores.chats.get_chat(&chat_id).ok_or("This lesson is gone.")?;
			let step = current_step_id(&chat["tree"], chat["messages"].items()).ok_or("No step is under way yet, so send topic_id.")?;
			args.set("topic_id", step);
		}
		write_vault_note(&app, &args)
	}))
}

#[cfg(test)]
mod tests {
	use gs_json::json;

	use super::super::setup::change_vault;
	use super::super::test_support::Fixture;
	use super::*;

	fn lesson(fx: &Fixture) -> String {
		fx.app.stores.chats.create_chat("Binary search", Some("study"), Some(&fx.space_id), None, &[]).unwrap()["id"].as_str().unwrap().to_owned()
	}

	fn tool_for(fx: &Fixture, chat_id: &str) -> Option<WriteVaultNote> {
		lesson_vault_tool(&fx.app, chat_id, &fx.app.stores.chats.get_chat(chat_id).unwrap())
	}

	#[test]
	fn the_tool_writes_for_the_lessons_space_and_takes_the_current_step_when_no_topic_is_sent() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		let chat_id = lesson(&fx);
		let tree = json!({ "nodes": [{ "id": "t1", "title": "Binary search" }], "edges": [] });
		fx.app.stores.chats.save_tree(&chat_id, &tree).unwrap();
		let tool = tool_for(&fx, &chat_id).expect("a vault was picked at the start");
		assert_eq!(tool(&json!({ "text": "x" })).unwrap_err(), "No step is under way yet, so send topic_id.");
		let asked = json!({ "role": "assistant", "content": [{ "type": "toolCall", "name": "quiz", "arguments": { "nodeId": "t1" } }] });
		fx.app.stores.chats.save_messages(&chat_id, &[asked]).unwrap();
		let answer = tool(&json!({ "text": "Halve the range." })).unwrap();
		assert_eq!(answer["path"].as_str(), Some("CSE 21/Binary search.md"));
		assert_eq!(tool(&json!({ "topic_id": "nope" })).unwrap_err(), "No topic \"nope\" in this space. Use read_space.");
	}

	#[test]
	fn a_lesson_keeps_its_tool_list_whatever_settings_do_later() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		let with = lesson(&fx);
		assert!(tool_for(&fx, &with).is_some());
		change_vault(&fx.app, &json!({ "path": null })).unwrap();
		assert!(tool_for(&fx, &with).is_some(), "stamped at its start");
		let without = lesson(&fx);
		assert!(tool_for(&fx, &without).is_none());
		change_vault(&fx.app, &json!({ "path": fx.vault.to_string_lossy() })).unwrap();
		assert!(tool_for(&fx, &without).is_none(), "a vault picked mid-lesson does not add the tool");
	}

	#[test]
	fn a_lesson_that_began_before_vaults_has_no_tool() {
		let fx = Fixture::new(&[("t1", "Binary search")]);
		let chat_id = lesson(&fx);
		let said = json!({ "role": "assistant", "content": [{ "type": "text", "text": "Hello." }] });
		fx.app.stores.chats.save_messages(&chat_id, &[said]).unwrap();
		assert!(tool_for(&fx, &chat_id).is_none());
	}

	#[test]
	fn a_lesson_outside_any_space_has_no_tool() {
		let fx = Fixture::new(&[]);
		let chat_id = fx.app.stores.chats.create_chat("Loose", Some("study"), None, None, &[]).unwrap()["id"].as_str().unwrap().to_owned();
		assert!(tool_for(&fx, &chat_id).is_none());
	}
}
