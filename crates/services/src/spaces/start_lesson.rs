//! start_lesson: a new lesson on a topic (for a deadline when one is named with it), a
//! deadline's lesson as its Study or Work on key starts it, or a lesson on files. A new lesson's
//! title is the learner's first message; a continued one is where they left it.

use std::sync::Arc;

use gs_base::clock;
use gs_core::contracts::space::{due_at, parse_space_scope};
use gs_core::spaces::space_tools::ToolOutcome;
use gs_core::spaces::today_note::when_label;
use gs_json::{Json, json};

use super::deadline_with_space;
use super::space_actions::{CLOSED_SPACE, SpaceActions, change, no_space_text, template_text};
use crate::turns::deadline_lesson::{DeadlineLesson, deadline_lesson};
use crate::turns::files_lesson::files_lesson;
use crate::turns::lessons::{CreateLessonInput, LessonStart, create_lesson};
use crate::App;
use crate::graph::progress::progress_for;

/// How soon a deadline must be due for a new topic lesson in its space to be sent back.
const NEAR_DEADLINE_MS: i64 = 2 * 24 * 60 * 60 * 1000;

/// A deadline of the space is due within two days and has an unfinished lesson: a new lesson on
/// a topic would start beside it with none of its record. The words that send the call back,
/// naming that lesson; None when no deadline is that near, or this call was sent back before.
fn near_deadline_ask(app: &Arc<App>, space_id: &str, topic: &str) -> Result<Option<String>, String> {
	let Some(progress) = progress_for(app, space_id, None)? else { return Ok(None) };
	let now = clock::now_ms();
	let near = progress["deadlines"].items().iter().find_map(|d| {
		due_at(d).filter(|due| !d["done"].truthy() && (now..=now + NEAR_DEADLINE_MS).contains(due))?;
		let (lesson, homework) = match d["continueStudy"]["chatId"].as_str() {
			Some(lesson) => (lesson, ""),
			None => (d["continueHomework"].as_str()?, ", homework: true"),
		};
		Some((d, lesson, homework))
	});
	let Some((deadline, lesson, homework)) = near else { return Ok(None) };
	let (id, name) = (deadline["id"].str_or_empty(), deadline["name"].str_or_empty());
	if !app.turns.near_deadline_asked.lock().insert((id.to_owned(), topic.to_lowercase())) {
		return Ok(None);
	}
	let title = app.stores.chats.get_chat(lesson).map(|chat| chat["title"].str_or_empty().to_owned()).unwrap_or_default();
	Ok(Some(format!(
		"{name} is due {} and its lesson \"{title}\" (lesson_id \"{lesson}\") is unfinished. To go on with it: start_lesson with deadline_id \"{id}\"{homework} and no topic. For a new lesson on \"{topic}\" that counts for {name}: add deadline_id \"{id}\" to this call. For a lesson apart from {name}: send this call again.",
		when_label(deadline)
	)))
}

impl SpaceActions {
	pub async fn start_lesson(&self, args: &Json) -> ToolOutcome {
		let topic = args["topic"].as_str().map(str::trim).filter(|t| !t.is_empty());
		let deadline_id = args["deadline_id"].as_str();
		let lesson = match (topic, deadline_id) {
			_ if args.get("file_ids").is_some() => self.files_lesson(args, topic, deadline_id),
			(None, None) => return ToolOutcome::Err("Give topic, deadline_id or file_ids.".to_owned()),
			(Some(topic), _) if args["homework"].truthy() => return ToolOutcome::Err(format!("homework takes deadline_id alone, not a topic (\"{topic}\").")),
			(Some(topic), deadline_id) => self.topic_lesson(args, topic, deadline_id).await,
			(None, Some(deadline_id)) => self.deadline_lesson(args, deadline_id),
		};
		let (space_id, lesson) = match lesson {
			Ok(lesson) => lesson,
			Err(refused) => return ToolOutcome::Err(refused),
		};
		let (status, verb, chat_id, title) = match lesson {
			DeadlineLesson::New { chat_id, title } => {
				if let Err(body) = (self.send)(chat_id.clone(), title.clone()).await {
					return ToolOutcome::Err(format!("The lesson was created but could not start: {body}"));
				}
				("started", "Starting", chat_id, title)
			}
			DeadlineLesson::Continued { chat_id, title } => ("continued", "Continuing", chat_id, title),
		};
		let space_json = space_id.map_or(Json::Null, Json::from);
		let shown = self.opened(change(format!("{verb} {title}"), &space_json, "lesson", &chat_id, &format!("/chat/{chat_id}")));
		self.done(json!({ "status": status, "lessonId": chat_id, "title": title }), vec![shown])
	}

