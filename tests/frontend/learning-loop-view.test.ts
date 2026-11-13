/**
 * The window's half of the two-day story (plan.md section 4): a Study
 * lesson's record built by hand, step by step, and what the view and the
 * models give him at each point. Wednesday evening: questions from earlier
 * while the first reply is written, the opening reply on its page, the plot
 * locked until his guess, the kept card and Drop this analogy, the problem
 * and its conclude, the stop. Saturday: the opener from the record with no
 * turn running, his sentence back in From earlier, Keep going into the
 * third topic, the last stop as the end. The server's half is
 * crates/services/tests/learning_loop_story.rs.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excerptParts, topicPageMarks } from "../../src/frontend/components/citations/page-excerpt-model.ts";
import { fromEarlierRow } from "../../src/frontend/components/lesson/from-earlier-card-model.ts";
import { keptCardView } from "../../src/frontend/components/lesson/kept-card-model.ts";
import { lessonBox, questionTurn } from "../../src/frontend/components/lesson/lesson-box-model.ts";
import { liveText, readPlot } from "../../src/frontend/components/lesson/plot-part-model.ts";
import { answerAnchorSelector, toolCardSelector } from "../../src/frontend/components/lesson/step-context.ts";
import { keepGoingOwesNext, stopCard, stopLightSelector } from "../../src/frontend/components/lesson/stop-card-model.ts";
import {
	activeProblemOf,
	fileCiteMark,
	findPendingToolCall,
	lessonStop,
	needsContinuation,
	openerLeadId,
	projectView,
	topicParts,
	withOpenReview,
	type FromEarlierData,
	type KeptCardData,
	type LhMessage,
	type LhViewMessage,
	type LhViewPart,
	type QuestionAnswerData,
	type ReviewDetails,
	type ReviewQuestion,
} from "../../src/shared/core/index.ts";
import { at, call, keepGoing, marker, OPENER_QUIZ, result, review, reviewDetails, text, topicStop, TREE, userText } from "../stop-fixtures.ts";
import { drop, KEEP, keptLesson, SOURCE_MARK } from "../kept-fixtures.ts";
import { LEASH_CALL, LEASH_GUESS, LEASH_RESULT } from "../plot-fixtures.ts";

/** Saturday 20:40, in minutes from Wednesday 21:00. */
const SAT = 3 * 24 * 60 - 20;
const iso = (minutes: number) => new Date(at(minutes)).toISOString();

/** One reply: words, then calls. */
function reply(id: string, words: string, calls: Array<{ id: string; name: string; arguments: unknown }>, minutes: number): LhMessage {
	const base = call(id, "x", {}, minutes) as LhMessage & { content: unknown[] };
	return { ...base, content: [...(words ? [{ type: "text", text: words }] : []), ...calls.map((c) => ({ type: "toolCall", ...c }))] } as LhMessage;
}

/** His pick of one option, as the window grades it. */
function picked(question: string, label: string, correct: boolean, minutes: number, questionType = "predict"): QuestionAnswerData {
	return { kind: "quiz", tool: "quiz", questionType, questionText: question, dontKnow: false, answers: [{ index: 1, label, value: label }], correct, confidence: 60, answeredAt: iso(minutes) } as QuestionAnswerData;
}

const answerOf = (details: ReviewDetails): ReviewQuestion => ({ of: details.of, nodeId: details.nodeId, topic: details.topic, quiz: details.quiz });

const LECTURE_7 = "f_7a8b9c0d1e2f";
const CV_LEAD = `Here λ is picked on one split of the 60 points, then on another.${fileCiteMark(LECTURE_7, "p. 3", "Lecture 7.pdf", "a different 12")}`;
const MS_QUIZ = { type: "predict", nodeId: "ms", question: "A model wins on one split and loses on four. Which do you keep?", options: [{ label: "The one that wins on average" }, { label: "The one that won once" }], correctAnswer: "The one that wins on average", explanation: "Made up." };
const MS_CHECK = { type: "check", nodeId: "ms", question: "Two models score 0.81 and 0.80 over five splits. What decides?", options: [{ label: "The spread over the splits" }, { label: "The first split" }], correctAnswer: "The spread over the splits", explanation: "Made up." };
const REVIEW_REG = { type: "check", standalone: true, nodeId: "reg", question: "What does a larger penalty do to large weights?", options: [{ label: "Prices them" }, { label: "Caps them" }], correctAnswer: "Prices them", explanation: "Made up." };

