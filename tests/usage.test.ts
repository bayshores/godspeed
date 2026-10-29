import assert from "node:assert/strict";
import test from "node:test";
import * as fs from "node:fs";
import { chatStore } from "../src/store/chats.ts";
import { graphStore } from "../src/store/graph.ts";
import { PATHS, SOURCES_FILE } from "../src/config.ts";
import { callCost, jobCost, sessionCost, turnCost } from "../src/server/pricing.ts";
import { sumSteps } from "../src/core/prices.ts";
import type { CallUsage, ExtractionRunUsage, JobRecord, TurnUsage } from "../src/core/contracts.ts";

const call = (over: Partial<CallUsage> = {}): CallUsage => ({
	inputTokens: 0, outputTokens: 0, cacheReadTokens: undefined,
	cacheWriteTokens: undefined, reasoningTokens: undefined, ...over,
});

test("sumSteps: absent stays absent; unknown long-cache detail stays unknown", () => {
	const sum = sumSteps([call({ inputTokens: 100, outputTokens: 20 }), call({ inputTokens: 50, outputTokens: 10, cacheReadTokens: 30 })]);
	assert.equal(sum.inputTokens, 150);
	assert.equal(sum.outputTokens, 30);
	assert.equal(sum.cacheReadTokens, 30);
	assert.equal(sum.cacheWriteTokens, undefined);
	assert.equal(sumSteps([call({ inputTokens: undefined, outputTokens: undefined })]).inputTokens, undefined);
	assert.equal(sumSteps([call({ cacheWriteTokens: 10 }), call({ cacheWriteTokens: 20, cacheWrite1hTokens: 5 })]).cacheWrite1hTokens, undefined);
});

test("no call has an API price: the outside agent bills its own plan (owner, 2026-10-27)", () => {
	const usage = call({ inputTokens: 100_000, outputTokens: 20_000, cacheReadTokens: 10_000 });
	for (const model of ["agent:outside-agent", "openrouter:z-ai/glm-5.3-flash", "not/a-model"]) assert.equal(callCost(usage, model), null, model);
});

test("turn/session costs count plan turns and unpriced turns separately, never a fake zero", () => {
	const turn: TurnUsage = { id: "t1", messageId: "m1", at: "x", model: "agent:outside-agent", steps: [call({ inputTokens: 10_000, outputTokens: 2_000 })] };
	const totals = sessionCost({ turns: [turn, { ...turn, id: "t2", model: "not/a-model" }] });
	assert.equal(totals.subscription, 1, "the outside agent's turn is plan usage");
	assert.equal(totals.unpriced, 1);
	assert.equal(totals.cost, 0);
	assert.equal(turnCost(turn), null);
	assert.deepEqual(totals.turnCosts, { t1: null, t2: null });
});

test("jobs have no API price; missing usage stays absent", () => {
	assert.equal(jobCost({}), null);
	const job: Pick<JobRecord, "usage"> = { usage: { model: "agent:outside-agent", inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, steps: 4 } };
	assert.equal(jobCost(job), null);
});

test("appendTurnUsage: idempotent per turn; continuations survive saveMessages; list omits log", () => {
	const record = chatStore.createChat("usage fixture");
	try {
		const entry: TurnUsage = { id: "turn_1", messageId: "msg_a", at: "x", model: "openai:gpt-5", steps: [call({ inputTokens: 100, outputTokens: 10, cacheWrite1hTokens: 0 })] };
		chatStore.appendTurnUsage(record.id, entry);
		chatStore.appendTurnUsage(record.id, entry);
		chatStore.appendTurnUsage(record.id, { ...entry, id: "turn_2" });
		assert.equal(chatStore.getChat(record.id)?.turns?.length, 2);
		chatStore.saveMessages(record.id, [{ id: "msg_a", role: "user", content: "fixture", timestamp: 1 }]);
		assert.deepEqual(chatStore.getChat(record.id)?.turns?.[0]?.steps, JSON.parse(JSON.stringify(entry.steps)));
		assert.equal(chatStore.getChat(record.id)?.turns?.length, 2);
		assert.equal("turns" in chatStore.listChats().find((c) => c.id === record.id)!, false);
	} finally { fs.unlinkSync(`${PATHS.chats}/${record.id}.json`); }
});

const runEntry = (startedAt: number): ExtractionRunUsage => ({
	startedAt, at: "2026-09-09T00:00:00Z", durationMs: 42_000,
	stats: { nodes: 1, chains: 2 }, stages: {
		extractor: { model: "openai:gpt-5", steps: [call({ inputTokens: 100, outputTokens: 10 })] },
	},
});

test("appendExtractionUsage: idempotent; failed runs persist; list omits log", () => {
	const record = chatStore.createChat("extraction usage fixture");
	try {
		chatStore.appendExtractionUsage(record.id, runEntry(1));
		chatStore.appendExtractionUsage(record.id, runEntry(1));
		chatStore.appendExtractionUsage(record.id, runEntry(2));
		chatStore.appendExtractionUsage(record.id, { ...runEntry(3), stats: undefined });
		assert.equal(chatStore.getChat(record.id)?.extractions?.length, 3);
		assert.equal(chatStore.getChat(record.id)?.extractions?.at(-1)?.stats, undefined);
		assert.equal("extractions" in chatStore.listChats().find((c) => c.id === record.id)!, false);
	} finally { fs.unlinkSync(`${PATHS.chats}/${record.id}.json`); }
});

test("appendSourceUsage: idempotent; reimport keeps history; absent source is a no-op", () => {
	fs.mkdirSync(PATHS.graph, { recursive: true });
	const backup = fs.existsSync(SOURCES_FILE) ? fs.readFileSync(SOURCES_FILE) : undefined;
	try {
		const id = "src_usagetest01";
		graphStore.upsertSource({ id, filePath: "/fixture/notes.md", importedAt: "2026-09-13T00:00:00Z" });
		graphStore.appendSourceUsage(id, runEntry(1));
		graphStore.appendSourceUsage(id, runEntry(1));
		graphStore.appendSourceUsage(id, runEntry(2));
		assert.equal(graphStore.readSources().find((s) => s.id === id)?.extractions?.length, 2);
		graphStore.upsertSource({ id, filePath: "/fixture/notes.md", importedAt: "2026-09-14T00:00:00Z" });
		assert.equal(graphStore.readSources().find((s) => s.id === id)?.extractions?.length, 2);
		graphStore.appendSourceUsage("src_missing", runEntry(1));
	} finally {
		if (backup) fs.writeFileSync(SOURCES_FILE, backup);
		else fs.rmSync(SOURCES_FILE, { force: true });
	}
});
