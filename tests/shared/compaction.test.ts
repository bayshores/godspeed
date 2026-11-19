import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	activeCompactionOf,
	newUserMessage,
	type LhMessage,
} from "../../src/shared/core/index.ts";
import { projectView } from "../../src/shared/core/view.ts";
import { newCompactionMarker } from "../compaction-marker.ts";

/**
 * COMPACTION in the frontend: the active marker is the NEWEST one (chained
 * compactions rule last), and the view draws its dividers.
 */

// ─── the marker + the active scan ───────────────────────────────────────────

describe("the active compaction marker", () => {
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
