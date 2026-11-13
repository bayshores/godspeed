/** The stop card's words and dark button, what Keep going owes, and the card that lights on return. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { keepGoingOwesNext, stopCard, stopLightSelector } from "../../src/frontend/components/lesson/stop-card-model.ts";
import { lessonStop, type LessonStop } from "../../src/shared/core/index.ts";
import { call, CONCLUDE_SOLVED, keepGoing, marker, problemStop, regularizationEnds, result, text, topicStop, TREE, userText } from "../stop-fixtures.ts";

const stop: LessonStop = { kind: "topic", at: "2026-11-18T21:48:00.000Z", nodeId: "reg", stopOf: "c1", next: "Cross-validation", activeMinutes: 48, keptGoing: false };
const buttons = (s: LessonStop) => stopCard(s).buttons.map((b) => `${b.label}${b.dark ? " (dark)" : ""}`);

describe("stopCard", () => {
	it("a topic end names what is next; from 25 active minutes Stop here is dark", () => {
		assert.equal(stopCard(stop).lead, "That finishes this topic.");
		assert.equal(stopCard(stop).next, "Cross-validation is next.");
		assert.deepEqual(buttons(stop), ["Keep going", "Stop here (dark)"]);
		assert.deepEqual(buttons({ ...stop, activeMinutes: 25 }), ["Keep going", "Stop here (dark)"]);
		assert.deepEqual(buttons({ ...stop, activeMinutes: 24 }), ["Keep going (dark)", "Stop here"]);
	});

	it("the last topic has one dark Done for today", () => {
		const end = stopCard({ ...stop, kind: "end", next: null, activeMinutes: 3 });
		assert.equal(end.lead, "That finishes this topic.");
		assert.equal(end.next, "Nothing more is planned today.");
		assert.deepEqual(buttons({ ...stop, kind: "end", next: null }), ["Done for today (dark)"]);
	});

	it("a long problem: the next step, problem n, or no second line in practice", () => {
		const problem: LessonStop = { ...stop, kind: "problem", next: "Cross-validation", activeMinutes: 26 };
		assert.equal(stopCard(problem).lead, "That finishes this problem.");
		assert.equal(stopCard(problem).next, "Next is Cross-validation.");
		assert.equal(stopCard({ ...problem, next: "problem 4" }).next, "Next is problem 4.");
		assert.equal(stopCard({ ...problem, next: null }).next, null);
	});
});

describe("keepGoingOwesNext", () => {
	const [p, pr, c, cr] = regularizationEnds();
	const concluded = [p!, pr!, c!, cr!];

	it("owes the go-ahead after Keep going when no opener is stored", () => {
		assert.equal(keepGoingOwesNext(concluded), false, "not before Keep going");
		assert.equal(keepGoingOwesNext([...concluded, keepGoing("c1", 50)]), true);
	});

	it("owes nothing once the opener shows or the go-ahead went", () => {
		assert.equal(keepGoingOwesNext([...regularizationEnds(), keepGoing("c1", 50)]), false);
		assert.equal(keepGoingOwesNext([...concluded, keepGoing("c1", 50), marker("n", "practice-next", null, 50.1)]), false);
		assert.equal(keepGoingOwesNext([...concluded, keepGoing("c1", 50), userText("u", "wait, why?", 51)]), false);
	});

	it("a Keep going written mid-turn still counts when the turn ends without topic_done", () => {
		assert.equal(keepGoingOwesNext([p!, pr!, keepGoing("c1", 48.5), c!, cr!]), true);
	});

	it("owes nothing when the teacher went on past the stop with no Keep going", () => {
		const typedOn = [...concluded, userText("u", "ok, go on", 50), call("q2", "quiz", { question: "?", type: "check", nodeId: "cv" }, 51)];
		assert.equal(lessonStop(typedOn, TREE)?.keptGoing, true, "the stop card does not come back");
		assert.equal(keepGoingOwesNext(typedOn), false);
		const asked = [...concluded, userText("u", "why does lambda shrink the weights?", 50), text("a", "The penalty grows with them.", 51)];
		assert.equal(lessonStop(asked, TREE)?.keptGoing, false, "a question about the finished topic keeps the stop");
	});

	it("a practice problem's stop", () => {
		const practice = [call("p", "problem", { statement: "x" }, 0), result("p", "problem", null, 0), call("c", "conclude", CONCLUDE_SOLVED, 30), result("c", "conclude", { stop: problemStop(30) }, 30)];
		assert.equal(keepGoingOwesNext([...practice, keepGoing("c", 31)]), true);
	});
});

describe("stopLightSelector", () => {
	it("a conclude stop lights its Concluded card", () => {
		assert.equal(stopLightSelector(regularizationEnds(), "c1"), '[data-tool-call="c1"]');
	});

	it("a topic a right quiz ended lights that quiz's card", () => {
		const quizEnded = [
			call("q", "quiz", { question: "?", nodeId: "ms" }, 0),
			result("q", "quiz", null, 1),
			call("t", "topic_done", { nodeId: "ms" }, 2),
			result("t", "topic_done", { part: "topic_done", v: 1, stop: topicStop("ms", 2) }, 2),
		];
		assert.equal(stopLightSelector(quizEnded, "t"), '[data-answer-call="q"]');
		assert.equal(stopLightSelector(quizEnded, "nope"), null);
	});
});
