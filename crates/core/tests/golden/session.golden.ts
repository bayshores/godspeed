// The session logic on made-up chats (tests/fixtures/session_chats.json) and on
// hand-made edge cases: empty input, huge text, an emoji split by a page cut, lone surrogates.
import fs from "node:fs";
import { healEncodedArguments } from "../../../../src/shared/core/argument-heal.ts";
import { fencedCode, writeCodeInputProblems, writeCodeInputSchema } from "../../../../src/shared/core/code-question.ts";
import {
	KEEP_RECENT_TOKENS,
	buildCompactionPrompt,
	calculateContextTokens,
	compactionCutIndex,
	effectiveThresholdTokens,
	estimateContextTokens,
	estimateMessageTokens,
	estimateTokens,
	compactionSpan,
	localSummary,
	newCompactionMarker,
	planTreeToText,
	serializeForSummary,
} from "../../../../src/shared/core/compaction.ts";
import { PROBE_DONE_ACK_TEXT, probeDoneInputSchema } from "../../../../src/shared/core/contracts/probe.ts";
import { accumulateJobUsage, buildAbortSteer, buildSubagentSteer, isSubagentFailure, piUsageToStep, setSteerUiInverted, steerDelivered } from "../../../../src/shared/core/contracts/jobs.ts";
import { derivePlanStatusesLh, derivedNodeStatus } from "../../../../src/shared/core/contracts/plan.ts";
import { graphCostSummary } from "../../../../src/shared/core/cost-summary.ts";
import { createTree } from "../../../../src/shared/core/plan-tree.ts";
import { planBlocksFor } from "../../../../src/shared/core/plan-blocks.ts";
import { planPositionLh, stepPosition } from "../../../../src/shared/core/plan-step-bar.ts";
import { isSubscriptionModel, sessionCost, subscriptionLabels, sumSteps } from "../../../../src/shared/core/prices.ts";
import { practiceOutcomes } from "../../../../src/shared/core/practice-outcomes.ts";
import {
	askInputSchema,
	askOptionProblems,
	coerceCorrectAnswer,
	compactAnswerForModel,
	confidenceLevel,
	explainInputBase,
	explainInputObject,
	explainInputProblems,
	levelPercent,
	parseOptionsIfString,
	probeQuizInputSchema,
	quizInputObject,
	quizInputProblems,
} from "../../../../src/shared/core/question-core.ts";
import { sessionMarkdown } from "../../../../src/shared/core/session-markdown.ts";
import { TOGGLEABLE_TOOLS, WRITABLE_TOOL_KEYS, filterEnabledTools, switchedOffToolsNote } from "../../../../src/shared/core/tool-switches.ts";
import { WORK_PAGE_BYTES, pageBlocks, splitPages } from "../../../../src/shared/core/work-pages.ts";

type Msg = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Chat = { id: string; title: string; messages: Msg[]; tree?: { nodes: Msg[]; edges: Msg[] }; turns?: Msg[]; extractions?: Msg[] };

const chats: Chat[] = JSON.parse(fs.readFileSync(new URL("../fixtures/session_chats.json", import.meta.url), "utf8")).chats;

// Output through JSON, so a schema's symbol keys and undefined fields drop like they do on disk.
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

// Ids and clocks differ per run; the Rust test checks their shape and masks them the same way.
const maskMarker = (message: Msg): Msg => ({
	...message,
	id: typeof message.id === "string" && /^(msg|pb)_[0-9a-z]+_[0-9a-f]{8}$/.test(message.id) ? "<id>" : message.id,
	timestamp: typeof message.timestamp === "number" ? "<now>" : message.timestamp,
});
const maskBlock = (message: Msg): Msg => {
	const out = maskMarker(message);
	const block = out.details?.block;
	return block ? { ...out, details: { ...out.details, block: { ...block, at: typeof block.at === "string" ? "<iso>" : block.at } } } : out;
};

// Every hand-made case lists its inputs beside the answer, so the Rust test replays exactly them.
const rec = <I>(inputs: readonly I[], run: (input: I) => unknown): unknown[] => inputs.map((input) => ({ input: plain(input), output: plain(run(input)) }));

const call = (id: string, name: string, args: unknown): Msg => ({ type: "toolCall", id, name, arguments: args });
const assistant = (id: string, content: unknown, extra: Msg = {}): Msg => ({ id, role: "assistant", content, ...extra });
const result = (call_id: string, tool: string, details: unknown, extra: Msg = {}): Msg => ({ role: "toolResult", toolName: tool, toolCallId: call_id, content: [{ type: "text", text: "ok" }], details, isError: false, timestamp: 1, ...extra });

// ─── per-chat cases ──────────────────────────────────────────────────────────

function chatCase(chat: Chat): unknown {
	const messages = chat.messages;
	const tree = chat.tree;
	const serialized = serializeForSummary(messages as never);
	const planText = planTreeToText(tree as never, messages as never);
	const statuses = tree ? derivePlanStatusesLh(tree as never, messages as never) : null;
	const markdown = sessionMarkdown(messages as never, { anchors: false });
	return plain({
		id: chat.id,
		messageTokens: messages.map((m) => estimateMessageTokens(m as never)),
		estimateTokens: estimateTokens(messages as never),
		context: estimateContextTokens(messages as never),
		cuts: [KEEP_RECENT_TOKENS, 5000, 1000, 100, 1, 0].map((keep) => compactionCutIndex(messages as never, keep)),
		serialized,
		planText,
		prompts: (["teach", "practice", "probe", "talk"] as const).map((kind) => buildCompactionPrompt({ spanText: serialized.slice(0, 300), planTreeText: planText, kind })),
		markdown,
		markdownTitled: sessionMarkdown(messages as never, { title: chat.title, anchors: false }).slice(0, 200),
		outcomes: practiceOutcomes(messages as never),
		position: tree ? planPositionLh(tree as never, messages as never) : null,
		current: statuses?.current ?? null,
		nodeStatuses: tree && statuses ? tree.nodes.map((n) => derivedNodeStatus(statuses, n.id)) : null,
		cost: sessionCost(chat as never),
		blocks: planBlocksFor([], messages as never, tree as never, messages as never).map((m) => maskBlock(m as never)),
		blocksAgain: planBlocksFor(messages as never, messages as never, tree as never, messages as never).map((m) => maskBlock(m as never)),
	});
}

// ─── hand-made inputs ────────────────────────────────────────────────────────

