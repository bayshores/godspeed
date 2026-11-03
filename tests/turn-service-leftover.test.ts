import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, mock } from "node:test";

import type { CoverageEntry } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
import type { ChatStore, GraphStore } from "../src/core/ports.ts";
import { coverageSlots } from "../src/core/coverage.ts";
import type { ExtractionPipeline } from "../src/agent/subagents/extraction.ts";
import { runs } from "../src/agent/subagents/extraction-runs.ts";
import { extractWhenIdle, LEFTOVER_IDLE_MS, triggerExtraction } from "../src/server/turn-service.ts";
import { beginTurn, endTurn } from "../src/server/turn-liveness.ts";

const CHAT = "chat_leftover";

function teacher(id: string, text: string): LhMessage {
	return { id, role: "assistant", content: [{ type: "text", text }], timestamp: 0 } as unknown as LhMessage;
}

/** A lesson record plus its coverage ledger, and an extraction that records each run. */
function fixture(messages: LhMessage[]) {
	const state = { messages, coverage: [] as CoverageEntry[], deleted: false };
	const chatStore = { getChat: (id: string) => (id === CHAT && !state.deleted ? { id, messages: state.messages } : null) } as unknown as ChatStore;
	const graphStore = { readCoverage: () => state.coverage } as unknown as GraphStore;
	const calls: string[] = [];
	const extraction = {
		runExtraction: async (id: string) => {
			calls.push(id);
			return { nodes: 0, chains: 0 };
		},
	} as unknown as ExtractionPipeline;
	const coverAll = () => {
		state.coverage = coverageSlots(state.messages).map((s) => ({ chatId: CHAT, fp: s.fp, tokens: s.tokens, foldedAt: "" }));
	};
	return { state, deps: { chatStore, graphStore }, extraction, calls, coverAll };
}

describe("the leftover idle timer", () => {
	beforeEach(() => mock.timers.enable({ apis: ["setTimeout"] }));
	afterEach(() => {
		mock.timers.reset();
		runs().inFlight.delete(CHAT);
		endTurn(CHAT);
	});

	it("extracts a short stretch once the lesson sits idle", () => {
		const f = fixture([teacher("m1", "A short answer.")]);
		extractWhenIdle(f.deps, f.extraction, CHAT, LEFTOVER_IDLE_MS);
		mock.timers.tick(LEFTOVER_IDLE_MS - 1);
		assert.deepEqual(f.calls, []);
		mock.timers.tick(1);
		assert.deepEqual(f.calls, [CHAT]);
	});

	it("waits again while the lesson's extraction is still running, then sweeps what landed meanwhile", () => {
		const f = fixture([teacher("m1", "A short answer.")]);
		runs().inFlight.add(CHAT);
		extractWhenIdle(f.deps, f.extraction, CHAT, LEFTOVER_IDLE_MS);
		mock.timers.tick(LEFTOVER_IDLE_MS);
		assert.deepEqual(f.calls, [], "a run in flight would swallow the request");
		runs().inFlight.delete(CHAT);
		mock.timers.tick(LEFTOVER_IDLE_MS);
		assert.deepEqual(f.calls, [CHAT]);
	});

	it("waits again while a turn runs, so a failed turn still gets its stretch saved", () => {
		const f = fixture([teacher("m1", "A short answer.")]);
		assert.ok(beginTurn(CHAT));
		extractWhenIdle(f.deps, f.extraction, CHAT, LEFTOVER_IDLE_MS);
		mock.timers.tick(LEFTOVER_IDLE_MS);
		assert.deepEqual(f.calls, []);
		endTurn(CHAT);
		mock.timers.tick(LEFTOVER_IDLE_MS);
		assert.deepEqual(f.calls, [CHAT]);
	});

	it("does nothing when the stretch was saved meanwhile or the lesson was deleted", () => {
		const f = fixture([teacher("m1", "A short answer.")]);
		extractWhenIdle(f.deps, f.extraction, CHAT, LEFTOVER_IDLE_MS);
		f.coverAll();
		mock.timers.tick(LEFTOVER_IDLE_MS);
		f.state.coverage = [];
		f.state.deleted = true;
		extractWhenIdle(f.deps, f.extraction, CHAT, LEFTOVER_IDLE_MS);
		mock.timers.tick(LEFTOVER_IDLE_MS);
		assert.deepEqual(f.calls, []);
	});

	it("a full chunk that lands while a run is going waits for idle instead of being dropped", () => {
		const env = process.env as Record<string, string | undefined>;
		const was = env.NODE_ENV;
		env.NODE_ENV = "production";
		try {
			const f = fixture([teacher("m1", "x".repeat(400))]);
			triggerExtraction(f.deps, f.extraction, CHAT, 10);
			assert.deepEqual(f.calls, [CHAT], "nothing going: it runs now");
			runs().inFlight.add(CHAT);
			triggerExtraction(f.deps, f.extraction, CHAT, 10);
			assert.deepEqual(f.calls, [CHAT]);
			runs().inFlight.delete(CHAT);
			mock.timers.tick(LEFTOVER_IDLE_MS);
			assert.deepEqual(f.calls, [CHAT, CHAT]);
		} finally {
			env.NODE_ENV = was;
		}
	});
});
