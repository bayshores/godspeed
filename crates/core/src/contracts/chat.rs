//! Lesson record constants and model-facing marker texts (src/shared/core/contracts/chat.ts).

/// Every lesson id starts with this.
pub const CHAT_ID_PREFIX: &str = "chat_";
/// The Talk chat's fixed id.
pub const TALK_CHAT_ID: &str = "chat_talk";
/// v2: `classId`, the "class-context" card and a deadline request's `className` are named for spaces.
/// v3: no field changes, but new markers (keep-going, opener-answer, app-note) and stops in result
/// details, which an older build would send to the agent as empty messages.
pub const CURRENT_CHAT_VERSION: i64 = 3;

/// Whether a session's teaching is saved to the graph: teach (absent kind) and study lessons.
pub fn extracts_facts(kind: Option<&str>) -> bool {
	matches!(kind, None | Some("teach" | "study"))
}

pub const HANDOFF_TEXT: &str = concat!(
	"Next: plan the full teaching arc from my current understanding to the goal understanding. ",
	"Apply the teaching methodology in your system prompt, and find the optimal way to teach me this. ",
	"Find the unconditional truths, plan the motivated derivations/discoveries, so every reasoning step has to land as obviously true. ",
	"Take your time here and really think this through. ",
	"When it's genuinely reasoned out, call plan_init and present the plan; I'll accept it or ask for changes."
);

pub const CONCLUDE_ACK_TEXT: &str = "Problem concluded. Say your closing words about the learner's work if useful, then END YOUR TURN — no further tool calls. The next problem waits for the learner's explicit go-ahead (a *Next problem* message, or their own words asking for the next one). The one exception: when the learner asked for a different problem or part, that ask is the go-ahead, so pose it now. Between problems, answer their questions about the concluded one.";

/// The study conclude's result when it finishes a topic, in place of CONCLUDE_ACK_TEXT, so the
/// agent never gets "END YOUR TURN" and "call topic_done" in one text.
pub const STUDY_TOPIC_END_ACK_TEXT: &str = "Problem concluded. This finishes the topic: write no prose. Read what the next topic needs, then call topic_done.";

/// The Study tool that stores a finished topic's review question and the next topic's opener.
/// Its result ends the agent's turn.
pub const TOPIC_DONE_TOOL: &str = "topic_done";

/// topic_done's result text.
pub const TOPIC_DONE_STORED_TEXT: &str = "Stored. He sees the stop now; the opener shows when he goes on.";

pub const NEXT_PROBLEM_TEXT: &str = "[NEXT PROBLEM] — the learner's explicit go-ahead: pose the next problem now per the selection rules, or wrap the session in text if the arc is complete.";

pub const COMPACTED_HISTORY_HEADER: &str = "[SESSION HISTORY COMPACTED] The transcript before this point was summarized to fit the context window; the summary below replaces it. Everything after this message is the verbatim recent transcript.";
