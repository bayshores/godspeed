/**
 * PRACTICE RECORD MECHANICS (practice sessions): the
 * native shapes beneath the two practice tools — the active-problem fold
 * (conclude-before-next-problem), the learner's work as plain messages
 * and the ask-style dismissal (a UI-only marker).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	newProblemDismissedMarker,
	newNextMessage,
	newOpenProblemMessage,
	newUserMessage,
	PRACTICE_CONCLUDE_TOOL,
	PRACTICE_PROBLEM_TOOL,
	type LhMessage,
} from "../../src/shared/core/native-messages.ts";
import { needsContinuation } from "../../src/shared/core/native-scans.ts";
import { activeProblemOf, problemChoicesOf, problemInputForConclude } from "../../src/shared/core/practice-problem.ts";
import { projectView } from "../../src/shared/core/index.ts";

// ── builders (native-shaped test fixtures) ───────────────────────────────────

const STAMPS = {
	api: "faux",
	provider: "test",
	model: "test-model",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
	stopReason: "toolUse",
} as const;

function problemPose(callId = "call_p1", statement = "Show that…"): LhMessage[] {
	const assistant: LhMessage & AssistantMessage = {
		id: `msg_a_${callId}`,
		role: "assistant",
		content: [
			{ type: "toolCall", id: callId, name: PRACTICE_PROBLEM_TOOL, arguments: { statement, mode: "recall", modelSolution: statement } },
		],
		timestamp: 1,
		...STAMPS,
	};
	const ack: LhMessage & ToolResultMessage = {
		id: `msg_r_${callId}`,
		role: "toolResult",
		toolCallId: callId,
		toolName: PRACTICE_PROBLEM_TOOL,
		content: [{ type: "text", text: "Problem posed — the turn ends here." }],
		details: null,
		isError: false,
		timestamp: 2,
	};
	return [assistant, ack];
}

function concludeCall(outcome: string): LhMessage[] {
	// Honest folds: the conclude call rides WITH its clean ack — a
	// dangling or errored conclude never freed anything.
	return [
		{
			id: `msg_c_${outcome}`,
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: `call_conclude_${outcome}`,
					name: PRACTICE_CONCLUDE_TOOL,
					arguments: { outcome },
				},
			],
			timestamp: 3,
			...STAMPS,
		},
		{
			id: `msg_cr_${outcome}`,
			role: "toolResult",
			toolCallId: `call_conclude_${outcome}`,
			toolName: PRACTICE_CONCLUDE_TOOL,
			content: [{ type: "text", text: "Problem concluded — the composer is free; pose the next problem or wrap up." }],
			details: null,
			isError: false,
			timestamp: 4,
		},
	];
}

// ── the active-problem fold ──────────────────────────────────────────────────

describe("activeProblemOf (the conclude-before-next-problem gate's fold)", () => {
	it("no messages → nothing active", () => {
		assert.equal(activeProblemOf([]), null);
	});

	it("a posed problem (call + ack) is ACTIVE — the ack does not conclude", () => {
		const messages = problemPose();
		const active = activeProblemOf(messages);
		assert.equal(active?.toolCallId, "call_p1");
		assert.deepEqual(active?.input, { statement: "Show that…", mode: "recall", modelSolution: "Show that…" });
	});

	it("the learner's messages keep it active (they never conclude)", () => {
		const messages = [
			...problemPose(),
			newUserMessage("stuck at the second step"),
		];
		assert.equal(activeProblemOf(messages)?.toolCallId, "call_p1");
	});

	it("a conclude call deactivates", () => {
		const messages = [...problemPose(), ...concludeCall("solved")];
		assert.equal(activeProblemOf(messages), null);
	});

	it("an ERRORED pose never activates (the BKT phantom — honest activation)", () => {
		// The gate refused the pose ("a problem is already active" in the
		// BKT incident); the composer must not mount from its arguments.
		const rejected = problemPose("call_bad", "A different student…");
		(rejected[1]! as unknown as { isError: boolean }).isError = true;
		assert.equal(activeProblemOf(rejected), null, "a lone refused pose is nothing");
	});

	it("a clean pose UNDER an errored rejection stays active (the scan skips refusals)", () => {
		const rejected = problemPose("call_bad", "A different student…");
		(rejected[1]! as unknown as { isError: boolean }).isError = true;
		const active = activeProblemOf([...problemPose(), ...rejected]);
		assert.ok(active, "the clean pose below is still the active one");
		assert.equal(active!.toolCallId, "call_p1");
	});

	it("an ERRORED conclude does not free (only the clean ack frees)", () => {
		const badConclude = concludeCall("solved");
		(badConclude[1]! as unknown as { isError: boolean }).isError = true;
		const active = activeProblemOf([...problemPose(), ...badConclude]);
		assert.ok(active, "the conclude never happened — the problem stays live");
		assert.equal(active!.toolCallId, "call_p1");
	});

	it("a DANGLING pose (mid-turn, no result) does not activate — it has not gone through", () => {
		const dangling = problemPose("call_new", "Fresh problem…")[0]!;
		assert.equal(activeProblemOf([dangling]), null, "no ack, no problem");
	});

	it("a dismissal marker deactivates immediately (the card closes at Esc)", () => {
		const messages = [...problemPose(), newProblemDismissedMarker("call_p1")];
		assert.equal(activeProblemOf(messages), null);
	});

	it("a NEWER problem after a conclude is the active one", () => {
		const messages = [
			...problemPose("call_p1"),
			...concludeCall("solved"),
			...problemPose("call_p2", "second"),
		];
		assert.equal(activeProblemOf(messages)?.toolCallId, "call_p2");
	});
});

describe("a homework pick in the view", () => {
	it("draws the pick as its go-ahead line, and 0.6.74's Teach me this as his own line", () => {
		const pick = projectView([newOpenProblemMessage("2b")]).flatMap((m) => m.parts);
		assert.deepEqual(pick.map((p) => [p.type, p.data]), [["data-practice-next", { homework: false, number: "2b" }]]);
		const old = { id: "m1", role: "custom", customType: "teach-me", content: "[TEACH ME] The learner asks you to teach the method of the open problem.", display: true, details: {}, timestamp: 1 } as LhMessage;
		const view = projectView([old]);
		assert.deepEqual([view[0]!.role, view[0]!.parts.map((p) => [p.type, p.text])], ["user", [["text", "Teach me this"]]]);
	});
});

// ── the continuation fold's practice carve-out ──────────────────────────────

describe("needsContinuation (a persisted pose ack owes nothing)", () => {
	it("a record ending on a problem-pose ack does NOT wake a continuation", () => {
		// The pose's terminate:true ended that turn deliberately; the
		// ack persists (unlike a question's placeholder). Without the
		// carve-out, a reload after a posed problem would wake a
		// phantom turn.
		assert.equal(needsContinuation(problemPose()), false);
	});

	it("a mixed batch (conclude ack then pose ack) still owes nothing — the pose is terminal", () => {
		const messages = [
			...problemPose("call_p0", "the earlier one"),
			...concludeCall("solved"),
			{
				id: "msg_r_conclude",
				role: "toolResult",
				toolCallId: "call_conclude_solved",
				toolName: PRACTICE_CONCLUDE_TOOL,
				content: [{ type: "text", text: "Problem concluded." }],
				details: null,
				isError: false,
				timestamp: 4,
			} as LhMessage & ToolResultMessage,
			...problemPose("call_p2", "the next one"),
		];
		assert.equal(needsContinuation(messages), false);
	});

	it("an ERROR result is not a pose — the agent loop continues past it, so a record ending there (an abort) is owed the wake like any interrupted tool", () => {
		const messages = [...problemPose("call_pe")];
		const err = messages[1] as LhMessage & ToolResultMessage;
		err.isError = true;
		err.content = [{ type: "text", text: "A problem is already active." }];
		assert.equal(needsContinuation(messages), true);
	});
});


// ── the reveal join ───────────────────────────────

describe("problemInputForConclude (the conclusion's hero is the pose's commitment)", () => {
	it("returns the cleanly-posed problem's modelSolution before the conclude", () => {
		const messages = [...problemPose(), ...concludeCall("solved")];
		assert.equal(problemInputForConclude(messages, "call_conclude_solved")?.modelSolution, "Show that…");
	});

	it("skips refused poses — a rejected pose revealed nothing", () => {
		const rejected = problemPose("call_bad", "A different student…");
		(rejected[1]! as unknown as { isError: boolean }).isError = true;
		const messages = [...rejected, ...concludeCall("solved")];
		assert.equal(problemInputForConclude(messages, "call_conclude_solved")?.modelSolution, undefined);
	});

	it("the newest pose before ITS conclude wins (multi-problem records)", () => {
		const messages = [
			...problemPose("call_p1", "first"),
			...concludeCall("solved"),
			...problemPose("call_p2", "second"),
			...concludeCall("movedOn"),
		];
		assert.equal(problemInputForConclude(messages, "call_conclude_movedOn")?.modelSolution, "second");
		assert.equal(problemInputForConclude(messages, "call_conclude_solved")?.modelSolution, "first");
	});

	it("projectView enriches the conclude part with the reveal", () => {
		const messages = [...problemPose(), ...concludeCall("solved")];
		const view = projectView(messages);
		const conclude = view.flatMap((m) => m.parts).find((p) => p.type === "tool-conclude");
		assert.ok(conclude, "the conclude part projects");
		assert.equal(conclude!.reveal, "Show that…", "the view-seam join carries the committed solution");
	});
});

// ── the transcript face of the signal ───────────────────────────────────────

describe("projectView renders the move-on signal", () => {
	it("the practice-next marker projects the compact part (the centered NEXT PROBLEM line)", () => {
		const view = projectView([newNextMessage()]);
		const parts = view[0]?.parts ?? [];
		assert.ok(
			parts.some((p) => p.type === "data-practice-next"),
			"the data-practice-next part rides the view",
		);
	});

	it("the line knows whether the lesson works an assignment", () => {
		const note = { id: "h", role: "custom", customType: "homework-context", content: "…", display: false, timestamp: 1 } as unknown as LhMessage;
		const dataOf = (messages: LhMessage[]) => projectView(messages).flatMap((m) => m.parts).find((p) => p.type === "data-practice-next")?.data;
		assert.deepEqual(dataOf([note, newNextMessage()]), { homework: true, number: null });
		assert.deepEqual(dataOf([newNextMessage()]), { homework: false, number: null });
	});
});

describe("the choices a problem's pose carries", () => {
	it("are its labels in order, with select all that apply only when asked", () => {
		const options = [{ label: " $x<1$ " }, { label: "$x=1$" }];
		assert.deepEqual(problemChoicesOf({ statement: "s", options }), { labels: ["$x<1$", "$x=1$"], multiSelect: false });
		assert.deepEqual(problemChoicesOf({ statement: "s", options, multiSelect: true }), { labels: ["$x<1$", "$x=1$"], multiSelect: true });
	});

	it("read past options and multiSelect sent as encoded text", () => {
		assert.deepEqual(problemChoicesOf({ options: '[{"label":"a"},{"label":"b"}]', multiSelect: "true" }), { labels: ["a", "b"], multiSelect: true });
	});

	it("are none for a problem without options or with an unlabelled one", () => {
		assert.equal(problemChoicesOf({ statement: "s" }), null);
		assert.equal(problemChoicesOf(null), null);
		assert.equal(problemChoicesOf({ options: [] }), null);
		assert.equal(problemChoicesOf({ options: [{ label: "a" }, { label: "  " }] }), null);
		assert.equal(problemChoicesOf({ options: [{ label: "a" }, "b"] }), null);
	});
});
