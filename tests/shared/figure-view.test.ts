import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectView, type LhMessage } from "../../src/shared/core/index.ts";
import { call, result, text, userText } from "../stop-fixtures.ts";

const FIGURE = { svg: "<svg viewBox=\"0 0 10 10\"/>" };

/** The drawn parts of the view in order: words by their text, cards by their tool. */
function order(messages: LhMessage[]): string[] {
	return projectView(messages)
		.flatMap((m) => m.parts)
		.filter((p) => p.type !== "step-start")
		.map((p) => (p.type === "text" ? String(p.text) : p.type));
}

const drawn = (id: string, minutes: number) => [call(id, "visual", FIGURE, minutes), result(id, "visual", FIGURE, minutes)];

describe("a teacher's figure in the view", () => {
	it("a figure drawn before the turn's words is drawn under its last words", () => {
		const record = [userText("u", "Draw it.", 0), ...drawn("call_v", 1), text("t1", "Here is the line.", 2), text("t2", "Look at the arrow.", 3)];
		assert.deepEqual(order(record), ["Draw it.", "Here is the line.", "Look at the arrow.", "tool-visual"]);
	});

	it("a figure drawn after the words stays where it was drawn", () => {
		const record = [userText("u", "Draw it.", 0), text("t1", "Here is the line.", 1), ...drawn("call_v", 2)];
		assert.deepEqual(order(record), ["Draw it.", "Here is the line.", "tool-visual"]);
	});

	it("a turn with only a figure keeps it as it is", () => {
		const record = [userText("u", "Draw it.", 0), ...drawn("call_v", 1)];
		assert.deepEqual(order(record), ["Draw it.", "tool-visual"]);
	});

	it("a figure goes under its own turn's words, never past the question that ends it", () => {
		const answer = { kind: "quiz", questionType: "multiple", questionText: "Which?", dontKnow: false, correct: true, answers: [], answeredAt: "2026-11-26T08:00:00.000Z" };
		const record = [
			userText("u", "Draw it.", 0),
			...drawn("call_v1", 1),
			text("t1", "Here is the line.", 2),
			call("call_q", "quiz", { question: "Which?" }, 3),
			result("call_q", "quiz", answer, 4),
			...drawn("call_v2", 5),
			text("t2", "Right, and here it is again.", 6),
		];
		assert.deepEqual(order(record), ["Draw it.", "Here is the line.", "tool-visual", "tool-quiz", "Right, and here it is again.", "tool-visual"]);
	});
});
