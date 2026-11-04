/**
 * CHEAT SHEETS end to end against a scripted agent that writes real PDFs
 * into the sheet's working folder: making a sheet (the request's contents,
 * PDFs refused for where they are or what they are), changing it (the
 * working folder and its source go along), the last 5 versions kept, Try
 * again after a failure, pictures and PDFs with a prompt, an older HTML
 * sheet made again, the routes (the PDF itself included), and removing the
 * deadline. Isolated LH_DATA_DIR and godspeed folder (set before any
 * config-loading import).
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
const FOLDER = path.join(TMP_DATA, "godspeed-folder");
fs.writeFileSync(path.join(TMP_DATA, "agent-folder.json"), JSON.stringify({ folder: FOLDER, noticeSeen: true }));

const { classStore } = await import("../src/store/classes.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { graphStoreFor } = await import("../src/server/stores.ts");
const { removeClassDeadline, sourceIdFor } = await import("../src/server/classes.ts");
const sheets = await import("../src/server/cheat-sheets.ts");
const route = await import("../src/app/api/classes/[id]/deadlines/[deadlineId]/cheat-sheet/route.ts");
const pdfRoute = await import("../src/app/api/classes/[id]/deadlines/[deadlineId]/cheat-sheet/pdf/[n]/route.ts");
const classRoute = await import("../src/app/api/classes/[id]/cheat-sheets/route.ts");
import type { LhMessage } from "../src/core/native-messages.ts";
import type { CheatSheetView } from "../src/core/cheat-sheet.ts";

after(() => {
	sheets.cheatSheetSeams.engine = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** A small real PDF with one page per [width, height] in points. */
function pdfOf(sizes: [number, number][]): Buffer {
	const objects: string[] = [];
	const pageIds = sizes.map((_, i) => 3 + i);
	objects[1] = "<</Type/Catalog/Pages 2 0 R>>";
	objects[2] = `<</Type/Pages/Kids[${pageIds.map((id) => `${id} 0 R`).join(" ")}]/Count ${sizes.length}>>`;
	sizes.forEach(([w, h], i) => (objects[pageIds[i]!] = `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${w} ${h}]>>`));
	let pdf = "%PDF-1.4\n";
	const offsets: number[] = [];
	for (let id = 1; id < objects.length; id++) {
		offsets[id] = pdf.length;
		pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
	}
	const xref = pdf.length;
	pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
	pdf += `trailer\n<</Size ${objects.length}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`;
	return Buffer.from(pdf, "latin1");
}
const A4: [number, number] = [595.28, 841.89];

/** What the scripted agent does with one request: write files into the
 *  working folder (named in the request), then send a path, or just say
 *  something. */
type Step = { files?: Record<string, Buffer | string>; link?: [string, string]; send?: string } | string;

/** What godspeed answered the scripted agent's calls, in order. */
const replies: string[] = [];

