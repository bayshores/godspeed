/**
 * Pictures and PDFs on learner messages: the shared rules (types, sizes,
 * the 5-file limit, the PDF note), the strict input parse, the stored
 * message shapes, the model-facing seam, the view projection, and the
 * compaction text (never base64).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import {
	attachmentRefusal,
	attachmentType,
	base64Bytes,
	contentText,
	draftAttachmentParts,
	HEIC_REFUSAL,
	keepsPng,
	pdfFileName,
	pdfNote,
	pdfNoteOf,
	pickAttachments,
	TOO_MANY_REFUSAL,
	type AttachmentPart,
} from "../../src/shared/core/attachments.ts";
import { ChatInputError, inputAppends, parseChatInput } from "../../src/shared/core/input-events.ts";
import { newAnswerResult, newSideQuestion, newThinkingMessage, newUserMessage, PRACTICE_PROBLEM_TOOL, toLlmMessages, type LhMessage } from "../../src/shared/core/native-messages.ts";
import { answerTakesFiles } from "../../src/shared/core/pending.ts";
import { projectView } from "../../src/shared/core/view.ts";
import { serializeForSummary } from "../../src/shared/core/compaction.ts";
import { absorbed } from "../../src/frontend/components/session-core.ts";

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
		assert.equal(attachmentRefusal({ name: "IMG_1.heic", type: "", size: 10 }), HEIC_REFUSAL);
		assert.equal(attachmentRefusal({ name: "a.png", type: "image/png", size: 20 * MB }), null);
		assert.equal(attachmentRefusal({ name: "a.png", type: "image/png", size: 20 * MB + 1 }), "a.png is too big. Pictures can be up to 20 MB.");
		assert.equal(attachmentRefusal({ name: "b.pdf", type: "application/pdf", size: 30 * MB }), null);
		assert.equal(attachmentRefusal({ name: "b.pdf", type: "application/pdf", size: 30 * MB + 1 }), "b.pdf is too big. PDFs can be up to 30 MB.");
		assert.equal(attachmentRefusal({ name: "c.zip", type: "application/zip", size: 1 }), "Can't add c.zip. Use a PNG, JPG, GIF, WebP or PDF.");
		for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
			assert.equal(attachmentRefusal({ name: "x", type, size: 1 }), null, type);
		}
	});

	it("keeps at most 5 files and reports the first refusal", () => {
		const file = (name: string) => ({ name, type: "image/png", size: 1 });
		const some = pickAttachments(3, [file("1"), file("2"), file("3")]);
		assert.deepEqual(some.accepted.map((f) => f.name), ["1", "2"]);
		assert.equal(some.refusal, TOO_MANY_REFUSAL);
		const mixed = pickAttachments(0, [{ name: "x.heic", type: "", size: 1 }, file("ok")]);
		assert.deepEqual(mixed.accepted.map((f) => f.name), ["ok"]);
		assert.equal(mixed.refusal, HEIC_REFUSAL);
		assert.deepEqual(pickAttachments(0, [file("a")]), { accepted: [file("a")], refusal: null });
	});

	it("counts base64 bytes without decoding", () => {
		assert.equal(base64Bytes("QUJD"), 3);
		assert.equal(base64Bytes("QUI="), 2);
		assert.equal(base64Bytes("QQ=="), 1);
	});

	it("keeps PNG for transparency or a small PNG screenshot, JPEG otherwise", () => {
		assert.equal(keepsPng({ transparent: true, sourcePng: false, pngBytes: 9 * MB }), true);
		assert.equal(keepsPng({ transparent: false, sourcePng: true, pngBytes: 1 * MB }), true);
		assert.equal(keepsPng({ transparent: false, sourcePng: true, pngBytes: 2 * MB }), false);
		assert.equal(keepsPng({ transparent: false, sourcePng: false, pngBytes: 1 }), false);
	});

	it("names a saved PDF by hash and a cleaned name", () => {
		assert.equal(pdfFileName("Lecture 3.pdf", "0123456789abcdef"), "0123456789ab-Lecture 3.pdf");
		assert.equal(pdfFileName("../../etc/passwd.PDF", "ff".repeat(8)), "ffffffffffff-_.._etc_passwd.pdf", "no slashes survive");
		assert.equal(pdfFileName("ñ.pdf", "aa".repeat(8)), "aaaaaaaaaaaa-_.pdf");
		assert.equal(pdfFileName(".pdf", "bb".repeat(8)), "bbbbbbbbbbbb-document.pdf");
	});

	it("the PDF note names the file and its path, and reads back", () => {
		assert.equal(pdf.text, "[Attached PDF] notes.pdf\nPath: /data/chats/chat_1/abc-notes.pdf\nRead it with the pdf tool when you need its content.");
		assert.deepEqual(pdfNoteOf(pdf.text), { name: "notes.pdf", path: "/data/chats/chat_1/abc-notes.pdf" });
		assert.equal(pdfNote("two\nlines.pdf", "/p").text.split("\n")[0], "[Attached PDF] two lines.pdf");
		assert.equal(pdfNoteOf("[Attached PDF] notes.pdf"), null, "plain learner text is never a note");
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

	it("content as text marks pictures and never carries their base64", () => {
		assert.equal(contentText("hi"), "hi");
		assert.equal(contentText([{ type: "text", text: "look" }, image]), "look\n[image]");
	});
});

describe("the input parse", () => {
	const att = { name: "a.png", mimeType: "image/png", data: PNG };

	it("text and thinking may carry files, and then may have no text", () => {
		assert.deepEqual(parseChatInput({ type: "text", text: "", attachments: [att] }), { type: "text", text: "", attachments: [att] });
		assert.deepEqual(parseChatInput({ type: "thinking", problemCallId: "p", text: " ", attachments: [att] }), {
			type: "thinking",
			problemCallId: "p",
			text: " ",
			attachments: [att],
		});
		assert.deepEqual(parseChatInput({ type: "text", text: "hi" }), { type: "text", text: "hi" });
	});

	it("bad shapes are a 400 (ChatInputError)", () => {
		const bad: unknown[] = [
			{ type: "text", text: "" },
			{ type: "text", text: "hi", attachments: [] },
			{ type: "text", text: "hi", attachments: "x" },
			{ type: "text", text: "hi", attachments: Array(6).fill(att) },
			{ type: "text", text: "hi", attachments: [{ ...att, name: "" }] },
			{ type: "text", text: "hi", attachments: [{ ...att, mimeType: undefined }] },
			{ type: "text", text: "hi", attachments: [{ ...att, data: "not base64!" }] },
			{ type: "text", text: "hi", attachments: [{ ...att, data: "QUJ" }] },
			{ type: "text", text: "hi", attachments: [{ ...att, mimeType: "image/heic" }] },
			{ type: "text", text: "hi", attachments: [{ ...att, mimeType: "text/plain" }] },
			{ type: "text", text: "hi", attachments: [null] },
			{ type: "thinking", problemCallId: "p", text: "", attachments: [] },
		];
		for (const input of bad) assert.throws(() => parseChatInput(input), ChatInputError, JSON.stringify(input));
	});

	it("an oversized file is refused by its decoded size", () => {
		const big = { name: "big.png", mimeType: "image/png", data: "A".repeat(Math.ceil((20 * MB + 3) / 3) * 4) };
		assert.throws(() => parseChatInput({ type: "text", text: "", attachments: [big] }), /too big/);
	});
});

describe("stored messages", () => {
	it("a user message with files: the text part, then the files; no files keeps a plain string", () => {
		assert.equal(newUserMessage("hi").content, "hi");
		assert.deepEqual(newUserMessage("look", [image, pdf]).content, [{ type: "text", text: "look" }, image, pdf]);
		assert.deepEqual(newUserMessage("  ", [image]).content, [image], "no empty text part");
	});

	it("inputAppends puts the stored files on the learner's message", () => {
		const [message] = inputAppends({ messages: [] }, { type: "text", text: "see", attachments: [] }, [image]);
		assert.deepEqual((message as { content: unknown }).content, [{ type: "text", text: "see" }, image]);
	});

	it("a thinking submission's files reach the model after its text", () => {
		const thinking = newThinkingMessage("call_p1", "my work", [image, pdf]);
		assert.deepEqual(thinking.attachments, [image, pdf]);
		assert.deepEqual(thinking.details, { problemCallId: "call_p1", text: "my work" }, "the card's payload is unchanged");
		const [wire] = toLlmMessages([thinking as never]);
		assert.deepEqual((wire as { content: unknown }).content, [{ type: "text", text: thinking.content }, image, pdf]);
		assert.equal(newThinkingMessage("call_p1", "x").attachments, undefined);
	});

	it("an optimistic message with files is absorbed by its saved copy", () => {
		const optimistic = { ...newUserMessage("see", [{ ...image, data: "b3JpZ2luYWw=" }, pdfNote("notes.pdf", "")]), id: "c_local" };
		const saved = newUserMessage("see", [image, pdf]);
		assert.ok(absorbed(optimistic, [saved]));
		assert.ok(!absorbed(optimistic, [newUserMessage("see", [image])]), "a different file list is a different message");
	});

	it("compaction reads files as text and never their base64", () => {
		const text = serializeForSummary([newUserMessage("see", [image, pdf]), newThinkingMessage("p", "work", [image])]);
		assert.ok(!text.includes(image.data));
		assert.match(text, /\[LEARNER\] see\n\[image\]\n\[Attached PDF\] notes\.pdf/);
		assert.match(text, /\[SYSTEM NOTE\] Your thinking:\nwork\n\[image\]/);
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

	it("a thinking card carries its files after it", () => {
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
			{ ...newThinkingMessage("call_p1", "work", [image]), id: "t1" },
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
	const att = { name: "work.png", mimeType: "image/png", data: PNG };

	it("explain, recall and ask answers take files; quiz, probe and code answers don't", () => {
		for (const tool of ["explain", "recall", "ask_user_question"]) assert.equal(answerTakesFiles(tool), true, tool);
		for (const tool of ["quiz", "probe", "write_code"]) assert.equal(answerTakesFiles(tool), false, tool);
	});

	it("the parse keeps them on the answer", () => {
		assert.deepEqual(parseChatInput({ type: "answer", toolCallId: "q1", answer: explained, attachments: [att] }), {
			type: "answer",
			toolCallId: "q1",
			answer: explained,
			attachments: [att],
		});
		assert.throws(() => parseChatInput({ type: "answer", toolCallId: "q1", answer: explained, attachments: [] }), ChatInputError);
	});

	it("they follow the answer record in the call's result, and a question that takes none refuses them", () => {
		const [result] = inputAppends({ messages: [ask("q1", "explain")] }, { type: "answer", toolCallId: "q1", answer: explained }, [image, pdf]);
		const content = (result as ToolResultMessage).content;
		assert.equal(content[0]!.type, "text");
		assert.deepEqual(content.slice(1), [image, pdf]);
		assert.throws(() => inputAppends({ messages: [ask("q2", "quiz")] }, { type: "answer", toolCallId: "q2", answer: explained }, [image]), /takes no files/);
	});

	it("the model gets them with the result, and the answered card gets them as file parts", () => {
		const record = [ask("q1", "recall"), { ...newAnswerResult("q1", "recall", explained, [image, pdf]), id: "r1" }];
		const wire = toLlmMessages(record).at(-1) as ToolResultMessage;
		assert.deepEqual(wire.content.slice(1), [image, pdf]);
		const part = projectView(record)[0]!.parts.find((p) => p.type === "tool-recall")!;
		assert.deepEqual(part.files, [
			{ type: "data-image", id: "q1-a0", data: { base64: image.data, mimeType: "image/jpeg" } },
			{ type: "data-pdf", id: "q1-a1", data: { name: "notes.pdf", path: "/data/chats/chat_1/abc-notes.pdf" } },
		]);
		const plain = projectView([ask("q2", "explain"), newAnswerResult("q2", "explain", explained)]);
		assert.equal(plain[0]!.parts.find((p) => p.type === "tool-explain")!.files, undefined);
	});

	it("an answer given after a side question carries them in its late message, and the earlier view stays a prefix", () => {
		const asked = [ask("q1", "explain"), newSideQuestion("why?")];
		const before = toLlmMessages(asked);
		const after = toLlmMessages([...asked, newAnswerResult("q1", "explain", explained, [image])]);
		assert.deepEqual(after.slice(0, before.length), before);
		const late = after.at(-1)!;
		assert.equal(late.role, "user");
		assert.deepEqual((late.content as AttachmentPart[]).slice(1), [image]);
	});

	it("compaction reads them as text and never their base64", () => {
		const text = serializeForSummary([newAnswerResult("q1", "explain", explained, [image])]);
		assert.ok(!text.includes(image.data));
		assert.match(text, /\[image\]/);
	});
});
