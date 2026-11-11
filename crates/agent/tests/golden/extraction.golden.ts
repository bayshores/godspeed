// The extraction pipeline and the topic grouper on the real TypeScript, with synthetic lessons and
// notes only: the prompts, schemas and validation messages each model call is shown, what each run
// answers, and what lands in the graph files. src/extraction/golden_tests.rs replays every case on
// the Rust pipeline with the same scripted replies. Random ids and clock times are normalized.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-extraction-golden-"));
process.env.LH_DATA_DIR = dataDir;

const src = "../../../../src";
const extraction = await import(`${src}/backend/agent/subagents/extraction.ts`);
const { groupTopics, TOPIC_GROUPER_INSTRUCTIONS } = await import(`${src}/backend/agent/subagents/topic-grouper.ts`);
const { chatStore } = await import(`${src}/backend/store/chats.ts`);
const { graphStore } = await import(`${src}/backend/store/graph.ts`);
const { getGraph } = await import(`${src}/shared/core/graph.ts`);
const { PATHS } = await import(`${src}/backend/config.ts`);
const { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall } = await import("@earendil-works/pi-ai");

type Reply = { call: Record<string, unknown> } | { say: string };

/** A faux engine that answers the scripted replies in order and keeps each request it was sent. */
function scripted(replies: Reply[], name = "submit_findings") {
	const core = createFauxCore({ api: "godspeed-agent", provider: "agent", models: [{ id: "outside-agent", name: "Outside agent (MCP)", reasoning: false, input: ["text", "image"], contextWindow: 200_000, maxTokens: 32_000 }], tokenSize: { min: 64, max: 64 } });
	const requests: unknown[] = [];
	core.setResponses(
		replies.map((reply, i) => (context: { messages: unknown[] }) => {
			requests.push(request(context.messages));
			return "call" in reply ? fauxAssistantMessage(fauxToolCall(name, reply.call, { id: `call_${i}` }), { stopReason: "toolUse" }) : fauxAssistantMessage(fauxText(reply.say), { stopReason: "stop" });
		}),
	);
	return { engine: { model: core.getModel(), streamFn: (model: any, context: any, options: any) => core.streamSimple(model, context, { ...options, cacheRetention: "none" }) }, requests };
}

/** What the model was shown: the system prompt, its tools, then each message's role and content
 *  (the replies' own tool calls left out: they are the script). */
function request(messages: any[]) {
	const [system, ...rest] = messages;
	return {
		system: system.content,
		tools: system.toolsAdded,
		messages: rest.map((m) => (m.role === "assistant" ? { role: m.role } : m.role === "toolResult" ? { role: m.role, toolName: m.toolName, isError: m.isError, content: m.content } : { role: m.role, content: m.content })),
	};
}

/** Random ids become their order of first appearance, clock times a marker. */
function normalized(value: unknown) {
	const seen = new Map<string, string>();
	const walk = (v: unknown, key = ""): unknown => {
		if (typeof v === "string") {
			if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(v)) return "<time>";
			return v.replace(/\b(n|arg|tpc)_[0-9a-f]{10,12}\b/g, (id, kind) => {
				if (!seen.has(id)) seen.set(id, `${kind}_#${seen.size}`);
				return seen.get(id)!;
			});
		}
		if (typeof v === "number" && /(At|Ms)$/.test(key)) return "<time>";
		if (Array.isArray(v)) return v.map((x) => walk(x));
		if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
		return v;
	};
	return walk(value);
}

const readLines = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/** Every graph ledger file, as lines. */
function ledgers() {
	const out: Record<string, unknown> = {};
	for (const file of fs.existsSync(PATHS.graph) ? fs.readdirSync(PATHS.graph).sort() : []) {
		out[file] = file.endsWith(".jsonl") ? readLines(path.join(PATHS.graph, file)) : JSON.parse(fs.readFileSync(path.join(PATHS.graph, file), "utf8"));
	}
	return out;
}