// ── Wednesday 21:00 ──────────────────────────────────────────────────────────

const BAYES_WED = reviewDetails("Bayes' rule", "wrong", 0);
const EIGEN_WED = reviewDetails("Eigenvalues", "right", 0);
const GD_WED = reviewDetails("Gradient descent", "right", 0);

const start: LhMessage[] = [userText("u_start", "Study for Midterm", 0)];
const firstReplyWait: LhMessage[] = [review("rv_bayes", BAYES_WED, 0.2), review("rv_eigen", EIGEN_WED, 0.4), review("rv_gd", GD_WED, 0.6)];
/** Words alone, quoting Lecture 6 page 14. */
const opening: LhMessage[] = [text("open", `Picture fitting a curve of degree 12 to ten points ${SOURCE_MARK}. It hits every point.`, 1)];
const plain: LhMessage[] = [
	marker("note_1", "app-note", { kinds: ["from-earlier"] }, 2, "[From earlier] Bayes' rule wrong, sure 3, picked Wrong. Eigenvalues right, sure 4. Gradient descent right, sure 4."),
	userText("u_2", "It swings wildly between them?", 2),
	text("r2", "A penalty on the weights: the loss grows with them.", 3),
];
const plotPair: LhMessage[] = [
	userText("u_3", "How much does it shrink them?", 4),
	reply("r3", "A common picture is a leash on the weights.", [{ id: "call_q", name: "quiz", arguments: LEASH_GUESS }, { id: "call_p", name: "plot", arguments: LEASH_CALL }], 5),
	result("call_p", "plot", LEASH_RESULT, 5),
];
const guessed: LhMessage[] = [result("call_q", "quiz", picked(LEASH_GUESS.question, "At 2, the leash's length.", false, 6), 6), text("r4", "Not quite: the penalty puts it at 4. The leash is a picture, and here it breaks.", 6.5)];
const keptRight: LhMessage[] = [userText("u_5", "Ok, test me.", 7.5), ...keptLesson()];
const analogyDropped: LhMessage[] = [drop("analogy-drop", false, 9.8), text("r6", "Right: the fit scales with the data.", 10)];
const phraseDroppedAndBack: LhMessage[] = [drop("phrase-drop", false, 10.2), drop("phrase-drop", true, 10.4)];
const problem: LhMessage[] = [
	marker("note_2", "app-note", { kinds: ["analogy-dropped"] }, 11, '[Analogy dropped] Regularization: "The leash fits one part"'),
	userText("u_7", "Give me a problem.", 11),
	call("p1", "problem", { statement: "For which $\\lambda$ is $X^\\top X + \\lambda I$ always invertible?", nodeId: "reg", modelSolution: "Every $\\lambda > 0$." }, 12),
	result("p1", "problem", null, 12),
	userText("u_8", "Is it about the eigenvalues?", 20),
	text("hint", "Look at what $\\lambda I$ adds to each eigenvalue.", 22),
	userText("u_9", "Every $\\lambda > 0$ works.", 40),
];
const concluded: LhMessage[] = [
	call("c1", "conclude", { outcome: "solvedWithHints", verdict: "Solid: $\\lambda I$ lifts every eigenvalue. You found it from the hint.", rung: "R1", missClass: null, retest: false }, 47),
	result("c1", "conclude", { stop: topicStop("reg", 48, 48) }, 48),
];
const topicDoneReg: LhMessage[] = [
	call("rd_1", "read", { path: "Lecture 7.pdf" }, 48.5),
	result("rd_1", "read", null, 48.5),
	call("t1", "topic_done", { nodeId: "reg", review: REVIEW_REG, opener: { lead: CV_LEAD, quiz: OPENER_QUIZ } }, 49),
	result("t1", "topic_done", { part: "topic_done", v: 1, lead: CV_LEAD }, 49),
];

