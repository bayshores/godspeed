/**
 * CHEAT SHEETS end to end against a scripted agent: the view (topics in
 * class order with status and mistakes), making a sheet (the request's
 * contents, a retry on a bad topic id, Watch out first), pinning and
 * tightening a block, adding a left-out topic back, reading the rules
 * once, the routes' refusals, and removing the deadline.
 * Isolated LH_DATA_DIR (set before any config-loading import).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type ToolCall } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-cheat-sheets-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { classStore } = await import("../src/store/classes.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { graphStoreFor } = await import("../src/server/stores.ts");
const { removeClassDeadline, sourceIdFor } = await import("../src/server/classes.ts");
const sheets = await import("../src/server/cheat-sheets.ts");
const route = await import("../src/app/api/classes/[id]/deadlines/[deadlineId]/cheat-sheet/route.ts");
import type { LhMessage } from "../src/core/native-messages.ts";
import type { CheatSheetView } from "../src/core/cheat-sheet.ts";

after(() => {
	sheets.cheatSheetSeams.engine = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** A faux agent answering each request with the next tool call; records each request's prompt. */
function agent(...calls: Array<[string, unknown]>) {
	const faux = createFauxCore({});
	const prompts: string[] = [];
	faux.setResponses(
		calls.map(([name, args]) => (ctx: { messages: Array<{ role: string; content: unknown }> }) => {
			const first = ctx.messages.find((m) => m.role === "user");
			prompts.push(typeof first?.content === "string" ? first.content : JSON.stringify(first?.content));
			return fauxAssistantMessage([fauxToolCall(name, args as ToolCall["arguments"])], { stopReason: "toolUse" });
		}),
	);
	sheets.cheatSheetSeams.engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return prompts;
}

const ask = (id: string, callId: string) =>
	({ id, role: "assistant", content: [{ type: "toolCall", id: callId, name: "quiz", arguments: {} }], timestamp: 0 }) as unknown as LhMessage;
const answer = (callId: string, correct: boolean, question: string) =>
	({
		id: `r_${callId}`,
		role: "toolResult",
		toolCallId: callId,
		toolName: "quiz",
		content: [{ type: "text", text: "{}" }],
		details: { kind: "quiz", questionText: question, dontKnow: false, answers: [], answeredAt: "2026-10-20T00:00:00.000Z", correct },
		isError: false,
		timestamp: 0,
	}) as unknown as LhMessage;

function seed() {
	const cls = classStore.createClass({ name: "CSE 21", description: "Discrete math, Rosen's notation." });
	const file = { id: "f_aaaaaaaaaaaa", origin: "copied" as const, name: "2026-10-01 Counting.pdf", path: "x.pdf", kind: "study" as const, contentFp: "", status: "ready" as const, addedAt: "2026-10-01T00:00:00.000Z" };
	classStore.saveFiles(cls.id, [file]);
	const deadline = classStore.addDeadline(cls.id, { kind: "exam", name: "Midterm", date: "2026-11-04", fileIds: [file.id] });
	const src = sourceIdFor(cls.id, file.id);
	const chat = chatStore.createChat("Counting", undefined, cls.id);
	chatStore.saveMessages(chat.id, [ask("m1", "q1"), answer("q1", false, "How many 5-letter strings use each letter once?"), ask("m2", "q2"), answer("q2", true, "Sum of 1..n?")]);
	const store = graphStoreFor(cls.id);
	const node = (id: string, name: string, statement: string, lesson?: string) =>
		store.appendNode({ id, name, statement, aliases: [], createdAt: "2026-10-01T00:00:00.000Z", provenance: [{ chatId: src, messageId: "" }, ...(lesson ? [{ chatId: chat.id, messageId: lesson }] : [])] });
	node("n1", "Permutations", "P(n,k) = n!/(n-k)!", "m1");
	node("n2", "Combinations", "C(n,k) = n!/(k!(n-k)!)");
	node("n3", "Conditional probability", "P(A|B) = P(A∩B)/P(B)");
	node("n4", "Gauss sum", "1+...+n = n(n+1)/2", "m2");
	store.appendTopics({
		at: "2026-10-02T00:00:00.000Z",
		topics: [
			{ id: "tpc_count", name: "Counting", members: ["n1", "n2"] },
			{ id: "tpc_prob", name: "Probability", members: ["n3"] },
			{ id: "tpc_sum", name: "Sums", members: ["n4"] },
		],
	});
	return { classId: cls.id, deadlineId: deadline.id };
}

