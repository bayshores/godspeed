/**
 * THE COMPACTION SERVICE: shortening at once (no model) at the gate and
 * the settle kick, and the model's summary replacing it later (refine).
 * Pinned here with an injected summarizer (the sub-agent one-shot needs a
 * live engine; the SERVICE laws don't).
 *
 * The laws:
 * - over-threshold → a local marker lands at once, no summary call;
 * - under-threshold, or a turn owning the chat → no-op;
 * - chained shortening carries the prior summary forward;
 * - refine replaces the local marker in place, with usage, and only it;
 * - the effective threshold: min(setting, window − reserve).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import (the birth-stamp discipline) ─
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-compaction-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../../src/backend/store/chats.ts");
const { ensureCompacted, kickCompaction, refine, projectedContextTokens } = await import("../../src/backend/server/compaction.ts");
import type { CompactionDeps } from "../../src/backend/server/compaction.ts";
const { subscribe } = await import("../../src/shared/core/events.ts");
const { activeCompactionOf, effectiveThresholdTokens, newUserMessage, measuredContextTokens, COMPACTED_HISTORY_HEADER } = await import("../../src/shared/core/index.ts");
import type { LhMessage } from "../../src/shared/core/index.ts";

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

// ── fixtures ────────────────────────────────────────────────────────────────

const big = (text: string, kb = 100): LhMessage => newUserMessage(`${text}: ${"x".repeat(kb * 1024)}`);

/** A chat whose record projects far over any test threshold. */
function overThresholdChat(label: string): string {
	const chat = chatStore.createChat(label);
	const messages = [big("m1"), big("m2"), big("m3"), newUserMessage("recent")];
	chatStore.saveMessages(chat.id, messages);
	return chat.id;
}

