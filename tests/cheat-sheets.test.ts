/**
 * CHEAT SHEETS end to end against a scripted agent that writes real PDFs
 * into the sheet's working folder: the sheet's chat (a message kept at
 * once, the agent's answer with or without a new version, the chat and the
 * sheet's rules carried along), PDFs refused for where they are or what
 * they are, the last 5 versions kept, Try again after a failure, pictures
 * and PDFs, pointing at a page, the problem from a session, an older
 * sheet's asks, a newer PDF from the working folder, the routes (the PDF
 * and the chat's files included), and removing the deadline. Isolated
 * LH_DATA_DIR and godspeed folder (set before any config-loading import).
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
const fileRoute = await import("../src/app/api/classes/[id]/deadlines/[deadlineId]/cheat-sheet/files/[file]/route.ts");
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

/** What the scripted agent does with one request: write files into the
 *  working folder (named in the request), then answer, with a PDF's path
 *  and rules or without; or only say something without answering. */
type Step = { files?: Record<string, Buffer | string>; link?: [string, string]; send?: string; text?: string; rules?: string[] } | string;

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
			const args = { text: step.text ?? "Done.", ...(step.send ? { pdf_path: step.send } : {}), ...(step.rules ? { new_rules: step.rules } : {}) };
			return fauxAssistantMessage([fauxToolCall("sheet_reply", args as ToolCall["arguments"])], { stopReason: "toolUse" });
		}),
	);
	sheets.cheatSheetSeams.engine = { model: faux.getModel(), streamFn: faux.streamSimple };
	return prompts;
}

const made = (tex = "\\documentclass{article}"): Exclude<Step, string> => ({ files: { "sheet.tex": tex, "sheet.pdf": pdfOf([A4, A4]) }, send: "sheet.pdf" });

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


const view = async (classId: string, deadlineId: string): Promise<CheatSheetView> => {
	const v = await sheets.cheatSheetView(classId, deadlineId);
	assert.ok(v.ok);
	return v.value;
};

/** The chat as [who, text, version] rows. */
const chat = async (classId: string, deadlineId: string) => (await view(classId, deadlineId)).sheet.messages.map((m) => [m.role, m.text, m.role === "agent" ? (m.version ?? null) : null]);

const sheetDir = (classId: string) => path.join(TMP_DATA, "classes", classId, "cheat-sheets");

const routeFor = (classId: string, deadlineId: string) => {
	const url = `http://localhost/api/classes/${classId}/deadlines/${deadlineId}/cheat-sheet`;
	const params = { params: Promise.resolve({ id: classId, deadlineId }) };
	return {
		post: (body: unknown) => route.POST(new Request(url, { method: "POST", body: JSON.stringify(body) }), params),
		get: () => route.GET(new Request(url), params),
		pdf: (n: string) => pdfRoute.GET(new Request(`${url}/pdf/${n}`), { params: Promise.resolve({ id: classId, deadlineId, n }) }),
		file: (file: string) => fileRoute.GET(new Request(`${url}/files/x`), { params: Promise.resolve({ id: classId, deadlineId, file }) }),
	};
};

/** A sheet with version 1 made from "A4". */
async function madeSheet() {
	const ids = seed();
	agent(made());
	assert.ok((await sheets.askCheatSheet(ids.classId, ids.deadlineId, { text: "A4" })).ok);
	await sheets.cheatSheetIdle(ids.deadlineId);
	return ids;
}

