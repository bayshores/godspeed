import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectView, type LhMessage, type LhViewPart } from "../../src/shared/core/index.ts";
import { call, result, userText } from "../stop-fixtures.ts";
import { LEASH_CALL, LEASH_GUESS, LEASH_RESULT } from "../plot-fixtures.ts";

/** One reply holding a line, the guess and the plot, in the order given. */
function reply(quizFirst: boolean): LhMessage {
	const base = call("unused", "x", {}, 2) as LhMessage & { content: unknown[] };
	const quiz = { type: "toolCall", id: "call_q", name: "quiz", arguments: LEASH_GUESS };
	const plot = { type: "toolCall", id: "call_p", name: "plot", arguments: LEASH_CALL };
	return { ...base, id: "m_r3", content: [{ type: "text", text: "A common picture is a leash on the weights." }, ...(quizFirst ? [quiz, plot] : [plot, quiz])] } as LhMessage;
}

const answer = { kind: "quiz", questionType: "predict", questionText: "Where?", dontKnow: false, correct: false, answers: [{ index: 1, label: "At 2, the leash's length.", value: "a" }], answeredAt: "2026-11-18T21:06:00.000Z" };

function parts(messages: LhMessage[]): LhViewPart[] {
	return projectView(messages).flatMap((m) => m.parts);
}

describe("joinPlots", () => {
	it("a plot stays locked until its guess is answered, then opens", () => {
		const asked = [userText("u", "Go.", 0), reply(false), result("call_p", "plot", LEASH_RESULT, 2)];
		const locked = parts(asked).find((p) => p.type === "tool-plot");
		assert.equal(locked?.guessOpen, false);
		const opened = parts([...asked, result("call_q", "quiz", answer, 3)]);
		assert.equal(opened.find((p) => p.type === "tool-plot")?.guessOpen, true);
		assert.equal(opened.find((p) => p.type === "tool-quiz")?.plotValue, 4, "his card learns the drawn value");
		assert.deepEqual(locked?.guessAt, { line: "penalty", x: 8 }, "the plot learns the point its guess asks at");
	});

	it("a skipped guess opens it too", () => {
		const skipped = parts([userText("u", "Go.", 0), reply(false), result("call_p", "plot", LEASH_RESULT, 2), result("call_q", "quiz", { ...answer, dismissed: true }, 3)]);
		assert.equal(skipped.find((p) => p.type === "tool-plot")?.guessOpen, true);
	});

	it("his card sits under the plot even when the quiz came first", () => {
		const view = parts([userText("u", "Go.", 0), reply(true), result("call_p", "plot", LEASH_RESULT, 2), result("call_q", "quiz", answer, 3)]);
		const order = view.filter((p) => p.type.startsWith("tool-")).map((p) => p.type);
		assert.deepEqual(order, ["tool-plot", "tool-quiz"]);
	});

	it("a refused plot shows nothing", () => {
		const view = parts([userText("u", "Go.", 0), reply(false), result("call_p", "plot", {}, 2, true, "plot: needs a quiz with onPlot in the same reply.")]);
		assert.ok(!view.some((p) => p.type === "tool-plot"));
	});
});
