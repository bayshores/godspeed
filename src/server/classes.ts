/**
 * CLASS ORCHESTRATION (classes wave, owner-approved 2026-10-26).
 *
 * The cross-store choreography behind every class action: the routes
 * (src/app/api/classes/*), the MCP tools, and the folder scanner all come
 * through here.
 *
 *  - create / edit / archive / delete a class (delete takes its lessons,
 *    copied files and graph with it; a linked folder is never touched)
 *  - add, re-kind, retry, remove files; link / unlink a folder
 *  - the FILE PIPELINE: file → text (class-files.ts, transcribe.ts) → the
 *    existing notes pipeline into THE CLASS'S OWN graph. "study" files
 *    become facts; "info" files never do (owner ruling: per-file choice).
 *    A changed file rebuilds its facts; a removed one loses them.
 *  - the linked-folder scan: new files are added as study material
 *    (owner ruling: auto-add), every 60 s while the app runs
 *  - moving a lesson between classes (its facts leave the old graph and
 *    are rebuilt in the new one)
 *
 * File work is serialized PER CLASS (one queue each) — the file list is a
 * read-modify-write record, and one class's imports shouldn't flood the
 * shared extraction slots.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { extractionStatuses, abortExtraction, NotesImportError } from "../agent/subagents/extraction.ts";
import type { ClassExam, ClassFile, ClassFileKind, ClassRecord, ClassScope, ClassSummary } from "../core/contracts.ts";
import { ClassExamError, isRecordingFile, isSupportedClassFile, parseClassScope } from "../core/contracts.ts";
import { ModelsNotConfiguredError, ProviderNotConnectedError } from "../core/settings.ts";
import { deleteChatTraces, deleteSourceTraces } from "../core/graph-deletion.ts";
import { extractionEnabled } from "../core/settings-resolution.ts";
import { emit } from "../core/events.ts";
import { extraction } from "./chat-handler.ts";
import { quiesceChatForRewrite } from "./chats.ts";
import { fileToText, fingerprintFile, walkLinkedFolder } from "./class-files.ts";
import { discardChatDeliveries } from "./jobs.ts";
import { effectiveSettings, forgetGraphStore, graphStoreFor, stores } from "./stores.ts";
import { transcribeRecording, WhisperMissingError } from "./transcribe.ts";
import { clearTurnFailure } from "./turn-runs.ts";
import { applyClassCard } from "./class-card.ts";
import { cancelTopicGrouping } from "./topics.ts";

export type ClassOutcome<T> = { ok: true; value: T } | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): { ok: false; status: number; code: string; error: string } => ({
	ok: false,
	status,
	code,
	error,
});

/** The class scope a request names with ?class=<id|none> (absent = No
 *  class). undefined = malformed, or a class that doesn't exist. */
export function requestClassScope(req: Request): ClassScope | undefined {
	const raw = new URL(req.url).searchParams.get("class");
	const scope = parseClassScope(raw);
	if (scope === undefined) return undefined;
	if (scope !== null && !stores.classStore.getClass(scope)) return undefined;
	return scope;
}

// ─── reads ──────────────────────────────────────────────────────────────────

export function listClasses(): ClassSummary[] {
	return stores.classStore.listClasses();
}

export function getClass(id: string): ClassRecord | null {
	return stores.classStore.getClass(id);
}

/** Absolute path of a class file on this computer (null when its linked
 *  folder is gone). */
export function classFilePath(record: ClassRecord, file: ClassFile): string | null {
	if (file.origin === "copied") return path.join(stores.classStore.filesDir(record.id), file.path);
	return record.linkedFolder ? path.join(record.linkedFolder, file.path) : null;
}

/** Where a recording's transcript is kept (inside the app's own class
 *  folder — a linked folder is never written to). */
export function transcriptPathOf(classId: string, fileId: string): string {
	return path.join(stores.classStore.filesDir(classId), "transcripts", `${fileId}.txt`);
}

/** The notes-source id a class file's facts are born under: unique per
 *  class + file, so the same filename in two classes never collides. */
