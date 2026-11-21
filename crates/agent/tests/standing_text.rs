//! Where each teaching line of the guess, keep, stop and come-back work lands in the composed
//! instructions: a line naming a Study-only tool, field, stop or note only in Study; the case-first,
//! analogy and prediction lines in Study and ordinary lessons; the marks line in every lesson
//! agent; the broken formulas line beside the work plan; the voice line in every agent;
//! the deadline tools sentence in every lesson agent but Study. Each line is said once, and the sentences it replaced are gone. No size is
//! pinned, so later prompt edits do not trip it.

use gs_agent::teacher::prompt_segments::AgentKind;
use gs_agent::teacher::teacher_agent::compose_instructions;
use gs_base::config::Paths;
use gs_store::prompt_overrides::PromptOverrides;

use AgentKind::{Homework, Practice, Prober, Study, Teacher};

const EVERY: [AgentKind; 5] = [Prober, Teacher, Practice, Study, Homework];

/// S, the place to stop.
const S: &str = "godspeed offers a stop at the end of each topic and long problem; stopping there costs him nothing.";
/// F, how a topic ends.
const F: &str = "After a `conclude` not finishing the topic: closing words, end turn. Finishes topic: its `verdict` is your closing words, no other prose; then read what next topic needs, call `topic_done` in its own reply. Right quiz finishes topic: no prose; read what next topic needs, call `topic_done`.";
/// F, the verdict at a topic end.
const F_VERDICT: &str = "At a topic end, the verdict says what is now solid, in exact terms, and gives one exact credit: a move he made that you saw in the transcript or a tool result (an answer, a line of his work). Never credit what you did not see. Do not name the next topic; godspeed shows it. Never ask whether he wants to go on, and never mention time, tiredness or breaks.";
/// F, the [Resumed] line.
const F_RESUMED: &str = "[Resumed] line: he came back to a stopped session. No recap. His answer to the opener is next step.";
/// Decision 3, the strong topic's extra question.
const EXTRA_QUESTION: &str = "Strong topic's extra question = `quiz` before `conclude`; he may skip it. Skip it yourself when a deadline is 2 days away or less.";
/// Decision 1, the line Study gets in place of the deadline tools.
const OUTSIDE_DEADLINES: &str = "Deadline changes happen outside lessons, in your terminal. He asks for one: say so in one line, back to the lesson.";
const F3: &str = "[From earlier] line lists earlier questions godspeed just re-asked. Don't reteach a miss now unless it's on current topic; godspeed brings it back.";
const G: &str = "`standalone: true` on a quiz that makes sense with no lesson around it: name the setting, never \"above\", \"the plot\" or \"the slide\". godspeed may ask it again weeks later.";
const I: &str = "Point at exact words: a few words copied from the passage in quotes after the id: `[[f_1a2b3c4d5e6f:7 \"degree 12\"]]`. godspeed marks them on his page. Once per topic, in the message opening it or in topic_done's opener.lead. Quote = 2+ words (on code: exact expression from the line), found once in the passage, max 80 characters, no [ ] backtick or $.";
const K: &str = "Quiz proves an idea the topic stands on: add `keep`, one sentence he can hold without the lesson, in space's own words. Max 2 keeps per topic. None on a quiz whose own reply shows a plot, none right after a plot or another keep. Card is the only place he reads a kept sentence, its fits or stops: don't write that sentence in the reply carrying the keep or the one before. After testing an analogy, next keep carries `fits` and `stops`; `stops` names first concrete place a careful student would carry it too far. After an [Analogy dropped] line: never mention that analogy again, give no other for that idea.";
/// When a plot beats a table.
const PLOT: &str = "Idea is a curve: send `plot` with a prediction on it: formula with one knob, or measured numbers as `points`. Never a table whose rows are points of one curve.";
/// No question lists in chat.
const PROBLEMS: &str = "Problems go through `problem` and `conclude`, never chat prose. One question at a time; never a list of questions in a reply.";
/// A broken formula is looked at before it is taught.
const FORMULAS: &str = "Passage's formulas read broken → have page looked at with `pdf` before teaching from it.";
/// E3, the memory phrase.
const PHRASE: &str = "`keep.phrase` only when a short phrase makes the sentence easier to remember: well-known one (SOH CAH TOA) or one made from space's own words. Never look one up, never draw one. Else leave it out.";
const B: &str = "Space files have a worked example, figure or line of code for the first unconditional truth: give that case first, then state the truth it shows.";
const C: &str = "3. **His own case first.** Space files have a worked example, figure or line of code for the idea: open on it, cite it. They don't: build a small case with numbers he can check, or simply assert a foundational truth. An analogy comes only after the case, and only when every part he will lean on maps onto the idea. Give it as one sentence on what it gets right. Never a table or callout for it. Never a second analogy for the same idea. Nothing maps: use none, say nothing about it. He asks for one and none holds: say so in one sentence, go back to the case. He says an analogy didn't help: drop it in one line, go back to the case.";
const D: &str = "- Offered an analogy → next prediction is one where analogy and idea give different answers. After his answer, say in one sentence where analogy stops fitting.";
const P2: &str = "Card says nothing when his pick was right and names right answer when not, so open with one plain sentence that names his pick in a few of its words and says whether it holds. Your prose resolution is the real explanation; land correction on the attempt.";
const M: &str = "Marks in message text only, never inside a question, problem or other tool call, unless a field's description asks for one.";
const E: &str = "No moralizing. His choices about pace, effort, and what to work on are logistics, never judgments. Never mention time away, missed days, or what he did not do.";
const DEADLINE_TOOLS: &str = "Learner asks to add, move or remove a deadline mid-lesson → deadline tools (list_spaces gives space id), say what changed in one line, back to where lesson was.";