	/// A new lesson on a typed topic, for the deadline when one is named: its space, and the lesson.
	async fn topic_lesson(&self, args: &Json, topic: &str, deadline_id: Option<&str>) -> Result<(Option<String>, DeadlineLesson), String> {
		let scope = match deadline_id {
			Some(id) => Some(self.deadline_space(args, id)?),
			None => parse_space_scope(args["space_id"].as_str()).ok_or_else(|| format!("\"{}\" is not a space id. Use list_spaces.", template_text(args.get("space_id"))))?,
		};
		let space = match &scope {
			Some(id) => Some(self.app.stores.spaces.get_space(id).ok_or_else(|| no_space_text(id))?),
			None => None,
		};
		if space.as_ref().is_some_and(|s| s["closed"].truthy()) {
			return Err(CLOSED_SPACE.to_owned());
		}
		if deadline_id.is_none()
			&& let Some(space_id) = &scope
			&& let Some(ask) = near_deadline_ask(&self.app, space_id, topic)?
		{
			return Err(ask);
		}
		// A path topic's name studies that topic, so its answers count for it.
		let on_path = space.as_ref().and_then(|s| s["path"]["topics"].items().iter().find(|t| t["name"].str_or_empty().to_lowercase() == topic.to_lowercase()).and_then(|t| t["id"].as_str()));
		let start = match on_path {
			Some(id) => LessonStart::PathTopic(id.to_owned()),
			None => LessonStart::typed(&self.app, scope.as_deref(), topic, Vec::new()).await?,
		};
		let lesson = match create_lesson(&self.app, CreateLessonInput { space_id: scope.clone(), start, for_deadline: deadline_id.map(str::to_owned) })? {
			Ok(created) => DeadlineLesson::New { chat_id: created.chat["id"].str_or_empty().to_owned(), title: created.title },
			Err(not_found) => return Err(not_found.error.to_owned()),
		};
		Ok((scope, lesson))
	}

	/// A lesson on files, tied to the deadline when one is named.
	fn files_lesson(&self, args: &Json, topic: Option<&str>, deadline_id: Option<&str>) -> Result<(Option<String>, DeadlineLesson), String> {
		if topic.is_some() || args["homework"].truthy() {
			return Err("file_ids takes no topic and no homework: the first file names the lesson.".to_owned());
		}
		let space_id = match args["space_id"].as_str() {
			Some(given) => Some(parse_space_scope(Some(given)).flatten().ok_or_else(|| format!("\"{given}\" is not a space id. Use list_spaces."))?),
			None => None,
		};
		let file_ids: Vec<String> = args["file_ids"].items().iter().filter_map(|id| id.as_str().map(str::to_owned)).collect();
		let (space_id, lesson) = files_lesson(&self.app, space_id.as_deref(), &file_ids, deadline_id)??;
		Ok((Some(space_id), lesson))
	}

