import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planPositionLh, planStepBar, stepPosition } from "../src/core/plan-step-bar.ts";
import type { QuestionAnswerData } from "../src/core/question-core.ts";

describe("planStepBar", () => {
	const tree = { nodes: [{ id: "b", title: "Bayes" }, { id: "a", title: "Priors" }, { id: "c", title: "Posteriors" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }] };
	const part = (type: string, nodeId: string | undefined, output: unknown, toolCallId: string) => ({ type, state: output === undefined ? "input-available" : "output-available", toolCallId, input: nodeId ? { nodeId } : {}, output });
	const quiz = (ad: Partial<QuestionAnswerData>) => ({ kind: "quiz", questionText: "?", dontKnow: false, answers: [], answeredAt: "", ...ad });

	it("orders steps by the plan, with statuses and the answers per step", () => {
		const bar = planStepBar(tree, [
			{ parts: [part("tool-quiz", "a", quiz({ correct: true, confidence: 70 }), "q1"), part("tool-quiz", "a", quiz({ dontKnow: true }), "q2")] },
			{ parts: [part("tool-explain", "b", { kind: "explain", questionText: "?", dontKnow: false, answers: [], answeredAt: "" }, "q3")] },
			{ parts: [part("tool-quiz", "b", quiz({ dismissed: true }), "q4"), part("tool-quiz", "b", undefined, "q5")] },
		]);
		assert.deepEqual(bar.steps.map((s) => [s.id, s.status]), [["a", "visited"], ["b", "current"], ["c", "upcoming"]]);
		assert.equal(bar.currentIndex, 1);
		assert.deepEqual(bar.steps[0]!.answers, [{ toolCallId: "q1", outcome: "right", level: 3 }, { toolCallId: "q2", outcome: "dontKnow" }]);
		assert.deepEqual(bar.steps[1]!.answers, [{ toolCallId: "q3", outcome: "ungraded" }], "dismissed and unanswered calls don't count");
	});

	it("is empty without a plan", () => {
		assert.deepEqual(planStepBar(null, []), { steps: [], currentIndex: -1 });
		assert.equal(planStepBar(tree, []).currentIndex, -1);
	});

	it("counts the current step's number, or the steps done while none is current", () => {
		assert.equal(stepPosition([{ status: "visited" }, { status: "current" }, { status: "upcoming" }]), 2);
		assert.equal(stepPosition([{ status: "visited" }, { status: "upcoming" }]), 1);
		assert.equal(stepPosition([{ status: "upcoming" }, { status: "upcoming" }]), 0);
	});

	it("reads the same count off the native record, problem calls included", () => {
		const call = (name: string, nodeId: string) => ({ role: "assistant", content: [{ type: "toolCall", id: nodeId, name, arguments: { nodeId } }] });
		assert.deepEqual(planPositionLh(tree, []), { done: 0, total: 3 });
		assert.deepEqual(planPositionLh(tree, [call("quiz", "a")] as never), { done: 1, total: 3 });
		assert.deepEqual(planPositionLh(tree, [call("quiz", "a"), call("problem", "c")] as never), { done: 3, total: 3 }, "the plan order, not the call order");
	});
});
