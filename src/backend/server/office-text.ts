/**
 * Word (.docx) and PowerPoint (.pptx) files → text, on this computer.
 * Both are zip archives of XML: a small zip reader on node:zlib opens
 * them, and the text is pulled from the XML (no layout, no images).
 * Slides come in presentation order, headed "--- Slide N ---" like PDF
 * pages, with each slide's speaker notes after it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { inflateRawSync } from "node:zlib";

const NOT_OFFICE = "This file can't be opened as a Word or PowerPoint file. Save it again as .docx, .pptx or PDF.";
/** Most one part may unpack to: a real document's XML is far smaller, and
 *  a tiny file that unpacks to gigabytes would stall the server. */
const MAX_PART_BYTES = 64 * 1024 * 1024;
const LOCKED = "This file is password-protected. Save a copy without a password, or as PDF.";

/** A zip archive's files by name, read lazily. */
function readZip(buf: Buffer): Map<string, () => Buffer> {
	// Office files with a password are not zips but OLE compound files.
	if (buf.length >= 4 && buf.readUInt32BE(0) === 0xd0cf11e0) throw new Error(LOCKED);
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error(NOT_OFFICE);
	const count = buf.readUInt16LE(eocd + 10);
	let at = buf.readUInt32LE(eocd + 16);
	const files = new Map<string, () => Buffer>();
	for (let n = 0; n < count; n++) {
		if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw new Error(NOT_OFFICE);
		const flags = buf.readUInt16LE(at + 8);
		const method = buf.readUInt16LE(at + 10);
		const size = buf.readUInt32LE(at + 20);
		const nameLen = buf.readUInt16LE(at + 28);
		const local = buf.readUInt32LE(at + 42);
		const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
		at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
		files.set(name, () => {
			if (flags & 1) throw new Error(LOCKED);
			if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new Error(NOT_OFFICE);
			const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
			const data = buf.subarray(start, start + size);
			if (method === 0) return data;
			if (method !== 8) throw new Error(NOT_OFFICE);
			try {
				return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
			} catch {
				throw new Error(NOT_OFFICE);
			}
		});
	}
	return files;
}

function entry(zip: Map<string, () => Buffer>, name: string): string | null {
	const read = zip.get(name);
	return read ? read().toString("utf8") : null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeXml(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
		if (code[0] === "#") {
			const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
			return Number.isInteger(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
		}
		return ENTITIES[code] ?? whole;
	});
}

/** Text runs in reading order: `tag` is the run element ("w:t" / "a:t"),
 *  `para` ends a paragraph, and breaks/tabs keep their spacing. */
function xmlText(xml: string, ns: "w" | "a"): string {
	const pattern =
		ns === "w"
			? /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*>|<\/w:p>/g
			: /<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*>|<\/a:p>/g;
	let out = "";
	for (const m of xml.matchAll(pattern)) {
		if (m[1] !== undefined) out += decodeXml(m[1]);
		else if (m[0].includes("tab")) out += "\t";
		else out += "\n";
	}
	return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function docxText(zip: Map<string, () => Buffer>): string {
	const doc = entry(zip, "word/document.xml");
	if (doc === null) throw new Error(NOT_OFFICE);
	return xmlText(doc, "w");
}

/** Relationship targets by id, resolved against the part's folder. */
function relTargets(zip: Map<string, () => Buffer>, part: string): Map<string, string> {
	const rels = entry(zip, path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`));
	const out = new Map<string, string>();
	for (const m of (rels ?? "").matchAll(/<Relationship\b[^>]*>/g)) {
		const id = /\bId="([^"]+)"/.exec(m[0])?.[1];
		const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1];
		if (id && target) out.set(id, path.posix.normalize(path.posix.join(path.posix.dirname(part), target)));
	}
	return out;
}

/** The slide parts in presentation order (file-number order when the
 *  presentation doesn't list them). */
function slideParts(zip: Map<string, () => Buffer>): string[] {
	const pres = entry(zip, "ppt/presentation.xml") ?? "";
	const targets = relTargets(zip, "ppt/presentation.xml");
	const listed = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map((m) => targets.get(m[1]!)).filter((t): t is string => !!t && zip.has(t));
	if (listed.length > 0) return listed;
	const num = (name: string) => Number(/slide(\d+)\.xml$/.exec(name)?.[1] ?? 0);
	return [...zip.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => num(a) - num(b));
}

function pptxText(zip: Map<string, () => Buffer>): string {
	const slides = slideParts(zip);
	if (slides.length === 0 && !zip.has("ppt/presentation.xml")) throw new Error(NOT_OFFICE);
	return slides
		.map((part, i) => {
			const body = xmlText(entry(zip, part) ?? "", "a");
			const notesPart = [...relTargets(zip, part).values()].find((t) => t.includes("/notesSlides/"));
			// The notes page repeats the slide number as a field: leave it out.
			const notes = notesPart ? xmlText((entry(zip, notesPart) ?? "").replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, ""), "a") : "";
			return [`--- Slide ${i + 1} ---`, body, notes ? `Notes:\n${notes}` : ""].filter(Boolean).join("\n");
		})
		.join("\n\n");
}

/** A .docx or .pptx file's text. Throws a plain message for files that
 *  aren't really Word/PowerPoint files or are password-protected. */
export function officeText(absPath: string): string {
	const zip = readZip(fs.readFileSync(absPath));
	return path.extname(absPath).toLowerCase() === ".pptx" ? pptxText(zip) : docxText(zip);
}