async function settle<T>(run: () => Promise<T>) {
	try {
		return { ok: await run() };
	} catch (err) {
		const e = err as { message: string; outcome?: string; partialStats?: unknown };
		return { error: e.message, outcome: e.outcome, partialStats: e.partialStats };
	}
}

const teacher = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, role: "assistant", content: [{ type: "text", text }], api: "godspeed-agent", provider: "agent", model: "outside-agent", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2, ...extra });
const learner = (id: string, text: string) => ({ id, role: "user", content: text, timestamp: 1 });

// The pipeline's inputs. The Rust replay reads them from this file.
const lesson = {
	id: "chat_golden",
	title: "Sorting",
	createdAt: "2026-11-09T19:00:00.000Z",
	updatedAt: "2026-11-09T19:03:00.000Z",
	kind: "study",
	version: 1,
	messages: [
		learner("msg_u1", "How does merge sort work?"),
		teacher("msg_t1", "Merge sort splits the list in half, sorts each half, then merges them.\n\nMerging two sorted lists takes linear time."),
		learner("msg_u2", "And the total?"),
		{ ...teacher("msg_t2", ""), content: [{ type: "text", text: "Each level of splitting does linear work." }, { type: "toolCall", id: "q1", name: "quiz", arguments: { question: "  How many levels are there?  " } }] },
		teacher("msg_t3", "There are log n levels, so merge sort runs in n log n time."),
	],
};
const shortNotes = { filePath: "notes/heaps.md", text: "# Heaps\n\nA heap keeps the smallest item on top.\nInserting sifts the item up.\n" };
const longNotes = { filePath: "notes/graphs.txt", text: Array.from({ length: 40 }, (_, i) => `Line ${i}: a graph has vertices and edges; a path walks edges from vertex to vertex without repeating. ${"x".repeat(i % 7)}`).join("\n").repeat(12) };
const logistics = { filePath: "class/week1-announcement.md", text: "Office hours move to Tuesday.\nThe first quiz is next Friday.\n" };

const replies = {
	lesson: [
		{ call: { propositions: [{ id: "split", name: "Merge sort", statement: "Merge sort splits, sorts halves and merges.", messageId: "msg_u1" }], chains: [], reteaches: [] } },
		{ call: { propositions: [{ id: "merge", name: "Merging", statement: "Merging two sorted lists is linear.", messageId: "msg_t1" }, { id: "levels", name: "Levels", statement: "Splitting makes log n levels.", messageId: "msg_t3" }], chains: [{ premises: ["merge", "nope"], conclusion: "levels" }], reteaches: [] } },
		{ call: { propositions: [{ id: "merge", name: "Merging", statement: "Merging two sorted lists is linear.", messageId: "msg_t1" }, { id: "levels", name: "Levels", statement: "Splitting makes log n levels.", messageId: "msg_t3" }, { id: "nlogn", name: "Merge sort time", statement: "Merge sort runs in n log n time.", messageId: "msg_t3" }], chains: [{ premises: ["merge", "levels"], conclusion: "nlogn" }], reteaches: [] } },
	] as Reply[],
	shortNotes: [{ call: { propositions: [{ id: "heap", name: "Heap", statement: "A heap keeps the smallest item on top." }, { id: "sift", name: "Sift up", statement: "Inserting into a heap sifts the item up.", messageId: "stray" }], chains: [{ premises: ["heap"], conclusion: "sift" }] } },
		{ call: { propositions: [{ id: "heap", name: "Heap", statement: "A heap keeps the smallest item on top." }, { id: "sift", name: "Sift up", statement: "Inserting into a heap sifts the item up.", messageId: "stray" }], chains: [{ premises: ["heap"], conclusion: "sift" }], reteaches: [] } },
	] as Reply[],
	longNotes: [
		{ call: { propositions: [{ id: "graph", name: "Graph", statement: "A graph has vertices and edges." }], chains: [], reteaches: [] } },
		{ say: "I read it." },
		{ say: "Still reading." },
		{ say: "Done." },
		{ say: "Really done." },
	] as Reply[],
	logistics: [{ call: { propositions: [], chains: [], reteaches: [], courseInfo: true } }] as Reply[],
	again: [{ say: "Nothing new." }, { say: "Nothing." }, { say: "No." }, { say: "Stop." }] as Reply[],
};

