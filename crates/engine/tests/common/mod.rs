//! What the bridge tests share: saved marks kept in memory, and a model call parked on the
//! bridge the way a lesson turn or background job parks one.

use gs_core::records::agent_seen::{SeenMark, SeenStore};
use gs_engine::bridge::Bridge;
use gs_engine::turn::abort::Abort;
use gs_engine::turn::faux;
use gs_engine::turn::models::agent_engine;
use gs_json::Json;
use parking_lot::Mutex;
use tokio::task::JoinHandle;

/// data/agent-seen.json in memory, keyed "agent conversation" in the order first saved.
#[derive(Default)]
pub struct Marks(pub Mutex<Vec<(String, SeenMark)>>);

impl SeenStore for Marks {
	fn get(&self, agent: &str, conversation: &str) -> Option<SeenMark> {
		let key = format!("{agent} {conversation}");
		self.0.lock().iter().find(|(k, _)| *k == key).map(|(_, m)| m.clone())
	}
	fn set(&self, agent: &str, conversation: &str, mark: &SeenMark) {
		let key = format!("{agent} {conversation}");
		let mut marks = self.0.lock();
		match marks.iter_mut().find(|(k, _)| *k == key) {
			Some(slot) => slot.1 = mark.clone(),
			None => marks.push((key, mark.clone())),
		}
	}
	fn forget_agent(&self, agent: &str) {
		self.0.lock().retain(|(k, _)| !k.starts_with(&format!("{agent} ")));
	}
}

/// Starts one model call on the bridge; it ends with the agent's reply as an assistant message.
pub fn park(bridge: &Bridge, messages: Vec<Json>, conversation: &str, abort: &Abort) -> JoinHandle<Json> {
	let engine = agent_engine(bridge);
	let (conversation, abort) = (conversation.to_owned(), abort.clone());
	tokio::spawn(async move { faux::stream(&engine, messages, Some(conversation), &abort, &mut |_| {}).await })
}