/** A faux agent taking each step in turn; records each request's prompt. */
function agent(...steps: Step[]) {
	const faux = createFauxCore({});
	const prompts: string[] = [];
	replies.length = 0;
	faux.setResponses(
		steps.map((step) => (ctx: { messages: Array<{ role: string; content: unknown }> }) => {
			const first = ctx.messages.find((m) => m.role === "user");
			const prompt = typeof first?.content === "string" ? first.content : JSON.stringify(first?.content);
			prompts.push(prompt);
			const last = ctx.messages[ctx.messages.length - 1];
			if (last?.role === "toolResult") replies.push(JSON.stringify(last.content));
			if (typeof step === "string") return fauxAssistantMessage([fauxText(step)], { stopReason: "stop" });
			const folder = /Working folder: ([^\n"\\]+)/.exec(prompt)![1]!;
			for (const [name, body] of Object.entries(step.files ?? {})) fs.writeFileSync(path.join(folder, name), body);
			if (step.link) fs.symlinkSync(step.link[1], path.join(folder, step.link[0]));
			return fauxAssistantMessage([fauxToolCall("write_cheat_sheet", { pdf_path: step.send } as ToolCall["arguments"])], { stopReason: "toolUse" });
		}),
	);
	sheets.cheatSheetSeams.engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return prompts;
}

/** The usual good answer: the source and a two-page A4 PDF. */
const made = (tex = "\\documentclass{article}"): Step => ({ files: { "sheet.tex": tex, "sheet.pdf": pdfOf([A4, A4]) }, send: "sheet.pdf" });

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

const sheetDir = (classId: string) => path.join(TMP_DATA, "classes", classId, "cheat-sheets");

const routeFor = (classId: string, deadlineId: string) => {
	const url = `http://localhost/api/classes/${classId}/deadlines/${deadlineId}/cheat-sheet`;
	const params = { params: Promise.resolve({ id: classId, deadlineId }) };
	return {
		post: (body: unknown) => route.POST(new Request(url, { method: "POST", body: JSON.stringify(body) }), params),
		get: () => route.GET(new Request(url), params),
		pdf: (n: string) => pdfRoute.GET(new Request(`${url}/pdf/${n}`), { params: Promise.resolve({ id: classId, deadlineId, n }) }),
	};
};

describe("cheat sheets", () => {
	it("starts with no sheet and nothing asked", () => {
		const { classId, deadlineId } = seed();
		const v = view(classId, deadlineId);
		assert.deepEqual([v.className, v.deadlineName, v.date], ["CSE 21", "Midterm", "2026-11-04"]);
		assert.deepEqual([v.sheet.versions, v.sheet.prompts, v.running, v.error], [[], [], null, null]);
	});

	it("makes a sheet from a prompt in one request: the PDF must be a real one inside the working folder", async () => {
		const { classId, deadlineId } = seed();
		const outside = path.join(TMP_DATA, "outside.pdf");
		fs.writeFileSync(outside, pdfOf([A4]));
		const prompts = agent(
			{ send: outside },
			{ send: "missing.pdf" },
			{ files: { "notes.pdf": "\\documentclass{article}" }, send: "notes.pdf" },
			{ files: { "five.pdf": pdfOf([A4, A4, A4, A4, A4]) }, send: "five.pdf" },
			made(),
		);
		const asked = await sheets.askCheatSheet(classId, deadlineId, { text: "  double sided A4, and a flowchart  " });
		assert.ok(asked.ok);
		assert.deepEqual(view(classId, deadlineId).running, { kind: "make", prompt: "double sided A4, and a flowchart" });
		await sheets.cheatSheetIdle(deadlineId);
		const v = view(classId, deadlineId);
		assert.equal(v.error, null);
		assert.equal(prompts.length, 5, "each refused PDF is sent back");
		const refusals = [/Put the PDF inside the working folder/, /There is no file at missing\.pdf/, /That file is not a PDF/, /The PDF has 5 pages; a cheat sheet has 1 to 4/];
		refusals.forEach((why, i) => assert.match(replies[i]!, why));
		assert.deepEqual(v.sheet.versions.map((x) => [x.n, x.prompt, x.pages.length, Math.round(x.pages[0]!.widthPt)]), [[1, "double sided A4, and a flowchart", 2, 595]]);
		assert.deepEqual(v.sheet.prompts.map((p) => p.text), ["double sided A4, and a flowchart"]);
		const kept = fs.readFileSync(path.join(sheetDir(classId), `${deadlineId}-versions`, "v1.pdf"));
		assert.deepEqual(kept, pdfOf([A4, A4]), "the PDF is kept exactly as the agent made it");

		const prompt = prompts[0]!;
		const folder = /Working folder: (.+)/.exec(prompt)![1]!;
		assert.equal(path.dirname(folder), path.join(FOLDER, "cheat-sheets"));
		assert.match(path.basename(folder), /^CSE 21 Midterm( \(\d+\))?$/);
		assert.equal(v.sheet.folder, path.basename(folder));
		assert.match(prompt, /^Cheat sheet for: CSE 21 Midterm on 2026-11-04\nAbout the class: Discrete math/);
		assert.match(prompt, /The student asks:\ndouble sided A4, and a flowchart/);
		assert.match(prompt, /Counting \| weak, 1 mistake\n {2}- Permutations: P\(n,k\)/);
		assert.match(prompt, /answered wrong \(Counting\): "How many 5-letter strings use each letter once\?"/);
		assert.match(prompt, /It is empty\. Keep the sheet's source here/);
	});

	it("refuses a link that leads out of the working folder", async () => {
		const { classId, deadlineId } = seed();
		const outside = path.join(TMP_DATA, "secret.pdf");
		fs.writeFileSync(outside, pdfOf([A4]));
		const prompts = agent({ link: ["link.pdf", outside], send: "link.pdf" }, made());
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "A4" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal(prompts.length, 2);
		assert.deepEqual(view(classId, deadlineId).sheet.versions.map((x) => x.pages.length), [2], "the linked one-page PDF was refused");
	});

	it("changes the sheet as asked: the working folder and what was asked before go along, and the last 5 versions stay", async () => {
		const { classId, deadlineId } = seed();
		agent(made("first"));
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "A4" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		const prompts = agent(made("second"));
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "use the back too" })).ok);
		assert.equal(view(classId, deadlineId).running?.kind, "change");
		assert.equal((await sheets.askCheatSheet(classId, deadlineId, { text: "again" })).ok, false, "one request at a time");
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /What they asked before, oldest first:\n- A4/);
		assert.match(prompts[0]!, /It has: sheet\.pdf, sheet\.tex\. The current sheet is the last PDF you made here \(A4, front and back\)\. Change its source/);
		const folders = new Set<string>();
		for (let i = 3; i <= 7; i++) {
			const p = agent(made(`v${i}`));
			assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: `change ${i}` })).ok);
			await sheets.cheatSheetIdle(deadlineId);
			folders.add(/Working folder: (.+)/.exec(p[0]!)![1]!);
		}
		assert.equal(folders.size, 1, "every change uses the same folder");
		const v = view(classId, deadlineId);
		assert.deepEqual(v.sheet.versions.map((x) => x.n), [3, 4, 5, 6, 7]);
		assert.deepEqual(v.sheet.versions.map((x) => x.prompt), ["change 3", "change 4", "change 5", "change 6", "change 7"]);
		assert.deepEqual(fs.readdirSync(path.join(sheetDir(classId), `${deadlineId}-versions`)).sort(), ["v3.pdf", "v4.pdf", "v5.pdf", "v6.pdf", "v7.pdf"]);
	});

	it("says why a request failed, and Try again sends it as it was", async () => {
		const { classId, deadlineId } = seed();
		agent(...Array.from({ length: 10 }, () => "I can't"));
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "index card" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal(view(classId, deadlineId).error, "the agent never sent the cheat sheet");
		assert.equal(view(classId, deadlineId).sheet.prompts.length, 0, "only a made sheet keeps its prompt");
		const prompts = agent({ files: { "card.pdf": pdfOf([[360, 216]]) }, send: "card.pdf" });
		assert.ok(sheets.retryCheatSheet(classId, deadlineId).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /The student asks:\nindex card/);
		const v = view(classId, deadlineId);
		assert.deepEqual([v.error, v.sheet.versions[0]!.pages[0]!.widthPt, v.sheet.prompts.map((p) => p.text)], [null, 360, ["index card"]]);
		assert.equal(sheets.retryCheatSheet(classId, deadlineId).ok, false, "nothing failed");
	});

	it("sends pictures to the agent and saves PDFs beside the sheet for it to read", async () => {
		const { classId, deadlineId } = seed();
		const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png().toBuffer();
		const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
		const prompts = agent(made());
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

	it("keeps an older HTML sheet's prompts, says it can't be shown, and makes it again as a PDF", async () => {
		const { classId, deadlineId } = seed();
		const file = path.join(sheetDir(classId), `${deadlineId}.json`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const doc = { widthIn: 8.27, heightIn: 11.69, css: "", pages: ["<p>front</p>"] };
		fs.writeFileSync(file, JSON.stringify({ version: 2, deadlineId, doc, prompts: [{ text: "both sides of A4", at: "t" }], updatedAt: "t" }));
		const before = view(classId, deadlineId).sheet;
		assert.deepEqual([before.olderFormat, before.versions, before.prompts.map((p) => p.text)], [true, [], ["both sides of A4"]]);
		const prompts = agent(made());
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "Make my cheat sheet again from what I asked before." })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /What they asked before, oldest first:\n- both sides of A4/);
		const after = view(classId, deadlineId).sheet;
		assert.deepEqual([after.olderFormat, after.versions.length, after.prompts.length], [undefined, 1, 2]);
		assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 3);
	});

	it("lists the class's deadlines with where each sheet is, through its route", async () => {
		const { classId, deadlineId } = seed();
		const later = classStore.addDeadline(classId, { kind: "homework", name: "HW 9", date: "2099-01-01", fileIds: [] });
		const cards = async () => {
			const res = await classRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: classId }) });
			assert.equal(res.status, 200);
			return ((await res.json()) as { cards: Array<{ deadlineId: string; status: string; version: { n: number } | null }> }).cards;
		};
		assert.deepEqual((await cards()).map((c) => c.status), ["none", "none"]);
		assert.deepEqual(new Set((await cards()).map((c) => c.deadlineId)), new Set([deadlineId, later.id]));
		agent(made());
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "A4" })).ok);
		assert.equal((await cards()).find((c) => c.deadlineId === deadlineId)!.status, "making");
		await sheets.cheatSheetIdle(deadlineId);
		const done = (await cards()).find((c) => c.deadlineId === deadlineId)!;
		assert.deepEqual([done.status, done.version!.n], ["made", 1]);
		assert.equal((await cards()).find((c) => c.deadlineId === later.id)!.status, "none");
		assert.equal((await classRoute.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "cls_missing_00000000" }) })).status, 404);
	});

	it("answers through the routes, refuses bad requests, serves each version's PDF, and goes with its deadline", async () => {
		const { classId, deadlineId } = seed();
		const r = routeFor(classId, deadlineId);
		assert.equal((await r.get()).status, 200);
		assert.equal((await r.post({ action: "ask", text: "  " })).status, 400);
		assert.equal((await r.post({ action: "ask" })).status, 400);
		assert.equal((await r.post({ action: "ask", text: "x", attachments: [{ name: "a.png", mimeType: "image/png", data: "%%%" }] })).status, 400);
		assert.equal((await r.post({ action: "shout" })).status, 400);
		assert.equal((await r.post({ action: "retry" })).status, 409);
		assert.equal((await route.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: classId, deadlineId: "ddl_missing" }) })).status, 404);

		agent(made());
		assert.equal((await r.post({ action: "ask", text: "A4" })).status, 200);
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal((await r.post({ action: "stop" })).status, 200);
		const pdf = await r.pdf("1");
		assert.deepEqual([pdf.status, pdf.headers.get("content-type")], [200, "application/pdf"]);
		assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), pdfOf([A4, A4]));
		for (const n of ["2", "0", "01", "x", "../1"]) assert.equal((await r.pdf(n)).status, 404, n);

		// Show in Finder: the agent's own file while it is still this version, else godspeed's copy beside it.
		const fileOf = async (n: number) => ((await (await r.post({ action: "file", n })).json()) as { path: string }).path;
		const folder = path.join(FOLDER, "cheat-sheets", view(classId, deadlineId).sheet.folder!);
		assert.equal(await fileOf(1), fs.realpathSync(path.join(folder, "sheet.pdf")));
		fs.writeFileSync(path.join(folder, "sheet.pdf"), pdfOf([A4]));
		const copy = await fileOf(1);
		assert.equal(copy, path.join(folder, "cheat sheet v1.pdf"));
		assert.deepEqual(fs.readFileSync(copy), pdfOf([A4, A4]));
		assert.equal((await r.post({ action: "file", n: 2 })).status, 404);
		assert.equal((await r.post({ action: "file" })).status, 400);
		const file = path.join(sheetDir(classId), `${deadlineId}.json`);
		assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 3);
		const files = path.join(sheetDir(classId), `${deadlineId}-files`);
		fs.mkdirSync(files, { recursive: true });
		assert.ok(removeClassDeadline(classId, deadlineId).ok);
		for (const gone of [file, files, path.join(sheetDir(classId), `${deadlineId}-versions`)]) assert.equal(fs.existsSync(gone), false, gone);
		assert.equal((await r.pdf("1")).status, 404);
	});
});
