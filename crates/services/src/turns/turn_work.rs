//! What the teacher does in a chat's running turn, for the desk of the lesson or of the teacher
//! panel's chat (GET /api/chats/{id}/work): why the turn runs, whether the agent took it, its plan, its steps and
//! the permission questions waiting for the learner. A step comes from a godspeed tool call, one
//! of the agent's own tools, or the PDF reader's progress. Made when the turn begins and dropped
//! when it ends, so a restart loses it with the turn. Every change goes out as "lesson-work".

use std::collections::VecDeque;
use std::sync::Arc;

use gs_base::clock;
use gs_base::events::EventKind;
use gs_core::session::approval_card::approval_card;
use gs_core::session::lesson_steps::{LessonCall, base_name, pdf_progress};
use gs_core::session::teacher_steps::{StepNames, TeacherStep, keep_step, own_tool_input_step, step_head};
use gs_core::session::turn_cause::TurnCause;
use gs_engine::turn::events::{AgentEvent, Listener};
use gs_engine::turn::session_turn::{DeskEvent, DeskListener};
use gs_json::{Json, json};

use super::desk_files::{desk_files, path_reading, step_reading};
use super::step_names::AppStepNames;
use crate::App;
use crate::app::settings_record::teacher_name;
use crate::jobs::asks::{AskedOn, asks_on};

pub(super) struct TurnWork {
	cause: TurnCause,
	plan: Option<Json>,
	/// Oldest first.
	steps: VecDeque<Json>,
	/// `{id, text, subject}`, oldest first.
	approvals: Vec<Json>,
}

/// Tells the window the lesson's work changed, and whether it waits for the learner to allow
/// something (for its turn or one of its jobs), which lights the strip's "needs you" on any page.
pub(crate) fn lesson_work_changed(app: &App, chat_id: &str) {
	let turn_asks = app.turns.work.lock().get(chat_id).is_some_and(|work| !work.approvals.is_empty());
	let asking = turn_asks || !asks_on(app, &AskedOn::Lesson(chat_id.to_owned())).is_empty();
	app.events.emit(EventKind::LessonWork, json!({ "chatId": chat_id, "asking": asking }));
}

/// Changes the running turn's work; the window hears when `change` says it changed anything.
fn update(app: &App, chat_id: &str, change: impl FnOnce(&mut TurnWork) -> bool) {
	let done = app.turns.work.lock().get_mut(chat_id).is_some_and(change);
	if done {
		lesson_work_changed(app, chat_id);
	}
}

/// The turn began, for `cause`.
pub(super) fn begin(app: &App, chat_id: &str, cause: TurnCause) {
	app.turns.work.lock().insert(chat_id.to_owned(), TurnWork { cause, plan: None, steps: VecDeque::new(), approvals: Vec::new() });
	lesson_work_changed(app, chat_id);
}

