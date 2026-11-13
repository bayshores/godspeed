//! probe_done: the probe-to-planning seam. The prober ends the
//! probe by authoring the assessment (the call's own arguments); this tool checks nothing is open
//! and queues the teacher's first turn.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gs_core::messages::native_messages::{dangling_question_of, has_probe_done, new_handoff_message};
use gs_core::session::probe::{PROBE_DONE_ACK_TEXT, probe_done_input_schema};
use gs_json::json;

use super::fn_tool::FnTool;
use super::ports::{ChatPort, Deliver};

/// What probe_done closes over.
#[derive(Clone)]
pub struct ProbeDoneContext {
	pub chat_id: String,
	pub chat_store: Arc<dyn ChatPort>,
	/// Queues the handoff steer (the wake pipeline).
	pub deliver: Deliver,
}

/// This turn's probe state. The stored record only updates when the turn ends, so it cannot see a
/// question or a probe_done from earlier in the same turn.
#[derive(Default)]
pub struct ProbeGate {
	pub question_posed: AtomicBool,
	pub concluded: AtomicBool,
}

pub fn probe_done_tool(ctx: &ProbeDoneContext, gate: &Arc<ProbeGate>) -> FnTool {
	let (ctx, gate) = (ctx.clone(), gate.clone());
	let description = "Conclude the probing phase and hand off to the teaching phase. Call this ONCE, when the probe is \
		complete: every strand the lesson depends on is bracketed (a floor he reliably gets right AND a \
		ceiling where it runs out), and his learning goal is concrete. The input IS the learner assessment \u{2014} \
		one strand per dependency the lesson will rest on, with your read of where his edge sits on it \
		(floor, ceiling, misconceptions, what to build from). It streams to the learner live and becomes \
		the handoff artifact the teacher plans from. Refused while a question is still open, and after \
		the probe is already concluded. After it succeeds, say your closing sentence and end your turn.";
	FnTool::server("probe_done", description, probe_done_input_schema(), move |_args, _ctx| {
		let (ctx, gate) = (ctx.clone(), gate.clone());
		async move {
			let Some(record) = ctx.chat_store.get_chat(&ctx.chat_id) else {
				return Ok(json!({ "ok": false, "error": format!("Chat not found: {}", ctx.chat_id) }));
			};
			let messages = record["messages"].as_arr().cloned().unwrap_or_default();
			if gate.question_posed.load(Ordering::SeqCst) || dangling_question_of(&messages).is_some() {
				return Ok(json!({
					"ok": false,
					"error": "A question is still open \u{2014} resolve it (or let him answer) before concluding the probe. probe_done only fires with no question outstanding.",
				}));
			}
			if gate.concluded.load(Ordering::SeqCst) || has_probe_done(&messages) {
				return Ok(json!({ "ok": false, "error": "The probe is already concluded \u{2014} probe_done fires exactly once." }));
			}
			gate.concluded.store(true, Ordering::SeqCst);
			// The handoff is recoverable (the next client message builds the teacher off the
			// transcript), so a failed queueing still records the assessment.
			(ctx.deliver)(new_handoff_message(&ctx.chat_id));
			Ok(json!({ "text": PROBE_DONE_ACK_TEXT, "details": { "ok": true } }))
		}
	})
}
