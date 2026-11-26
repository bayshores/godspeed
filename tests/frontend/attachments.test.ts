/**
 * Pictures and PDFs on learner messages: the shared rules (types, sizes,
 * the 5-file limit, the PDF note), the stored message shapes and the view
 * projection.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	attachmentType,
	draftAttachmentParts,
	pdfNote,
	pdfNoteOf,
	pickAttachments,
	type AttachmentPart,
} from "../../src/shared/core/attachments.ts";
import { newAnswerResult, newUserMessage, PRACTICE_PROBLEM_TOOL, type LhMessage } from "../../src/shared/core/native-messages.ts";
import { answerTakesFiles } from "../../src/shared/core/pending.ts";
import { projectView } from "../../src/shared/core/view.ts";
import { absorbed } from "../../src/frontend/components/session-core.ts";
import { oldThinkingMessage } from "../old-records.ts";

const MB = 1024 * 1024;
const PNG = "iVBORw0KGgo="; // well-formed base64; the parse never decodes
const image: AttachmentPart = { type: "image", data: "QUJD", mimeType: "image/jpeg" };
const pdf = pdfNote("notes.pdf", "/data/chats/chat_1/abc-notes.pdf");

describe("attachment rules", () => {
	it("reads the type from the browser, or from the extension when it gives none", () => {
		assert.equal(attachmentType("a.png", "image/png"), "image/png");
		assert.equal(attachmentType("Scan.JPG", ""), "image/jpeg");
		assert.equal(attachmentType("paper.pdf", ""), "application/pdf");
		assert.equal(attachmentType("IMG_1.HEIC", ""), "image/heic");
		assert.equal(attachmentType("notes", ""), "");
	});

	it("refuses HEIC, oversized files and other types with short plain messages", () => {
		const refusal = (file: { name: string; type: string; size: number }) => pickAttachments(0, [file]).refusal;
		assert.equal(refusal({ name: "IMG_1.heic", type: "", size: 10 }), "Can't use HEIC photos yet. Export as JPG.");
		assert.equal(refusal({ name: "a.png", type: "image/png", size: 20 * MB }), null);
		assert.equal(refusal({ name: "a.png", type: "image/png", size: 20 * MB + 1 }), "a.png is too big. Pictures can be up to 20 MB.");
		assert.equal(refusal({ name: "b.pdf", type: "application/pdf", size: 30 * MB }), null);
		assert.equal(refusal({ name: "b.pdf", type: "application/pdf", size: 30 * MB + 1 }), "b.pdf is too big. PDFs can be up to 30 MB.");
		assert.equal(refusal({ name: "c.zip", type: "application/zip", size: 1 }), "Can't add c.zip. Use a PNG, JPG, GIF, WebP or PDF.");
		for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
			assert.equal(refusal({ name: "x", type, size: 1 }), null, type);
		}
	});

	it("keeps at most 5 files and reports the first refusal", () => {
		const file = (name: string) => ({ name, type: "image/png", size: 1 });
		const some = pickAttachments(3, [file("1"), file("2"), file("3")]);
		assert.deepEqual(some.accepted.map((f) => f.name), ["1", "2"]);
		assert.equal(some.refusal, "You can add up to 5 files to one message.");
		const mixed = pickAttachments(0, [{ name: "x.heic", type: "", size: 1 }, file("ok")]);
		assert.deepEqual(mixed.accepted.map((f) => f.name), ["ok"]);
		assert.equal(mixed.refusal, "Can't use HEIC photos yet. Export as JPG.");
		assert.deepEqual(pickAttachments(0, [file("a")]), { accepted: [file("a")], refusal: null });
	});

	it("the PDF note names the file and its path, and reads back", () => {
		assert.equal(pdf.text, "[Attached PDF] notes.pdf\nPath: /data/chats/chat_1/abc-notes.pdf\nRead it with the pdf tool when you need its content.");
		assert.deepEqual(pdfNoteOf(pdf.text), { name: "notes.pdf", path: "/data/chats/chat_1/abc-notes.pdf" });
		assert.equal(pdfNote("two\nlines.pdf", "/p").text.split("\n")[0], "[Attached PDF] two lines.pdf");
		assert.equal(pdfNoteOf("[Attached PDF] notes.pdf"), null, "plain learner text is never a note");
		assert.deepEqual(pdfNoteOf("[Attached PDF] notes.pdf\nPath: /p.pdf\nRead it when you need its content."), { name: "notes.pdf", path: "/p.pdf" }, "the teacher panel's note");
		assert.equal(pdfNoteOf("[Attached PDF] notes.pdf\nPath: /p.pdf\nRead it."), null);
	});

	it("drafts show the picture as sent and the PDF with no path yet", () => {
		assert.deepEqual(
			draftAttachmentParts([
				{ name: "a.png", mimeType: "image/png", data: PNG },
				{ name: "b.pdf", mimeType: "application/pdf", data: "JVBERi0=" },
			]),
			[{ type: "image", data: PNG, mimeType: "image/png" }, pdfNote("b.pdf", "")],
		);
	});
});

describe("stored messages", () => {
	it("a user message with files: the text part, then the files; no files keeps a plain string", () => {
		assert.equal(newUserMessage("hi").content, "hi");
		assert.deepEqual(newUserMessage("look", [image, pdf]).content, [{ type: "text", text: "look" }, image, pdf]);
		assert.deepEqual(newUserMessage("  ", [image]).content, [image], "no empty text part");
	});

	it("an optimistic message with files is absorbed by its saved copy", () => {
		const optimistic = { ...newUserMessage("see", [{ ...image, data: "b3JpZ2luYWw=" }, pdfNote("notes.pdf", "")]), id: "c_local" };
		const saved = newUserMessage("see", [image, pdf]);
		assert.ok(absorbed(optimistic, [saved]));
		assert.ok(!absorbed(optimistic, [newUserMessage("see", [image])]), "a different file list is a different message");
	});
});

describe("the view", () => {
	it("a user message projects text, picture and PDF parts", () => {
		const message = { ...newUserMessage("see", [image, pdf]), id: "u1" };
		const [view] = projectView([message]);
		assert.deepEqual(view!.parts, [
			{ type: "text", text: "see", state: "done" },
			{ type: "data-image", id: "u1-a1", data: { base64: image.data, mimeType: "image/jpeg" } },
			{ type: "data-pdf", id: "u1-a2", data: { name: "notes.pdf", path: "/data/chats/chat_1/abc-notes.pdf" } },
		]);
	});

	it("an old thinking card carries its files after it", () => {
		const pose: LhMessage[] = [
			{
				id: "a1",
				role: "assistant",
				content: [{ type: "toolCall", id: "call_p1", name: PRACTICE_PROBLEM_TOOL, arguments: { statement: "S" } }],
				timestamp: 1,
				api: "faux",
				provider: "test",
				model: "m",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse",
			} as LhMessage & AssistantMessage,
			{ id: "r1", role: "toolResult", toolCallId: "call_p1", toolName: PRACTICE_PROBLEM_TOOL, content: [], details: null, isError: false, timestamp: 2 } as LhMessage & ToolResultMessage,
			{ ...oldThinkingMessage("call_p1", "work", [image]), id: "t1" },
		];
		const thinking = projectView(pose).at(-1)!;
		assert.deepEqual(thinking.parts.map((p) => p.type), ["data-practice-thinking", "data-image"]);
	});
});

describe("an answer's files", () => {
	const ask = (id: string, tool: string): LhMessage =>
		({
			id: `a_${id}`,
			role: "assistant",
			content: [{ type: "toolCall", id, name: tool, arguments: { question: "Show your work." } }],
			stopReason: "toolUse",
			api: "faux",
			provider: "faux",
			model: "m",
			usage: {},
			timestamp: 0,
		}) as unknown as LhMessage;
	const explained = { kind: "explain", questionText: "Show your work.", dontKnow: false, answers: [], text: "see the picture" } as never;

	it("explain, recall and ask answers take files; quiz, probe and code answers don't", () => {
		for (const tool of ["explain", "recall", "ask_user_question"]) assert.equal(answerTakesFiles(tool), true, tool);
		for (const tool of ["quiz", "probe", "write_code"]) assert.equal(answerTakesFiles(tool), false, tool);
	});

	it("the answered card gets them as file parts", () => {
		const record = [ask("q1", "recall"), { ...newAnswerResult("q1", "recall", explained, [image, pdf]), id: "r1" }];
		const part = projectView(record)[0]!.parts.find((p) => p.type === "tool-recall")!;
		assert.deepEqual(part.files, [
			{ type: "data-image", id: "q1-a0", data: { base64: image.data, mimeType: "image/jpeg" } },
			{ type: "data-pdf", id: "q1-a1", data: { name: "notes.pdf", path: "/data/chats/chat_1/abc-notes.pdf" } },
		]);
		const plain = projectView([ask("q2", "explain"), newAnswerResult("q2", "explain", explained)]);
		assert.equal(plain[0]!.parts.find((p) => p.type === "tool-explain")!.files, undefined);
	});
});