const relatedFacts = async (store: typeof graphStore, _text: string, limit: number) => store.readNodes().map((n: { id: string }) => n.id).slice(0, limit);

/** The whole story, run once: each case below reads its part. */
const story = await (async () => {
	fs.mkdirSync(PATHS.chats, { recursive: true });
	fs.writeFileSync(path.join(PATHS.chats, `${lesson.id}.json`), JSON.stringify(lesson, null, "\t"));
	const pipeline = (replies: Reply[]) => {
		const s = scripted(replies);
		return { run: extraction.createExtractionPipeline({ chatStore, graphStore, extractor: s.engine, relatedFacts }), requests: s.requests };
	};
	const steps: Record<string, unknown> = {};
	for (const [name, go] of [
		["lesson", (p: any) => p.runExtraction(lesson.id)],
		["shortNotes", (p: any) => p.importNotes(shortNotes)],
		["longNotes", (p: any) => p.importNotes(longNotes)],
		["logistics", (p: any) => p.importNotes({ ...logistics, mayBeCourseInfo: true })],
		["again", (p: any) => p.runExtraction(lesson.id)],
	] as const) {
		const p = pipeline(replies[name]);
		const result = await settle(() => go(p.run));
		steps[name] = { result, requests: p.requests };
	}
	const graph = getGraph(graphStore);
	const facts = graph.nodes.map((n: any) => ({ id: n.id, name: n.name, statement: n.statement }));
	const ids = facts.map((f: any) => f.id);
	const topics = scripted(
		[
			{ call: { topics: [{ name: "Sorting and more and more things", members: ids.slice(0, 3) }] } },
			{ call: { topics: [{ name: "Sorting", members: [...ids.slice(0, 3), "n_unknown"] }, { name: "Heaps", members: [ids[3], ids[3]] }] } },
		],
		"submit_topics",
	);
	const grouped = await settle(() => groupTopics({ className: "Algorithms", facts, chains: graph.chains, current: [{ id: "tpc_aaaaaaaaaa", name: "Old", members: [ids[0]] }], engine: topics.engine }));
	steps.topics = { facts, result: grouped, requests: topics.requests };
	const chat = JSON.parse(fs.readFileSync(path.join(PATHS.chats, `${lesson.id}.json`), "utf8"));
	steps.files = { graph: ledgers(), extractions: chat.extractions };
	return normalized(steps);
})();
fs.rmSync(dataDir, { recursive: true, force: true });

export default {
	"inputs": () => ({ lesson, shortNotes, longNotes, logistics, replies }),
	"instructions": () => ({ extractor: extraction.EXTRACTOR_INSTRUCTIONS, notes: extraction.NOTES_EXTRACTOR_INSTRUCTIONS, topics: TOPIC_GROUPER_INSTRUCTIONS }),
	"prose view": () => extraction.proseView(lesson.messages as never, lesson.title),
	"prose view without a title": () => extraction.proseView(lesson.messages as never, ""),
	"a lesson: a stray anchor, a broken chain, then a good submit": () => (story as any).lesson,
	"short notes: reteaches left out, then a stray messageId is dropped": () => (story as any).shortNotes,
	"long notes in stretches, the later ones never submit": () => (story as any).longNotes,
	"a class file that is course logistics": () => (story as any).logistics,
	"the same lesson again has nothing left": () => (story as any).again,
	"topic grouping: a long name, then a repaired grouping": () => (story as any).topics,
	"the files afterwards": () => (story as any).files,
};