const emoji = "😀";
const loneHigh = "\ud83d";
const loneLow = "\ude00";
const pageTexts = [
	"",
	"hello",
	"a\nb",
	"line one\nline two\nline three",
	`${"x".repeat(40)}\n${"y".repeat(80)}`,
	`${"x".repeat(80)}\n${"y".repeat(80)}`,
	emoji.repeat(50),
	`a${emoji.repeat(30)}`,
	"é".repeat(70),
	"漢".repeat(60),
	`${"ab".repeat(20)}${loneHigh}${"cd".repeat(30)}`,
	`${loneLow}${"x".repeat(60)}${loneHigh}`,
	`${"z".repeat(48)}${emoji}${"z".repeat(50)}`,
	`${"q".repeat(46)}\n${emoji.repeat(20)}`,
	"\n".repeat(120),
	"abc\n".repeat(60),
	`${"w".repeat(98)}${loneHigh}`,
];
const pageLimits = [4, 5, 7, 10, 13, 50, 100, 101, 999];

const pageBlockSets: string[][] = [
	[],
	[""],
	["one"],
	["{}", "instructions", "[text 1]\nhello"],
	["a".repeat(30), "b".repeat(30), "c".repeat(30), "d".repeat(30)],
	[`${"a".repeat(80)}\n${"b".repeat(150)}`],
	["head", `${"a".repeat(80)}\n${"b".repeat(150)}`, "tail"],
	[emoji.repeat(40), "x", emoji.repeat(40)],
	["漢".repeat(40), "é".repeat(50), `${loneHigh}${"y".repeat(120)}${loneLow}`],
	["x".repeat(60), "y".repeat(45), "z".repeat(300)],
];

const usageSteps: Msg[] = [
	{},
	{ inputTokens: 10 },
	{ inputTokens: 5, outputTokens: 2, cacheReadTokens: 7, cacheWriteTokens: 3, cacheWrite1hTokens: 1, reasoningTokens: 4 },
	{ cacheWriteTokens: 9 },
	{ cacheWriteTokens: 9, cacheWrite1hTokens: 2 },
	{ cacheWriteTokens: 0 },
	{ outputTokens: 0.5, reasoningTokens: 0 },
];

const treeNodes = [{ id: "a", title: "A", summary: "first" }, { id: "b", title: "B" }, { id: "c", title: "C", summary: "" }];
const treeCases: [Msg[], Msg[]][] = [
	[[], []],
	[treeNodes, []],
	[treeNodes, [{ from: "a", to: "b" }, { from: "b", to: "c" }]],
	[treeNodes, [{ from: "a", to: "b", extra: 1 }]],
	[[{ id: " ", title: "x" }], []],
	[[{ title: "x" }], []],
	[[{ id: "a", title: "" }], []],
	[[{ id: "a", title: "   " }], []],
	[[{ id: "a", title: "x" }, { id: "a", title: "y" }], []],
	[treeNodes, [{ from: "a", to: "zz" }]],
	[treeNodes, [{ to: "a" }]],
	[treeNodes, [{ from: "a" }]],
	[treeNodes, [{ from: 5, to: "a" }]],
	[treeNodes, [{ from: null, to: "a" }]],
	[treeNodes, [{ from: ["a", "b"], to: "a" }]],
	[treeNodes, [{ from: "a", to: {} }]],
	[treeNodes, [{ from: "a", to: "a" }]],
	[treeNodes, [{ from: "a", to: "b" }, { from: "a", to: "b" }]],
	[treeNodes, [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }]],
	[treeNodes, [{ from: "a", to: "b" }, { from: "b", to: "a" }]],
];

// ─── cases ───────────────────────────────────────────────────────────────────

