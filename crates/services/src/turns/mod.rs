//! Lessons, turns, Talk and catch-up (src/backend/server: chat-handler, turn-liveness, turn-runs,
//! turn-service, dismissal-park, compaction, attachments, lessons, homework, talk, chats,
//! agent-catch-up). One module per TS file; the live registries the TS kept on `globalThis` are
//! the fields of `TurnsState`.

pub mod agent_catch_up;
mod agent_ports;
pub mod attachments;
pub mod chat_handler;
pub mod chats;
pub mod compaction;
pub mod dismissal_park;
pub mod homework;
mod job_host;
mod lesson_agent;
pub mod lessons;
pub mod talk;
pub mod turn_liveness;
pub mod turn_runs;
pub mod turn_service;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::AtomicBool;

use gs_core::messages::input_events::DismissInput;
use gs_engine::turn::ui_stream::TurnHandle;
use parking_lot::Mutex;
use tokio::sync::watch;

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
	/// The kept notice of a turn whose settlement failed (turn-runs).
	failures: Mutex<HashMap<String, String>>,
	/// A dismissal that arrived mid-turn, applied at settle (dismissal-park).
	parked: Mutex<HashMap<String, DismissInput>>,
	/// Running compactions: each ends by sending `true` (or dropping its sender).
	compactions: Mutex<HashMap<String, watch::Receiver<bool>>>,
	/// The leftover-extraction timer of each chat: its number, so a newer one replaces it.
	leftover_timers: Mutex<HashMap<String, u64>>,
	leftover_count: Mutex<u64>,
	/// Catch-up ran its lesson pass this run.
	lessons_caught_up: AtomicBool,
	/// A deadline request to Talk is on its way.
	asking_deadlines: AtomicBool,
}
