/**
 * CHEAT SHEETS end to end against a scripted agent: making a sheet from a
 * prompt (the request's contents, a retry on a bad page size), changing
 * it (the current sheet goes along), Try again after a failure, pictures
 * and PDFs with a prompt, an old block sheet shown as a document, the
 * route's refusals, and removing the deadline.
 * Isolated LH_DATA_DIR (set before any config-loading import).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type ToolCall } from "@earendil-works/pi-ai";
import sharp from "sharp";

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

/** A faux agent answering each request with the next tool call (or, for
 *  a string, just that text); records each request's prompt. */
function agent(...calls: Array<[string, unknown] | string>) {
	const faux = createFauxCore({});
	const prompts: string[] = [];
	faux.setResponses(
		calls.map((call) => (ctx: { messages: Array<{ role: string; content: unknown }> }) => {
			const first = ctx.messages.find((m) => m.role === "user");
			prompts.push(typeof first?.content === "string" ? first.content : JSON.stringify(first?.content));
			if (typeof call === "string") return fauxAssistantMessage([fauxText(call)], { stopReason: "stop" });
			return fauxAssistantMessage([fauxToolCall(call[0], call[1] as ToolCall["arguments"])], { stopReason: "toolUse" });
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


const sheet = (pages: string[], over: Record<string, unknown> = {}) => ({ width_in: 8.27, height_in: 11.69, css: "body { padding: 0.3in }", pages, ...over });

const routeFor = (classId: string, deadlineId: string) => {
	const url = `http://localhost/api/classes/${classId}/deadlines/${deadlineId}/cheat-sheet`;
	const params = { params: Promise.resolve({ id: classId, deadlineId }) };
	return { post: (body: unknown) => route.POST(new Request(url, { method: "POST", body: JSON.stringify(body) }), params), get: () => route.GET(new Request(url), params) };
};

describe("cheat sheets", () => {
	it("starts with no sheet and nothing asked", () => {
		const { classId, deadlineId } = seed();
		const v = view(classId, deadlineId);
		assert.deepEqual([v.className, v.deadlineName, v.date], ["CSE 21", "Midterm", "2026-11-04"]);
		assert.deepEqual([v.sheet.doc, v.sheet.prompts, v.running, v.error], [null, [], null, null]);
	});

	it("makes a sheet from a prompt in one request, sent back once for a bad page size", async () => {
		const { classId, deadlineId } = seed();
		const prompts = agent(["write_cheat_sheet", sheet(["<p>x</p>"], { width_in: 30 })], ["write_cheat_sheet", sheet(["<p>front $x$</p>", "<p>back</p>"])]);
		const asked = await sheets.askCheatSheet(classId, deadlineId, { text: "  double sided A4, and a flowchart  " });
		assert.ok(asked.ok);
		assert.deepEqual(view(classId, deadlineId).running, { kind: "make", prompt: "double sided A4, and a flowchart" });
		await sheets.cheatSheetIdle(deadlineId);
		const v = view(classId, deadlineId);
		assert.equal(v.error, null);
		assert.deepEqual(v.sheet.doc, { widthIn: 8.27, heightIn: 11.69, css: "body { padding: 0.3in }", pages: ["<p>front $x$</p>", "<p>back</p>"] });
		assert.deepEqual(v.sheet.prompts.map((p) => p.text), ["double sided A4, and a flowchart"]);
		const prompt = prompts[0]!;
		assert.match(prompt, /^Cheat sheet for: CSE 21 Midterm on 2026-11-04\nAbout the class: Discrete math/);
		assert.match(prompt, /no course info files; search all its files/);
		assert.match(prompt, /The student asks:\ndouble sided A4, and a flowchart/);
		assert.match(prompt, /Counting \| weak, 1 mistake\n {2}- Permutations: P\(n,k\)/);
		assert.match(prompt, /Sums \| knows it well/);
		assert.match(prompt, /answered wrong \(Counting\): "How many 5-letter strings use each letter once\?"/);
		assert.doesNotMatch(prompt, /current sheet/);
		assert.equal(prompts.length, 2, "a bad page size is sent back once");
	});

	it("changes the sheet as asked: the current sheet and what was asked before go along", async () => {
		const { classId, deadlineId } = seed();
		agent(["write_cheat_sheet", sheet(["<p>one</p>"])]);
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "A4" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		const prompts = agent(["write_cheat_sheet", sheet(["<p>one</p>", "<p>two</p>"])]);
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "use the back too" })).ok);
		assert.equal(view(classId, deadlineId).running?.kind, "change");
		assert.equal((await sheets.askCheatSheet(classId, deadlineId, { text: "again" })).ok, false, "one request at a time");
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /What they asked before, oldest first:\n- A4/);
		assert.match(prompts[0]!, /The current sheet \(send the whole sheet back, changed as asked\):[\s\S]*Page 1:\n<p>one<\/p>/);
		const v = view(classId, deadlineId);
		assert.equal(v.sheet.doc!.pages.length, 2);
		assert.deepEqual(v.sheet.prompts.map((p) => p.text), ["A4", "use the back too"]);
	});

	it("says why a request failed, and Try again sends it as it was", async () => {
		const { classId, deadlineId } = seed();
		agent(...Array.from({ length: 10 }, () => "I can't"));
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "index card" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal(view(classId, deadlineId).error, "the agent never sent the cheat sheet");
		assert.equal(view(classId, deadlineId).sheet.prompts.length, 0, "only a written sheet keeps its prompt");
		const prompts = agent(["write_cheat_sheet", sheet(["<p>card</p>"], { width_in: 5, height_in: 3 })]);
		assert.ok(sheets.retryCheatSheet(classId, deadlineId).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /The student asks:\nindex card/);
		const v = view(classId, deadlineId);
		assert.deepEqual([v.error, v.sheet.doc!.widthIn, v.sheet.prompts.map((p) => p.text)], [null, 5, ["index card"]]);
		assert.equal(sheets.retryCheatSheet(classId, deadlineId).ok, false, "nothing failed");
	});

	it("sends pictures to the agent and saves PDFs beside the sheet for it to read", async () => {
		const { classId, deadlineId } = seed();
		const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
		const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
		const prompts = agent(["write_cheat_sheet", sheet(["<p>x</p>"])]);
		const asked = await sheets.askCheatSheet(classId, deadlineId, {
			text: "",
			attachments: [
				{ name: "formulas.png", mimeType: "image/png", data: png.toString("base64") },
				{ name: "Practice exam.pdf", mimeType: "application/pdf", data: pdf.toString("base64") },
			],
		});
		assert.ok(asked.ok);
		await sheets.cheatSheetIdle(deadlineId);
		const content = JSON.parse(prompts[0]!) as Array<{ type: string; text?: string }>;
		assert.match(content[0]!.text!, /The student asks:\nUse the files I sent\./);
		assert.equal(content[1]!.type, "image");
		assert.match(content[2]!.text!, /\[Attached PDF\] Practice exam\.pdf\nPath: .*cheat-sheets\/ddl_\w+-files\/\w+-Practice exam\.pdf/);
		const [first] = view(classId, deadlineId).sheet.prompts;
		assert.deepEqual([first!.text, first!.files], ["", ["formulas.png", "Practice exam.pdf"]]);
		const refused = await sheets.askCheatSheet(classId, deadlineId, { text: "x", attachments: [{ name: "fake.pdf", mimeType: "application/pdf", data: Buffer.from("hello").toString("base64") }] });
		assert.deepEqual(refused, { ok: false, status: 400, error: "fake.pdf is not a PDF." });
	});

	it("shows an old block sheet as a document, its instructions as the first prompt", () => {
		const { classId, deadlineId } = seed();
		const file = path.join(TMP_DATA, "classes", classId, "cheat-sheets", `${deadlineId}.json`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const blocks = [{ id: "blk_1", topicId: "tpc_count", title: "Counting", body: "- $n^k$", reason: "Weak" }];
		fs.writeFileSync(file, JSON.stringify({ version: 1, deadlineId, rules: { paper: "letter-both" }, prefs: { instructions: "both sides" }, blocks, updatedAt: "t" }));
		const v = view(classId, deadlineId);
		assert.deepEqual([v.sheet.doc!.widthIn, v.sheet.doc!.pages.length], [8.5, 2]);
		assert.match(v.sheet.doc!.pages[0]!, /<h3>Counting<\/h3><ul><li>\\\(n\^k\\\)<\/li><\/ul>/);
		assert.deepEqual(v.sheet.prompts.map((p) => p.text), ["both sides"]);
	});

	it("answers through the route, refuses bad requests, saves version 2, and goes with its deadline", async () => {
		const { classId, deadlineId } = seed();
		const r = routeFor(classId, deadlineId);
		assert.equal((await r.get()).status, 200);
		assert.equal((await r.post({ action: "ask", text: "  " })).status, 400);
		assert.equal((await r.post({ action: "ask" })).status, 400);
		assert.equal((await r.post({ action: "ask", text: "x", attachments: [{ name: "a.png", mimeType: "image/png", data: "%%%" }] })).status, 400);
		assert.equal((await r.post({ action: "shout" })).status, 400);
		assert.equal((await r.post({ action: "retry" })).status, 409);
		assert.equal((await route.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: classId, deadlineId: "ddl_missing" }) })).status, 404);

		agent(["write_cheat_sheet", sheet(["<p>x</p>"])]);
		assert.equal((await r.post({ action: "ask", text: "A4" })).status, 200);
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal((await r.post({ action: "stop" })).status, 200);
		const file = path.join(TMP_DATA, "classes", classId, "cheat-sheets", `${deadlineId}.json`);
		assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 2);
		const files = path.join(TMP_DATA, "classes", classId, "cheat-sheets", `${deadlineId}-files`);
		fs.mkdirSync(files, { recursive: true });
		assert.ok(removeClassDeadline(classId, deadlineId).ok);
		assert.equal(fs.existsSync(file), false);
		assert.equal(fs.existsSync(files), false);
	});
});