export default {
	"chats": () => chats.map(chatCase),

	"work pages: split": () => {
		const out: unknown[] = [];
		for (const text of pageTexts) {
			for (const max of pageLimits) out.push({ text, max, pages: splitPages(text, max) });
			out.push({ text, max: null, pages: splitPages(text) });
		}
		const huge = "x".repeat(100_000);
		out.push({ text: "huge ascii", pages: splitPages(huge).map((p) => p.length) });
		const hugeCjk = "漢".repeat(30_000);
		out.push({ text: "huge cjk", pages: splitPages(hugeCjk).map((p) => p.length) });
		const hugeLines = "some words on a line\n".repeat(5000);
		out.push({ text: "huge lines", pages: splitPages(hugeLines).map((p) => p.length) });
		out.push({ text: "constant", value: WORK_PAGE_BYTES });
		return out;
	},

	"work pages: blocks": () => {
		const out: unknown[] = [];
		for (const blocks of pageBlockSets) {
			for (const max of [5, 20, 50, 100, 500]) out.push({ blocks, max, pages: pageBlocks(blocks, max) });
			out.push({ blocks, max: null, pages: pageBlocks(blocks) });
		}
		out.push({ blocks: "huge", pages: pageBlocks(["x".repeat(60_000), "tail", "漢".repeat(20_000)]).map((p) => p.map((b) => b.length)) });
		return out;
	},

	"compaction: thresholds and usage": () => ({
		thresholds: rec(
			[
				[undefined, undefined],
				[undefined, 100_000],
				[64_000, undefined],
				[64_000, 100_000],
				[64_000, 20_000],
				[64_000, 16_384],
				[64_000, 0],
				[64_000, -5],
				[0, 50_000],
			],
			([setting, window]) => effectiveThresholdTokens(setting, window),
		),
		usage: rec(
			[{}, { totalTokens: 100 }, { totalTokens: 0, input: 10, output: 20, cacheRead: 30, cacheWrite: 40 }, { input: 10 }, { totalTokens: 5, input: 10 }, { cacheRead: 1.5, cacheWrite: 2.25 }],
			calculateContextTokens,
		),
	}),

	"compaction: messages": () => {
		const messages: Msg[] = [
			{ role: "user", content: "hello world" },
			{ role: "user", content: [{ type: "text", text: "abcd" }, { type: "image" }, "plain", { type: "other", text: "zzzz" }, null] },
			{ role: "user", content: [{ type: "text" }], attachments: [{ type: "text", text: "att" }] },
			{ role: "user", content: 5 },
			{ role: "user" },
			{ role: "assistant", content: [{ type: "text", text: "four" }, { type: "thinking", thinking: "think" }, call("c", "quiz", { a: 1, nested: [1, 2] }), call("d", "plan", undefined), { type: "other" }] },
			{ role: "assistant", content: "not an array" },
			{ role: "assistant", content: [{ type: "text", text: `😀${loneHigh}` }, call("e", "emoji😀", { s: "😀" })] },
			{ role: "toolResult", toolName: "quiz", content: [{ type: "text", text: "result text" }] },
			{ role: "system", content: "sys", sections: { a: "1234", b: "12" }, toolsAdded: ["x", "y"] },
			{ role: "custom", customType: "today-context", content: "ctx" },
			{ role: "custom", customType: "compaction", content: "summary" },
			{ role: "custom", customType: "plan-block", content: "" },
			{ role: "weird" },
		];
		const withUsage = (usage: Msg, extra: Msg = {}): Msg => assistant("u", [{ type: "text", text: "tail" }], { usage, ...extra });
		const contexts: Msg[][] = [
			[],
			[{ role: "user", content: "abcdefgh" }],
			[{ role: "user", content: "abcdefgh" }, withUsage({ totalTokens: 50 }), { role: "user", content: "12345678" }],
			[withUsage({ input: 10, output: 5 }), withUsage({ totalTokens: 0 }), { role: "user", content: "x" }],
			[withUsage({ totalTokens: 30 }), withUsage({ totalTokens: 99 }, { stopReason: "aborted" }), withUsage({ totalTokens: 98 }, { stopReason: "error" })],
			[withUsage({ totalTokens: 30 }), { role: "custom", customType: "compaction", content: "s" }, { role: "user", content: "abcd" }],
			[withUsage({ totalTokens: 30 }), { role: "custom", customType: "plan-block", content: "s" }, { role: "user", content: "abcd" }],
			[assistant("n", [{ type: "text", text: "no usage" }])],
			messages,
		];
		return {
			messages: plain(messages),
			each: plain(messages.map((m) => estimateMessageTokens(m as never))),
			total: estimateTokens(messages as never),
			contexts: rec(contexts, (m) => estimateContextTokens(m as never)),
		};
	},

	"compaction: cut and marker": () => {
		const text = (n: number): string => "x".repeat(n);
		const lists: Msg[][] = [
			[],
			[{ role: "user", content: "hi" }],
			[{ role: "toolResult", toolName: "t", content: [{ type: "text", text: "r" }] }],
			[{ role: "custom", customType: "plan-block", content: text(400) }, { role: "custom", customType: "problem-dismissed", content: text(400) }],
			[
				{ id: "m0", role: "user", content: text(400) },
				assistant("m1", [{ type: "text", text: text(400) }]),
				{ id: "m2", role: "toolResult", toolName: "t", content: [{ type: "text", text: text(4000) }] },
				{ id: "m3", role: "user", content: text(400) },
				assistant("m4", [{ type: "text", text: text(400) }]),
			],
			[
				{ id: "m0", role: "user", content: text(400) },
				assistant("m1", [{ type: "text", text: text(400) }]),
				{ id: "m2", role: "custom", customType: "compaction", content: "s", details: { firstKeptMessageId: "m1", tokensBefore: 5, at: "t" } },
				{ id: "m3", role: "user", content: text(400) },
				assistant("m4", [{ type: "text", text: text(400) }]),
				{ id: "m5", role: "custom", customType: "today-context", content: text(40) },
			],
			[
				{ id: "m0", role: "user", content: text(400) },
				{ id: "m1", role: "custom", customType: "compaction", content: "s", details: { firstKeptMessageId: "gone", tokensBefore: 5, at: "t" } },
				{ id: "m2", role: "user", content: text(400) },
				{ id: "m3", role: "custom", customType: "plan-block", content: text(4000) },
				assistant("m4", [{ type: "text", text: text(400) }]),
			],
			[
				{ id: "m0", role: "user", content: text(4000) },
				{ id: "m1", role: "custom", customType: "today-context", content: "t" },
				{ id: "m2", role: "custom", customType: "plan-block", content: text(40) },
				{ id: "m3", role: "custom", customType: "problem-dismissed", content: text(40) },
				{ id: "m4", role: "user", content: text(4000) },
			],
		];
		const marker = (summary: string, details: Msg): unknown => maskMarker(newCompactionMarker(summary, details as never) as never);
		const markerInputs: [string, Msg][] = [
			["  A summary.  \n", { firstKeptMessageId: "m3", tokensBefore: 1234, model: "agent:x", at: "2026-01-01T00:00:00.000Z" }],
			["", { firstKeptMessageId: "m3", tokensBefore: 0, at: "2026-01-01T00:00:00.000Z" }],
			["😀 summary", { firstKeptMessageId: "", tokensBefore: 1.5, at: "t" }],
		];
		return {
			cuts: rec(lists, (list) => ({ byKeep: [20_000, 1000, 250, 100, 10, 1, 0].map((keep) => compactionCutIndex(list as never, keep)), byDefault: compactionCutIndex(list as never) })),
			markers: rec(markerInputs, ([summary, details]) => marker(summary, details)),
		};
	},

	"compaction: serialize and plan text": () => {
		const long = "y".repeat(2500);
		const messages: Msg[] = [
			{ role: "user", content: "plain question" },
			{ role: "user", content: [{ type: "text", text: "part one" }, { type: "image" }, { type: "text", text: "part two" }] },
			assistant("a1", [{ type: "text", text: "first" }, { type: "thinking", thinking: "secret" }, call("c1", "quiz", { nodeId: "a", options: ["x", "y"] }), { type: "text", text: "second" }]),
			assistant("a2", [{ type: "thinking", thinking: "only thinking" }]),
			assistant("a3", [call("c2", "plan_init", { nodes: [] })]),
			result("c1", "quiz", { correct: true }, { content: [{ type: "text", text: long }] }),
			result("c2", "plan_init", {}, { isError: true, content: [{ type: "text", text: "short error" }] }),
			result("c3", "read", {}, { content: [{ type: "text", text: "😀".repeat(1100) }] }),
			result("c4", "read", {}, { content: [{ type: "text", text: "x".repeat(2000) }] }),
			result("c5", "read", {}, { content: [{ type: "image" }] }),
			{ role: "custom", customType: "plan-block", content: "hidden", details: {} },
			{ role: "custom", customType: "today-context", content: "today is a day" },
			{ role: "custom", customType: "space-context", content: "space", attachments: [{ type: "text", text: "attached file" }] },
			{ role: "system", content: "ignored" },
			{ role: "custom", customType: "compaction", content: "earlier summary" },
			assistant("a4", [{ type: "text", text: 5 }, { type: "text" }, { type: "text", text: null }, { type: "text", text: ["x", null, 2] }]),
			{ role: "custom", customType: "today-context", content: null },
			{ role: "custom", customType: "today-context", content: 7, attachments: "inline note" },
		];
		const tree = {
			nodes: [{ id: "a", title: "Alpha", summary: "the first" }, { id: "b", title: "Beta" }, { id: "c", title: "Gamma", summary: "" }, { id: "d", title: "Delta", summary: "last" }],
			edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "ghost" }, { from: "c", to: "d" }],
		};
		const tagged = (id: string, node: unknown, name = "quiz"): Msg => assistant(id, [call(`${id}c`, name, { nodeId: node })]);
		const planInputs: [unknown, Msg[]][] = [
			[undefined, []],
			[{ nodes: [], edges: [] }, []],
			[tree, []],
			[tree, [tagged("1", "a"), tagged("2", "b", "explain"), tagged("3", "zz"), tagged("4", "b"), tagged("5", "c", "problem"), tagged("6", 5, "quiz"), tagged("7", "a", "read")]],
			[tree, [tagged("1", "a"), tagged("2", "b"), tagged("3", "a")]],
		];
		const promptInputs = (["teach", "practice", "probe", "talk"] as const).flatMap((kind) => [
			{ kind, spanText: "SPAN 😀", planTreeText: null },
			{ kind, spanText: "", planTreeText: "- [current] A (a)" },
		]);
		return {
			messages: plain(messages),
			serialized: serializeForSummary(messages as never),
			empty: serializeForSummary([]),
			plans: rec(planInputs, ([t, m]) => planTreeToText(t as never, m as never)),
			prompts: rec(promptInputs, (input) => buildCompactionPrompt(input)),
		};
	},

	"compaction: local summary and span": () => {
		const many: Msg[] = Array.from({ length: 60 }, (_, i) => ({ id: `u${i}`, role: "user", content: `${i} ${"word ".repeat(150)}` }));
		const spans: { span: Msg[]; priorSummary: string | null; planTreeText: string | null }[] = [
			{ span: [], priorSummary: null, planTreeText: null },
			{ span: [{ role: "user", content: "short" }, assistant("a1", [{ type: "text", text: "😀".repeat(700) }])], priorSummary: "", planTreeText: "" },
			{ span: many.slice(0, 5), priorSummary: "s".repeat(9000), planTreeText: "- [current] A (a)" },
			{ span: many, priorSummary: "earlier", planTreeText: null },
			{ span: many, priorSummary: "😀".repeat(9000), planTreeText: "- [done] B (b)" },
		];
		const marker = (id: string, kept: unknown, content = "summary"): Msg => ({ id, role: "custom", customType: "compaction", content, details: { firstKeptMessageId: kept, tokensBefore: 1, at: "t" } });
		const lists: [Msg[], Msg][] = [
			[[{ id: "a", role: "user", content: "a" }, { id: "b", role: "user", content: "b" }, marker("k1", "b")], marker("k1", "b")],
			[[{ id: "a", role: "user", content: "a" }, { id: "b", role: "user", content: "b" }, marker("k1", "b", "first"), { id: "c", role: "user", content: "c" }, { id: "d", role: "user", content: "d" }, marker("k2", "d")], marker("k2", "d")],
			[[{ id: "a", role: "user", content: "a" }, marker("k1", "gone")], marker("k1", "gone")],
			[[{ id: "a", role: "user", content: "a" }], marker("k9", "a")],
			[[{ id: "a", role: "user", content: "a" }, { id: "b", role: "user", content: "b" }, marker("k1", "b", "first"), marker("k2", "a")], marker("k2", "a")],
			[[{ id: "a", role: "user", content: "a" }, marker("k1", "missing", "first"), { id: "c", role: "user", content: "c" }, marker("k2", "c")], marker("k2", "c")],
		];
		return {
			summaries: rec(spans, (input) => localSummary(input as never)),
			spans: rec(lists, ([messages, m]) => compactionSpan(messages as never, m as never)),
		};
	},

	"plan: derived statuses and step bar": () => {
		const tree = { nodes: [{ id: "a", title: "A" }, { id: "b", title: "B" }, { id: "c", title: "C" }, { id: "d", title: "D" }], edges: [{ from: "c", to: "a" }, { from: "a", to: "b" }, { from: "ghost", to: "a" }, { from: "d", to: "ghost" }] };
		const tagged = (id: string, node: unknown, name = "quiz", role = "assistant"): Msg => ({ id, role, content: [call(`${id}c`, name, { nodeId: node })] });
		const runs: Msg[][] = [
			[],
			[tagged("1", "a")],
			[tagged("1", "a"), tagged("2", "a")],
			[tagged("1", "a"), tagged("2", "b"), tagged("3", "a")],
			[tagged("1", "a"), tagged("2", "zzz"), tagged("3", "b")],
			[tagged("1", "a", "read"), tagged("2", "b", "problem"), tagged("3", "c", "explain")],
			[tagged("1", "a", "quiz", "user"), tagged("2", 7), tagged("3", null)],
			[{ role: "assistant", content: "text" }, { role: "assistant", content: [{ type: "text", text: "t" }, { type: "toolCall", name: "quiz" }] }],
			[assistant("m", [call("x", "quiz", undefined), call("y", "quiz", { nodeId: "d" })])],
		];
		const otherTrees = [
			{ nodes: [], edges: [] },
			{ nodes: [{ id: "x", title: "X" }, { id: "y", title: "Y" }], edges: [{ from: "x", to: "y" }, { from: "y", to: "x" }] },
			{ nodes: [{ id: "z", title: "Z" }, { id: "y", title: "Y" }, { id: "x", title: "X" }], edges: [] },
		];
		const otherRuns: Msg[][] = [[], [tagged("1", "x")], [tagged("1", "y"), tagged("2", "x")]];
		return {
			tree: plain(tree),
			runs: rec(runs, (messages) => {
				const statuses = derivePlanStatusesLh(tree as never, messages as never);
				return {
					current: statuses.current,
					statuses: tree.nodes.map((n) => derivedNodeStatus(statuses, n.id)),
					position: planPositionLh(tree as never, messages as never),
				};
			}),
			positions: rec(otherTrees.flatMap((t) => otherRuns.map((m) => ({ tree: t, messages: m }))), (input) => planPositionLh(input.tree as never, input.messages as never)),
			stepPosition: rec([[], [{ status: "upcoming" }], [{ status: "visited" }, { status: "visited" }], [{ status: "visited" }, { status: "current" }, { status: "upcoming" }]], (steps) => stepPosition(steps as never)),
		};
	},

	"plan: tree": () =>
		rec(treeCases, ([nodes, edges]) => {
			try {
				return { tree: createTree(nodes as never, edges as never) };
			} catch (err) {
				return { error: err instanceof Error ? err.message : String(err) };
			}
		}),

	"plan: blocks": () => {
		const tree = { nodes: [{ id: "a", title: "A" }, { id: "b", title: "B" }], edges: [{ from: "a", to: "b" }] };
		const planResult = (id: string, ok: unknown, tool = "plan_init", role = "toolResult"): Msg => ({ role, toolName: tool, toolCallId: id, details: { ok } });
		const marker = (callId: unknown): Msg => ({ role: "custom", customType: "plan-block", details: { planCallId: callId } });
		const transcript = [assistant("t1", [call("q1", "quiz", { nodeId: "a" }), call("q2", "quiz", { nodeId: "b" })])];
		const news: Msg[][] = [
			[],
			[planResult("p1", true)],
			[planResult("p1", true), planResult("p2", true), planResult("p3", false)],
			[planResult("p1", true), planResult("p2", "true")],
			[planResult("p1", true, "other")],
			[planResult("p1", true, "plan_init", "assistant")],
			[{ role: "toolResult", toolName: "plan_init", details: { ok: true } }],
			[{ role: "toolResult", toolName: "plan_init", toolCallId: 5, details: { ok: true } }],
			[{ role: "toolResult", toolName: "plan_init", toolCallId: "p9" }],
		];
		const records: Msg[][] = [[], [marker("p2")], [marker("p1"), marker("p2")], [marker(5), { role: "custom", customType: "other", details: { planCallId: "p2" } }]];
		const trees = [tree, null, undefined, { nodes: [], edges: [] }, { nodes: [{ id: "a", title: "A" }], edges: [] }, { nodes: [{ id: "a" }, { title: "B" }], edges: [{ from: "a" }] }];
		const grid = trees.flatMap((t) => records.flatMap((record) => news.map((fresh) => ({ tree: t, record, fresh }))));
		return {
			transcript: plain(transcript),
			blocks: rec(grid, ({ tree: t, record, fresh }) => planBlocksFor(record as never, fresh as never, t as never, transcript as never).map((m) => maskBlock(m as never))),
		};
	},

	"practice outcomes": () => {
		const problem = (id: string, mid: string, args: unknown): Msg => assistant(mid, [call(id, "problem", args)]);
		const conclude = (id: string, mid: string, outcome: unknown): Msg => assistant(mid, [call(id, "conclude", { outcome })]);
		const ok = (id: string, timestamp: unknown = 1_700_000_000_123, extra: Msg = {}): Msg => ({ role: "toolResult", toolCallId: id, timestamp, ...extra });
		const runs: Msg[][] = [
			[],
			[problem("p1", "m1", { statement: "S", target: ["f1", "f1", 3, "f2", null] }), ok("p1"), conclude("c1", "m2", "solved"), ok("c1", 1_700_000_001_999)],
			[problem("p1", "m1", {}), ok("p1"), conclude("c1", "m2", "bogus"), ok("c1"), conclude("c2", "m3", "movedOn"), ok("c2", "2026-02-03T04:05:06.789Z")],
			[problem("p1", "m1", { statement: "S" }), ok("p1", 1, { isError: true }), conclude("c1", "m2", "solved"), ok("c1")],
			[problem("p1", "m1", { statement: "A" }), ok("p1"), problem("p2", "m2", { statement: "B", target: "notalist" }), ok("p2"), conclude("c1", "m3", "dismissed"), ok("c1", 0), conclude("c2", "m4", "surrendered"), ok("c2")],
			[problem("p1", "m1", { statement: 5, target: [] }), ok("p1"), conclude("c1", "m2", "solvedWithHints"), ok("c1", 1.9)],
			[{ ...problem("p1", "m1", { statement: "S" }), id: undefined }, ok("p1"), conclude("c1", "m2", "solved"), ok("c1", -1)],
			[assistant("m1", [{ type: "toolCall", name: "problem", arguments: {} }, call("p1", "other", {}), { type: "text", name: "problem", id: "p2" }]), ok("p1"), ok("p2"), { role: "toolResult" }, { role: "user", content: "x" }],
			[problem("p1", "m1", { statement: "S" }), ok("p1"), conclude("c1", "m2", "solved"), ok("c1", 8.64e15), conclude("c2", "m3", "solved"), ok("c2")],
			[problem("p1", "m1", { statement: "S" }), ok("p1"), conclude("c1", "m2", "solved"), ok("c1", null)],
			[problem("p1", "m1", { statement: "S" }), ok("p1"), conclude("c1", "m2", "solved"), ok("c1", true)],
			[problem("p1", "m1", { statement: "S" }), ok("p1"), conclude("c1", "m2", "solved"), ok("c1", ["2024-01-01"])],
			[problem("p1", "m1", { statement: "S" }), ok("p1"), conclude("c1", "m2", "solved"), ok("c1", -1.9)],
		];
		return rec(runs, (messages) => practiceOutcomes(messages as never));
	},

	"session markdown": () => {
		const quiz = (id: string, details: unknown, tool = "quiz"): Msg[] => [assistant(`a_${id}`, [call(id, tool, {})]), result(id, tool, details)];
		const sets: Msg[][] = [
			[],
			[{ role: "user", content: "  hi  " }],
			[{ role: "user", content: [{ type: "text", text: "one" }, { type: "image" }, { type: "text", text: "  two  " }] }, { role: "user", content: "" }, { role: "user", content: [] }],
			[assistant("a", [{ type: "text", text: " Teacher says " }, { type: "thinking", thinking: "hmm" }, call("s", "send_to_user", { text: "visible" })]), result("s", "send_to_user", {})],
			[assistant("a", [call("q", "quiz", {})]), result("q", "quiz", { questionText: "Q?" }, { isError: true })],
			[{ role: "custom", customType: "today-context", content: "hidden" }, { role: "weird" }],
			[...quiz("q1", { questionText: "Pick one", correct: true }), ...quiz("q2", { questionText: "Pick two", correct: false, thinking: "I guessed" }), ...quiz("q3", { questionText: "Pick three", dontKnow: true }), ...quiz("q4", { dismissed: true, note: "old note" }), ...quiz("q5", { questionText: "Say it", text: "  my words  " }), ...quiz("q6", {}, "probe"), ...quiz("q7", { questionText: "X", text: "   " }, "explain"), ...quiz("q8", { questionText: "R", correct: true, thinking: "", note: "n" }, "recall")],
			[...quiz("w1", { questionText: "Write f", code: "int f();", language: "c", note: "slow" }, "write_code"), ...quiz("w2", { questionText: "Write g", code: "a```b````c", language: "" }, "write_code"), ...quiz("w3", { dismissed: true }, "write_code"), ...quiz("w4", { questionText: "Hmm", dontKnow: true, thinking: "idk" }, "write_code"), ...quiz("w5", { questionText: "No code" }, "write_code"), ...quiz("w6", { questionText: "Py", code: "print(1)" }, "write_code")],
			[...quiz("k1", { questionText: "Which?", answers: [{ label: "A" }, { label: "B" }], other: " C " }, "ask_user_question"), ...quiz("k2", { questionText: "Text?", text: " free " }, "ask_user_question"), ...quiz("k3", { dismissed: true }, "ask_user_question"), ...quiz("k4", { answers: [], thinking: "t" }, "ask_user_question"), ...quiz("k5", { questionText: "Q", answers: [{ label: "A" }], text: "t", note: "n" }, "ask_user_question")],
			[
				assistant("p", [call("pp", "problem", { statement: " Solve x ", modelSolution: "a\nb" })]),
				result("pp", "problem", {}),
				assistant("c", [call("cc", "conclude", { outcome: "solvedWithHints", verdict: " Nice. " })]),
				result("cc", "conclude", {}),
				assistant("d", [call("dd", "conclude", { outcome: "dismissed", verdict: "ignored" })]),
				result("dd", "conclude", {}),
				assistant("e", [call("ee", "conclude", {})]),
				result("ee", "conclude", {}),
				assistant("f", [call("ff", "conclude", { outcome: "movedOn", verdict: "" })]),
				result("ff", "conclude", {}),
				result("zz", "problem", {}),
				result("yy", "conclude", {}),
				{ role: "toolResult", toolName: "problem", toolCallId: undefined, content: [] },
			],
			[result("n1", "web_search", {}), result("n2", "read", {}), { role: "toolResult", content: [] }, { role: "toolResult", toolName: "send_to_user", toolCallId: "x" }],
			[...quiz("t1", { questionText: "Q", correct: true, thinking: 5, note: "n" }), ...quiz("t2", { questionText: "Q", text: "t", thinking: 5, note: "n" }, "ask_user_question"), ...quiz("t3", { questionText: 7, code: "x", thinking: 5, note: "n" }, "write_code"), ...quiz("t4", { questionText: "Q", thinking: null, note: "n" }, "ask_user_question"), ...quiz("t5", { questionText: "Q", answers: [{ label: 3 }, { label: null }, {}, { label: ["a", "b"] }] }, "ask_user_question"), ...quiz("t6", { questionText: "Q", code: "x", language: null }, "write_code")],
			[
				assistant("a", [call("c1", "problem", { statement: "Old", modelSolution: "old sol" })]),
				result("c1", "problem", {}),
				assistant("b", [call("c2", "problem", { statement: "New", modelSolution: "new\nsol" })]),
				result("c2", "problem", {}),
				assistant("c", [call("c3", "conclude", { outcome: "solved" })]),
				result("c3", "conclude", {}),
			],
		];
		return rec(sets, (messages) => ({
			plain: sessionMarkdown(messages as never, { anchors: false }),
			titled: sessionMarkdown(messages as never, { title: "My lesson", anchors: false }),
			emptyTitle: sessionMarkdown(messages as never, { title: "", anchors: false }),
		}));
	},

	"question core": () => {
		const optionLists: Msg[][] = [
			[],
			[{ label: "A" }, { label: "B" }],
			[{ label: "A", value: "a" }, { label: "B", value: " a " }],
			[{ label: "  " }, { label: "B" }],
			[{ label: "A", value: "" }, { label: "A" }],
			[{ label: "x", value: "y" }, { label: "y" }],
		];
		const correct: unknown[] = ["a", " a ", ["a"], ["a", "b"], "", [], ["", "a"], '["a","b"]', '["a"', "[a]", '"a"', ":a", '[":a"]', ['"a"', "a:", " :a "], "[]", '[1,2]', "A", "{}", "'a'", "`a`"];
		const keySets = [[], ["a"], ["a", "b"], ["a", "[a]", '["a","b"]'], ["A", "b"], ["1", "2"]];
		const quizInputs: Msg[] = [];
		for (const options of optionLists) {
			for (const correctAnswer of correct.slice(0, 12)) {
				quizInputs.push({ options, correctAnswer });
				quizInputs.push({ options, correctAnswer, multiSelect: true });
			}
		}
		const answers: Msg[] = [
			{ kind: "quiz", dismissed: true, text: "ignored" },
			{ kind: "quiz" },
			{ kind: "quiz", dontKnow: true, correct: false, confidence: 40 },
			{ kind: "quiz", answers: [{ index: 1, label: "A", extra: 1 }, { index: 2, label: "B" }], correct: true, confidence: 80, thinking: "because", readingThinking: "read" },
			{ kind: "ask", answers: [], text: "words", other: "else", code: "x=1", language: "py", note: "old" },
			{ kind: "code", code: "int x;", language: "c", thinking: "", note: "n2", correct: false },
			{ kind: "explain", answers: "no", text: "", other: "", correct: false, confidence: 0, readingThinking: "" },
			{ kind: "quiz", correct: true, confidence: 0 },
		];
		return {
			parseOptions: rec(["[1,2]", "[]", "{}", "nope", "", "5", "[", undefined, [1], "  [ 3 ] "], (o) => parseOptionsIfString(o as never) ?? null),
			askProblems: rec(optionLists, (o) => askOptionProblems(o as never)),
			coerce: rec(correct.flatMap((answer) => keySets.map((keys) => ({ answer, keys }))), ({ answer, keys }) => coerceCorrectAnswer(answer as never, keys)),
			quizProblems: rec(quizInputs, (input) => quizInputProblems(input as never)),
			explainProblems: rec(["", "  ", "x", "\n\t"], (correctAnswer) => explainInputProblems({ correctAnswer })),
			compactAnswers: rec(answers, (a) => compactAnswerForModel(a as never)),
			levels: rec([1, 2, 3, 4, 5], (l) => levelPercent(l as never)),
			percents: rec([-10, 0, 10, 19.9, 20, 30, 39.99, 40, 50, 59, 60, 70, 79, 80, 90, 99, 100, 120, 1000], (p) => confidenceLevel(p)),
			schemas: plain({ quiz: quizInputObject, probeQuiz: probeQuizInputSchema, explainBase: explainInputBase, explain: explainInputObject, ask: askInputSchema, writeCode: writeCodeInputSchema, probeDone: probeDoneInputSchema }),
			ack: PROBE_DONE_ACK_TEXT,
		};
	},

	"code question": () => ({
		problems: rec(["", " ", "\n", "task", " task "], (question) => writeCodeInputProblems({ question })),
		fences: rec(
			[
				["", ""],
				["x", "c"],
				["a`b", "c"],
				["a``b`c", ""],
				["```\ncode\n```", "py"],
				["`````", "x"],
				["line1\nline2\n", "c"],
				[`${emoji}\`${emoji}`, "😀"],
			],
			([code, language]) => fencedCode(code!, language!),
		),
	}),

	"argument heal": () => {
		const schema = {
			properties: {
				mode: { anyOf: [{ const: "recall" }, { const: "check" }] },
				strict: { type: "boolean" },
				nothing: { type: "null" },
				maybe: { anyOf: [{ type: "string" }, { type: "null" }] },
				count: { type: "number" },
				list: { type: "array" },
				one: { const: 1 },
				flag: { const: true },
				nested: { anyOf: [{ anyOf: [{ const: "x" }] }, { const: "y" }] },
				text: { type: "string" },
				obj: { type: "object" },
			},
		};
		const inputs: unknown[] = [
			null,
			5,
			"str",
			[],
			["mode"],
			{},
			{ mode: "recall" },
			{ mode: '"recall"' },
			{ mode: '"other"' },
			{ mode: "recall", strict: "true" },
			{ strict: "true", count: "5", list: "[1,2]", text: '"quoted"' },
			{ strict: "yes", count: "five", list: "{}", nothing: "null", maybe: "null" },
			{ nothing: "null", maybe: "null", one: "1", flag: "true", nested: '"x"' },
			{ nested: '"z"', one: "2", flag: "false" },
			{ obj: '{"a":1}', list: '["a"]', count: "  7 ", strict: " true " },
			{ mode: 5, strict: true, list: [1] },
			{ unknown: '"x"', mode: '"check"', count: "1e3", nothing: "nul" },
			{ count: "-0", one: "1.0", maybe: '"s"', text: "plain" },
		];
		const bare: [unknown, unknown][] = [[{ mode: '"recall"' }, {}], [{ mode: '"recall"' }, { properties: {} }], ["s", {}]];
		return {
			schema,
			healed: rec(inputs, (args) => healEncodedArguments(args, schema)),
			bare: rec(bare, ([args, bareSchema]) => healEncodedArguments(args, bareSchema as never)),
		};
	},

	"jobs": () => {
		const stampless = (m: Msg): Msg => ({ ...m, timestamp: typeof m.timestamp === "number" ? "<now>" : m.timestamp });
		const results: [string, Msg][] = [
			["research", { brief: "Found things.", sources: [{ title: "T", url: "u" }] }],
			["research", { brief: "Research failed: no network", sources: [] }],
			["research", { brief: "research failed: lower", sources: [] }],
			["research", { brief: "Research failed: but has sources", sources: [{ title: "T", url: "u" }] }],
			["demo", { title: "Pendulum", html: "<p>x</p>", tested: true, notes: "drag the bob" }],
			["demo", { title: "Pendulum", html: "<p>x</p>", tested: true }],
			["demo", { title: "Broken", html: "", tested: true, notes: "crashed" }],
			["demo", { title: "Broken", tested: true }],
			["visual", { svg: "<svg/>", notes: "labels" }],
			["visual", { svg: "<svg/>" }],
			["visual", { svg: "", notes: "blank" }],
			["visual", { svg: "" }],
			["pdf", { path: "a.pdf", question: "q", brief: "Chapter one.", pagesRead: [1], pagesConsulted: [1, 2] }],
			["pdf", { path: "a.pdf", question: "q", brief: "PDF failed: encrypted", pagesRead: [], pagesConsulted: [] }],
			["pdf", { path: "a.pdf", question: "q", brief: "pdf failed: x", pagesRead: [], pagesConsulted: [] }],
		];
		const jobs: Msg[] = [
			{ id: "job_1", kind: "research", toolCallId: "call_1", extra: "dropped" },
			{ id: "job_2", kind: "demo", toolCallId: "call_2" },
			{ id: "j😀", kind: "visual" },
			{ id: "job_4", kind: "pdf", toolCallId: "call_4" },
			{ kind: "visual", toolCallId: "call_5" },
		];
		const steers = (): Msg[] => [
			{ id: "steer_a", role: "custom", customType: "subagent-steer", details: { kind: "demo", ui: { inverted: false, other: 1 } } },
			{ id: "steer_b", role: "custom", customType: "subagent-steer", details: { kind: "visual" } },
			{ id: "steer_c", role: "custom", customType: "subagent-steer", details: { kind: "research", ui: { inverted: false } } },
			{ id: "steer_d", role: "custom", customType: "subagent-steer" },
			{ id: "steer_e", role: "custom", customType: "subagent-steer", details: { kind: "demo", ui: null } },
			{ id: "steer_f", role: "user", content: "x" },
		];
		const usageRuns: Msg[][] = [
			[],
			[usageSteps[0]!],
			[usageSteps[1]!, usageSteps[2]!],
			[usageSteps[2]!, usageSteps[0]!, usageSteps[3]!],
			[usageSteps[3]!, usageSteps[4]!],
			[usageSteps[5]!, usageSteps[6]!, usageSteps[2]!],
		];
		const invertedInputs = [
			["steer_a", true],
			["steer_a", false],
			["steer_b", true],
			["steer_c", true],
			["steer_d", true],
			["steer_e", true],
			["steer_f", true],
			["nope", true],
		].map(([id, flag]) => ({ messages: steers(), id, flag }));
		const steerInputs = results.flatMap(([kind, r]) => jobs.map((job) => ({ job: { ...job, kind }, result: r })));
		const abortInputs = jobs.flatMap((job) => ["research", "demo", "visual", "pdf"].map((kind) => ({ ...job, kind })));
		return {
			stepFromPi: rec(
				[
					{ input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
					{ input: 1, output: 2, cacheRead: 3, cacheWrite: 4, cacheWrite1h: 5, reasoning: 6 },
					{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
				],
				piUsageToStep,
			),
			folded: rec(usageRuns, (steps) => {
				let total: unknown = undefined;
				return steps.map((step, i) => (total = plain(accumulateJobUsage(total as never, i % 2 === 0 ? "agent:x" : "agent:y", step as never))));
			}),
			failures: rec(results, ([kind, r]) => isSubagentFailure(kind as never, r as never)),
			steers: rec(steerInputs, ({ job, result: r }) => stampless(buildSubagentSteer(job as never, r as never))),
			aborts: rec(abortInputs, (job) => stampless(buildAbortSteer(job as never))),
			inverted: rec(invertedInputs, ({ messages, id, flag }) => setSteerUiInverted(messages as never, id as string, flag as boolean)),
			delivered: rec([["steer_a", "steer_a"], ["steer_a", "nope"], ["", "steer_a"]], ([id, probe]) => steerDelivered([{ id } as never], probe!)),
		};
	},

	"prices": () => ({
		subscription: rec([undefined, "", "agent:claude", "chatgpt:gpt", "github-copilot-subscription:x", "xai-subscription:grok", "anthropic:claude", "Agent:x", "agent"], (m) => isSubscriptionModel(m)),
		labels: rec([[], [undefined], ["agent:a", "agent:b", "chatgpt:c"], ["xai-subscription:x", undefined, "other", "agent:z", "xai-subscription:y"], ["github-copilot-subscription:x", "chatgpt:y", "github-copilot-subscription:z"]], (models) => subscriptionLabels(models)),
		sums: rec([[], ...usageSteps.map((s) => [s]), usageSteps, [usageSteps[2]!, usageSteps[4]!], [usageSteps[3]!, usageSteps[2]!], [usageSteps[4]!, usageSteps[5]!], [usageSteps[5]!, usageSteps[6]!]], (steps) => sumSteps(steps as never)),
		costs: rec(
			[
				{},
				{ turns: [] },
				{ turns: [{ model: "agent:x" }] },
				{ turns: [{ model: "agent:x" }, { model: "chatgpt:y" }, { model: "other" }, {}] },
				{ turns: [{ model: "other" }, { model: undefined }] },
				{ turns: [{ model: "agent:a" }, { model: "agent:b" }] },
				{ turns: [{ model: "xai-subscription:g" }, { model: "github-copilot-subscription:c" }, { model: "xai-subscription:h" }] },
			],
			(record) => sessionCost(record as never),
		),
	}),

	"cost summary": () => {
		const stage = (model: string, steps: Msg[]): Msg => ({ model, steps });
		const run = (startedAt: number, extractor: Msg | undefined, auditor?: Msg, stats?: Msg): Msg => ({ startedAt, at: "t", durationMs: 5, ...(stats ? { stats } : {}), stages: { ...(extractor ? { extractor } : {}), ...(auditor ? { auditor } : {}) } });
		const stats = { nodesAdded: 2, edgesAdded: 3 };
		const manyRuns = Array.from({ length: 14 }, (_, i) => run(1000 + ((i * 7) % 14), stage(i % 3 === 0 ? "agent:x" : "other", [usageSteps[i % usageSteps.length]!]), i % 4 === 0 ? stage("chatgpt:y", [usageSteps[2]!]) : undefined, i % 2 ? stats : undefined));
		const inputs: Msg[] = [
			{ chats: [], sources: [] },
			{ chats: [{ title: "Empty", extractions: [] }], sources: [] },
			{ chats: [{ title: "No steps", extractions: [run(1, stage("agent:x", []))] }], sources: [] },
			{ chats: [{ title: "One", extractions: [run(5, stage("agent:x", [usageSteps[2]!]), undefined, stats)] }], sources: [{ filePath: "notes/a.md", extractions: [run(9, stage("other", [usageSteps[1]!, usageSteps[3]!]), stage("agent:y", [usageSteps[4]!]))] }] },
			{ chats: [{ title: "Ties", extractions: [run(7, stage("other", [usageSteps[1]!])), run(7, stage("agent:x", [usageSteps[2]!])), run(7, stage("chatgpt:z", [usageSteps[3]!]))] }], sources: [{ filePath: "b.md", extractions: [run(7, stage("other", [usageSteps[4]!]))] }] },
			{ chats: [{ title: "Many", extractions: manyRuns }], sources: [] },
			{ chats: [{ title: "Writes", extractions: [run(1, stage("other", [usageSteps[3]!])), run(2, stage("other", [usageSteps[4]!])), run(3, stage("other", [usageSteps[5]!]))] }], sources: [] },
			{ chats: [{ title: "No stages", extractions: [{ startedAt: 4, at: "t", durationMs: 1 }, run(6, undefined, stage("agent:x", [usageSteps[2]!]))] }], sources: [] },
			{ chats: [{ extractions: [run(3, stage("other", [usageSteps[1]!])), run(null as never, stage("other", [usageSteps[1]!])), run(-2, stage("other", [usageSteps[2]!]))] }], sources: [{ extractions: [run(1, stage("agent:x", [usageSteps[1]!]))] }] },
		];
		const seeded = { chats: chats.map((c) => ({ title: c.title, extractions: c.extractions ?? [] })), sources: [] };
		return { made: rec(inputs, (input) => graphCostSummary(input as never)), seeded: plain(graphCostSummary(seeded as never)) };
	},

	"tool switches": () => {
		const tools = { research: 1, demo: 2, visual: 3, pdf: 4, quiz: 5, explain: 6 };
		const enabledSets: unknown[] = [undefined, {}, { research: false }, { research: true, demo: false }, { quiz: false, explain: false }, { pdf: 0 }, { visual: null }, { research: false, demo: false, visual: false, pdf: false }, { ghost: false }];
		const carriedSets = [[], ["research"], ["research", "demo"], ["demo", "visual", "pdf"], [...TOGGLEABLE_TOOLS], ["ghost", "demo"]];
		return {
			toggleable: [...TOGGLEABLE_TOOLS],
			writable: [...WRITABLE_TOOL_KEYS],
			filtered: rec(enabledSets, (enabled) => filterEnabledTools(tools, enabled as never)),
			notes: rec(enabledSets.flatMap((enabled) => carriedSets.map((carried) => ({ enabled, carried }))), ({ enabled, carried }) => switchedOffToolsNote(enabled as never, carried as never)),
		};
	},
} satisfies Record<string, () => unknown>;
