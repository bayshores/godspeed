//! What the teacher does in a lesson's running turn, for the lesson's desk (GET
//! /api/chats/{id}/work): why the turn runs, whether an agent took it, its plan and its steps. A
//! step comes from a tool call in the teacher's reply, a godspeed call or one of its own tools
//! while it holds the turn, or the PDF reader's progress. Made when the turn begins and dropped
//! when it ends, so a restart loses it with the turn. Every change goes out as "lesson-work".

use std::collections::VecDeque;
use std::sync::Arc;

use gs_base::clock;
use gs_base::events::EventKind;
use gs_core::session::lesson_steps::{LessonCall, base_name, lesson_call, pdf_progress};
use gs_core::session::teacher_steps::{TeacherStep, keep_step, step_head};
use gs_core::session::turn_cause::TurnCause;
use gs_engine::turn::agent::Listener;
use gs_engine::turn::events::AgentEvent;
use gs_json::{Json, json};

use super::desk_files::{desk_files, path_reading, step_reading};
use super::step_names::AppStepNames;
use crate::App;

pub(super) struct TurnWork {
	cause: TurnCause,
	taken: bool,
	plan: Option<Json>,
	/// Oldest first.
	steps: VecDeque<Json>,
}

fn changed(app: &App, chat_id: &str) {
	app.events.emit(EventKind::LessonWork, json!({ "chatId": chat_id }));
}

/// Changes the running turn's work; the window hears when `change` says it changed anything.
fn update(app: &App, chat_id: &str, change: impl FnOnce(&mut TurnWork) -> bool) {
	let done = app.turns.work.lock().get_mut(chat_id).is_some_and(change);
	if done {
		changed(app, chat_id);
	}
}

/// The turn began, for `cause`.
pub(super) fn begin(app: &App, chat_id: &str, cause: TurnCause) {
	app.turns.work.lock().insert(chat_id.to_owned(), TurnWork { cause, taken: false, plan: None, steps: VecDeque::new() });
	changed(app, chat_id);
}

/// The turn ended, however it ended.
pub(super) fn end(app: &App, chat_id: &str) {
	if app.turns.work.lock().remove(chat_id).is_some() {
		changed(app, chat_id);
	}
}

/// An agent took the lesson's turn.
pub fn taken(app: &App, chat_id: &str) {
	update(app, chat_id, |work| !std::mem::replace(&mut work.taken, true));
}

/// One step: its words, the reply's tool call it stands for, the file and place it reads.
pub fn note_step(app: &App, chat_id: &str, step: TeacherStep, call: Option<&str>, reads: Option<Json>) {
	let mut out = step_head(step.text, clock::now_ms());
	out.insert("call", call);
	out.insert("reads", reads);
	update(app, chat_id, |work| {
		keep_step(&mut work.steps, Json::Obj(out));
		true
	});
}

/// A godspeed tool the teacher called itself while it holds the turn, with its step's words.
pub fn note_own_call(app: &App, chat_id: &str, tool: &str, args: &Json, step: TeacherStep) {
	let reads = step_reading(app, tool, args, args["space_id"].as_str());
	note_step(app, chat_id, step, None, reads);
}

/// Hears the turn's agent run the tools of the teacher's reply: a step per tool call (its call id
/// with it, so the lesson text leaves out that call's card), or the plan.
pub(super) fn listener(app: &Arc<App>, chat_id: &str, space_id: Option<&str>) -> Listener {
	let (app, chat_id, space_id) = (Arc::downgrade(app), chat_id.to_owned(), space_id.map(str::to_owned));
	Arc::new(move |event: &AgentEvent| {
		let AgentEvent::ToolExecutionStart { tool_call_id, tool_name, args } = event else { return };
		let Some(app) = app.upgrade() else { return };
		match lesson_call(tool_name, args, space_id.as_deref(), &AppStepNames(&app)) {
			Some(LessonCall::Plan(plan)) => update(&app, &chat_id, |work| {
				work.plan = Some(plan);
				true
			}),
			Some(LessonCall::Step(step)) => {
				let reads = step_reading(&app, tool_name, args, space_id.as_deref());
				note_step(&app, &chat_id, step, Some(tool_call_id), reads);
			}
			Some(LessonCall::Quiet) | None => {}
		}
	})
}

/// A job's new activity line: the PDF reader's progress is a step on its lesson's desk, at the
/// page it reads.
pub(super) fn job_activity(app: &App, job_id: &str, line: &str) {
	let Some(job) = app.stores.jobs.get_job(job_id).filter(|job| job["kind"].as_str() == Some("pdf")) else { return };
	let Some(path) = job["input"]["path"].as_str().map(gs_base::text::trim).filter(|p| !p.is_empty()) else { return };
	let Some((step, page)) = pdf_progress(line, base_name(path)) else { return };
	note_step(app, job["chatId"].str_or_empty(), step, None, path_reading(path, None, None, page));
}