// ── Saturday 20:40 ───────────────────────────────────────────────────────────

const REG_SAT: ReviewDetails = {
	...reviewDetails("Regularization", "right", SAT + 2),
	of: { chatId: "chat_story", messageId: "m_t1", toolCallId: "t1" },
	nodeId: "reg",
	quiz: REVIEW_REG,
	kept: { of: { chatId: "chat_story", messageId: "m_call_k", toolCallId: "call_k" }, text: KEEP.text, source: SOURCE_MARK, phrase: KEEP.phrase },
};
const continued: LhMessage[] = [keepGoing("c1", SAT)];
const OPENER_ANSWER = picked(OPENER_QUIZ.question, "It can move a lot", true, SAT + 2);
const openerAnswered: LhMessage[] = [
	marker("note_3", "app-note", { kinds: ["resumed", "opener"] }, SAT + 2, "[Resumed] He came back to this session after a stop.\n[Opener] Cross-validation: he picked A, It can move a lot, sure 3."),
	marker("oa_cv", "opener-answer", { topicDoneCallId: "t1", answer: OPENER_ANSWER }, SAT + 2),
];
const teacherWritesSat: LhMessage[] = [
	review("rv_bayes_2", reviewDetails("Bayes' rule", "right", SAT + 2), SAT + 2.2),
	review("rv_gd_2", reviewDetails("Gradient descent", "right", SAT + 2), SAT + 2.4),
	review("rv_reg", REG_SAT, SAT + 2.6),
	text("cv1", "Right: each split picks its own λ.", SAT + 3),
];
const crossValidationEnds: LhMessage[] = [
	call("p2", "problem", { statement: "Five folds give errors 0.20, 0.22, 0.31, 0.19, 0.18. What is the estimate?", nodeId: "cv", modelSolution: "0.22" }, SAT + 5),
	result("p2", "problem", null, SAT + 5),
	userText("u_10", "0.22", SAT + 20),
	call("c2", "conclude", { outcome: "solved", verdict: "Solid: the estimate is the mean over the folds. You averaged all five.", rung: null, missClass: null, retest: false }, SAT + 29),
	result("c2", "conclude", { stop: topicStop("cv", SAT + 30, 26) }, SAT + 30),
	call("t2", "topic_done", { nodeId: "cv", opener: { lead: "Now pick between models with those scores.", quiz: MS_QUIZ } }, SAT + 31),
	result("t2", "topic_done", { part: "topic_done", v: 1, lead: "Now pick between models with those scores." }, SAT + 31),
];
const keptGoingOn: LhMessage[] = [keepGoing("c2", SAT + 32), marker("oa_ms", "opener-answer", { topicDoneCallId: "t2", answer: picked(MS_QUIZ.question, "The one that wins on average", true, SAT + 33) }, SAT + 33)];
const lastTopicEnds: LhMessage[] = [
	call("q_ms", "quiz", MS_CHECK, SAT + 35),
	result("q_ms", "quiz", picked(MS_CHECK.question, "The spread over the splits", true, SAT + 40, "check"), SAT + 40),
	call("t3", "topic_done", { nodeId: "ms", review: MS_CHECK }, SAT + 45),
	result("t3", "topic_done", { part: "topic_done", v: 1, stop: topicStop("ms", SAT + 45, 13) }, SAT + 45),
];

const story = (...steps: LhMessage[][]): LhMessage[] => steps.flat();
const wednesday = story(start, firstReplyWait, opening, plain, plotPair, guessed, keptRight, analogyDropped, phraseDroppedAndBack, problem, concluded, topicDoneReg);
const saturday = story(wednesday, continued, openerAnswered, teacherWritesSat, crossValidationEnds, keptGoingOn, lastTopicEnds);

