/**
 * Files on a learner message: pictures and PDFs added in the composer.
 *
 * The composer sends each file as base64 (ChatAttachment). The Rust server
 * turns a picture into an image part and saves a PDF next to the lesson,
 * leaving a text note (pdfNote) that tells the teacher where it is. Both
 * kinds ride the stored message as AttachmentPart.
 *
 * Pure and browser-safe: the composer's rules for what it accepts.
 */

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

/** One file as the composer sends it. */
export interface ChatAttachment {
	name: string;
	mimeType: string;
	/** The file's bytes, base64. */
	data: string;
}

/** A file inside a stored message: an image part, or a PDF's text note. */
export type AttachmentPart = TextContent | ImageContent;

export const MAX_ATTACHMENTS = 5;

const MB = 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * MB;
const MAX_PDF_BYTES = 30 * MB;

const PDF_TYPE = "application/pdf";
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
const HEIC_TYPES = ["image/heic", "image/heif"];
/** The file picker's accept list. */
export const ATTACHMENT_ACCEPT = [...IMAGE_TYPES, PDF_TYPE].join(",");

const TYPE_BY_EXTENSION: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	pdf: PDF_TYPE,
	heic: "image/heic",
	heif: "image/heif",
};

const HEIC_REFUSAL = "Can't use HEIC photos yet. Export as JPG.";
const TOO_MANY_REFUSAL = `You can add up to ${MAX_ATTACHMENTS} files to one message.`;

/** A file's type: the browser's, or read from its extension when the browser gives none. */
export function attachmentType(name: string, type: string): string {
	if (type) return type;
	const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
	return TYPE_BY_EXTENSION[ext] ?? "";
}

export function isPdfType(type: string): boolean {
	return type === PDF_TYPE;
}

/** Why a file can't be added (shown under the previews), or null when it can. */
function attachmentRefusal(file: { name: string; type: string; size: number }): string | null {
	const type = attachmentType(file.name, file.type);
	if (HEIC_TYPES.includes(type)) return HEIC_REFUSAL;
	if (type === PDF_TYPE) return file.size > MAX_PDF_BYTES ? `${file.name} is too big. PDFs can be up to 30 MB.` : null;
	if (IMAGE_TYPES.includes(type)) return file.size > MAX_IMAGE_BYTES ? `${file.name} is too big. Pictures can be up to 20 MB.` : null;
	return `Can't add ${file.name}. Use a PNG, JPG, GIF, WebP or PDF.`;
}

/** Split new files into the ones that fit beside `have` waiting files and
 *  the first refusal to show. */
export function pickAttachments<T extends { name: string; type: string; size: number }>(
	have: number,
	files: readonly T[],
): { accepted: T[]; refusal: string | null } {
	const accepted: T[] = [];
	let refusal: string | null = null;
	for (const file of files) {
		const why = attachmentRefusal(file) ?? (have + accepted.length >= MAX_ATTACHMENTS ? TOO_MANY_REFUSAL : null);
		if (why) refusal ??= why;
		else accepted.push(file);
	}
	return { accepted, refusal };
}

const PDF_NOTE_HEAD = "[Attached PDF] ";
const PDF_NOTE_PATH = "Path: ";
/** A note's last line: the server words it for a lesson's teacher (the pdf
 *  tool) or for the teacher panel's chat. */
const PDF_NOTE_TAILS = ["Read it with the pdf tool when you need its content.", "Read it when you need its content."];

/** A draft's note for a saved PDF, before the server's copy replaces it: the
 *  view turns it into a chip (pdfNoteOf). */
export function pdfNote(name: string, filePath: string): TextContent {
	return { type: "text", text: `${PDF_NOTE_HEAD}${name.replace(/\s+/g, " ")}\n${PDF_NOTE_PATH}${filePath}\n${PDF_NOTE_TAILS[0]}` };
}

export function pdfNoteOf(text: string): { name: string; path: string } | null {
	const lines = text.split("\n");
	if (lines.length !== 3 || !lines[0]!.startsWith(PDF_NOTE_HEAD) || !lines[1]!.startsWith(PDF_NOTE_PATH) || !PDF_NOTE_TAILS.includes(lines[2]!)) {
		return null;
	}
	return { name: lines[0]!.slice(PDF_NOTE_HEAD.length), path: lines[1]!.slice(PDF_NOTE_PATH.length) };
}

/** The parts the composer shows before the server answers: the picture as
 *  sent, and a PDF note with no path yet (the saved copy replaces both). */
export function draftAttachmentParts(attachments: readonly ChatAttachment[]): AttachmentPart[] {
	return attachments.map((a) =>
		isPdfType(a.mimeType) ? pdfNote(a.name, "") : { type: "image", data: a.data, mimeType: a.mimeType },
	);
}
