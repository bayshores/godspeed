import { createHash } from "node:crypto";
import sharp from "sharp";
import {
	isPdfType,
	keepsPng,
	MAX_IMAGE_SIDE,
	pdfFileName,
	pdfNote,
	type AttachmentPart,
	type ChatAttachment,
} from "../core/attachments.ts";
import { ChatInputError } from "../core/input-events.ts";
import { stores } from "./stores.ts";

/**
 * Turn a message's files into the parts the record stores: each picture
 * resized and re-encoded inline, each PDF saved beside the lesson with a
 * note naming its path. A file that isn't what it claims is a 400.
 */
export async function storeAttachments(chatId: string, attachments: readonly ChatAttachment[]): Promise<AttachmentPart[]> {
	const parts: AttachmentPart[] = [];
	for (const attachment of attachments) {
		const bytes = Buffer.from(attachment.data, "base64");
		parts.push(isPdfType(attachment.mimeType) ? savePdf(chatId, attachment.name, bytes) : await normalizeImage(attachment.name, bytes));
	}
	return parts;
}

function savePdf(chatId: string, name: string, bytes: Buffer): AttachmentPart {
	if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") throw new ChatInputError(`${name} is not a PDF.`);
	const hash = createHash("sha256").update(bytes).digest("hex");
	return pdfNote(name, stores.chatStore.saveAttachment(chatId, pdfFileName(name, hash), bytes));
}

/** Upright, at most MAX_IMAGE_SIDE on the long side (never enlarged); a
 *  GIF keeps its first frame. */
async function normalizeImage(name: string, bytes: Buffer): Promise<AttachmentPart> {
	const resized = () =>
		sharp(bytes).rotate().resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: "inside", withoutEnlargement: true });
	try {
		const meta = await sharp(bytes).metadata();
		const sourcePng = meta.format === "png";
		const png = meta.hasAlpha || sourcePng ? await resized().png().toBuffer() : null;
		const transparent = png !== null && meta.hasAlpha === true && !(await sharp(png).stats()).isOpaque;
		if (png && keepsPng({ transparent, sourcePng, pngBytes: png.length })) {
			return { type: "image", data: png.toString("base64"), mimeType: "image/png" };
		}
		const jpeg = await resized().jpeg({ quality: 85 }).toBuffer();
		return { type: "image", data: jpeg.toString("base64"), mimeType: "image/jpeg" };
	} catch {
		throw new ChatInputError(`Can't read ${name}.`);
	}
}
