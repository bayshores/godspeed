/** The lesson text as one sheet per step: where a new sheet starts, what each holds and the number in its corner. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stepSheets } from "../../src/frontend/components/lesson/step-sheets-model.ts";
import type { LhViewMessage, LhViewPart } from "../../src/shared/core/index.ts";

const step: LhViewPart = { type: "step-start" };
const text = (words: string, extra: Partial<LhViewPart> = {}): LhViewPart => ({ type: "text", text: words, ...extra });
const quiz = (id: string, nodeId: string): LhViewPart => ({ type: "tool-quiz", toolCallId: id, input: { nodeId }, state: "output-available" });
const problem = (id: string, input: Record<string, unknown> = {}, state = "output-available"): LhViewPart => ({ type: "tool-problem", toolCallId: id, input, state });
const conclude = (id: string): LhViewPart => ({ type: "tool-conclude", toolCallId: id, input: {}, state: "output-available" });
const teacher = (id: string, ...parts: LhViewPart[]): LhViewMessage => ({ id, role: "assistant", parts });
const learner = (id: string, words: string): LhViewMessage => ({ id, role: "user", parts: [text(words)] });
const PLAN = new Map([["fork", 1], ["exec", 2], ["wait", 3]]);

/** Each sheet as its label and, per message, the texts and call ids it holds. */
function drawn(messages: LhViewMessage[], plan = PLAN) {
	return stepSheets(messages, plan).map((sheet) => [
		sheet.label,
		...sheet.rows.map((row) =>
			messages[row.index]!.parts
				.slice(row.from, row.to)
				.filter((p) => p.type !== "step-start")
				.map((p) => p.text ?? p.toolCallId),
		),
	]);
}

describe("the lesson text as one sheet per step", () => {
	it("is one sheet with no number while nothing names a step", () => {
		const messages = [teacher("a", step, text("Hello.")), learner("u", "Hi")];
		assert.deepEqual(drawn(messages), [[null, ["Hello."], ["Hi"]]]);
	});

	it("puts what comes before the first step on that step's sheet", () => {
		const messages = [teacher("a", step, text("The plan."), step, text("Fork copies."), problem("p1", { nodeId: "fork" }))];
		assert.deepEqual(drawn(messages), [["1", ["The plan.", "Fork copies.", "p1"]]]);
	});

	it("starts a new sheet at an opener's lead, and keeps his question and its answer on it", () => {
		const messages = [
			teacher("a", step, problem("p1", { nodeId: "fork" }), step, conclude("c1"), step, text("Now exec.", { opens: "exec" })),
			learner("u", "What is exec?"),
			teacher("b", step, text("A new program."), step, quiz("opener_t1", "exec"), step, text("That pick holds.")),
		];
		assert.deepEqual(drawn(messages), [
			["1", ["p1", "c1"]],
			["2", ["Now exec."], ["What is exec?"], ["A new program.", "opener_t1", "That pick holds."]],
		]);
	});

	it("a question for the next step leaves the words before it on the old sheet", () => {
		const messages = [teacher("a", step, quiz("q1", "fork"), step, text("Right, because it copies."), quiz("q2", "exec"), step, text("Exec replaces."))];
		assert.deepEqual(drawn(messages), [
			["1", ["q1", "Right, because it copies."]],
			["2", ["q2", "Exec replaces."]],
		]);
	});

	it("a problem for the next step takes the words that lead into it", () => {
		const messages = [teacher("a", step, problem("p1", { nodeId: "fork" }), step, conclude("c1"), step, text("Same idea, with exec."), problem("p2", { nodeId: "exec" }))];
		assert.deepEqual(drawn(messages), [
			["1", ["p1", "c1"]],
			["2", ["Same idea, with exec.", "p2"]],
		]);
	});

	it("several questions and problems on one step share its sheet", () => {
		const messages = [teacher("a", step, quiz("q1", "fork"), step, problem("p1", { nodeId: "fork" }), step, quiz("q2", "fork"))];
		assert.equal(stepSheets(messages, PLAN).length, 1);
	});

	it("a practice lesson has a sheet per problem, numbered in the order posed", () => {
		const messages = [teacher("a", step, problem("p1"), step, conclude("c1")), learner("u", "next"), teacher("b", step, text("A harder one."), problem("p2"))];
		assert.deepEqual(drawn(messages, new Map()), [
			["1", ["p1", "c1"], ["next"]],
			["2", ["A harder one.", "p2"]],
		]);
	});

	it("a homework problem's sheet carries the number its assignment gives it", () => {
		const messages = [teacher("a", step, problem("p1", { number: "2b" }), step, problem("p2", { number: "2b" }), step, problem("p3", { number: "4" }))];
		assert.deepEqual(drawn(messages, new Map()), [
			["2b", ["p1", "p2"]],
			["4", ["p3"]],
		]);
	});

	it("says whether its number counts steps or problems", () => {
		const taught = [teacher("a", step, quiz("q1", "fork"), step, problem("p1", { nodeId: "exec" }))];
		assert.deepEqual(stepSheets(taught, PLAN).map((s) => s.counts), ["Step", "Step"]);
		const homework = [teacher("a", step, problem("p1", { number: "2b" }))];
		assert.deepEqual(stepSheets(homework, new Map()).map((s) => s.counts), ["Problem"]);
	});

	it("a call that failed or is still being written starts no sheet", () => {
		const messages = [teacher("a", step, problem("p1"), step, problem("bad", {}, "output-error"), step, problem("live", {}, "input-streaming"))];
		assert.equal(stepSheets(messages, new Map()).length, 1);
	});

	it("a step the plan no longer has gets a sheet with no number", () => {
		const messages = [teacher("a", step, quiz("q1", "fork"), step, quiz("q2", "gone"))];
		assert.deepEqual(drawn(messages).map((s) => s[0]), ["1", null]);
	});
});
