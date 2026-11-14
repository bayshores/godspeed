//! Lessons, turns, questions from earlier, Talk and catch-up. One module per TS file; the live registries the TS kept on `globalThis` are
//! the fields of `TurnsState`.

pub mod agent_catch_up;
pub mod attachments;
pub mod chat_handler;
pub mod chats;
pub mod compaction;
pub mod dismissal_park;
pub mod homework;
mod job_host;
mod lesson_agent;
pub mod lesson_events;
pub mod lessons;
pub mod reply_nudges;
pub mod review;
pub mod talk;
pub mod turn_liveness;
pub mod turn_runs;
pub mod turn_service;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;

use gs_core::messages::input_events::DismissInput;
use gs_core::study::reply_nudges::Nudge;
use gs_engine::turn::ui_stream::TurnHandle;
use parking_lot::Mutex;
use tokio::sync::Notify;

pub use agent_catch_up::{ask_about_new_deadlines, catch_up_for_agent};
pub use attachments::{AttachmentError, store_attachments};
pub use chat_handler::{ChatReply, handle_chat_input, send_first_message};
pub use chats::{Refusal, quiesce_chat_for_rewrite, running_work_blocker};
pub use lessons::create_lesson;
pub use turn_liveness::is_turn_running;
pub use turn_runs::{abort_turn, clear_turn_failure};

/// The turn registries inside `App`.
#[derive(Default)]
pub struct TurnsState {
	/// Chats with a turn in flight (turn-liveness).
	in_flight: Mutex<HashSet<String>>,
	/// The running turn of each chat (turn-runs).
	runs: Mutex<HashMap<String, TurnHandle>>,
	/// A turn's handle was registered or its turn ended: `attach_turn` looks again.
	attachable: Notify,
	/// The kept notice of a turn whose settlement failed (turn-runs).
	failures: Mutex<HashMap<String, String>>,
	/// A dismissal that arrived mid-turn, applied at settle (dismissal-park).
	parked: Mutex<HashMap<String, DismissInput>>,
	/// The quiet-wait timer of each chat's summary: its number, so a newer one replaces it.
	refine_timers: Mutex<HashMap<String, u64>>,
	refine_count: Mutex<u64>,
	/// Chats whose summary is being written.
	refining: Mutex<HashSet<String>>,
	/// The leftover-extraction timer of each chat: its number, so a newer one replaces it.
	leftover_timers: Mutex<HashMap<String, u64>>,
	leftover_count: Mutex<u64>,
	/// Catch-up ran its lesson pass this run.
	lessons_caught_up: AtomicBool,
	/// A deadline request to Talk is on its way.
	asking_deadlines: AtomicBool,
	/// The questions from earlier skipped in each lesson's sitting (review).
	review_skips: Mutex<HashMap<String, review::Skips>>,
	/// The reply nudges each Study lesson was sent, by chat and topic (reply-nudges).
	nudged: Mutex<HashSet<(String, String, Nudge)>>,
}
