//! list_lessons and read_lesson: the learner's lessons, read directly.

use gs_base::locale;
use gs_core::session::session_markdown::session_markdown;
use gs_core::session::work_pages::{WORK_PAGE_BYTES, split_pages};
use gs_json::{Json, Obj, json};

use super::reply::{failure, result, text_block};
use super::tools::{ToolCall, space_arg};

/// Copies `key` when the summary has it (JSON.stringify drops an absent field).
fn copy(into: &mut Obj, key: &str, from: &Json, field: &str) {
	if let Some(value) = from.get(field) {
		into.insert(key, value.clone());
	}
}

pub fn list_lessons(call: &ToolCall<'_>, args: &Json) -> Json {
	let app = call.app;
	let mut chats = app.stores.chats.list_chats();
	if let Some(space_id) = args["space_id"].as_str() {
		let scope = match space_arg(app, Some(space_id)) {
			Ok(scope) => scope,
			Err(error) => return failure(&error),
		};
		chats.retain(|c| c["spaceId"].as_str() == scope.as_deref());
	}
	let mut lessons: Vec<Json> = chats
		.iter()
		.map(|c| {
			let space_id = c["spaceId"].as_str().filter(|id| !id.is_empty());
			let space_name = match space_id {
				Some(id) => app.stores.spaces.get_space(id).and_then(|k| k["name"].as_str().map(str::to_owned)).unwrap_or_else(|| "Unknown space".to_owned()),
				None => "No space".to_owned(),
			};
			let mut lesson = Obj::new();
			copy(&mut lesson, "id", c, "id");
			copy(&mut lesson, "title", c, "title");
			copy(&mut lesson, "kind", c, "kind");
			lesson.insert("spaceId", if c["spaceId"].is_null() { Json::from("none") } else { c["spaceId"].clone() });
			lesson.insert("spaceName", space_name);
			copy(&mut lesson, "phase", c, "phase");
			lesson.insert("waitingForLearner", if c["pendingQuestion"].truthy() { c["pendingQuestion"].clone() } else { c["pendingProblem"].clone() });
			lesson.insert("running", gs_services::turns::turn_liveness::is_turn_running(app, c["id"].as_str().unwrap_or_default()));
			copy(&mut lesson, "updatedAt", c, "updatedAt");
			Json::Obj(lesson)
		})
		.collect();
	lessons.sort_by(|a, b| locale::compare(b["updatedAt"].as_str().unwrap_or_default(), a["updatedAt"].as_str().unwrap_or_default()));
	let total = lessons.len();
	let limit = args["limit"].as_i64().unwrap_or(20) as usize;
	lessons.truncate(limit);
	result(&json!({ "lessons": lessons, "total": total }))
}

pub fn read_lesson(call: &ToolCall<'_>, args: &Json) -> Json {
	let lesson_id = args["lesson_id"].as_str().unwrap_or_default();
	let page = args["page"].as_i64().unwrap_or(1) as usize;
	let Some(record) = call.app.stores.chats.get_chat(lesson_id) else {
		return failure(&format!("No lesson \"{lesson_id}\". Use list_lessons."));
	};
	let messages = record["messages"].as_arr().map_or(&[][..], Vec::as_slice);
	// Node's markdown reads every message's role, so a null message fails the read.
	if messages.iter().any(Json::is_null) {
		return failure("Cannot read properties of null (reading 'role')");
	}
	let pages = split_pages(&session_markdown(messages, record["title"].as_str()), WORK_PAGE_BYTES);
	let count = pages.len();
	if page > count {
		return failure(&format!("This lesson has {count} page(s)."));
	}
	if count == 1 {
		return result(&Json::from(pages[0].as_str()));
	}
	let note = if page < count { format!("Page {page} of {count}. Next: read_lesson page {}.", page + 1) } else { format!("Page {page} of {count}, the last.") };
	let mut content = result(&json!({ "lessonId": lesson_id, "page": page, "pages": count, "note": note }))["content"].as_arr().cloned().unwrap_or_default();
	content.push(text_block(&pages[page - 1]));
	json!({ "content": content })
}
