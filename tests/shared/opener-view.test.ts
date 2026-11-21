/**
 * The opener in the window: after Keep going the view draws its lead and
 * its question right after topic_done's result (the Concluded card, then
 * the lead, then the question), wherever the Keep going marker sits; the
 * question is pending and app-posed until answered, and then draws where
 * he answered; the plan row moves to its topic.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LhMessage } from "../../src/shared/core/native-messages.ts";
import { needsContinuation } from "../../src/shared/core/native-scans.ts";
import { findPendingToolCall } from "../../src/shared/core/pending.ts";
import { planStepBar } from "../../src/shared/core/plan-step-bar.ts";
import { projectView } from "../../src/shared/core/view.ts";
import { at, call, keepGoing, marker, OPENER_QUIZ, regularizationEnds, result, text, TREE, userText } from "../stop-fixtures.ts";

/** The record after a Keep going pressed mid-turn: the marker sits before
 *  the turn's conclude, reading and topic_done. */
function keptMidTurn(): LhMessage[] {
	const [p, pr, c, cr, t, tr] = regularizationEnds();
	return [p!, pr!, keepGoing("c1", 48.5), c!, cr!, call("rd", "read", { path: "lecture7.pdf" }, 48.6), result("rd", "read", null, 48.6), t!, tr!];
}

const partsOf = (view: ReturnType<typeof projectView>) => view.flatMap((m) => m.parts).filter((p) => p.type !== "step-start");

describe("projectView: the opener", () => {
	it("draws the lead then the question right after topic_done, even when Keep going sits earlier", () => {
		const parts = partsOf(projectView(keptMidTurn()));
		assert.deepEqual(
			parts.map((p) => p.type),
			["tool-problem", "tool-conclude", "tool-read", "tool-topic_done", "text", "tool-quiz"],
		);
		assert.equal(parts[4]!.text, "Now split the data.");
		assert.deepEqual(parts[5]!.input, OPENER_QUIZ);
		assert.equal(parts[5]!.state, "input-available");
	});

	it("is the pending question, posed by the app", () => {
		assert.deepEqual(findPendingToolCall(projectView(keptMidTurn())), {
			toolCallId: "opener_t1",
			tool: "quiz",
			input: OPENER_QUIZ,
			appPosed: { kind: "opener", ref: "t1" },
		});
	});

	it("shows nothing before Keep going", () => {
		const parts = partsOf(projectView(regularizationEnds()));
		assert.ok(!parts.some((p) => p.type === "tool-quiz" || p.type === "text"));
	});

	it("an answer settles it; a skip shows as a skipped question", () => {
		const answer = { kind: "quiz", questionText: OPENER_QUIZ.question, dontKnow: false, answers: [{ index: 1, label: "It can move a lot", value: "It can move a lot" }], correct: true, answeredAt: "x" };
		const answered = projectView([...keptMidTurn(), marker("oa", "opener-answer", { topicDoneCallId: "t1", answer }, 50)]);
		const quiz = partsOf(answered).find((p) => p.type === "tool-quiz")!;
		assert.equal(quiz.state, "output-available");
		assert.deepEqual(quiz.output, answer);
		assert.equal(findPendingToolCall(answered), null);

		const skipped = projectView([...keptMidTurn(), marker("oa", "opener-answer", { topicDoneCallId: "t1", answer: null }, 50)]);
		const output = partsOf(skipped).find((p) => p.type === "tool-quiz")!.output as { dismissed?: boolean; answeredAt?: string; questionText?: string };
		assert.equal(output.dismissed, true);
		assert.equal(output.questionText, OPENER_QUIZ.question);
		assert.equal(output.answeredAt, new Date(at(50)).toISOString());
	});

	it("an answer given after a question of his own draws under the reply to that question", () => {
		const answer = { kind: "quiz", questionText: OPENER_QUIZ.question, dontKnow: false, answers: [{ index: 1, label: "It can move a lot", value: "It can move a lot" }], correct: false, answeredAt: "x" };
		const view = projectView([...keptMidTurn(), userText("u1", "What is a split?", 49), text("a9", "Two parts of the data.", 49.5), marker("oa", "opener-answer", { topicDoneCallId: "t1", answer }, 50)]);
		assert.deepEqual(
			view.map((m) => m.parts.filter((p) => p.type !== "step-start").map((p) => p.text ?? p.type)),
			[["tool-problem", "tool-conclude", "tool-read", "tool-topic_done", "Now split the data."], ["What is a split?"], ["Two parts of the data.", "tool-quiz"]],
		);
		assert.deepEqual(view[2]!.parts.at(-1)!.output, answer);
	});

	it("draws the same on every projection (pure)", () => {
		assert.deepEqual(projectView(keptMidTurn()), projectView(keptMidTurn()));
	});
});

describe("the plan row follows a shown opener", () => {
	it("the view's step bar moves to the opener's topic once it shows", () => {
		assert.equal(planStepBar(TREE, projectView(regularizationEnds())).currentIndex, 0);
		assert.equal(planStepBar(TREE, projectView(keptMidTurn())).currentIndex, 1);
	});
});

describe("needsContinuation at a topic end", () => {
	it("a stored topic_done ended the turn, with or without a Keep going after it", () => {
		assert.equal(needsContinuation(regularizationEnds()), false);
		assert.equal(needsContinuation([...regularizationEnds(), keepGoing("c1", 50)]), false);
	});

	it("reads past a Keep going to the answered call before it", () => {
		const [p, pr, c, cr] = regularizationEnds();
		assert.equal(needsContinuation([p!, pr!, c!, cr!]), true);
		assert.equal(needsContinuation([p!, pr!, c!, cr!, keepGoing("c1", 48.5)]), true);
	});
});
