//! The space tools' work (space-actions.ts), shared by the teacher panel's chat, lessons
//! and deadline requests: each checks its arguments, changes the space, records what it changed for the
//! teacher's panel, and returns what the agent sees. `caller` names the agent in the panel's rows;
//! `send` gives a new lesson its first message (the chat handler's input, passed in by the
//! caller).

mod deadline_tools;
mod file_tools;
mod space_tools;
mod space_view;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use gs_base::{clock, time};
use gs_core::spaces::space_tools::{SpaceChange, ToolOutcome};
use gs_core::spaces::today_note::local_day;
use gs_core::contracts::space::SIGNATURE_MAX;
use gs_json::{Json, json};

use crate::App;
use crate::app::agent_actions::note_agent_action;

/// Sends a lesson's first message (chat id, text); Err holds the refusal's body text.
pub type SendFirstMessage = Arc<dyn Fn(String, String) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send>> + Send + Sync>;

/// How the window shows a caller's changes, by who asked for them.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mark {
	/// The learner, in a lesson or in the teacher panel's chat: the window opens the lesson or
	/// space it starts even with Follow off.
	Started,
	/// A page's request (a deadline's): Follow shows each change.
	Asked,
	/// godspeed's own check: each change is listed, marked `background`, and Follow stays put.
	Background,
}

/// The space tools for one caller.
pub fn space_actions(app: &Arc<App>, caller: Option<&str>, send: SendFirstMessage, mark: Mark) -> SpaceActions {
	SpaceActions { app: app.clone(), caller: caller.map(str::to_owned), send, mark }
}

pub struct SpaceActions {
	pub(super) app: Arc<App>,
	pub(super) caller: Option<String>,
	pub(super) send: SendFirstMessage,
	pub(super) mark: Mark,
}

/// The last part of a folder path, or "a folder".
pub fn folder_name(path: Option<&str>) -> String {
	let trimmed = path.unwrap_or("").trim_end_matches(['/', '\\']);
	trimmed.rsplit(['/', '\\']).next().filter(|n| !n.is_empty()).unwrap_or("a folder").to_owned()
}

/// This computer's date and time, "YYYY-MM-DD HH:MM" (deadlines are in the same local wall clock).
fn local_now() -> String {
	let now = clock::now_ms();
	let local = time::local(now);
	format!("{} {:02}:{:02}", local_day(now), local.hour(), local.minute())
}

/// What an agent hears when it asks for something in a closed space.
pub(crate) const CLOSED_SPACE: &str = "This space is closed. Ask the learner to reopen it first.";

pub(crate) fn no_space_text(space_id: &str) -> String {
	format!("No space \"{space_id}\". Use list_spaces.")
}

fn no_space(space_id: &str) -> ToolOutcome {
	ToolOutcome::Err(no_space_text(space_id))
}

fn bad_signature() -> ToolOutcome {
	ToolOutcome::Err(format!("A signature is one line of at most {SIGNATURE_MAX} characters."))
}

/// `${v}` for an argument the schema makes a string (None is `undefined`).
pub(super) fn template_text(v: Option<&Json>) -> String {
	match v {
		None => "undefined".to_owned(),
		Some(Json::Str(s)) => s.clone(),
		Some(other) => gs_json::stringify(other),
	}
}

/// `args[key]` as JS sees `args.key !== undefined`.
fn given(args: &Json, key: &str) -> bool {
	args.get(key).is_some()
}

/// A change for the panel: `{ label, spaceId, target: { kind, id }, page }`.
pub(super) fn change(label: String, space_id: &Json, kind: &str, id: &str, page: &str) -> Json {
	json!({ "label": label, "spaceId": space_id, "target": { "kind": kind, "id": id }, "page": page })
}

impl SpaceActions {
	/// The change marked `open` when the learner asked for it.
	pub(super) fn opened(&self, mut change: Json) -> Json {
		if self.mark == Mark::Started
			&& let Some(obj) = change.as_obj_mut()
		{
			obj.insert("open", true);
		}
		change
	}

	fn space_exists(&self, space_id: &str) -> bool {
		self.app.stores.spaces.get_space(space_id).is_some()
	}

	/// Each change is recorded for the panel and returned for the chat.
	pub(super) fn done(&self, value: Json, mut changes: Vec<Json>) -> ToolOutcome {
		for change in &mut changes {
			if self.mark == Mark::Background
				&& let Some(obj) = change.as_obj_mut()
			{
				obj.insert("background", true);
			}
			note_agent_action(&self.app, self.caller.as_deref(), change);
		}
		let changes = changes.iter().map(|c| SpaceChange { label: c["label"].str_or_empty().to_owned(), page: c["page"].str_or_empty().to_owned() }).collect();
		ToolOutcome::Ok { value, changes }
	}

	/// Runs one space tool by name; None for a name that is not one.
	pub async fn run(&self, name: &str, args: &Json) -> Option<ToolOutcome> {
		Some(match name {
			"list_spaces" => self.list_spaces(args),
			"read_space" => self.read_space(args),
			"search_space_files" => self.search_space_files(args).await,
			"read_passage" => self.read_passage(args),
			"create_space" => self.create_space(args),
			"update_space" => self.update_space(args),
			"add_space_file" => self.add_space_file(args),
			"set_space_file_kind" => self.set_space_file_kind(args),
			"add_space_deadline" => self.add_space_deadline(args),
			"update_space_deadline" => self.update_space_deadline(args),
			"remove_space_deadline" => self.remove_space_deadline(args),
			"link_space_folder" => self.link_space_folder(args),
			"start_lesson" => self.start_lesson(args).await,
			_ => return None,
		})
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	pub(super) fn actions(app: &Arc<App>) -> SpaceActions {
		let send: SendFirstMessage = Arc::new(|_, _| Box::pin(async { Ok(()) }));
		space_actions(app, Some("Teacher"), send, Mark::Started)
	}

	pub(super) fn value(outcome: ToolOutcome) -> (Json, Vec<SpaceChange>) {
		match outcome {
			ToolOutcome::Ok { value, changes } => (value, changes),
			ToolOutcome::Err(error) => panic!("{error}"),
		}
	}

	#[test]
	fn folder_names_like_the_ts() {
		assert_eq!(folder_name(Some("/Users/me/Course Notes/")), "Course Notes");
		assert_eq!(folder_name(Some("C:\\a\\b\\\\")), "b");
		assert_eq!(folder_name(Some("/")), "a folder");
		assert_eq!(folder_name(Some("")), "a folder");
		assert_eq!(folder_name(None), "a folder");
	}
}
