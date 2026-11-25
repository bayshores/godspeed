//! The permission questions background jobs wait on. Each shows as the lessons' Allow / Deny card on
//! the page that started its job (the lesson that asked, the cheat sheet) until the learner answers
//! or the job ends. Jobs nobody watches get no `Approve`, so the agent's own requests are denied.

use std::sync::{Arc, Weak};

use gs_base::ids::uuid_hex;
use gs_engine::turn::job_session::Approve;
use gs_engine::turn::session_turn::ask_json;
use gs_json::Json;
use gs_runtime::{Ask, Verdict};
use parking_lot::Mutex;
use tokio::sync::oneshot;

use crate::App;
use crate::turns::turn_work::{approval_view, lesson_work_changed};

/// The page a job's question shows on.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum AskedOn {
	Lesson(String),
	/// A cheat sheet, by its deadline's id.
	Sheet(String),
}

struct Waiting {
	id: String,
	on: AskedOn,
	card: Json,
	reply: oneshot::Sender<Verdict>,
}

/// The questions waiting, oldest first.
#[derive(Default)]
pub struct JobAsks(Mutex<Vec<Waiting>>);

const DENY: Verdict = Verdict { allow: false, message: None };

/// A job's `approve`: its questions wait on `on` for the learner's answer.
pub fn approve_on(app: &Arc<App>, on: AskedOn) -> Approve {
	let app = Arc::downgrade(app);
	Arc::new(move |ask: Ask| {
		let (app, on) = (app.clone(), on.clone());
		Box::pin(async move {
			let Some(strong) = app.upgrade() else { return DENY };
			let id = uuid_hex("approval", 12);
			let (reply, answer) = oneshot::channel();
			let card = approval_view(&strong, &id, &ask_json(&ask));
			strong.jobs.asks.0.lock().push(Waiting { id: id.clone(), on: on.clone(), card, reply });
			told(&strong, &on);
			drop(strong);
			// A job that ends first takes its question off the page.
			let _gone = Gone { app, id, on };
			answer.await.unwrap_or(DENY)
		})
	})
}

struct Gone {
	app: Weak<App>,
	id: String,
	on: AskedOn,
}

impl Drop for Gone {
	fn drop(&mut self) {
		let Some(app) = self.app.upgrade() else { return };
		if take(&app, &self.on, &self.id).is_some() {
			told(&app, &self.on);
		}
	}
}

fn take(app: &App, on: &AskedOn, id: &str) -> Option<Waiting> {
	let mut asks = app.jobs.asks.0.lock();
	let at = asks.iter().position(|w| w.id == id && w.on == *on)?;
	Some(asks.remove(at))
}

/// The learner's answer to a job's question on `on`; false when none waits there by that id.
pub fn answer_job_ask(app: &App, on: &AskedOn, id: &str, allow: bool) -> bool {
	let Some(waiting) = take(app, on, id) else { return false };
	let _ = waiting.reply.send(Verdict { allow, message: None });
	told(app, on);
	true
}

/// The cards of the questions waiting on `on`, oldest first.
pub fn asks_on(app: &App, on: &AskedOn) -> Vec<Json> {
	app.jobs.asks.0.lock().iter().filter(|w| w.on == *on).map(|w| w.card.clone()).collect()
}

fn told(app: &App, on: &AskedOn) {
	match on {
		AskedOn::Lesson(chat_id) => lesson_work_changed(app, chat_id),
		AskedOn::Sheet(deadline_id) => crate::cheat_sheets::changed(app, deadline_id),
	}
}