/// GET /api/chats/{id}/work: `{live, cause, taken, plan, steps, files}`; the files go out with no
/// turn too. None for an unknown lesson.
pub fn lesson_work(app: &App, chat_id: &str) -> Option<Json> {
	let lesson = app.stores.chats.get_chat(chat_id)?;
	let files = desk_files(app, &lesson);
	let turns = app.turns.work.lock();
	Some(match turns.get(chat_id) {
		Some(work) => json!({ "live": true, "cause": work.cause.name(), "taken": work.taken, "plan": work.plan.clone(), "steps": work.steps.iter().cloned().collect::<Vec<_>>(), "files": files }),
		None => json!({ "live": false, "cause": null, "taken": false, "plan": null, "steps": [], "files": files }),
	})
}

#[cfg(test)]
mod tests {
	use gs_base::events::Event;

	use super::*;
	use crate::app::test_support::{scratch_dir, test_app};
	use crate::turns::turn_liveness::{begin_turn, end_turn};

	fn told(events: &mut tokio::sync::mpsc::UnboundedReceiver<Event>) -> Vec<Json> {
		std::iter::from_fn(|| events.try_recv().ok()).filter(|e| e.kind == EventKind::LessonWork).map(|e| e.payload).collect()
	}

	fn step(text: &str) -> TeacherStep {
		TeacherStep { text: text.to_owned(), link: None }
	}

	#[test]
	fn a_turn_s_work_lasts_as_long_as_the_turn_and_two_lessons_stay_apart() {
		let root = scratch_dir("turn-work");
		let app = test_app(&root);
		let lesson = |title: &str| app.stores.chats.create_chat(title, Some("study"), None, None, &[]).unwrap()["id"].str_or_empty().to_owned();
		let (a, b) = (lesson("Pointers"), lesson("Sets"));
		let mut events = app.events.subscribe();
		assert_eq!(lesson_work(&app, &a), Some(json!({ "live": false, "cause": null, "taken": false, "plan": null, "steps": [], "files": [] })));
		assert_eq!(lesson_work(&app, "chat_gone"), None);

		for chat in [&a, &b] {
			assert!(begin_turn(&app, chat));
			begin(&app, chat, TurnCause::First);
		}
		taken(&app, &a);
		taken(&app, &a);
		note_step(&app, &a, step("Looking at CSE 29"), Some("agent_1"), None);
		assert_eq!(told(&mut events), [json!({ "chatId": a }), json!({ "chatId": b }), json!({ "chatId": a }), json!({ "chatId": a })], "begun twice, taken once, one step");
		let work = lesson_work(&app, &a).unwrap();
		assert_eq!((work["live"].as_bool(), work["cause"].as_str(), work["taken"].as_bool()), (Some(true), Some("first"), Some(true)));
		assert_eq!(work["steps"][0]["text"], json!("Looking at CSE 29"));
		assert_eq!((work["steps"][0]["call"].as_str(), &work["steps"][0]["reads"]), (Some("agent_1"), &Json::Null));
		let other = lesson_work(&app, &b).unwrap();
		assert_eq!((other["taken"].as_bool(), other["steps"].items().len()), (Some(false), 0), "the other lesson's turn is its own");

		end_turn(&app, &a);
		assert_eq!(lesson_work(&app, &a).unwrap()["live"], json!(false));
		assert!(told(&mut events).contains(&json!({ "chatId": a })), "its end is told");
		note_step(&app, &a, step("Late"), None, None);
		assert_eq!(lesson_work(&app, &a).unwrap()["steps"], json!([]), "a step after the turn is dropped");
		end_turn(&app, &b);
	}

	#[test]
	fn the_pdf_reader_s_progress_is_a_step_at_its_page() {
		let root = scratch_dir("turn-work-pdf");
		let app = test_app(&root);
		let chat = app.stores.chats.create_chat("HW7", Some("study"), None, None, &[]).unwrap()["id"].str_or_empty().to_owned();
		let init = gs_store::jobs::CreateJobInit { kind: "pdf", chat_id: &chat, tool_call_id: "c1", activity: None, input: Some(json!({ "path": "/a/HW7.pdf", "question": "q" })) };
		let job = app.stores.jobs.create_job(&init).unwrap()["id"].str_or_empty().to_owned();
		assert!(begin_turn(&app, &chat));
		begin(&app, &chat, TurnCause::Ask);
		job_activity(&app, &job, "reading pdf");
		job_activity(&app, &job, "pdf_render: 4 @150dpi");
		let steps = lesson_work(&app, &chat).unwrap()["steps"].clone();
		assert_eq!(steps.items().len(), 1);
		assert_eq!(steps[0]["text"], json!("Looking closely at page 4 of HW7.pdf"));
		assert_eq!(steps[0]["reads"], json!({ "name": "HW7.pdf", "path": "/a/HW7.pdf", "kind": "pdf", "from": null, "to": null, "page": 4 }));
		end_turn(&app, &chat);
	}
}