export function sourceIdFor(classId: string, fileId: string): string {
	return `src_${createHash("sha256").update(`${classId}:${fileId}`).digest("hex").slice(0, 12)}`;
}

// ─── class lifecycle ────────────────────────────────────────────────────────

export function createClass(init: { name: string; description?: string }): ClassRecord {
	return stores.classStore.createClass(init);
}

export function updateClass(id: string, patch: { name?: string; description?: string; archived?: boolean }): ClassOutcome<ClassRecord> {
	if (!stores.classStore.getClass(id)) return fail(404, "not_found", "No such class");
	return { ok: true, value: stores.classStore.updateClass(id, patch) };
}

/**
 * Delete a class with its lessons, copied files and graph. Refused while
 * any of its lessons has a turn or job running; extractions are aborted
 * and waited out. A linked folder on the learner's computer is untouched.
 */
export async function deleteClass(id: string): Promise<ClassOutcome<{ lessonsRemoved: number }>> {
	const record = stores.classStore.getClass(id);
	if (!record) return fail(404, "not_found", "No such class");
	const lessons = stores.chatStore.listChats().filter((c) => c.classId === id);
	for (const lesson of lessons) {
		const blocker = await quiesceChatForRewrite(lesson.id);
		if (blocker) return fail(blocker.status, blocker.code, `${lesson.title}: ${blocker.error}`);
	}
	// The class's file imports: abort and wait them out.
	const sourceIds = new Set(record.files.map((f) => f.sourceId).filter((s): s is string => !!s));
	for (const sid of sourceIds) abortExtraction(sid);
	const deadline = Date.now() + 10_000;
	while (extractionStatuses().some((run) => sourceIds.has(run.chatId))) {
		if (Date.now() > deadline) return fail(503, "extraction_winding_down", "The class's file imports are still stopping. Try again in a moment.");
		await new Promise((r) => setTimeout(r, 50));
	}
	cancelledClasses.add(id);
	cancelTopicGrouping(id);
	// THE SYNC BLOCK: lessons → class folder.
	let lessonsRemoved = 0;
	for (const lesson of lessons) {
		stores.jobStore.deleteJobsForChat(lesson.id);
		if (stores.chatStore.deleteChat(lesson.id)) {
			discardChatDeliveries(lesson.id);
			clearTurnFailure(lesson.id);
			lessonsRemoved++;
		}
	}
	stores.classStore.deleteClass(id);
	forgetGraphStore(id);
	return { ok: true, value: { lessonsRemoved } };
}

// ─── exams (redesign plan, owner-approved 2026-10-27) ───────────────────────
// Added by the learner (Edit class) or an outside agent from the syllabus
// (MCP add_class_exam). The store validates; these map its refusals.

function examFailure(err: unknown): { ok: false; status: number; code: string; error: string } {
	if (err instanceof ClassExamError) return fail(err.code === "exam_not_found" ? 404 : 400, err.code, err.message);
	throw err;
}

export function listClassExams(classId: string): ClassOutcome<ClassExam[]> {
	const record = stores.classStore.getClass(classId);
	if (!record) return fail(404, "not_found", "No such class");
	return { ok: true, value: record.exams ?? [] };
}

export function addClassExam(classId: string, exam: { name: string; date: string; fileIds?: string[] }): ClassOutcome<ClassExam> {
	if (!stores.classStore.getClass(classId)) return fail(404, "not_found", "No such class");
	try {
		return { ok: true, value: stores.classStore.addExam(classId, exam) };
	} catch (err) {
		return examFailure(err);
	}
}

export function updateClassExam(
	classId: string,
	examId: string,
	patch: { name?: string; date?: string; fileIds?: string[] },
): ClassOutcome<ClassExam> {
	if (!stores.classStore.getClass(classId)) return fail(404, "not_found", "No such class");
	try {
		return { ok: true, value: stores.classStore.updateExam(classId, examId, patch) };
	} catch (err) {
		return examFailure(err);
	}
}

