/**
 * CLASS FILES → TEXT.
 *
 * The one "to text" step every class file passes through before the
 * existing notes pipeline (extractor → merge) turns it into
 * facts. No model here: plain reads, the existing pdfjs text extraction,
 * transcript cleanup. Recordings go through the local whisper.cpp
 * transcriber (src/server/transcribe.ts).
 *
 * Also: the linked-folder walk (which supported files a folder holds).
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { pdfExtract, standardFontsDir } from "../agent/subagents/pdf-ops.ts";
import {
	MAX_LINKED_FILES,
	OFFICE_EXTENSIONS,
	PLAIN_TEXT_EXTENSIONS,
	TRANSCRIPT_EXTENSIONS,
	extensionOf,
	isRecordingFile,
	isSupportedClassFile,
	type SkippedFiles,
} from "../core/contracts.ts";
import { officeText } from "./office-text.ts";

/** sha256 of the file's bytes, 16 hex chars — the change detector.
 *  Streamed: a whole-file sync read of a big PDF would block every other
 *  request while it hashed. */
export function fingerprintFile(absPath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		fs.createReadStream(absPath)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("hex").slice(0, 16)));
	});
}

/** The PDF text worker (plain .mjs, traced into the standalone build by
 *  next.config.ts). Found from the server's working directory: the repo
 *  root in dev and tests, the standalone dir when packaged. */
function pdfTextWorkerPath(): string {
	return path.join(process.cwd(), "src", "server", "workers", "pdf-text-worker.mjs");
}

/** pdfExtract(file, "all") on a worker thread, so a big PDF never stalls the
 *  server. Falls back to the in-process extractor if the worker can't start
 *  (logged — a build missing the worker file must still work). */
export async function pdfTextOffThread(absPath: string): Promise<string> {
	let started = false;
	try {
		return await new Promise<string>((resolve, reject) => {
			const worker = new Worker(pdfTextWorkerPath(), {
				workerData: { filePath: absPath, standardFontDataUrl: standardFontsDir() },
			});
			worker.once("online", () => {
				started = true;
			});
			worker.once("message", (msg: { ok: boolean; text?: string; error?: string }) => {
				void worker.terminate();
				if (msg.ok) resolve(msg.text ?? "");
				else reject(new Error(msg.error ?? "PDF text extraction failed"));
			});
			worker.once("error", reject);
			worker.once("exit", (code) => reject(new Error(`PDF text worker exited (code ${code})`)));
		});
	} catch (err) {
		// The worker ran and the PDF itself failed: that error, as before.
		if (started) throw err;
		console.error(`[class-files] PDF worker unavailable (${err instanceof Error ? err.message : String(err)}) — reading in-process`);
		return pdfExtract(absPath, "all");
	}
}

/** Strip a WebVTT / SRT transcript down to its spoken text: no header, no
 *  cue numbers, no timestamps, no styling tags; consecutive duplicate lines
 *  (rolling captions) collapse. */
export function transcriptToText(raw: string): string {
	const out: string[] = [];
	for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
		const t = line.trim();
		if (t === "" || t === "WEBVTT" || t.startsWith("WEBVTT ") || t.startsWith("NOTE") || t.startsWith("STYLE")) continue;
		if (/^\d+$/.test(t)) continue; // SRT cue number
		if (/-->/.test(t)) continue; // timing line
		const text = t.replace(/<[^>]+>/g, "").trim();
		if (text === "" || out[out.length - 1] === text) continue;
		out.push(text);
	}
	return out.join("\n");
}

export class RecordingNeedsTranscriptError extends Error {
	constructor() {
		super("Recordings are transcribed by the transcriber");
		this.name = "RecordingNeedsTranscriptError";
	}
}

/** The file's text for the notes pipeline. Throws on unreadable files;
 *  recordings throw RecordingNeedsTranscriptError (the caller routes them
 *  through the transcriber first). */
export async function fileToText(absPath: string): Promise<string> {
	const ext = extensionOf(absPath);
	// No extension: only ever added after looksLikeText said it is text.
	if (ext === "" || PLAIN_TEXT_EXTENSIONS.includes(ext)) return fs.readFileSync(absPath, "utf-8");
	if ((TRANSCRIPT_EXTENSIONS as readonly string[]).includes(ext)) return transcriptToText(fs.readFileSync(absPath, "utf-8"));
	// pdfjs text, page-headed ("--- Page N ---"): the headings keep the
	// extractor oriented in long readings.
	if (ext === ".pdf") return pdfTextOffThread(absPath);
	if ((OFFICE_EXTENSIONS as readonly string[]).includes(ext)) return officeText(absPath);
	if (isRecordingFile(absPath)) throw new RecordingNeedsTranscriptError();
	throw new Error(`Unsupported file type: ${ext}`);
}

