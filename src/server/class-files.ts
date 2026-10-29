/**
 * CLASS FILES → TEXT (classes wave, owner-approved 2026-10-26, Phase 3).
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
	DOCUMENT_EXTENSIONS,
	MAX_LINKED_FILES,
	TEXT_EXTENSIONS,
	TRANSCRIPT_EXTENSIONS,
	extensionOf,
	isRecordingFile,
	isSupportedClassFile,
} from "../core/contracts.ts";

/** sha256 of the file's bytes, 16 hex chars — the change detector.
 *  Streamed (speed plan, 2026-10-27): a whole-file sync read of a big PDF
 *  blocked every other request while it hashed. */
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
	if ((TEXT_EXTENSIONS as readonly string[]).includes(ext)) return fs.readFileSync(absPath, "utf-8");
	if ((TRANSCRIPT_EXTENSIONS as readonly string[]).includes(ext)) return transcriptToText(fs.readFileSync(absPath, "utf-8"));
	if ((DOCUMENT_EXTENSIONS as readonly string[]).includes(ext)) {
		// pdfjs text, page-headed ("--- Page N ---") — the headings keep the
		// extractor oriented in long readings.
		return pdfTextOffThread(absPath);
	}
	if (isRecordingFile(absPath)) throw new RecordingNeedsTranscriptError();
	throw new Error(`Unsupported file type: ${ext || "(none)"}`);
}

/** Folders never walked inside a linked class folder (fs-shared.ts's noise
 *  set plus hidden folders). */
const SKIPPED_DIRS = new Set(["node_modules", ".git", "Library", ".Trash"]);

/** Every supported file under `root`, as POSIX-style relative paths,
 *  sorted, and whether the walk stopped at MAX_LINKED_FILES with more
 *  left. Hidden files, transcripts generated by the app
 *  (".godspeed-transcript.txt"), and noise folders are skipped. Throws
 *  when the root can't be read: an unreadable folder is not an empty one. */
export function walkLinkedFolder(root: string): { files: string[]; capped: boolean } {
	const out: string[] = [];
	let capped = false;
	const visit = (dir: string, rel: string) => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch (err) {
			if (rel === "") throw err;
			return;
		}
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			if (capped) return;
			if (entry.name.startsWith(".")) continue;
			const childRel = rel ? `${rel}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) visit(path.join(dir, entry.name), childRel);
			} else if (entry.isFile() && isSupportedClassFile(entry.name) && !entry.name.endsWith(TRANSCRIPT_SUFFIX)) {
				if (out.length === MAX_LINKED_FILES) capped = true;
				else out.push(childRel);
			}
		}
	};
	visit(root, "");
	return { files: out, capped };
}

/** The suffix of transcripts the app writes for recordings. */
const TRANSCRIPT_SUFFIX = ".godspeed-transcript.txt";