	/// The deadline's lesson, as its Study key (or with `homework`, its Work on key) starts it.
	fn deadline_lesson(&self, args: &Json, deadline_id: &str) -> Result<(Option<String>, DeadlineLesson), String> {
		let space_id = self.deadline_space(args, deadline_id)?;
		if self.app.stores.spaces.get_space(&space_id).is_some_and(|s| s["closed"].truthy()) {
			return Err(CLOSED_SPACE.to_owned());
		}
		let lesson = deadline_lesson(&self.app, &space_id, deadline_id, args["homework"].truthy())??;
		Ok((Some(space_id), lesson))
	}

	/// The deadline's space, which a given space_id must be.
	fn deadline_space(&self, args: &Json, deadline_id: &str) -> Result<String, String> {
		let given = args["space_id"].as_str();
		let found = deadline_with_space(&self.app, deadline_id).and_then(|d| d["spaceId"].as_str().map(str::to_owned)).filter(|space_id| given.is_none_or(|g| g == space_id));
		found.ok_or_else(|| format!("No deadline \"{deadline_id}\". Use read_space."))
	}
}

#[cfg(test)]
mod tests {
	use gs_core::spaces::today_note::wall_clock;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::spaces::space_actions::{Mark, SendFirstMessage, space_actions};

	#[tokio::test]
	async fn a_new_topic_lesson_beside_a_near_deadlines_unfinished_lesson_is_sent_back_once() {
		let root = scratch_dir("start-lesson-near-deadline");
		let app = test_app(&root);
		let send: SendFirstMessage = Arc::new(|_, _| Box::pin(async { Ok(()) }));
		let actions = space_actions(&app, Some("Teacher"), send, Mark::Started);
		let space_with = |name: &str, date: &str| {
			let space_id = app.stores.spaces.create_space(&json!({ "name": name })).unwrap()["id"].str_or_empty().to_owned();
			let deadline_id = app.stores.spaces.add_deadline(&space_id, &json!({ "name": "Test 2", "kind": "exam", "date": date })).unwrap()["id"].str_or_empty().to_owned();
			(space_id, deadline_id)
		};
		let tomorrow = wall_clock(clock::now_ms() + 24 * 60 * 60 * 1000).day;
		let (near, near_deadline) = space_with("Systems", &tomorrow);
		let (far, far_deadline) = space_with("Algebra", "2099-01-15");
		let lesson_id = |outcome: ToolOutcome| match outcome {
			ToolOutcome::Ok { value, .. } => value["lessonId"].str_or_empty().to_owned(),
			ToolOutcome::Err(error) => panic!("{error}"),
		};

		assert!(!lesson_id(actions.start_lesson(&json!({ "space_id": near, "topic": "pipes" })).await).is_empty(), "the deadline has no lesson to go on with yet");
		let study = lesson_id(actions.start_lesson(&json!({ "deadline_id": near_deadline })).await);
		let apart = json!({ "space_id": near, "topic": "execvp" });
		let when = when_label(&json!({ "date": tomorrow }));
		let sent_back = format!(
			"Test 2 is due {when} and its lesson \"Study for Test 2\" (lesson_id \"{study}\") is unfinished. To go on with it: start_lesson with deadline_id \"{near_deadline}\" and no topic. For a new lesson on \"execvp\" that counts for Test 2: add deadline_id \"{near_deadline}\" to this call. For a lesson apart from Test 2: send this call again."
		);
		assert_eq!(actions.start_lesson(&apart).await, ToolOutcome::Err(sent_back));
		assert_ne!(lesson_id(actions.start_lesson(&apart).await), study, "the same call again starts the lesson apart");
		assert!(!lesson_id(actions.start_lesson(&json!({ "space_id": near, "topic": "fork", "deadline_id": near_deadline })).await).is_empty(), "a lesson for the deadline is never sent back");

		lesson_id(actions.start_lesson(&json!({ "deadline_id": far_deadline })).await);
		assert!(!lesson_id(actions.start_lesson(&json!({ "space_id": far, "topic": "matrices" })).await).is_empty(), "a deadline weeks away sends nothing back");
	}
}
