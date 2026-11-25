//! The server instructions an agent gets when it connects: what godspeed is, the "Where you left
//! off" briefing, then memory and spaces.

use std::sync::Arc;

use gs_base::text::len16;
use gs_services::App;

/// Claude Code cuts a server's instructions after this many characters, so the briefing is sized
/// for memory to end before the cut. The margin allows for a count that differs a little from ours.
const INSTRUCTIONS_CUT: usize = 4096;
const CUT_MARGIN: usize = 96;

const INTRO: &str = "godspeed is a learning app; you are its AI. Outside lessons the learner types to you in godspeed's terminal: answer them there. These instructions are short to save tokens. Write to the learner in full, plain sentences.

Asked to show a page (\"open my cheat sheet\"): open_page. Asked to study for or work on a deadline: start_lesson with deadline_id. For one thing for it (one topic): topic too.";

const MEMORY_INSTRUCTIONS: &str = "Memory: \"Where you left off\" above = learner's state when you connected; list_lessons and read_space have anything newer. Learner tells you something outside a lesson that matters next time (exam over, what to study next, how they like to learn): save with remember, one fact per note, never passwords or private details. Remove out-of-date notes with forget.";

// Last because each space tool's description says the same, so a client's cut loses least here.
const SPACE_INSTRUCTIONS: &str = "Spaces: learner sorts learning into spaces (one per thing they study, like a university course or a certification), each with own lessons, knowledge graph, description and files. \"study\" files (notes, readings, transcripts, recordings) become graph facts; \"info\" files (syllabus, schedule, logistics) are only read by the teacher. godspeed sorts a linked folder's files into study and info itself. Take deadlines (exam, homework, quiz, project, interview: a date, optional time, files they cover) from space info files with add_space_deadline; change, tick done or remove with update_space_deadline / remove_space_deadline. Date, time or covered files unclear: ask the learner, don't guess. Teach inside a space with start_lesson and space_id; lessons without one are in \"No space\". Closed spaces take no new lessons; ask the learner to reopen one first. Only the godspeed window can delete a space.";

/// The room the briefing gets after the intro so that memory still ends before Claude Code's cut.
fn briefing_room() -> usize {
	let before = len16(INTRO) + 2;
	let after = 2 + len16(MEMORY_INSTRUCTIONS);
	INSTRUCTIONS_CUT - CUT_MARGIN - before - after
}

/// What initialize and server/discover hand over.
pub fn connect_instructions(app: &Arc<App>) -> String {
	let briefing = gs_services::app::agent_memory::current_agent_briefing(app, briefing_room());
	[INTRO, &briefing, MEMORY_INSTRUCTIONS, SPACE_INSTRUCTIONS].join("\n\n")
}

#[cfg(test)]
mod tests {
	use super::*;

	/// What the fixed texts leave of the 4,096 characters: a longer text here shrinks the briefing.
	#[test]
	fn the_fixed_texts_leave_the_briefing_its_room() {
		assert_eq!(briefing_room(), 3242);
	}
}
