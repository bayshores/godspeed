/**
 * Storing a message's files (src/server/attachments.ts): pictures are
 * turned upright, shrunk to 1568 px on the long side and re-encoded inline;
 * PDFs are saved in the lesson's own folder, which goes with the lesson.
 * Runs under an isolated LH_DATA_DIR (set before any config-loading import).
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import sharp from "sharp";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-attachments-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { storeAttachments } = await import("../src/server/attachments.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { ChatInputError } = await import("../src/core/input-events.ts");
const { pdfNoteOf } = await import("../src/core/attachments.ts");

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const chat = chatStore.createChat("Files fixture");

const solid = (width: number, height: number, alpha = 1) =>
	sharp({ create: { width, height, channels: 4, background: { r: 200, g: 40, b: 40, alpha } } });
const noise = (width: number, height: number) =>
	sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } });

async function store(name: string, mimeType: string, bytes: Buffer) {
	const [part] = await storeAttachments(chat.id, [{ name, mimeType, data: bytes.toString("base64") }]);
	return part!;
}

async function sizeOf(part: { type: string; data?: string }) {
	assert.equal(part.type, "image");
	return sharp(Buffer.from(part.data!, "base64")).metadata();
}

describe("storeAttachments: pictures", () => {
	it("a big photo becomes a JPEG at most 1568 px on its long side", async () => {
		const part = await store("photo.jpg", "image/jpeg", await noise(3000, 2000).jpeg().toBuffer());
		assert.equal((part as { mimeType: string }).mimeType, "image/jpeg");
		const meta = await sizeOf(part);
		assert.deepEqual([meta.width, meta.height, meta.format], [1568, 1045, "jpeg"]);
	});

	it("a small picture is never enlarged", async () => {
		const meta = await sizeOf(await store("tiny.webp", "image/webp", await solid(40, 30).webp().toBuffer()));
		assert.deepEqual([meta.width, meta.height], [40, 30]);
	});

	it("a sideways phone photo is turned upright", async () => {
		const sideways = await solid(200, 100).jpeg().withMetadata({ orientation: 6 }).toBuffer();
		const meta = await sizeOf(await store("phone.jpg", "image/jpeg", sideways));
		assert.deepEqual([meta.width, meta.height], [100, 200]);
	});

	it("transparency and small screenshots stay PNG; a heavy opaque PNG becomes JPEG", async () => {
		const clear = await store("logo.png", "image/png", await solid(64, 64, 0.5).png().toBuffer());
		assert.equal((clear as { mimeType: string }).mimeType, "image/png");
		const shot = await store("shot.png", "image/png", await solid(800, 600).png().toBuffer());
		assert.equal((shot as { mimeType: string }).mimeType, "image/png");
		const heavy = await store("scan.png", "image/png", await noise(1000, 1000).png().toBuffer());
		assert.equal((heavy as { mimeType: string }).mimeType, "image/jpeg");
	});

	it("a GIF keeps only its first frame", async () => {
		const gif = await solid(30, 20).gif().toBuffer();
		const meta = await sizeOf(await store("anim.gif", "image/gif", gif));
		assert.notEqual(meta.format, "gif");
		assert.equal(meta.pages ?? 1, 1);
	});

	it("bytes that aren't a picture are a 400", async () => {
		await assert.rejects(store("fake.png", "image/png", Buffer.from("not a picture")), (err: unknown) =>
			err instanceof ChatInputError && err.message === "Can't read fake.png.");
	});
});

describe("storeAttachments: PDFs", () => {
	const bytes = Buffer.from("%PDF-1.4\n% a tiny test file\n");

	it("saves the PDF in the lesson's folder and notes its name and path", async () => {
		const part = await store("Week 3 notes.pdf", "application/pdf", bytes);
		assert.equal(part.type, "text");
		const note = pdfNoteOf((part as { text: string }).text)!;
		assert.equal(note.name, "Week 3 notes.pdf");
		assert.equal(path.dirname(note.path), path.join(TMP_DATA, "chats", chat.id));
		assert.match(path.basename(note.path), /^[0-9a-f]{12}-Week 3 notes\.pdf$/);
		assert.deepEqual(fs.readFileSync(note.path), bytes);
		const again = await store("Week 3 notes.pdf", "application/pdf", bytes);
		assert.equal(pdfNoteOf((again as { text: string }).text)!.path, note.path, "a resend writes the same file");
	});

	it("a file that isn't a PDF is a 400", async () => {
		await assert.rejects(store("fake.pdf", "application/pdf", Buffer.from("hello")), ChatInputError);
	});

	it("deleting the lesson deletes its folder", async () => {
		const other = chatStore.createChat("Delete fixture");
		const [part] = await storeAttachments(other.id, [{ name: "a.pdf", mimeType: "application/pdf", data: bytes.toString("base64") }]);
		const saved = pdfNoteOf((part as { text: string }).text)!.path;
		assert.ok(fs.existsSync(saved));
		assert.ok(chatStore.deleteChat(other.id));
		assert.ok(!fs.existsSync(path.dirname(saved)));
		assert.ok(chatStore.listChats().every((c) => c.id !== other.id));
	});
});
