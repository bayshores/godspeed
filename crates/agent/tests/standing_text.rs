//! Where each teaching line of the guess, keep, stop and come-back work lands in the composed
//! instructions: a line naming a Study-only tool, field, stop or note only in Study; the case-first,
//! analogy and prediction lines in Study and ordinary lessons; the marks line in every lesson
//! agent; the voice line in every agent, Talk too; the deadline tools sentence in every lesson
//! agent but Study. Each line is said once, and the sentences it replaced are gone. No size is
//! pinned, so later prompt edits do not trip it.

use gs_agent::teacher::prompt_segments::AgentKind;
use gs_agent::teacher::teacher_agent::compose_instructions;
use gs_base::config::Paths;
use gs_store::prompt_overrides::PromptOverrides;

use AgentKind::{Homework, Practice, Prober, Study, Talk, Teacher};

const EVERY: [AgentKind; 6] = [Prober, Teacher, Practice, Study, Homework, Talk];

/// S, the place to stop.
const S: &str = "godspeed offers a place to stop at the end of each topic and of a long problem; stopping there costs him nothing.";
/// F, how a topic ends.
const F: &str = "After a `conclude` that does not finish the topic, say your closing words and end your turn. When it finishes the topic, its `verdict` is your closing words and you write no other prose; then read what the next topic needs and call `topic_done` in its own reply. When a right quiz finishes the topic, write no prose: read what the next topic needs, then call `topic_done`.";
/// F, the verdict at a topic end.
const F_VERDICT: &str = "At a topic end, the verdict says what is now solid, in exact terms, and gives one exact credit: a move he made that you saw in the transcript or a tool result (an answer, a line of his work). Never credit what you did not see. Do not name the next topic; godspeed shows it. Never ask whether he wants to go on, and never mention time, tiredness or breaks.";
/// F, the [Resumed] line.
const F_RESUMED: &str = "A [Resumed] line means he came back to a stopped session. Do not recap. His answer to the opener is the next step.";
/// Decision 3, the strong topic's extra question.
const EXTRA_QUESTION: &str = "A strong topic's extra question is a `quiz` before the `conclude`, and he may skip it; skip it yourself when a deadline is 2 days away or less.";
/// Decision 1, the line Study gets in place of the deadline tools.
const TALK_DEADLINES: &str = "Deadline changes happen in Talk: when he asks for one, say so in one line and go back to the lesson.";
const F3: &str = "A [From earlier] line lists earlier questions godspeed just asked him again. Do not reteach a miss now unless it is on the topic you are teaching; godspeed brings it back.";
const G: &str = "Set `standalone: true` on a quiz that makes sense with no lesson around it: name the setting, never \"above\", \"the plot\" or \"the slide\". godspeed may ask it again weeks later.";
const I: &str = "To point at exact words, add a few words copied from the passage in quotes after the id: `[[f_1a2b3c4d5e6f:7 \"degree 12\"]]`. godspeed marks them on his page. Do it once per topic, in the message that opens it or in topic_done's opener.lead. A quote is 2 or more words, or on code the exact expression from the line, found once in the passage, at most 80 characters, without [ ] backtick or $.";
const K: &str = "When a quiz proves an idea the topic stands on, add `keep`: one sentence he can hold without the lesson, in the space's own words. Never restate a kept sentence, its fits or its stops in your prose, before or after. After you tested an analogy, the next keep carries `fits` and `stops`; `stops` names the first concrete place a careful student would carry it too far. After an [Analogy dropped] line, never mention that analogy again and give no other for that idea.";
/// E3, the memory phrase.
const PHRASE: &str = "Add `keep.phrase` only when a short phrase makes the sentence easier to remember: a well-known one (SOH CAH TOA) or one made from the space's own words. Never look one up and never draw one. Leave it out otherwise.";
const B: &str = "When the space files have a worked example, a figure or a line of code for the first unconditional truth, give that case first, then state the truth it shows.";
const C: &str = "3. **His own case first.** When the space files have a worked example, a figure or a line of code for the idea, open on it and cite it. When they do not, build a small case with numbers he can check, or simply assert a foundational truth. An analogy comes only after the case, and only when every part he will lean on maps onto the idea. Give it as one sentence on what it gets right. Never a table or callout for it. Never a second analogy for the same idea. When nothing maps, use none and say nothing about it. If he asks for one and none holds, say so in one sentence and go back to the case. If he says an analogy did not help, drop it in one line and go back to the case.";
const D: &str = "- When you have offered an analogy, make the next prediction one where the analogy and the idea give different answers. After his answer, say in one sentence where the analogy stops fitting.";
const P2: &str = "The card says nothing when his pick was right and names the right answer when it was not, so open with one plain sentence on whether his pick holds; your prose resolution is the real explanation; make the correction land on the attempt.";
const M: &str = "Marks go in your message text only, never inside a question, a problem or any other tool call, unless a field's own description asks for a mark.";
const E: &str = "No moralizing. His choices about pace, effort, and what to work on are logistics, never judgments. Never mention time away, missed days, or what he did not do.";
const DEADLINE_TOOLS: &str = "When the learner asks you to add, move or remove a deadline mid-lesson, do it with the deadline tools (list_spaces gives the space id), say what changed in one line, and go back to where the lesson was.";

/// Sentences the lines above replaced or removed: no agent reads them any more.
const GONE: [&str; 6] = [
	"After `conclude`, say your closing words and end your turn.",
	"After the last topic, wrap up in a few sentences",
	"goes in your closing words as plain chat",
	"Then ask him in one line where he would use one of today's topics",
	"The card already showed him the verdict and the committed answer",
	"or any other tool call.",
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
	for line in [S, F, F_VERDICT, F_RESUMED, EXTRA_QUESTION, TALK_DEADLINES, F3, G, I, K, PHRASE] {
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
	lands_in(M, &[Prober, Teacher, Practice, Study, Homework]);
	lands_in(E, &EVERY);
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
