import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activeCompactionOf,
	estimateMessageTokens,
	compactionCutIndex,
	keptIndexFor,
	newCompactionMarker,
	newUserMessage,
	COMPACTED_HISTORY_HEADER,
	type LhMessage,
	type LhMarkerMessage,
} from "../../src/shared/core/index.ts";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { projectView } from "../../src/shared/core/view.ts";

/**
 * COMPACTION: the cut walk and the marker.
 *
 * The laws pinned here:
 * - the cut NEVER separates a tool result from its call;
 * - a pending question call (pose→answer window) always survives — the
 *   walk cannot cross the transcript end;
 * - the active marker is the NEWEST one (chained compactions rule last).
 */

const assistantWithCall = (id: string, callId: string, text = "Let me quiz you."): LhMessage =>
	({
		id,
		role: "assistant",
		content: [
			{ type: "text", text },
			{ type: "toolCall", id: callId, name: "quiz", arguments: { question: "Q?" } },
		],
		timestamp: 1,
	}) as never;

const resultFor = (callId: string, text: string): LhMessage & ToolResultMessage =>
	({
		id: `r_${callId}`,
		role: "toolResult",
		toolCallId: callId,
		toolName: "quiz",
		content: [{ type: "text", text }],
		isError: false,
		timestamp: 2,
	}) as never;

const big = (id: string, kb = 8): LhMessage => newUserMessage(`${id}: ${"x".repeat(kb * 1024)}`);

