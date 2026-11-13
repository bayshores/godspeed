//! The server instructions an agent gets when it connects: the work loop, the "Where you left
//! off" briefing, then memory and spaces.

use std::sync::Arc;

use gs_base::text::len16;
use gs_services::App;

/// Claude Code cuts a server's instructions after this many characters, so the loop comes first
/// and the briefing is sized for memory to end before the cut. The margin allows for a count
/// that differs a little from ours.
const INSTRUCTIONS_CUT: usize = 4096;
const CUT_MARGIN: usize = 96;

pub const INSTRUCTIONS: &str = "godspeed is a learning app and you are its AI: the teacher in lessons, the worker behind its jobs (research, demos, diagrams, PDF reading) and its knowledge-graph builder.

The work loop:
1. Call wait_for_work. It returns a work item, or \"idle\" after a while; then call it again.
2. A work item is a JSON block with \"tools\" (what you may call) and \"messages\" (the conversation so far), then plain-text blocks: its instructions (your system prompt here, the app's teaching method; follow them exactly) and each long message text (the message reads \"[text N]\" and its block starts with \"[text N]\"). \"continued\": true means only new messages follow; when it also carries instructions or tools, they changed and replace the ones you had for this conversation. \"instructionsAsIn\" and \"toolsAsBefore\" point at instructions and tool schemas you already got. A long item comes in pages: read every page with read_work before you respond. \"[image N]\" marks the images sent with the item, in order.
3. Answer with respond: text and/or tool calls, exactly as a model would. If the app needs you again right away (e.g. tool results), respond returns the next work item.
4. When respond says the turn is complete, the learner is answering in the godspeed window. Call wait_for_work again.

Lost track of a work item (context compacted, or missing the instructions or tools it refers to)? Call read_work with its work_id and full: true. Without the workId, call wait_for_work with full_context: true.

Loop until the user says stop. Use only the work item's tools, never invented ones, called through respond even when this server has one with the same name (like read_space): only then does the lesson keep what you looked up. The learner never sees text outside respond.";

const MEMORY_INSTRUCTIONS: &str = "Memory: \"Where you left off\" above is the learner's state when you connected; list_lessons and read_space have anything newer. When the learner tells you something outside a lesson that will matter next time (an exam is over, what to study next, how they like to learn), save it with remember, one fact per note, never passwords or private details. Remove out-of-date notes with forget.";

// Last because each space tool's description says the same, so a client's cut loses least here.
const SPACE_INSTRUCTIONS: &str = "Spaces: the learner can sort learning into spaces (one per thing they study, like a university course or a certification), each with its own lessons, knowledge graph, description and files. \"study\" files (notes, readings, transcripts, recordings) become graph facts; \"info\" files (a syllabus, a schedule, logistics) are only read by the teacher. godspeed sorts a linked folder's files into study and info itself. Take deadlines (exam, homework, quiz, project: a date, an optional time, the files they cover) from the space info files with add_space_deadline; change, tick done or remove them with update_space_deadline / remove_space_deadline. If a date, time or the covered files aren't clear, ask the learner instead of guessing. Teach inside a space with start_lesson and space_id; lessons without one are in \"No space\". Archived spaces take no new lessons; ask the learner to unarchive one first. Only the godspeed window can delete a space.";

/// The room the briefing gets so that memory still ends before Claude Code's cut.
fn briefing_room() -> usize {
	let before = len16(INSTRUCTIONS) + 2;
	let after = 2 + len16(MEMORY_INSTRUCTIONS);
	INSTRUCTIONS_CUT - CUT_MARGIN - before - after
}

/// What initialize and server/discover hand over. (In Claude Code, the godspeed folder's
/// CLAUDE.md says how to wait with the waiter.)
pub fn connect_instructions(app: &Arc<App>) -> String {
	let briefing = gs_services::app::agent_memory::current_agent_briefing(app, briefing_room());
	[INSTRUCTIONS, &briefing, MEMORY_INSTRUCTIONS, SPACE_INSTRUCTIONS].join("\n\n")
}

#[cfg(test)]
mod tests {
	use super::*;

	/// What the fixed texts leave of the 4,096 characters: a longer text here shrinks the briefing.
	#[test]
	fn the_fixed_texts_leave_the_briefing_its_room() {
		assert_eq!(briefing_room(), 1852);
	}
}
