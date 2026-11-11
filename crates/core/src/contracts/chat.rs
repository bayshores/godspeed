//! Lesson record constants and model-facing marker texts (src/shared/core/contracts/chat.ts).

/// Every lesson id starts with this.
pub const CHAT_ID_PREFIX: &str = "chat_";
/// The Talk chat's fixed id.
pub const TALK_CHAT_ID: &str = "chat_talk";
pub const CURRENT_CHAT_VERSION: i64 = 1;

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

pub const THINKING_LABEL: &str = "Your thinking";

pub const CONCLUDE_ACK_TEXT: &str = "Problem concluded. Say your closing words about the learner's work if useful, then END YOUR TURN — no further tool calls. The next problem is NEVER posed here: it waits for the learner's explicit go-ahead (a *Next problem* message, or their own words asking for the next one). Between problems, answer their questions about the concluded one.";

pub const NEXT_PROBLEM_TEXT: &str = "[NEXT PROBLEM] — the learner's explicit go-ahead: pose the next problem now per the selection rules, or wrap the session in text if the arc is complete.";

pub const COMPACTED_HISTORY_HEADER: &str = "[SESSION HISTORY COMPACTED] The transcript before this point was summarized to fit the context window; the summary below replaces it. Everything after this message is the verbatim recent transcript.";