/// The turn ended, however it ended.
pub(super) fn end(app: &App, chat_id: &str) {
	if app.turns.work.lock().remove(chat_id).is_some() {
		lesson_work_changed(app, chat_id);
	}
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

/// What a tool call is for the desk: `lesson_call` in a lesson, `talk_call` in a talk chat.
pub(super) type DeskCalls = fn(&str, &Json, Option<&str>, &dyn StepNames) -> Option<LessonCall>;

/// Hears the turn run godspeed's tools: a step per tool call (its call id with it, so the lesson
/// text leaves out that call's card), or the plan.
pub(super) fn listener(app: &Arc<App>, chat_id: &str, space_id: Option<&str>, calls: DeskCalls) -> Listener {
	let (app, chat_id, space_id) = (Arc::downgrade(app), chat_id.to_owned(), space_id.map(str::to_owned));
	Arc::new(move |event: &AgentEvent| {
		let AgentEvent::ToolExecutionStart { tool_call_id, tool_name, args } = event else { return };
		let Some(app) = app.upgrade() else { return };
		match calls(tool_name, args, space_id.as_deref(), &AppStepNames(&app)) {
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

/// A permission question as the desk's card shows it: its id, its sentence and its subject.
pub(crate) fn approval_view(app: &App, id: &str, ask: &Json) -> Json {
	let card = approval_card(ask, &teacher_name(app));
	json!({ "id": id, "text": card["text"].clone(), "subject": card["subject"].clone() })
}

/// Hears what the turn's agent does besides godspeed's tools: it runs one of its own tools (a
/// step; a file it reads shows on the desk), a permission question waits or was answered.
pub(super) fn desk_listener(app: &Arc<App>, chat_id: &str) -> DeskListener {
	let (app, chat_id) = (Arc::downgrade(app), chat_id.to_owned());
	Arc::new(move |event: &DeskEvent| {
		let Some(app) = app.upgrade() else { return };
		match event {
			DeskEvent::OwnTool { name, input } => {
				let Some(step) = own_tool_input_step(name, input) else { return };
				let reads = (name == "Read").then(|| input["file_path"].as_str().and_then(|path| path_reading(path, None, None, None))).flatten();
				note_step(&app, &chat_id, step, None, reads);
			}
			DeskEvent::Approval { id, ask } => {
				let card = approval_view(&app, id, ask);
				update(&app, &chat_id, |work| {
					work.approvals.push(card);
					true
				});
			}
			DeskEvent::ApprovalDone { id } => update(&app, &chat_id, |work| {
				let before = work.approvals.len();
				work.approvals.retain(|a| a["id"].as_str() != Some(id.as_str()));
				work.approvals.len() != before
			}),
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

/// GET /api/chats/{id}/work: `{live, cause, plan, steps, approvals, files}`; the files and
/// the lesson's jobs' permission questions go out with no turn too. None for an unknown lesson.
pub fn lesson_work(app: &App, chat_id: &str) -> Option<Json> {
	let lesson = app.stores.chats.get_chat(chat_id)?;
	let files = desk_files(app, &lesson);
	let job_asks = asks_on(app, &AskedOn::Lesson(chat_id.to_owned()));
	let turns = app.turns.work.lock();
	Some(match turns.get(chat_id) {
		Some(work) => {
			let approvals = [work.approvals.clone(), job_asks].concat();
			json!({ "live": true, "cause": work.cause.name(), "plan": work.plan.clone(), "steps": work.steps.iter().cloned().collect::<Vec<_>>(), "approvals": approvals, "files": files })
		}
		None => json!({ "live": false, "cause": null, "plan": null, "steps": [], "approvals": job_asks, "files": files }),
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
		assert_eq!(lesson_work(&app, &a), Some(json!({ "live": false, "cause": null, "plan": null, "steps": [], "approvals": [], "files": [] })));
		assert_eq!(lesson_work(&app, "chat_gone"), None);

		for chat in [&a, &b] {
			assert!(begin_turn(&app, chat));
			begin(&app, chat, TurnCause::First);
		}
		note_step(&app, &a, step("Looking at CSE 29"), Some("agent_1"), None);
		let not_asking = |chat: &str| json!({ "chatId": chat, "asking": false });
		assert_eq!(told(&mut events), [not_asking(&a), not_asking(&b), not_asking(&a)], "begun twice, one step");
		let work = lesson_work(&app, &a).unwrap();
		assert_eq!((work["live"].as_bool(), work["cause"].as_str()), (Some(true), Some("first")));
		assert_eq!(work["steps"][0]["text"], json!("Looking at CSE 29"));
		assert_eq!((work["steps"][0]["call"].as_str(), &work["steps"][0]["reads"]), (Some("agent_1"), &Json::Null));
		let other = lesson_work(&app, &b).unwrap();
		assert_eq!(other["steps"].items().len(), 0, "the other lesson's turn is its own");

		end_turn(&app, &a);
		assert_eq!(lesson_work(&app, &a).unwrap()["live"], json!(false));
		assert!(told(&mut events).contains(&not_asking(&a)), "its end is told");
		note_step(&app, &a, step("Late"), None, None);
		assert_eq!(lesson_work(&app, &a).unwrap()["steps"], json!([]), "a step after the turn is dropped");
		end_turn(&app, &b);
	}

	#[test]
	fn a_permission_question_is_a_card_in_the_teacher_s_name_until_it_is_answered() {
		let root = scratch_dir("turn-work-approval");
		let app = test_app(&root);
		app.stores.settings.write_settings(&json!({ "version": 2, "general": { "teacherName": "Zed" } })).unwrap();
		let chat = app.stores.chats.create_chat("Files", Some("study"), None, None, &[]).unwrap()["id"].str_or_empty().to_owned();
		assert!(begin_turn(&app, &chat));
		begin(&app, &chat, TurnCause::Ask);
		let mut events = app.events.subscribe();
		let desk = desk_listener(&app, &chat);
		desk(&DeskEvent::Approval { id: "ap_1".to_owned(), ask: json!({ "kind": "tool", "name": "Read", "input": { "file_path": "/h/notes/week 3.md" } }) });
		assert_eq!(lesson_work(&app, &chat).unwrap()["approvals"], json!([{ "id": "ap_1", "text": "Zed wants to read this file.", "subject": { "kind": "file", "text": "week 3.md" } }]));
		desk(&DeskEvent::ApprovalDone { id: "ap_1".to_owned() });
		assert_eq!(lesson_work(&app, &chat).unwrap()["approvals"], json!([]));
		assert_eq!(told(&mut events), [json!({ "chatId": chat, "asking": true }), json!({ "chatId": chat, "asking": false })], "the strip hears it wait and go");
		end_turn(&app, &chat);
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
