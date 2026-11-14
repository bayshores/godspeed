//! The engine side: the outside agent as a model. Each request parks a work item and waits for
//! the agent's reply; an abort (the learner's Stop) ends the wait with an empty message, which
//! the faux stream then ends as aborted.

use std::sync::Arc;

use futures_util::future::BoxFuture;
use gs_base::events::EventKind;
use gs_base::{clock, ids};
use gs_core::records::settings::{OUTSIDE_AGENT_CONTEXT_WINDOW, OUTSIDE_AGENT_MODEL_ID, OUTSIDE_AGENT_PROVIDER};
use gs_json::Json;
use tokio::sync::oneshot;

use super::{Bridge, WorkItem, is_background};
use crate::turn::abort::Abort;
use crate::turn::faux::{Request, Respond, faux_model};
use crate::turn::messages::{faux_assistant_message, text_block};

/// The bridge's one model entry (catalog and engine).
pub fn agent_model() -> Json {
	faux_model("godspeed-agent", OUTSIDE_AGENT_PROVIDER, OUTSIDE_AGENT_MODEL_ID, "Outside agent (MCP)", OUTSIDE_AGENT_CONTEXT_WINDOW as f64, 32_000.0)
}

impl Respond for Bridge {
	fn respond(&self, request: Request) -> Option<BoxFuture<'static, Result<Json, String>>> {
		let bridge = self.clone();
		Some(Box::pin(async move { Ok(bridge.await_agent(request.messages, request.session_id, request.abort).await) }))
	}
}

impl Bridge {
	/// The faux responder this bridge answers through.
	pub(crate) fn responder(&self) -> Arc<dyn Respond> {
		Arc::new(self.clone())
	}

	/// Parks one request and waits for the agent's reply (or an abort).
	async fn await_agent(&self, context: Vec<Json>, session_id: Option<String>, abort: Abort) -> Json {
		let id = ids::uuid_head("work", 12);
		let conversation = session_id.clone().unwrap_or_else(|| id.clone());
		let background = is_background(&conversation);
		if abort.is_aborted() {
			if background {
				self.emit(EventKind::ActivityChanged);
			}
			return empty_reply();
		}
		let (tx, rx) = oneshot::channel();
		{
			let mut s = self.0.state.lock();
			s.items.push(WorkItem {
				id: id.clone(),
				conversation: conversation.clone(),
				created_at: clock::now_ms(),
				context: Arc::new(context),
				claimed_at: None,
				agent: None,
				terminal: None,
				claims: 0,
				agent_forgot: false,
				pages: Vec::new(),
				unread: Default::default(),
				reply: Some(tx),
			});
			if session_id.is_some() && background {
				s.background_runs.insert(conversation.clone());
			}
		}
		self.emit(EventKind::AgentChanged);
		if background {
			self.emit(EventKind::ActivityChanged);
		}
		self.0.waiters.wake_all();
		// The abort takes the item out inside the aborting call, as the TS listener does, so its
		// events come before whatever the aborting caller does next. The dropped sender then ends
		// the wait with an empty message.
		let _listener = abort.on_abort({
			let (bridge, id, conversation) = (self.clone(), id.clone(), conversation.clone());
			move || bridge.abandon(&id, &conversation)
		});
		// A caller that drops this wait (a select or timeout around the model call) must not
		// leave behind an item whose answer nobody receives.
		let _parked = Parked { bridge: self, id: &id, conversation: &conversation };
		rx.await.unwrap_or_else(|_| empty_reply())
	}

	/// Takes an unanswered request out of the queue (an answered one is gone already).
	fn abandon(&self, id: &str, conversation: &str) {
		let removed = {
			let mut s = self.0.state.lock();
			let before = s.items.len();
			s.items.retain(|i| i.id != id);
			s.items.len() != before
		};
		if removed {
			self.emit(EventKind::AgentChanged);
			if is_background(conversation) {
				self.emit(EventKind::ActivityChanged);
			}
		}
	}
}

fn empty_reply() -> Json {
	faux_assistant_message(vec![text_block("")], "stop")
}

/// Takes a parked item out of the queue when its wait ends without an answer.
struct Parked<'a> {
	bridge: &'a Bridge,
	id: &'a str,
	conversation: &'a str,
}

impl Drop for Parked<'_> {
	fn drop(&mut self) {
		self.bridge.abandon(self.id, self.conversation);
	}
}