describe("estimateMessageTokens (wire text only — the 3x-inflation fix)", () => {
	it("assistant: text + thinking + toolCall name/args — scaffolding never counted", () => {
		const m = {
			id: "a1",
			role: "assistant",
			content: [
				{ type: "text", text: "x".repeat(400) },
				{ type: "thinking", thinking: "y".repeat(800), thinkingSignature: "sig" },
				{ type: "toolCall", id: "c1", name: "quiz", arguments: { q: "z".repeat(200) } },
			],
			usage: { input: 9_999_999, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 10_000_000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			responseId: "r".repeat(300),
			timestamp: 1,
		} as never as LhMessage;
		const expected = Math.ceil((400 + 800 + ("quiz".length + JSON.stringify({ q: "z".repeat(200) }).length)) / 4);
		assert.equal(estimateMessageTokens(m), expected); // usage/responseId/signature inflate nothing
	});
});

// ─── the cut walk ────────────────────────────────────────────────────────────

describe("compactionCutIndex", () => {
	it("keeps ~the budget of recent messages: everything before is the span", () => {
		const messages = [big("m1"), big("m2"), big("m3"), big("m4"), newUserMessage("recent")];
		// ~8KB each ≈ 2k tokens; a 4.5k budget keeps the last two + recent.
		const cut = compactionCutIndex(messages, 4_500);
		// check-at-loop-top: kept = [m2, m3, m4, recent] ≈ 6.2k — the first
		// end-prefix whose estimate reaches the budget (overshoot = one message)
		assert.equal((messages[cut] as { content: string }).content.startsWith("m2"), true, "the oldest kept message sits at the cut");
	});

	it("native cut after an oversized result drops both call and result, never keeps an orphan", () => {
		const messages = [
			big("m1"),
			big("m2"),
			assistantWithCall("a1", "call_1"), // pose
			resultFor("call_1", "correct"), // answer — must ride WITH a1
			big("m3"),
			big("m4"),
		];
		// Budget lands on the result. Pi chooses the next valid cut AT OR
		// AFTER it, dropping the complete exchange rather than extending.
		const cut = compactionCutIndex(messages, [big("m3"), big("m4")].reduce((sum, m) => sum + estimateMessageTokens(m), 0) + 1);
		assert.equal(cut, 4);
		const keptIds = new Set(messages.slice(cut).map((m) => m.id));
		assert.equal(keptIds.has("a1"), false);
		assert.equal(keptIds.has("r_call_1"), false);
	});

	it("a PENDING question call (no result — the pose→answer window) always survives", () => {
		const messages = [big("m1"), big("m2"), big("m3"), assistantWithCall("a_pending", "call_p")];
		const cut = compactionCutIndex(messages, 100); // tiny budget
		const kept = messages.slice(cut);
		assert.ok(kept.some((m) => m.id === "a_pending"), "the pending pose is never dropped");
	});

	it("whole history within budget keeps everything (zero cut)", () => {
		assert.equal(compactionCutIndex([newUserMessage("hi")], 100), 0);
	});
});

// ─── the marker + the active scan ───────────────────────────────────────────

describe("the compaction marker", () => {
	it("content is the header + summary; details carry the cut", () => {
		const marker = newCompactionMarker("The learner knows X.", {
			firstKeptMessageId: "m9",
			tokensBefore: 180_000,
			model: "openai:gpt-5.2",
			at: "2026-10-05T12:00:00.000Z",
		});
		assert.equal(marker.customType, "compaction");
		assert.ok(marker.content.startsWith(COMPACTED_HISTORY_HEADER));
		assert.ok(marker.content.endsWith("The learner knows X."));
		assert.equal((marker.details as { firstKeptMessageId: string }).firstKeptMessageId, "m9");
	});

	it("activeCompactionOf: the NEWEST marker rules (chained compactions)", () => {
		const old = newCompactionMarker("old", { firstKeptMessageId: "m1", tokensBefore: 1, at: "t" });
		const fresh = newCompactionMarker("fresh", { firstKeptMessageId: "m5", tokensBefore: 2, at: "t" });
		const active = activeCompactionOf([old as never, newUserMessage("x"), fresh as never]);
		assert.equal(active!.content.endsWith("fresh"), true);
	});

	it("a marker with malformed details is not an active compaction (defensive)", () => {
		const broken = { ...newCompactionMarker("s", { firstKeptMessageId: "m1", tokensBefore: 1, at: "t" }), details: {} };
		assert.equal(activeCompactionOf([broken as never]), null);
	});

	it("keptIndexFor: found by id; missing → -1 (the honest-fallback signal)", () => {
		const marker = newCompactionMarker("s", { firstKeptMessageId: "m2", tokensBefore: 1, at: "t" }) as LhMarkerMessage & { details: { firstKeptMessageId: string } };
		const messages = [newUserMessage("a"), newUserMessage("b"), newUserMessage("c")];
		messages[0]!.id = "m1";
		messages[1]!.id = "m2";
		assert.equal(keptIndexFor(messages as never, marker as never), 1);
		const gone = newCompactionMarker("s", { firstKeptMessageId: "zzz", tokensBefore: 1, at: "t" }) as LhMarkerMessage & { details: { firstKeptMessageId: string } };
		assert.equal(keptIndexFor(messages as never, gone as never), -1);
	});
});

// ---------------------------------------------------------------------------
// THE VIEW FOLD: two dividers from one marker —
// the minimal moment divider where the user is, the longer cut divider
// at the kept boundary. Both carry the full summary payload.
// ---------------------------------------------------------------------------
describe("projectView compaction dividers", () => {
	const record = (): LhMessage[] => [
		{ id: "old1", role: "user", content: "earliest", timestamp: 1 },
		{ id: "kept", role: "user", content: "recent", timestamp: 2 },
		newCompactionMarker("SUMMARY TEXT", {
			firstKeptMessageId: "kept",
			tokensBefore: 12345,
			at: new Date(0).toISOString(),
		}) as unknown as LhMessage,
	];

	it("emits the cut divider BEFORE the first kept message", () => {
		const view = projectView(record());
		const idx = view.findIndex((m) => m.parts.some((p) => p.type === "data-compaction-cut"));
		const keptIdx = view.findIndex((m) => m.parts.some((p) => p.type === "text" && p.text === "recent"));
		assert.ok(idx !== -1, "the cut divider exists");
		assert.ok(keptIdx !== -1);
		assert.equal(idx, keptIdx - 1, "immediately before the kept message");
		const part = view[idx]!.parts.find((p) => p.type === "data-compaction-cut")!;
		assert.equal((part.data as { content: string }).content.includes("SUMMARY TEXT"), true);
	});

	it("emits the moment divider at the marker (the transcript tail)", () => {
		const view = projectView(record());
		const moment = view.find((m) => m.parts.some((p) => p.type === "data-compaction"));
		assert.ok(moment, "the moment divider exists");
		const part = moment!.parts.find((p) => p.type === "data-compaction")!;
		assert.equal((part.data as { details: { tokensBefore: number } }).details.tokensBefore, 12345);
		// and it renders AFTER the kept message (the compaction moment is
		// the tail — where the user is when it happens)
		const keptIdx = view.findIndex((m) => m.parts.some((p) => p.type === "text" && p.text === "recent"));
		assert.ok(view.indexOf(moment!) > keptIdx);
	});
});