export function removeClassExam(classId: string, examId: string): ClassOutcome<null> {
	if (!stores.classStore.getClass(classId)) return fail(404, "not_found", "No such class");
	if (!stores.classStore.removeExam(classId, examId)) return fail(404, "exam_not_found", `No exam "${examId}" in this class`);
	return { ok: true, value: null };
}

// ─── file list mutation (sync read-modify-write) ────────────────────────────

function mutateFiles(classId: string, fn: (files: ClassFile[]) => ClassFile[]): ClassRecord | null {
	const record = stores.classStore.getClass(classId);
	if (!record) return null;
	const next = stores.classStore.saveFiles(classId, fn(record.files));
	emit("classes-changed", {});
	return next;
}

function patchFile(classId: string, fileId: string, patch: Partial<ClassFile>): void {
	mutateFiles(classId, (files) =>
		files.map((f) => {
			if (f.id !== fileId) return f;
			const next = { ...f, ...patch };
			if (patch.error === undefined && "error" in patch) delete next.error;
			return next;
		}),
	);
}

const newFileId = () => `f_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** A filename safe to store (no folders, no control chars). */
function safeName(name: string): string {
	const base = path.basename(name.replace(/\\/g, "/")).replace(/[\u0000-\u001f]/g, "").trim();
	return base.length > 0 && base !== "." && base !== ".." ? base.slice(0, 200) : "file";
}

/** Copy a file into the class (the "Add files…" button / MCP add_class_file). */
export function addCopiedFile(classId: string, name: string, bytes: Uint8Array, kind: ClassFileKind): ClassOutcome<ClassFile> {
	if (!stores.classStore.getClass(classId)) return fail(404, "not_found", "No such class");
	const clean = safeName(name);
	if (!isSupportedClassFile(clean)) {
		return fail(400, "unsupported_type", `${clean}: unsupported file type. Supported: .md .txt .pdf .vtt .srt .mp3 .m4a .wav .mp4 .mov`);
	}
	const id = newFileId();
	const rel = `${id}/${clean}`;
	const abs = path.join(stores.classStore.filesDir(classId), rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, bytes);
	const file: ClassFile = {
		id,
		origin: "copied",
		name: clean,
		path: rel,
		kind,
		contentFp: "",
		status: "pending",
		addedAt: new Date().toISOString(),
	};
	mutateFiles(classId, (files) => [...files, file]);
	enqueueFile(classId, id);
	return { ok: true, value: file };
}

/** Copy a file from an absolute path on this computer (MCP). */
export function addFileFromPath(classId: string, absPath: string, kind: ClassFileKind): ClassOutcome<ClassFile> {
	if (!path.isAbsolute(absPath)) return fail(400, "bad_path", "Give the file's full (absolute) path");
	let stat: fs.Stats;
	try {
		stat = fs.statSync(absPath);
	} catch {
		return fail(404, "file_not_found", `No file at ${absPath}`);
	}
	if (!stat.isFile()) return fail(400, "not_a_file", `${absPath} is not a file`);
	return addCopiedFile(classId, path.basename(absPath), fs.readFileSync(absPath), kind);
}

/** Switch a file between study material and course info. Study → info
 *  removes its facts; info → study builds them. */
export function setFileKind(classId: string, fileId: string, kind: ClassFileKind): ClassOutcome<ClassFile> {
	const record = stores.classStore.getClass(classId);
	const file = record?.files.find((f) => f.id === fileId);
	if (!record || !file) return fail(404, "not_found", "No such class file");
	if (file.kind !== kind) {
		patchFile(classId, fileId, { kind, status: "pending", contentFp: "", error: undefined });
		enqueueFile(classId, fileId);
	}
	return { ok: true, value: { ...file, kind } };
}

/** Re-run a failed (or any) file. */
export function retryFile(classId: string, fileId: string): ClassOutcome<null> {
	const record = stores.classStore.getClass(classId);
	if (!record?.files.some((f) => f.id === fileId)) return fail(404, "not_found", "No such class file");
	patchFile(classId, fileId, { status: "pending", contentFp: "", error: undefined });
	enqueueFile(classId, fileId);
	return { ok: true, value: null };
}

/** Remove a file and its facts. A copied file's copy is deleted; a linked
 *  file is only forgotten (and comes back on the next scan unless removed
 *  from the folder — the API refuses that case). */
export function removeFile(classId: string, fileId: string): ClassOutcome<null> {
	const record = stores.classStore.getClass(classId);
	const file = record?.files.find((f) => f.id === fileId);
	if (!record || !file) return fail(404, "not_found", "No such class file");
	if (file.origin === "linked") {
		return fail(409, "linked_file", "This file is in your linked folder. Remove it from the folder (or switch it to course info) instead.");
	}
	if (file.sourceId && extractionStatuses().some((r) => r.chatId === file.sourceId)) {
		return fail(409, "extraction_running", "This file is being turned into facts. Try again when it finishes.");
	}
	dropFile(record, file);
	return { ok: true, value: null };
}

/** The sync removal: facts, transcript, copy, list entry. */
function dropFile(record: ClassRecord, file: ClassFile): void {
	if (file.sourceId) deleteSourceTraces(graphStoreFor(record.id), file.sourceId);
	fs.rmSync(transcriptPathOf(record.id, file.id), { force: true });
	if (file.origin === "copied") {
		fs.rmSync(path.join(stores.classStore.filesDir(record.id), file.id), { recursive: true, force: true });
	}
	mutateFiles(record.id, (files) => files.filter((f) => f.id !== file.id));
}

// ─── linked folder ──────────────────────────────────────────────────────────

export function linkFolder(classId: string, folder: string): ClassOutcome<ClassRecord> {
	const record = stores.classStore.getClass(classId);
	if (!record) return fail(404, "not_found", "No such class");
	if (!path.isAbsolute(folder)) return fail(400, "bad_path", "Give the folder's full (absolute) path");
	try {
		if (!fs.statSync(folder).isDirectory()) return fail(400, "not_a_folder", `${folder} is not a folder`);
	} catch {
		return fail(404, "folder_not_found", `No folder at ${folder}`);
	}
	const resolved = path.resolve(folder);
	if (record.linkedFolder && record.linkedFolder !== resolved) {
		const blocked = unlinkFolder(classId);
		if (!blocked.ok) return blocked;
	}
	const updated = stores.classStore.updateClass(classId, { linkedFolder: resolved });
	scanLinkedFolder(classId);
	return { ok: true, value: updated };
}

/** Unlink: the linked files leave the class, their facts with them. */
export function unlinkFolder(classId: string): ClassOutcome<ClassRecord> {
	const record = stores.classStore.getClass(classId);
	if (!record) return fail(404, "not_found", "No such class");
	const linked = record.files.filter((f) => f.origin === "linked");
	if (linked.some((f) => f.sourceId && extractionStatuses().some((r) => r.chatId === f.sourceId))) {
		return fail(409, "extraction_running", "A linked file is being turned into facts. Try again when it finishes.");
	}
	for (const file of linked) dropFile(stores.classStore.getClass(classId)!, file);
	return { ok: true, value: stores.classStore.updateClass(classId, { linkedFolder: null }) };
}

/**
 * One scan of a class's linked folder (owner rulings: new files are added
 * as study material; edited files rebuild; deleted files lose their
 * facts). Sync except for the queued processing.
 */
export function scanLinkedFolder(classId: string): void {
	const record = stores.classStore.getClass(classId);
	if (!record?.linkedFolder || record.archived) return;
	let present: string[];
	try {
		if (!fs.statSync(record.linkedFolder).isDirectory()) return;
		present = walkLinkedFolder(record.linkedFolder);
	} catch {
		return; // folder gone (unplugged drive, renamed): leave the class as is
	}
	const presentSet = new Set(present);
	const known = new Map(record.files.filter((f) => f.origin === "linked").map((f) => [f.path, f]));
	const toProcess: string[] = [];
	// Removed from the folder → facts go.
	for (const [rel, file] of known) {
		if (!presentSet.has(rel) && !(file.sourceId && extractionStatuses().some((r) => r.chatId === file.sourceId))) {
			dropFile(stores.classStore.getClass(classId)!, file);
		}
	}
	const added: ClassFile[] = [];
	for (const rel of present) {
		const file = known.get(rel);
		const abs = path.join(record.linkedFolder, rel);
		if (!file) {
			const id = newFileId();
			added.push({
				id,
				origin: "linked",
				name: path.basename(rel),
				path: rel,
				kind: "study",
				contentFp: "",
				status: "pending",
				addedAt: new Date().toISOString(),
			});
			toProcess.push(id);
			continue;
		}
		let sig: string;
		try {
			const st = fs.statSync(abs);
			sig = `${st.mtimeMs}:${st.size}`;
		} catch {
			continue;
		}
		if (file.statSig !== sig && file.status !== "extracting") toProcess.push(file.id);
	}
	if (added.length > 0) mutateFiles(classId, (files) => [...files, ...added]);
	for (const id of toProcess) enqueueFile(classId, id);
}

// ─── the file pipeline ──────────────────────────────────────────────────────

interface ClassQueuesGlobal {
	__lhClassQueues?: Map<string, Promise<void>>;
	__lhClassQueued?: Set<string>;
	__lhClassScanTimer?: ReturnType<typeof setInterval>;
}
const G = globalThis as typeof globalThis & ClassQueuesGlobal;
const queues = (G.__lhClassQueues ??= new Map());
const queued = (G.__lhClassQueued ??= new Set());
/** Classes deleted while work was queued — their queued work is skipped. */
const cancelledClasses = new Set<string>();

/** Queue one file for processing (deduped while waiting). */
export function enqueueFile(classId: string, fileId: string): void {
	const key = `${classId}:${fileId}`;
	if (queued.has(key)) return;
	queued.add(key);
	const prev = queues.get(classId) ?? Promise.resolve();
	const next = prev
		.then(async () => {
			queued.delete(key);
			if (cancelledClasses.has(classId)) return;
			await processFile(classId, fileId);
		})
		.catch((err: unknown) => console.error(`[classes] processing ${key} failed:`, err));
	queues.set(classId, next);
}

/** Resolves when every queued file of the class has been processed. */
export function classIdle(classId: string): Promise<void> {
	return queues.get(classId) ?? Promise.resolve();
}

/**
 * Bring one file's facts up to date with its current content and kind.
 *  - info: no facts (old ones removed); readable by the teacher
 *  - study, unchanged: nothing
 *  - study, new/changed: old facts removed, the new text imported
 */
async function processFile(classId: string, fileId: string): Promise<void> {
	const record = stores.classStore.getClass(classId);
	const file = record?.files.find((f) => f.id === fileId);
	if (!record || !file) return;
	const abs = classFilePath(record, file);
	if (!abs || !fs.existsSync(abs)) {
		patchFile(classId, fileId, { status: "failed", error: "The file could not be found" });
		return;
	}
	const st = fs.statSync(abs);
	const statSig = `${st.mtimeMs}:${st.size}`;
	const fp = fingerprintFile(abs);
	const store = graphStoreFor(classId);

	if (file.kind === "info") {
		if (file.sourceId) deleteSourceTraces(store, file.sourceId);
		patchFile(classId, fileId, { status: "ready", contentFp: fp, statSig, sourceId: undefined, error: undefined });
		return;
	}
	if (file.contentFp === fp && file.status === "ready" && file.sourceId) {
		if (file.statSig !== statSig) patchFile(classId, fileId, { statSig });
		return; // touched, not changed
	}
	if (!extractionEnabled(effectiveSettings().graph)) {
		patchFile(classId, fileId, { status: "pending", statSig, error: "The knowledge graph is turned off in Settings → Graph" });
		return;
	}

	patchFile(classId, fileId, { status: "extracting", statSig, error: undefined });
	let text: string;
	try {
		if (isRecordingFile(file.name)) {
			const out = transcriptPathOf(classId, fileId);
			text = await transcribeRecording(abs, out);
		} else {
			text = await fileToText(abs);
		}
	} catch (err) {
		if (err instanceof WhisperMissingError) {
			patchFile(classId, fileId, { status: "needs-whisper", contentFp: fp, error: err.message });
		} else {
			patchFile(classId, fileId, { status: "failed", contentFp: fp, error: err instanceof Error ? err.message : String(err) });
		}
		return;
	}

	// REBUILD (owner ruling: edited files rebuild automatically): the old
	// version's facts go first — shared facts survive by the deletion law.
	const sourceId = sourceIdFor(classId, fileId);
	if (stores.classStore.getClass(classId) === null) return;
	deleteSourceTraces(store, sourceId);
	try {
		await extraction.importNotes({ filePath: file.name, text, graphStore: store, sourceId });
		patchFile(classId, fileId, { status: "ready", contentFp: fp, sourceId, error: undefined });
	} catch (err) {
		const message =
			err instanceof ModelsNotConfiguredError || err instanceof ProviderNotConnectedError
				? `${err.message} Then retry this file.`
				: err instanceof NotesImportError
					? `${err.outcome}: ${err.message}`
					: err instanceof Error
						? err.message
						: String(err);
		if (stores.classStore.getClass(classId)) {
			patchFile(classId, fileId, { status: "failed", contentFp: fp, sourceId, error: message });
		}
	}
}

/** Re-check every class: linked folders rescanned, never-processed files
 *  queued (app start). */
export function scanAllClasses(): void {
	for (const summary of stores.classStore.listClasses()) {
		if (summary.archived) continue;
		const record = stores.classStore.getClass(summary.id);
		if (!record) continue;
		for (const file of record.files) {
			if (file.status === "pending" || file.status === "extracting") enqueueFile(record.id, file.id);
		}
		scanLinkedFolder(record.id);
	}
}

/** Start the 60-second linked-folder scan (once per process; never under
 *  tests). The timer is unref'd so it never holds the process open. */
export function startClassScanner(): void {
	if (process.env.NODE_ENV === "test" || G.__lhClassScanTimer) return;
	G.__lhClassScanTimer = setInterval(() => {
		try {
			for (const summary of stores.classStore.listClasses()) {
				if (!summary.archived && summary.linkedFolder) scanLinkedFolder(summary.id);
			}
		} catch (err) {
			console.error("[classes] folder scan failed:", err);
		}
	}, 60_000);
	G.__lhClassScanTimer.unref?.();
	// App start: catch up on files left pending by a previous run.
	setTimeout(() => {
		try {
			scanAllClasses();
		} catch (err) {
			console.error("[classes] startup scan failed:", err);
		}
	}, 0).unref?.();
}

// ─── moving a lesson ────────────────────────────────────────────────────────

/**
 * Move a lesson to another class (or "No class"). Its facts leave the old
 * graph (a fact another lesson or file also produced stays there) and are
 * rebuilt in the new one by re-running extraction over the whole lesson.
 * The lesson's class card is updated to the new class.
 */
export async function moveChatToClass(chatId: string, target: ClassScope): Promise<ClassOutcome<{ classId: string | null }>> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "No such lesson");
	if (target !== null) {
		const cls = stores.classStore.getClass(target);
		if (!cls) return fail(404, "class_not_found", "No such class");
	}
	const from = record.classId ?? null;
	if (from === target) return { ok: true, value: { classId: target } };
	const blocker = await quiesceChatForRewrite(chatId);
	if (blocker) return fail(blocker.status, blocker.code, blocker.error);
	// THE SYNC BLOCK: old graph → class field → card.
	deleteChatTraces(graphStoreFor(from), chatId, "delete-nodes");
	stores.chatStore.setChatClass(chatId, target);
	applyClassCard(chatId, target === null ? null : stores.classStore.getClass(target));
	// Rebuild in the new graph (teaching lessons only — practice writes
	// nothing). Fire-and-forget like the post-turn trigger.
	if (record.kind !== "practice" && extractionEnabled(effectiveSettings().graph) && process.env.NODE_ENV !== "test") {
		void extraction.runExtraction(chatId).catch((err: unknown) => console.info(`[classes] rebuild after move skipped for ${chatId}:`, err instanceof Error ? err.message : err));
	}
	return { ok: true, value: { classId: target } };
}