/// Sentences the lines above replaced or removed: no agent reads them any more.
const GONE: [&str; 12] = [
	"After `conclude`, say your closing words and end your turn.",
	"After the last topic, wrap up in a few sentences",
	"goes in your closing words as plain chat",
	"Then ask him in one line where he would use one of today's topics",
	"The card already showed him the verdict and the committed answer",
	"or any other tool call.",
	"Do it once per topic",
	"Never restate a kept sentence",
	"none on the quiz right after a page",
	"Do not draw that curve as a table.",
	"Never ask a numbered list of questions in chat.",
	"shows a page or a plot",
];

fn composed(kind: AgentKind) -> String {
	// No folder there, so no saved versions: the shipped text.
	let none = std::env::temp_dir().join("gs-standing-text-no-overrides");
	compose_instructions(kind, &PromptOverrides::new(&Paths::new(none.clone(), none.clone(), none.clone(), none)))
}

/// `line` is said exactly once in the agents of `readers` and never in the others.
fn lands_in(line: &str, readers: &[AgentKind]) {
	for kind in EVERY {
		let count = composed(kind).matches(line).count();
		assert_eq!(count, usize::from(readers.contains(&kind)), "{kind:?}: {line}");
	}
}

#[test]
fn the_study_only_lines_reach_study_alone() {
	for line in [S, F, F_VERDICT, F_RESUMED, EXTRA_QUESTION, OUTSIDE_DEADLINES, F3, G, I, K, PLOT, PROBLEMS, PHRASE] {
		lands_in(line, &[Study]);
	}
}

#[test]
fn the_case_analogy_and_prediction_lines_reach_study_and_ordinary_lessons() {
	for line in [B, C, D, P2] {
		lands_in(line, &[Study, Teacher]);
	}
}

#[test]
fn the_marks_line_reaches_every_lesson_agent_and_the_voice_line_every_agent() {
	lands_in(M, &EVERY);
	lands_in(E, &EVERY);
}

#[test]
fn the_broken_formulas_line_reaches_the_agents_that_plan_their_reads() {
	lands_in(FORMULAS, &[Prober, Teacher, Study]);
}

#[test]
fn the_deadline_tools_sentence_reaches_every_lesson_agent_but_study() {
	lands_in(DEADLINE_TOOLS, &[Prober, Teacher, Practice, Homework]);
}

#[test]
fn the_replaced_sentences_are_gone() {
	for kind in EVERY {
		let text = composed(kind);
		for old in GONE {
			assert!(!text.contains(old), "{kind:?} still reads: {old}");
		}
	}
}
