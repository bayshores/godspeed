/**
 * Practice problems paired with how they ended, and how those outcomes
 * count toward readiness: solved is right, giving up or moving on is
 * wrong, solved with hints counts neither way.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LhMessage } from "../../src/shared/core/native-messages.ts";
import { practiceOutcomes } from "../../src/shared/core/practice-outcomes.ts";
import { collectAnswers, factsForAnswer } from "../../src/shared/core/progress.ts";

const T0 = Date.parse("2026-11-02T20:00:00Z");
let clock = 0;
const call = (msgId: string, id: string, name: string, args: Record<string, unknown>) =>
	({ id: msgId, role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }], timestamp: T0 + clock++ * 1000 }) as unknown as LhMessage;
const done = (id: string, name: string, isError = false) =>
	({ id: `r_${id}`, role: "toolResult", toolCallId: id, toolName: name, isError, content: [], timestamp: T0 + clock++ * 1000 }) as unknown as LhMessage;

function session(): LhMessage[] {
	clock = 0;
	const pose = (n: number, target?: string[]) => [call(`m${n}`, `p${n}`, "problem", { statement: `Problem ${n}`, mode: "recall", modelSolution: "…", ...(target ? { target } : {}) }), done(`p${n}`, "problem")];
	const end = (n: number, outcome: string, isError = false) => [call(`c${n}`, `k${n}`, "conclude", { outcome, verdict: "v", rung: null, missClass: null, retest: false }), done(`k${n}`, "conclude", isError)];
	return [
		...pose(1, ["n_a"]), ...end(1, "solved"),
		...pose(2, ["n_b"]), ...end(2, "solvedWithHints"),
		...pose(3), ...end(3, "surrendered"),
		...pose(4, ["n_a", "n_c"]), ...end(4, "movedOn", true), ...end(4, "movedOn"),
		...pose(5), ...end(5, "dismissed"),
		...pose(6), // still open
	];
}

describe("practice outcomes", () => {
	it("pair each posed problem with the conclude that went through", () => {
		const outcomes = practiceOutcomes(session());
		assert.deepEqual(
			outcomes.map((o) => [o.problemCallId, o.messageId, o.statement, o.targets, o.outcome]),
			[
				["p1", "m1", "Problem 1", ["n_a"], "solved"],
				["p2", "m2", "Problem 2", ["n_b"], "solvedWithHints"],
				["p3", "m3", "Problem 3", [], "surrendered"],
				["p4", "m4", "Problem 4", ["n_a", "n_c"], "movedOn"],
				["p5", "m5", "Problem 5", [], "dismissed"],
			],
		);
		assert.equal(outcomes[0]!.at, new Date(T0 + 3000).toISOString(), "when its conclude went through");
	});

	it("count toward readiness: solved right, given up or moved on wrong, hints and dismissals not at all", () => {
		const answers = collectAnswers("chat_p", session());
		assert.deepEqual(
			answers.map((a) => [a.toolCallId, a.tool, a.outcome, a.factIds]),
			[
				["p1", "problem", "right", ["n_a"]],
				["p3", "problem", "wrong", undefined],
				["p4", "problem", "wrong", ["n_a", "n_c"]],
			],
		);
		const index = new Map([["chat_p\u0000m1", ["n_other"]]]);
		assert.deepEqual(factsForAnswer(answers[0]!, index), ["n_a"], "a problem's own targets come first");
		assert.deepEqual(factsForAnswer({ ...answers[0]!, factIds: undefined }, index), ["n_other"]);
	});

	it("count a target named twice once (an id and its name both normalize to the id)", () => {
		clock = 0;
		const messages = [
			call("m1", "p1", "problem", { statement: "Problem 1", target: ["n_a", "n_a", "n_b"] }),
			done("p1", "problem"),
			call("c1", "k1", "conclude", { outcome: "solved" }),
			done("k1", "conclude"),
		];
		assert.deepEqual(practiceOutcomes(messages)[0]!.targets, ["n_a", "n_b"]);
	});

	it("carry the plan node a study problem names, so it counts for that topic", () => {
		clock = 0;
		const messages = [
			call("m1", "p1", "problem", { statement: "Problem 1", nodeId: "pt_a" }),
			done("p1", "problem"),
			call("c1", "k1", "conclude", { outcome: "surrendered" }),
			done("k1", "conclude"),
		];
		assert.equal(practiceOutcomes(messages)[0]!.nodeId, "pt_a");
		assert.equal(collectAnswers("chat_p", messages)[0]!.nodeId, "pt_a");
		assert.equal("nodeId" in practiceOutcomes(session())[0]!, false, "absent when the problem names none");
	});
});