let summarizeCalls = 0;
const depsOfUsage = { input: 1_000, output: 500, cacheRead: 0, cacheWrite: 0, totalTokens: 1_500, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const depsOf = (thresholdTokens: number): CompactionDeps => ({
	chatStore,
	// The engine is never touched when summarize is injected (only its
	// identity rides the marker's provenance) — a minimal stand-in.
	engine: { model: { provider: "faux", id: "test", contextWindow: 1_000_000 } } as never,
	modelId: "faux:test",
	kind: "teach",
	thresholdTokens,
	systemPromptTokens: 100,
	summarize: async (prompt) => {
		summarizeCalls++;
		assert.ok(prompt.includes("TRANSCRIPT") || prompt.length > 0);
		return {
			summary: `SUMMARY #${summarizeCalls}: the learner knows X.`,
			usage: depsOfUsage,
		};
	},
});

// ── the laws ────────────────────────────────────────────────────────────────

const markers = (chatId: string) => chatStore.getChat(chatId)!.messages.filter((m) => (m as { customType?: string }).customType === "compaction");

describe("shortening", () => {
	it("over the threshold: a local marker lands at once, with no summary call", () => {
		const chatId = overThresholdChat("shorten: basic");
		const before = summarizeCalls;
		const events: string[] = [];
		const off = subscribe((e) => {
			if (e.type === "record-changed" && (e as { chatId?: string }).chatId === chatId) events.push("record");
		});
		ensureCompacted(depsOf(40_000), chatId);
		off();
		const record = chatStore.getChat(chatId)!;
		const marker = activeCompactionOf(record.messages)!;
		assert.ok(marker, "the marker landed");
		assert.equal(marker.details.local, true);
		assert.match(marker.content, /godspeed shortened the earlier part/);
		assert.ok(marker.details.tokensBefore > 40_000, "provenance carries the trigger reading");
		assert.ok(projectedContextTokens(record.messages, 100) < 40_000, "the cut brought the projection under the threshold");
		assert.equal(summarizeCalls, before);
		assert.deepEqual(events, ["record"]);
	});

	it("under the threshold, or while a turn owns the chat, nothing happens", () => {
		const chatId = overThresholdChat("shorten: no-op");
		ensureCompacted(depsOf(10_000_000), chatId);
		ensureCompacted({ ...depsOf(40_000), canStart: () => false }, chatId);
		kickCompaction(() => ({ ...depsOf(40_000), canStart: () => false }), chatId);
		kickCompaction(() => null, chatId);
		assert.equal(activeCompactionOf(chatStore.getChat(chatId)!.messages), null);
	});

	it("the settle kick shortens too, and a second kick under the threshold adds nothing", () => {
		const chatId = overThresholdChat("shorten: kick");
		kickCompaction(() => depsOf(40_000), chatId);
		kickCompaction(() => depsOf(40_000), chatId);
		assert.equal(markers(chatId).length, 1);
	});

	it("chained: the second shortening carries the first forward", () => {
		const chatId = overThresholdChat("shorten: chained");
		ensureCompacted(depsOf(40_000), chatId);
		chatStore.saveMessages(chatId, [...chatStore.getChat(chatId)!.messages, big("m9"), big("m10"), big("m11")]);
		ensureCompacted(depsOf(40_000), chatId);
		assert.equal(markers(chatId).length, 2, "both markers persist (history is never rewritten)");
		assert.match(activeCompactionOf(chatStore.getChat(chatId)!.messages)!.content, /## Before that\n[\s\S]*godspeed shortened/);
	});

	it("effectiveThresholdTokens: the setting rules big windows; the window rule binds small ones", () => {
		assert.equal(effectiveThresholdTokens(150_000, 200_000), 150_000);
		assert.equal(effectiveThresholdTokens(150_000, 100_000), 100_000 - 16_384);
		assert.equal(effectiveThresholdTokens(undefined, 200_000), 40_000);
		assert.equal(effectiveThresholdTokens(undefined, undefined), 40_000);
	});

	it("a usage-heavy zero cut appends no marker", () => {
		const chat = chatStore.createChat("no-progress fixture");
		const assistant = { id: "measured", role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", usage: { input: 120_000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 120_001 }, timestamp: 1 } as LhMessage;
		chatStore.saveMessages(chat.id, [newUserMessage("tiny visible history"), assistant]);
		ensureCompacted(depsOf(40_000), chat.id);
		assert.equal(activeCompactionOf(chatStore.getChat(chat.id)!.messages), null);
		assert.equal(measuredContextTokens(chatStore.getChat(chat.id)!.messages), 120_001);
	});

	it("the marker clears the meter's measured reading", () => {
		const id = overThresholdChat("meter fixture");
		const assistant = { id: "measured", role: "assistant", content: [{ type: "text", text: "ok" }], stopReason: "stop", usage: { input: 120_000, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 120_001 }, timestamp: 1 } as LhMessage;
		chatStore.saveMessages(id, [...chatStore.getChat(id)!.messages, assistant]);
		ensureCompacted(depsOf(40_000), id);
		assert.equal(measuredContextTokens(chatStore.getChat(id)!.messages), null);
	});
});

describe("refine: the model's summary replaces the local one", () => {
	it("in place, with its usage, and the next shortening builds on it", async () => {
		const chatId = overThresholdChat("refine: basic");
		ensureCompacted(depsOf(40_000), chatId);
		const local = activeCompactionOf(chatStore.getChat(chatId)!.messages)!;
		await refine(depsOf(40_000), chatId);
		const record = chatStore.getChat(chatId)!;
		const refined = activeCompactionOf(record.messages)!;
		assert.equal(refined.id, local.id, "the same marker, in the same place");
		assert.ok(refined.content.startsWith(COMPACTED_HISTORY_HEADER));
		assert.match(refined.content, /SUMMARY #/);
		assert.equal(refined.details.local, false);
		assert.equal(refined.details.firstKeptMessageId, local.details.firstKeptMessageId);
		assert.equal(refined.details.model, "faux:test");
		assert.ok((record.turns ?? []).some((t) => t.messageId === local.id && t.model === "faux:test"), "usage keyed by the marker");
		const calls = summarizeCalls;
		await refine(depsOf(40_000), chatId);
		assert.equal(summarizeCalls, calls, "a refined marker isn't summarized again");
	});

	it("a chained refine reads the previous summary first", async () => {
		const chatId = overThresholdChat("refine: chained");
		ensureCompacted(depsOf(40_000), chatId);
		await refine(depsOf(40_000), chatId);
		chatStore.saveMessages(chatId, [...chatStore.getChat(chatId)!.messages, big("m9"), big("m10"), big("m11")]);
		ensureCompacted(depsOf(40_000), chatId);
		let seen = "";
		await refine({ ...depsOf(40_000), summarize: async (prompt, engine) => ((seen = prompt), depsOf(40_000).summarize!(prompt, engine)) }, chatId);
		assert.match(seen, /prior compaction summary[\s\S]*SUMMARY #/);
	});

	it("keeps what another writer saved while the summary was written", async () => {
		const chatId = overThresholdChat("refine: concurrent write");
		ensureCompacted(depsOf(40_000), chatId);
		const late = newUserMessage("saved during the summary");
		const deps = depsOf(40_000);
		await refine({ ...deps, summarize: async (prompt, engine) => {
			chatStore.saveMessages(chatId, [...chatStore.getChat(chatId)!.messages, late]);
			return deps.summarize!(prompt, engine);
		} }, chatId);
		const messages = chatStore.getChat(chatId)!.messages;
		assert.ok(messages.some((m) => m.id === late.id), "the concurrent write survives");
		assert.equal(activeCompactionOf(messages)!.details.local, false);
	});

	it("a failure, an empty summary or a newer marker leaves the local one", async () => {
		const chatId = overThresholdChat("refine: kept local");
		ensureCompacted(depsOf(40_000), chatId);
		await refine({ ...depsOf(40_000), summarize: async () => { throw new Error("boom"); } }, chatId);
		await refine({ ...depsOf(40_000), summarize: async () => ({ summary: "  ", usage: depsOfUsage }) }, chatId);
		await refine({ ...depsOf(40_000), summarize: async (prompt, engine) => {
			chatStore.saveMessages(chatId, [...chatStore.getChat(chatId)!.messages, big("m9"), big("m10"), big("m11")]);
			ensureCompacted(depsOf(40_000), chatId);
			return depsOf(40_000).summarize!(prompt, engine);
		} }, chatId);
		const record = chatStore.getChat(chatId)!;
		assert.ok(markers(chatId).every((m) => (m as { details: { local?: boolean } }).details.local === true));
		assert.equal(markers(chatId).length, 2);
		assert.ok(activeCompactionOf(record.messages));
	});
});