describe("cheat sheets", () => {
	it("starts with no sheet and an empty chat", async () => {
		const { classId, deadlineId } = seed();
		const v = await view(classId, deadlineId);
		assert.deepEqual([v.className, v.deadlineName, v.date], ["CSE 21", "Midterm", "2026-11-04"]);
		assert.deepEqual([v.sheet.versions, v.sheet.messages, v.sheet.rules, v.running, v.error], [[], [], [], null, null]);
	});

	it("makes a sheet from a message in one request: the message shows at once, the PDF must be a real one inside the working folder", async () => {
		const { classId, deadlineId } = seed();
		const outside = path.join(TMP_DATA, "outside.pdf");
		fs.writeFileSync(outside, pdfOf([A4]));
		const prompts = agent(
			{ send: outside },
			{ send: "missing.pdf" },
			{ files: { "notes.pdf": "\\documentclass{article}" }, send: "notes.pdf" },
			{ files: { "five.pdf": pdfOf([A4, A4, A4, A4, A4]) }, send: "five.pdf" },
			{ ...made(), text: "Made it: both sides of A4." },
		);
		const asked = await sheets.askCheatSheet(classId, deadlineId, { text: "  double sided A4, and a flowchart  " });
		assert.ok(asked.ok);
		const during = await view(classId, deadlineId);
		assert.deepEqual(during.sheet.messages.map((m) => [m.role, m.text]), [["you", "double sided A4, and a flowchart"]]);
		assert.deepEqual(during.running, { messageId: during.sheet.messages[0]!.id });
		await sheets.cheatSheetIdle(deadlineId);
		const v = await view(classId, deadlineId);
		assert.equal(v.error, null);
		assert.equal(prompts.length, 5, "each refused PDF is sent back");
		const refusals = [/Put the PDF inside the working folder/, /There is no file at missing\.pdf/, /That file is not a PDF/, /The PDF has 5 pages; a cheat sheet has 1 to 4/];
		refusals.forEach((why, i) => assert.match(replies[i]!, why));
		assert.deepEqual(v.sheet.versions.map((x) => [x.n, x.prompt, x.pages.length, Math.round(x.pages[0]!.widthPt)]), [[1, "double sided A4, and a flowchart", 2, 595]]);
		assert.deepEqual(await chat(classId, deadlineId), [
			["you", "double sided A4, and a flowchart", null],
			["agent", "Made it: both sides of A4.", 1],
		]);
		const kept = fs.readFileSync(path.join(sheetDir(classId), `${deadlineId}-versions`, "v1.pdf"));
		assert.deepEqual(kept, pdfOf([A4, A4]), "the PDF is kept exactly as the agent made it");

		const prompt = prompts[0]!;
		const folder = /Working folder: (.+)/.exec(prompt)![1]!;
		assert.equal(path.dirname(folder), path.join(FOLDER, "cheat-sheets"));
		assert.match(path.basename(folder), /^CSE 21 Midterm( \(\d+\))?$/);
		assert.equal(v.sheet.folder, path.basename(folder));
		assert.match(prompt, /^Cheat sheet for: CSE 21 Midterm on 2026-11-04\nAbout the class: Discrete math/);
		assert.match(prompt, /The student says:\ndouble sided A4, and a flowchart$/);
		assert.match(prompt, /Counting \| weak, 1 mistake\n {2}- Permutations: P\(n,k\)/);
		assert.match(prompt, /answered wrong \(Counting\): "How many 5-letter strings use each letter once\?"/);
		assert.match(prompt, /It is empty\. There is no sheet yet\./);
	});

	it("refuses a link that leads out of the working folder", async () => {
		const { classId, deadlineId } = seed();
		const outside = path.join(TMP_DATA, "secret.pdf");
		fs.writeFileSync(outside, pdfOf([A4]));
		const prompts = agent({ link: ["link.pdf", outside], send: "link.pdf" }, made());
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "A4" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal(prompts.length, 2);
		assert.deepEqual((await view(classId, deadlineId)).sheet.versions.map((x) => x.pages.length), [2], "the linked one-page PDF was refused");
	});

	it("answers a question without changing the sheet, with the chat so far and the sheet now", async () => {
		const { classId, deadlineId } = await madeSheet();
		const prompts = agent({ text: "A **pool** is the set of items you choose from." });
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "wdym pool" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /The chat so far, oldest first:\nStudent: A4\nYou: Done\. \[made version 1\]/);
		assert.match(prompts[0]!, /It has: sheet\.pdf, sheet\.tex\. The sheet now is version 1 \(A4, front and back\), made from the source here/);
		assert.match(prompts[0]!, /The student says:\nwdym pool$/);
		const v = await view(classId, deadlineId);
		assert.equal(v.sheet.versions.length, 1);
		assert.deepEqual((await chat(classId, deadlineId)).slice(2), [
			["you", "wdym pool", null],
			["agent", "A **pool** is the set of items you choose from.", null],
		]);
	});

	it("changes the sheet as asked in the same folder, one request at a time, and keeps the last 5 versions", async () => {
		const { classId, deadlineId } = await madeSheet();
		const prompts = agent(made("second"));
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "use the back too" })).ok);
		assert.deepEqual(await sheets.askCheatSheet(classId, deadlineId, { text: "again" }), { ok: false, status: 409, error: "Your agent is still answering your last message about this sheet." });
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal((await view(classId, deadlineId)).sheet.messages.filter((m) => m.text === "again").length, 0, "a refused message isn't kept");
		const folders = new Set<string>([/Working folder: (.+)/.exec(prompts[0]!)![1]!]);
		for (let i = 3; i <= 7; i++) {
			const p = agent(made(`v${i}`));
			assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: `change ${i}` })).ok);
			await sheets.cheatSheetIdle(deadlineId);
			folders.add(/Working folder: (.+)/.exec(p[0]!)![1]!);
		}
		assert.equal(folders.size, 1, "every change uses the same folder");
		const v = await view(classId, deadlineId);
		assert.deepEqual(v.sheet.versions.map((x) => [x.n, x.prompt]), [[3, "change 3"], [4, "change 4"], [5, "change 5"], [6, "change 6"], [7, "change 7"]]);
		assert.deepEqual(fs.readdirSync(path.join(sheetDir(classId), `${deadlineId}-versions`)).sort(), ["v3.pdf", "v4.pdf", "v5.pdf", "v6.pdf", "v7.pdf"]);
	});

	it("saves the rules the student sets, sends them with every request, and deletes one", async () => {
		const { classId, deadlineId } = await madeSheet();
		agent({ text: "Got it, American spelling from now on.", rules: ["American spelling", "A4, both sides"] });
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "always use American spelling" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		const v = await view(classId, deadlineId);
		assert.deepEqual(v.sheet.rules.map((r) => r.text), ["American spelling", "A4, both sides"]);
		assert.deepEqual(v.sheet.messages.at(-1), { ...v.sheet.messages.at(-1)!, rules: ["American spelling", "A4, both sides"] });
		const prompts = agent({ text: "ok" });
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "hi" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /This sheet's rules \(follow every one\):\n- American spelling\n- A4, both sides/);
		const r = routeFor(classId, deadlineId);
		assert.equal((await r.post({ action: "remove-rule", text: "American spelling" })).status, 200);
		assert.equal((await r.post({ action: "remove-rule" })).status, 400);
		assert.deepEqual((await view(classId, deadlineId)).sheet.rules.map((r) => r.text), ["A4, both sides"]);
	});

	it("says why a request failed, keeps the message, and Try again answers that same message", async () => {
		const { classId, deadlineId } = seed();
		agent(...Array.from({ length: 10 }, () => "I can't"));
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "index card" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		const failed = await view(classId, deadlineId);
		assert.deepEqual(failed.error, { messageId: failed.sheet.messages[0]!.id, text: "the agent never answered" });
		const prompts = agent({ files: { "card.pdf": pdfOf([[360, 216]]) }, send: "card.pdf" });
		assert.ok(sheets.retryCheatSheet(classId, deadlineId).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /The student says:\nindex card$/);
		assert.doesNotMatch(prompts[0]!, /chat so far/, "the message isn't its own history");
		const v = await view(classId, deadlineId);
		assert.deepEqual([v.error, v.sheet.versions[0]!.pages[0]!.widthPt], [null, 360]);
		assert.deepEqual(await chat(classId, deadlineId), [
			["you", "index card", null],
			["agent", "Done.", 1],
		]);
		assert.equal(sheets.retryCheatSheet(classId, deadlineId).ok, false, "nothing failed");
	});

	it("keeps pictures and PDFs beside the sheet, sends them to the agent, and serves them to the chat", async () => {
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
		assert.match(content[0]!.text!, /The student says:\n\(no words, only the files\)$/);
		assert.equal(content[1]!.type, "image");
		assert.match(content[2]!.text!, /\[Attached PDF\] Practice exam\.pdf\nPath: .*cheat-sheets\/ddl_\w+-files\/\w+-Practice exam\.pdf/);
		const [first] = (await view(classId, deadlineId)).sheet.messages;
		assert.ok(first?.role === "you");
		assert.deepEqual(first.files!.map((f) => f.name), ["formulas.png", "Practice exam.pdf"]);
		assert.match(first.files![0]!.file!, /^\w{12}-formulas\.png$/);
		const r = routeFor(classId, deadlineId);
		const picture = await r.file(first.files![0]!.file!);
		assert.deepEqual([picture.status, picture.headers.get("content-type")], [200, "image/png"]);
		assert.equal((await r.file(first.files![1]!.file!)).headers.get("content-type"), "application/pdf");
		for (const bad of ["../x.json", ".hidden", "missing.png"]) assert.equal((await r.file(bad)).status, 404, bad);
		const refused = await sheets.askCheatSheet(classId, deadlineId, { text: "x", attachments: [{ name: "fake.pdf", mimeType: "application/pdf", data: Buffer.from("hello").toString("base64") }] });
		assert.deepEqual(refused, { ok: false, status: 400, error: "fake.pdf is not a PDF." });
	});

	it("carries the part of a page the student points at, and the problem they are on in a session", async () => {
		const { classId, deadlineId } = seed();
		const r = routeFor(classId, deadlineId);
		const region = { n: 1, page: 2, x: 0.1, y: 0.5, w: 0.4, h: 0.2 };
		assert.equal((await r.post({ action: "ask", text: "this is confusing", region })).status, 400, "no version to point at yet");
		agent(made());
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "A4" })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.equal((await r.post({ action: "ask", text: "x", region: { ...region, page: 3 } })).status, 400);
		assert.equal((await r.post({ action: "ask", text: "x", region: { page: 1 } })).status, 400);
		assert.equal((await r.post({ action: "ask", text: "x", about: { kind: "lesson" } })).status, 400);
		const png = await sharp({ create: { width: 8, height: 4, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
		const prompts = agent({ text: "I split card 8 into two routes." });
		const about = { kind: "problem", session: "Counting practice", text: "How many ways to seat 5 people?", work: "5! = 120, like the sheet says" };
		const res = await r.post({ action: "ask", text: "according to the cheat sheet that's what I did", region, about, attachments: [{ name: "Back, the part you pointed at.png", mimeType: "image/png", data: png.toString("base64") }] });
		assert.equal(res.status, 200);
		await sheets.cheatSheetIdle(deadlineId);
		const content = JSON.parse(prompts[0]!) as Array<{ type: string; text?: string }>;
		assert.match(content[0]!.text!, /They pointed at version 1, page 2 \(the back\), from 10% to 50% across and 50% to 70% down\. The first picture shows that part\./);
		assert.match(content[0]!.text!, /The student is on this problem in their session "Counting practice", with the sheet open beside it:\nHow many ways to seat 5 people\?\nWhat they have written for it so far:\n5! = 120, like the sheet says/);
		assert.equal(content[1]!.type, "image");
		const asked = (await view(classId, deadlineId)).sheet.messages.at(-2)!;
		assert.ok(asked.role === "you");
		assert.deepEqual([asked.region, asked.about], [region, about]);
	});

	it("turns an older HTML sheet's asks into the chat, says it can't be shown, and makes it again as a PDF", async () => {
		const { classId, deadlineId } = seed();
		const file = path.join(sheetDir(classId), `${deadlineId}.json`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		const doc = { widthIn: 8.27, heightIn: 11.69, css: "", pages: ["<p>front</p>"] };
		fs.writeFileSync(file, JSON.stringify({ version: 2, deadlineId, doc, prompts: [{ text: "both sides of A4", at: "t" }], updatedAt: "t" }));
		const before = (await view(classId, deadlineId)).sheet;
		assert.deepEqual([before.olderFormat, before.versions, before.messages.map((m) => m.text)], [true, [], ["both sides of A4"]]);
		const prompts = agent(made());
		assert.ok((await sheets.askCheatSheet(classId, deadlineId, { text: "Make my cheat sheet again from what I asked before." })).ok);
		await sheets.cheatSheetIdle(deadlineId);
		assert.match(prompts[0]!, /The chat so far, oldest first:\nStudent: both sides of A4/);
		const after = (await view(classId, deadlineId)).sheet;
		assert.deepEqual([after.olderFormat, after.versions.length, after.messages.length], [undefined, 1, 3]);
		assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 4);
	});

	it("takes a newer PDF from the working folder as a new version once, after the same checks", async () => {
		const { classId, deadlineId } = await madeSheet();
		const folder = path.join(FOLDER, "cheat-sheets", (await view(classId, deadlineId)).sheet.folder!);
		const later = (s: number) => new Date(Date.now() + s * 1000);
		fs.writeFileSync(path.join(folder, "cheat sheet v1.pdf"), pdfOf([A4]));
		fs.utimesSync(path.join(folder, "cheat sheet v1.pdf"), later(5), later(5));
		assert.equal((await view(classId, deadlineId)).sheet.versions.length, 1, "Show in Finder's copy is never taken");
		fs.writeFileSync(path.join(folder, "broken.pdf"), "not a pdf");
		fs.utimesSync(path.join(folder, "broken.pdf"), later(10), later(10));
		assert.equal((await view(classId, deadlineId)).sheet.versions.length, 1, "a PDF that fails the checks is left out");
		fs.writeFileSync(path.join(folder, "sheet.pdf"), pdfOf([A4, A4, A4]));
		fs.utimesSync(path.join(folder, "sheet.pdf"), later(20), later(20));
		const v = await view(classId, deadlineId);
		assert.deepEqual(v.sheet.versions.map((x) => [x.n, x.pages.length, x.fromFolder ?? false]), [[1, 2, false], [2, 3, true]]);
		assert.equal((await view(classId, deadlineId)).sheet.versions.length, 2, "taken once");
		fs.utimesSync(path.join(folder, "sheet.pdf"), later(30), later(30));
		assert.equal((await view(classId, deadlineId)).sheet.versions.length, 2, "the same PDF touched again isn't a new version");
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
		const folder = path.join(FOLDER, "cheat-sheets", (await view(classId, deadlineId)).sheet.folder!);
		assert.equal(await fileOf(1), fs.realpathSync(path.join(folder, "sheet.pdf")));
		fs.writeFileSync(path.join(folder, "sheet.pdf"), pdfOf([A4]));
		const old = new Date(0);
		fs.utimesSync(path.join(folder, "sheet.pdf"), old, old);
		const copy = await fileOf(1);
		assert.equal(copy, path.join(folder, "cheat sheet v1.pdf"));
		assert.deepEqual(fs.readFileSync(copy), pdfOf([A4, A4]));
		assert.equal((await r.post({ action: "file", n: 2 })).status, 404);
		assert.equal((await r.post({ action: "file" })).status, 400);
		const file = path.join(sheetDir(classId), `${deadlineId}.json`);
		assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 4);
		const files = path.join(sheetDir(classId), `${deadlineId}-files`);
		fs.mkdirSync(files, { recursive: true });
		assert.ok(removeClassDeadline(classId, deadlineId).ok);
		for (const gone of [file, files, path.join(sheetDir(classId), `${deadlineId}-versions`)]) assert.equal(fs.existsSync(gone), false, gone);
		assert.equal((await r.pdf("1")).status, 404);
	});
});