/** How much of a file with no extension is checked for being text. */
const TEXT_SNIFF_BYTES = 8192;

/** True when these bytes (a file's start) read as UTF-8 text: no NUL
 *  byte and nothing that isn't UTF-8 (a character cut off at the end is
 *  fine). Empty is not text: an empty file has nothing to learn from. */
export function looksLikeText(bytes: Uint8Array): boolean {
	const head = bytes.subarray(0, TEXT_SNIFF_BYTES);
	if (head.length === 0 || head.includes(0)) return false;
	try {
		new TextDecoder("utf-8", { fatal: true }).decode(head, { stream: true });
		return true;
	} catch {
		return false;
	}
}

/** The start of a file on disk, for looksLikeText. */
function fileHead(absPath: string): Uint8Array {
	const fd = fs.openSync(absPath, "r");
	try {
		const buf = Buffer.alloc(TEXT_SNIFF_BYTES);
		return buf.subarray(0, fs.readSync(fd, buf, 0, TEXT_SNIFF_BYTES, 0));
	} finally {
		fs.closeSync(fd);
	}
}

/** looksLikeText per file on disk, kept while its size and time stay the
 *  same: the folder scan runs every minute, and opening a synced Drive
 *  file can download it. */
const textChecks = new Map<string, { sig: string; text: boolean }>();

function fileLooksLikeText(absPath: string): boolean {
	try {
		const st = fs.statSync(absPath);
		const sig = `${st.mtimeMs}:${st.size}`;
		const known = textChecks.get(absPath);
		if (known?.sig === sig) return known.text;
		const text = looksLikeText(fileHead(absPath));
		textChecks.set(absPath, { sig, text });
		return text;
	} catch {
		return false;
	}
}

/** Can this file become class material? By its extension, or, with none,
 *  by its bytes being text. */
export function isReadableClassFile(name: string, bytes: () => Uint8Array): boolean {
	if (isSupportedClassFile(name)) return true;
	return extensionOf(name) === "" && looksLikeText(bytes());
}

/** Google Docs, Sheets, Slides and the like on a synced Drive: small link
 *  files whose contents live online. */
const GOOGLE_STUB_EXTENSIONS = [".gdoc", ".gsheet", ".gslides", ".gdraw", ".gform", ".gsite", ".gmap", ".gjam"];

/** Names kept for files a folder holds that can't be read. */
const SKIPPED_EXAMPLES = 3;

/** Folders never walked inside a linked class folder (fs-shared.ts's noise
 *  set plus hidden folders). */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "Library", ".Trash"]);

/** Every supported file under `root`, as POSIX-style relative paths,
 *  sorted, and whether the walk stopped at MAX_LINKED_FILES with more
 *  left. Hidden files, lock files and noise folders are passed over; other
 *  files that can't be read are counted in `skipped`. An unreadable
 *  folder is not an empty one: the walk throws when the root can't be
 *  read, and lists unreadable subfolders in `unreadable`. */
export function walkLinkedFolder(root: string): { files: string[]; capped: boolean; unreadable: string[]; skipped: SkippedFiles } {
	const out: string[] = [];
	const unreadable: string[] = [];
	const skipped: SkippedFiles = { count: 0, examples: [], google: 0 };
	let capped = false;
	const visit = (dir: string, rel: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (err) {
			if (rel === "") throw err;
			unreadable.push(rel);
			return;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (capped) return;
			// Hidden files (where Drive and editors keep temporary ones) and Office lock files.
			if (entry.name.startsWith(".") || entry.name.startsWith("~$")) continue;
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) visit(path.join(dir, entry.name), childRel);
			} else if (entry.isFile()) {
				const name = entry.name;
				if (!isSupportedClassFile(name) && !(extensionOf(name) === "" && fileLooksLikeText(path.join(dir, name)))) {
					skipped.count++;
					if (GOOGLE_STUB_EXTENSIONS.includes(extensionOf(name))) skipped.google++;
					if (skipped.examples.length < SKIPPED_EXAMPLES) skipped.examples.push(name);
				} else if (out.length === MAX_LINKED_FILES) capped = true;
				else out.push(childRel);
			}
		}
	};
	visit(root, "");
	return { files: out, capped, unreadable, skipped };
}
