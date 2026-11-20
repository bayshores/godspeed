//! start_lesson: a new lesson on a topic (for a deadline when one is named with it), or a
//! deadline's lesson as its Study or Work on key starts it. A new lesson's title is the learner's
//! first message; a continued one is where they left it.

use gs_core::contracts::space::parse_space_scope;
use gs_core::spaces::space_tools::ToolOutcome;
use gs_json::{Json, json};

use super::deadline_with_space;
use super::space_actions::{CLOSED_SPACE, SpaceActions, change, no_space_text, template_text};
use crate::turns::deadline_lesson::{DeadlineLesson, deadline_lesson};
use crate::turns::lessons::{CreateLessonInput, LessonStart, create_lesson};

impl SpaceActions {
	pub async fn start_lesson(&self, args: &Json) -> ToolOutcome {
		let topic = args["topic"].as_str().map(str::trim).filter(|t| !t.is_empty());
		let deadline_id = args["deadline_id"].as_str();
		let lesson = match (topic, deadline_id) {
			(None, None) => return ToolOutcome::Err("Give topic or deadline_id.".to_owned()),
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