const view = (classId: string, deadlineId: string): CheatSheetView => {
	const v = sheets.cheatSheetView(classId, deadlineId);
	assert.ok(v.ok);
	return v.value;
};

const block = (topic_id: string, title: string, extra: Record<string, unknown> = {}) => ({ topic_id, title, body: `$x$ for ${title}`, reason: "Shaky", ...extra });

describe("cheat sheets", () => {
	it("shows the deadline's topics with status and mistakes, and a sheet of defaults", () => {
		const { classId, deadlineId } = seed();
		const v = view(classId, deadlineId);
		assert.deepEqual(v.topics.map((t) => [t.id, t.status, t.mistakes]), [["tpc_count", "weak", 1], ["tpc_prob", "untested", 0], ["tpc_sum", "strong", 0]]);
		assert.equal(v.mistakes, 1);
		assert.equal(v.saved, false);
		assert.deepEqual([v.sheet.rules.paper, v.sheet.prefs.textSize, v.sheet.blocks], ["letter", "medium", []]);
	});

	it("makes a sheet in one request: weak and untested topics, mistakes, rules; strong ones left out", async () => {
		const { classId, deadlineId } = seed();
		const prompts = agent(
			["write_cheat_sheet", { blocks: [block("tpc_nope", "Nope")] }],
			["write_cheat_sheet", { blocks: [block("tpc_prob", "Probability"), block("watch_out", "Watch out", { reason: "Missed once" }), block("tpc_count", "Counting", { why: "You used n^r." })] }],
		);
		const made = sheets.makeCheatSheet(classId, deadlineId, { rules: { banned: ["Worked examples"] }, prefs: { content: ["formulas", "mistakes", "examples"] } });
		assert.ok(made.ok);
		assert.equal(view(classId, deadlineId).running?.kind, "make");
		await sheets.cheatSheetIdle(deadlineId);
		const v = view(classId, deadlineId);
		assert.equal(v.error, null);
		assert.deepEqual(v.sheet.blocks.map((b) => b.title), ["Watch out", "Counting", "Probability"]);
		assert.equal(v.sheet.blocks[1]!.why, "You used n^r.");
		assert.ok(v.sheet.confirmedAt);
		assert.deepEqual(v.sheet.rules.banned, ["Worked examples"]);
		const prompt = prompts[0]!;
		assert.match(prompt, /Exam: CSE 21 Midterm on 2026-11-04/);
		assert.match(prompt, /About the class: Discrete math/);
		assert.match(prompt, /On it: formulas, your mistakes\n/, "examples are banned");
		assert.match(prompt, /Not allowed: Worked examples/);
		assert.match(prompt, /tpc_count \| Counting \| weak, 1 mistake \| about \d+ lines\n {2}- Permutations: P\(n,k\)/);
		assert.match(prompt, /answered wrong \(Counting\): "How many 5-letter strings use each letter once\?"/);
		assert.doesNotMatch(prompt, /tpc_sum/, "a strong topic stays off");
		assert.equal(prompts.length, 2, "an unknown topic id is sent back once");
	});

	it("tightens one block in place, keeps it pinned, and adds a left-out topic back in class order", async () => {
		const { classId, deadlineId } = seed();
		agent(["write_cheat_sheet", { blocks: [block("tpc_count", "Counting"), block("tpc_prob", "Probability")] }]);
		assert.ok(sheets.makeCheatSheet(classId, deadlineId, {}).ok);
		await sheets.cheatSheetIdle(deadlineId);
		const [counting] = view(classId, deadlineId).sheet.blocks;
		assert.ok(sheets.editCheatSheetBlocks(classId, deadlineId, { kind: "pin", blockId: counting!.id, pinned: true }).ok);

		const prompts = agent(
			["write_cheat_sheet", { blocks: [block("tpc_count", "Counting", { body: "short" })] }],
			["write_cheat_sheet", { blocks: [block("tpc_count", "Counting", { block_id: counting!.id, body: "short" })] }],
			["write_cheat_sheet", { blocks: [block("tpc_sum", "Sums", { reason: "You know it" })] }],
		);
		assert.ok(sheets.changeCheatSheetBlocks(classId, deadlineId, { how: "tighten", blockIds: [counting!.id] }).ok);
		assert.equal(sheets.changeCheatSheetBlocks(classId, deadlineId, { how: "redo", blockIds: [counting!.id] }).ok, false, "one request at a time");
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /Change this block\. Make each shorter/);
		assert.match(prompts[0]!, new RegExp(`block_id ${counting!.id} \\| topic_id tpc_count`));
		const tightened = view(classId, deadlineId).sheet.blocks[0]!;
		assert.deepEqual([tightened.id, tightened.body, tightened.pinned], [counting!.id, "short", true]);

		assert.ok(sheets.changeCheatSheetBlocks(classId, deadlineId, { how: "add", topicId: "tpc_sum" }).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[2]!, /Add topic_id tpc_sum/);
		assert.deepEqual(view(classId, deadlineId).sheet.blocks.map((b) => b.topicId), ["tpc_count", "tpc_prob", "tpc_sum"]);

		const prob = view(classId, deadlineId).sheet.blocks[1]!;
		assert.ok(sheets.editCheatSheetBlocks(classId, deadlineId, { kind: "move", blockId: prob.id, before: null }).ok);
		assert.deepEqual(view(classId, deadlineId).sheet.blocks.map((b) => b.topicId), ["tpc_count", "tpc_sum", "tpc_prob"]);
		assert.ok(sheets.editCheatSheetBlocks(classId, deadlineId, { kind: "remove", blockId: prob.id }).ok);
		assert.equal(view(classId, deadlineId).sheet.blocks.length, 2);
	});

	it("reads the rules once when the setup opens, until the learner confirms", async () => {
		const { classId, deadlineId } = seed();
		const prompts = agent(["set_cheat_sheet_rules", { found: true, paper: "index-card", writing: "by-hand", banned: ["Worked examples"], source: "Syllabus.pdf, page 3" }]);
		assert.ok(sheets.readCheatSheetRules(classId, deadlineId).ok);
		assert.equal(view(classId, deadlineId).readingRules, true);
		await sheets.cheatSheetIdle(deadlineId);
		const v = view(classId, deadlineId);
		assert.deepEqual(v.sheet.rules, { allowed: true, paper: "index-card", writing: "by-hand", banned: ["Worked examples"], source: "Syllabus.pdf, page 3" });
		assert.equal(v.sheet.rulesRead, true);
		assert.match(prompts[0]!, /Exam: CSE 21 Midterm on 2026-11-04/);
		assert.ok(sheets.readCheatSheetRules(classId, deadlineId).ok);
		assert.equal(view(classId, deadlineId).readingRules, false, "never asked twice");
	});

	it("answers through the route, refuses a sheet the class doesn't allow, and goes with its deadline", async () => {
		const { classId, deadlineId } = seed();
		const url = `http://localhost/api/classes/${classId}/deadlines/${deadlineId}/cheat-sheet`;
		const params = { params: Promise.resolve({ id: classId, deadlineId }) };
		const put = await route.PUT(new Request(url, { method: "PUT", body: JSON.stringify({ rules: { allowed: false }, prefs: { columns: 3 } }) }), params);
		assert.equal(put.status, 200);
		const got = (await (await route.GET(new Request(url), params)).json()) as CheatSheetView;
		assert.deepEqual([got.saved, got.sheet.rules.allowed, got.sheet.prefs.columns], [true, false, 3]);
		const make = await route.POST(new Request(url, { method: "POST", body: JSON.stringify({ action: "make" }) }), params);
		assert.equal(make.status, 400);
		assert.equal((await route.POST(new Request(url, { method: "POST", body: JSON.stringify({ action: "change", how: "shout", blockIds: ["b"] }) }), params)).status, 400);
		assert.equal((await route.GET(new Request(url), { params: Promise.resolve({ id: classId, deadlineId: "ddl_missing" }) })).status, 404);

		const file = path.join(TMP_DATA, "classes", classId, "cheat-sheets", `${deadlineId}.json`);
		assert.ok(fs.existsSync(file));
		assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 1);
		assert.ok(removeClassDeadline(classId, deadlineId).ok);
		assert.equal(fs.existsSync(file), false);
	});
});