const FIRST_TOPIC = TREE.nodes[0]!.id;
const parts = (view: LhViewMessage[]): LhViewPart[] => view.flatMap((m) => m.parts);
const part = (view: LhViewMessage[], toolCallId: string): LhViewPart => parts(view).find((p) => p.toolCallId === toolCallId)!;
const cards = (view: LhViewMessage[]): FromEarlierData[] => parts(view).flatMap((p) => (p.type === "data-from-earlier" ? [p.data as FromEarlierData] : []));
/** What Your turn would show beside a running turn: the pending question and the open problem. */
const yourTurn = (messages: LhMessage[]) => ({ pending: findPendingToolCall(projectView(messages)), problem: activeProblemOf(messages) });

describe("the two-day story, as the window draws it", () => {
	it("Wednesday: questions from earlier fill the wait for the first reply, answered while the teacher writes", () => {
		const bayes = findPendingToolCall(withOpenReview(projectView(start), answerOf(BAYES_WED)));
		assert.deepEqual(bayes?.appPosed, { kind: "review", ref: { chatId: "chat_old", toolCallId: BAYES_WED.of.toolCallId } });
		const box = lessonBox({ name: "Teacher", busy: true, waitingForAgent: false, hasText: false, hasFiles: false, turn: questionTurn("quiz", bayes!.input, true, "review") });
		assert.equal(box.right.disabled, false, "Submit answer works while the teacher writes");
		assert.equal(box.exit, "skip");

		const [card] = cards(projectView(story(start, firstReplyWait)));
		assert.deepEqual(card!.rows.map((r) => [fromEarlierRow(r).topic, fromEarlierRow(r).word]), [["Bayes' rule", "Wrong"], ["Eigenvalues", "Right"], ["Gradient descent", "Right"]]);
	});

	it("the opening reply, words alone, draws its page with the quoted words under it as soon as it is there", () => {
		const record = story(start, firstReplyWait, opening);
		const topics = topicParts(record, FIRST_TOPIC);
		assert.deepEqual(topics, [{ nodeId: "reg", page: { messageId: "m_open", leadOf: null, fileId: "f_1a2b3c4d5e6f", range: "p. 14", name: "Lecture 6.pdf", quote: "degree 12" } }], "the lesson starts on the plan's first topic");
		const row = projectView(record).find((m) => m.parts.some((p) => p.id === "m_open-t0"))!;
		const drawn = excerptParts(row.parts, topicPageMarks(topics));
		assert.deepEqual([...drawn].map(([i, mark]) => [row.parts[i]!.id, mark]), [["m_open-t0", SOURCE_MARK]], "under the opening reply, once");
		assert.deepEqual(topicParts(story(record, plain, plotPair), FIRST_TOPIC), topics, "the replies after it keep that page");
	});

	it("the plot keeps its hidden line back until his guess, then opens", () => {
		const asked = projectView(story(start, firstReplyWait, opening, plain, plotPair));
		const plot = part(asked, "call_p");
		assert.equal(plot.guessOpen, false);
		const drawn = readPlot(plot.input, plot.output);
		assert.ok("plot" in drawn);
		assert.doesNotMatch(liveText(drawn.plot, 1, false), /penalty/, "the penalty line is held back");
		assert.equal(yourTurn(story(start, firstReplyWait, opening, plain, plotPair)).pending?.toolCallId, "call_q", "his guess waits in Your turn");

		const answered = projectView(story(start, firstReplyWait, opening, plain, plotPair, guessed));
		assert.equal(part(answered, "call_p").guessOpen, true);
		assert.match(liveText(drawn.plot, 1, true), /penalty 0, 2\.5, 5\./);
		assert.equal(part(answered, "call_q").plotValue, 4, "his card learns the drawn value");
	});

	it("his right answer shows the kept card; Drop this analogy takes the analogy away and keeps the sentence", () => {
		const right = story(start, firstReplyWait, opening, plain, plotPair, guessed, keptRight);
		const kept = part(projectView(right), "call_k").kept as KeptCardData;
		assert.deepEqual(kept, { text: KEEP.text, fits: KEEP.fits, stops: KEEP.stops, analogyDropped: false, phrase: KEEP.phrase, phraseDropped: false, source: SOURCE_MARK });
		const card = keptCardView(kept);
		assert.equal(card.statement, KEEP.text);
		assert.deepEqual(card.analogy, { fits: KEEP.fits, stops: KEEP.stops, shown: true });
		assert.deepEqual(card.phrase, { line: "Remember it as Price, not cap", shown: true });
		assert.equal(card.source?.range, "p. 14");

		const dropped = keptCardView(part(projectView(story(right, analogyDropped)), "call_k").kept as KeptCardData);
		assert.equal(dropped.analogy?.shown, false);
		assert.equal(dropped.statement, KEEP.text);
		const back = keptCardView(part(projectView(story(right, analogyDropped, phraseDroppedAndBack)), "call_k").kept as KeptCardData);
		assert.equal(back.phrase?.shown, true, "the phrase he dropped and brought back shows");
		assert.equal(back.analogy?.shown, false);
	});

	it("the problem stays open through his work and the hint, and its conclude carries the stop", () => {
		const posed = story(start, firstReplyWait, opening, plain, plotPair, guessed, keptRight, analogyDropped, phraseDroppedAndBack, problem);
		const turn = yourTurn(posed);
		assert.deepEqual([turn.pending, turn.problem?.toolCallId], [null, "p1"]);
		const view = projectView(story(posed, concluded));
		assert.equal(activeProblemOf(story(posed, concluded)), null);
		const conclude = part(view, "c1");
		assert.equal(conclude.state, "output-available");
		assert.equal(conclude.reveal, "Every $\\lambda > 0$.", "the reveal is the solution committed at the pose");
		assert.deepEqual((conclude.output as { stop: unknown }).stop, topicStop("reg", 48, 48));
	});

	it("the stop names the next topic, with Stop here dark at 48 minutes, and no opener shows yet", () => {
		const stop = lessonStop(wednesday, TREE)!;
		assert.deepEqual(stop, { kind: "topic", at: iso(48), nodeId: "reg", stopOf: "c1", next: "Cross-validation", activeMinutes: 48, keptGoing: false });
		const card = stopCard(stop);
		assert.deepEqual([card.lead, card.next], ["That finishes this topic.", "Cross-validation is next."]);
		assert.deepEqual(card.buttons.map((b) => [b.label, b.dark]), [["Keep going", false], ["Stop here", true]]);
		assert.deepEqual(yourTurn(wednesday), { pending: null, problem: null });
		assert.ok(!parts(projectView(wednesday)).some((p) => p.appPosed), "the opener waits for Keep going");
	});

	it("Saturday: Continue shows the stored opener under the Concluded card, with no turn to run", () => {
		const record = story(wednesday, continued);
		const view = projectView(record);
		const types = parts(view).filter((p) => p.type !== "step-start").map((p) => p.type);
		assert.deepEqual(types.slice(types.indexOf("tool-conclude")), ["tool-conclude", "tool-read", "tool-topic_done", "text", "tool-quiz"]);
		assert.deepEqual(findPendingToolCall(view), { toolCallId: "opener_t1", tool: "quiz", input: OPENER_QUIZ, appPosed: { kind: "opener", ref: "t1" } });
		assert.equal(needsContinuation(record), false, "nothing for the agent to continue");
		assert.equal(keepGoingOwesNext(record), false, "no go-ahead is sent");
		assert.equal(lessonStop(record, TREE)?.keptGoing, true, "the stop card is gone");
		assert.equal(stopLightSelector(record, "c1"), toolCardSelector("c1"), "the Concluded card lights");

		const lead = parts(view).find((p) => p.id === openerLeadId("t1"))!;
		assert.equal(lead.text, CV_LEAD);
		const leadRow = view.find((m) => m.parts.includes(lead))!;
		assert.deepEqual([...excerptParts(leadRow.parts, topicPageMarks(topicParts(record, FIRST_TOPIC)))].map(([i]) => leadRow.parts[i]!.id), [openerLeadId("t1")], "Cross-validation's page is in the lead");

		const answered = projectView(story(record, openerAnswered));
		assert.equal(part(answered, "opener_t1").state, "output-available");
		assert.equal(findPendingToolCall(answered), null);
	});

	it("his sentence comes back in From earlier, with its phrase and source, never the analogy", () => {
		const view = projectView(story(wednesday, continued, openerAnswered, teacherWritesSat));
		const [wed, sat] = cards(view);
		assert.equal(wed!.rows.length, 3, "Wednesday's card stays its own");
		assert.deepEqual(sat!.rows.map((r) => r.topic), ["Bayes' rule", "Gradient descent", "Regularization"]);
		const reg = fromEarlierRow(sat!.rows[2]!);
		assert.equal(reg.word, "Right");
		assert.deepEqual({ text: reg.kept?.text, phrase: reg.kept?.phrase, range: reg.kept?.source?.range }, { text: KEEP.text, phrase: "Remember it as Price, not cap", range: "p. 14" });
		const shown = JSON.stringify([reg, sat!.rows[2]]);
		assert.ok(!shown.includes(KEEP.fits) && !shown.includes(KEEP.stops), "no analogy line");
	});

	it("Keep going in the same sitting leads into the third topic's opener", () => {
		const stopped = story(wednesday, continued, openerAnswered, teacherWritesSat, crossValidationEnds);
		const stop = lessonStop(stopped, TREE)!;
		assert.deepEqual([stop.kind, stop.nodeId, stop.next, stop.keptGoing], ["topic", "cv", "Model selection", false]);
		assert.equal(stopCard(stop).next, "Model selection is next.");

		const going = story(stopped, keptGoingOn.slice(0, 1));
		assert.equal(lessonStop(going, TREE)?.keptGoing, true);
		assert.deepEqual(findPendingToolCall(projectView(going))?.appPosed, { kind: "opener", ref: "t2" });
		assert.equal(findPendingToolCall(projectView(story(stopped, keptGoingOn))), null, "answered");
	});

	it("the last topic, ended by a right quiz, is the end of the lesson", () => {
		const stop = lessonStop(saturday, TREE)!;
		assert.deepEqual([stop.kind, stop.nodeId, stop.stopOf, stop.next, stop.keptGoing], ["end", "ms", "t3", null, false]);
		const card = stopCard(stop);
		assert.deepEqual([card.lead, card.next, card.buttons], ["That finishes this topic.", "Nothing more is planned today.", [{ action: "done-for-today", label: "Done for today", dark: true }]]);
		assert.equal(stopLightSelector(saturday, "t3"), answerAnchorSelector("q_ms"), "his right answer lights");
		assert.deepEqual(yourTurn(saturday), { pending: null, problem: null });
	});

	it("no UI-only marker draws a part of its own", () => {
		const uiOnly = ["keep-going", "keep-check", "analogy-drop", "phrase-drop", "opener-answer"];
		const markers = saturday.filter((m) => m.role === "custom" && uiOnly.includes(m.customType));
		assert.deepEqual([...new Set(markers.map((m) => (m as { customType: string }).customType))].sort(), [...uiOnly].sort(), "the story holds each kind");
		const view = projectView(saturday);
		// Every row is his message, a teacher run or a From earlier card.
		const owners = new Set(saturday.flatMap((m) => (m.role === "user" || m.role === "assistant" || (m.role === "custom" && m.customType === "review") ? [m.id] : [])));
		assert.deepEqual(view.filter((m) => !owners.has(m.id)).map((m) => m.id), []);
		const ids = parts(view).flatMap((p) => [p.id, p.toolCallId].filter((v): v is string => typeof v === "string"));
		for (const m of markers) assert.ok(!ids.some((id) => id.includes(m.id)), `${m.id} has no part`);
	});
});
