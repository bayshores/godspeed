/**
 * SPACE ORCHESTRATION.
 *
 * The cross-store choreography behind every space action: the routes
 * (src/app/api/spaces/*), the MCP tools, and the folder scanner all come
 * through here.
 *
 *  - create / edit / archive / delete a space (delete takes its lessons,
 *    copied files and graph with it; a linked folder is never touched)
 *  - add, re-kind, retry, remove files; link / unlink a folder
 *  - the FILE PIPELINE: file → text (space-files.ts, transcribe.ts) → the
 *    existing notes pipeline into THE SPACE'S OWN graph. "study" files
 *    become facts; "info" files never do. Both go into the space's
 *    search index (search-index.ts).
 *    A changed file rebuilds its facts; a removed one loses them.
 *  - the linked-folder scan, every 60 s while the app runs: new files
 *    are added with their series' kind and announced, a renamed file or
 *    one already copied in keeps its facts
 *  - moving a lesson between spaces (its facts leave the old graph and
 *    are rebuilt in the new one)
 *
 * File work is serialized PER SPACE (one queue each) — the file list is a
 * read-modify-write record, and one space's imports shouldn't flood the
 * shared extraction slots.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { NotesImportError } from "../agent/subagents/extraction.ts";
import { extractionStatuses, abortExtraction } from "../agent/subagents/extraction-runs.ts";
import type { SpaceDeadline, SpaceFile, SpaceFileKind, SpaceIcon, SpaceRecord, SpaceScope, SpaceSignature, SpaceSummary, FolderProblem, FolderStatus, RemovedFile, SkippedFiles } from "../../shared/core/contracts.ts";
import { SpaceDeadlineError, compareDeadlines, DOCUMENT_EXTENSIONS, extensionOf, extractsFacts, FILE_NOT_FOUND, isRecordingFile, isTranscriptFile, parseSpaceScope, safeName, SUPPORTED_SPACE_FILE_EXTENSIONS } from "../../shared/core/contracts.ts";
import { deleteChatTraces, deleteSourceTraces } from "../../shared/core/graph-deletion.ts";
import type { DeadlineInit, DeadlinePatch } from "../../shared/core/ports.ts";
import { emit } from "../../shared/core/events.ts";
import { folderSource } from "../../shared/core/linked-folder.ts";
import { kindsForNewFiles } from "../../shared/core/new-files.ts";
import { recordingsToRecheck, transcriptFor } from "../../shared/core/lecture-transcript.ts";
import { localDay } from "../../shared/core/today-note.ts";
import { recordFolderFiles } from "./agent-actions.ts";
import { extraction } from "./extraction.ts";
import { quiesceChatForRewrite, runningWorkBlocker } from "./chats.ts";
import { fileToText, fingerprintFile, isReadableSpaceFile, looksLikeText, walkLinkedFolder } from "./space-files.ts";
import { dropSpaceFile, forgetSpaceSearch, indexSpaceFile, isFileIndexed } from "./search-index.ts";
import { discardChatDeliveries } from "./jobs.ts";
import { effectiveSettings, forgetGraphStore, graphStoreFor, stores } from "./stores.ts";
import { transcribeRecording, WhisperMissingError } from "./transcribe.ts";
import { clearTurnFailure } from "./turn-runs.ts";
import { applySpaceCard, spaceFilePath, transcriptPathOf } from "./space-card.ts";
import { cancelTopicGrouping, scheduleTopicGrouping } from "./topics.ts";
import { cancelPrepRuns } from "./prep-runs.ts";
import { writeFileAtomic } from "../store/write-file-atomic.ts";
import { removeCheatSheet } from "../store/cheat-sheets.ts";

type SpaceOutcome<T> = { ok: true; value: T } | { ok: false; status: number; code: string; error: string };

const fail = (status: number, code: string, error: string): { ok: false; status: number; code: string; error: string } => ({
	ok: false,
	status,
	code,
	error,
});

/** The extraction_running refusal for the outside agent: the file's reading is a work item
 *  waiting for that same agent, so it only finishes once the agent answers it. */
export const AGENT_FILE_READING_REFUSAL =
	"This file is still being turned into facts, and that work waits for you. Get that work item with wait_for_work (or the waiter), answer it, then try again.";

/** The space scope a request names with ?space=<id|none> (absent = No
 *  space). undefined = malformed, or a space that doesn't exist. */
export function requestSpaceScope(req: Request): SpaceScope | undefined {
	const raw = new URL(req.url).searchParams.get("space");
	const scope = parseSpaceScope(raw);
	if (scope === undefined) return undefined;
	if (scope !== null && !stores.spaceStore.getSpace(scope)) return undefined;
	return scope;
}

// ─── reads ──────────────────────────────────────────────────────────────────

export function listSpaces(): SpaceSummary[] {
	return stores.spaceStore.listSpaces();
}

export function getSpace(id: string): SpaceRecord | null {
	return stores.spaceStore.getSpace(id);
}

/** A deadline with its space (deadline ids are unique across spaces), or null. */
export function deadlineWithSpace(deadlineId: string): { spaceId: string; deadline: SpaceDeadline } | null {
	for (const record of stores.spaceStore.listSpaceRecords()) {
		const deadline = record.deadlines?.find((d) => d.id === deadlineId);
		if (deadline) return { spaceId: record.id, deadline };
	}
	return null;
}

/** PDF, Word and PowerPoint files: their text is pulled out (and saved). */
function isDocumentFile(name: string): boolean {
	return (DOCUMENT_EXTENSIONS as readonly string[]).includes(extensionOf(name));
}
/** Saved document text and recording transcripts: the text of one version
 *  of a file, named by its content fingerprint, so processing an unchanged
 *  file again skips re-reading the document or re-transcribing the
 *  recording. */
function textCacheDir(spaceId: string): string {
	return path.join(stores.spaceStore.filesDir(spaceId), "texts");
}
/** ".v2": texts saved before PDF line breaks were kept are not reused. */
function textCachePath(spaceId: string, fileId: string, fp: string): string {
	return path.join(textCacheDir(spaceId), `${fileId}.${fp}.v2.txt`);
}
function readCachedText(spaceId: string, fileId: string, fp: string): string | null {
	try {
		return fs.readFileSync(textCachePath(spaceId, fileId, fp), "utf-8");
	} catch {
		return null;
	}
}
/** Remove every saved text of one file (all versions). */
function dropCachedTexts(spaceId: string, fileId: string): void {
	let names: string[];
	try {
		names = fs.readdirSync(textCacheDir(spaceId));
	} catch {
		return;
	}
	for (const name of names) {
		if (name.startsWith(`${fileId}.`)) fs.rmSync(path.join(textCacheDir(spaceId), name), { force: true });
	}
}
/** Save one version's text, replacing older versions'. Best effort: a
 *  failed write only costs a re-read next time. */
function writeCachedText(spaceId: string, fileId: string, fp: string, text: string): void {
	try {
		dropCachedTexts(spaceId, fileId);
		writeFileAtomic(textCachePath(spaceId, fileId, fp), text);
	} catch (err) {
		console.error(`[spaces] could not save text of ${fileId}:`, err);
	}
}

/** The notes-source id a space file's facts are born under: unique per
 *  space + file, so the same filename in two spaces never collides. */
export function sourceIdFor(spaceId: string, fileId: string): string {
	return `src_${createHash("sha256").update(`${spaceId}:${fileId}`).digest("hex").slice(0, 12)}`;
}

// ─── space lifecycle ────────────────────────────────────────────────────────

export function createSpace(init: { name: string; description?: string; signature?: SpaceSignature; icon?: SpaceIcon }): SpaceRecord {
	return stores.spaceStore.createSpace(init);
}

export function updateSpace(
	id: string,
	patch: { name?: string; description?: string; archived?: boolean; signature?: SpaceSignature | null; icon?: SpaceIcon; rules?: string[] },
): SpaceOutcome<SpaceRecord> {
	if (!stores.spaceStore.getSpace(id)) return fail(404, "not_found", "No such space");
	return { ok: true, value: stores.spaceStore.updateSpace(id, patch) };
}

/** Close the summary of the teacher's last round of work on a space. */
export function closeSpaceWork(id: string): void {
	stores.spaceStore.closeWork(id);
}

/**
 * Delete a space with its lessons, copied files and graph. Refused while
 * any of its lessons has a turn or job running; extractions are aborted
 * and waited out. A linked folder on the learner's computer is untouched.
 */
export async function deleteSpace(id: string): Promise<SpaceOutcome<{ lessonIds: string[] }>> {
	const record = stores.spaceStore.getSpace(id);
	if (!record) return fail(404, "not_found", "No such space");
	const lessons = stores.chatStore.listChats().filter((c) => c.spaceId === id);
	for (const lesson of lessons) {
		const blocker = await quiesceChatForRewrite(lesson.id);
		if (blocker) return fail(blocker.status, blocker.code, `${lesson.title}: ${blocker.error}`);
	}
	// The space's file imports: abort and wait them out. Aborted again on
	// every pass, since the queue can start the next file during the wait.
	const sourceIds = new Set(record.files.map((f) => sourceIdFor(id, f.id)));
	const deadline = Date.now() + 10_000;
	while (extractionStatuses().some((run) => sourceIds.has(run.chatId))) {
		for (const sid of sourceIds) abortExtraction(sid);
		if (Date.now() > deadline) return fail(503, "extraction_winding_down", "The space's file imports are still stopping. Try again in a moment.");
		await new Promise((r) => setTimeout(r, 50));
	}
	// Lessons may have started a turn, or been created in or moved out of the space, during the
	// waits above: read them again, with no await before the sync block.
	const current = stores.chatStore.listChats().filter((c) => c.spaceId === id);
	for (const lesson of current) {
		const busy = runningWorkBlocker(lesson.id);
		if (busy) return fail(busy.status, busy.code, `${lesson.title}: ${busy.error}`);
		if (extractionStatuses().some((run) => run.chatId === lesson.id)) {
			return fail(503, "extraction_winding_down", `${lesson.title}: This lesson is still finishing its graph work. Try again in a moment.`);
		}
	}
	cancelledSpaces.add(id);
	cancelTopicGrouping(id);
	cancelPrepRuns(id);
	// THE SYNC BLOCK: lessons → space folder.
	const lessonIds: string[] = [];
	for (const lesson of current) {
		stores.jobStore.deleteJobsForChat(lesson.id);
		if (stores.chatStore.deleteChat(lesson.id)) {
			discardChatDeliveries(lesson.id);
			clearTurnFailure(lesson.id);
			lessonIds.push(lesson.id);
		}
	}
	stores.spaceStore.deleteSpace(id);
	forgetGraphStore(id);
	forgetSpaceSearch(id);
	folderScans.delete(id);
	seenFiles.delete(id);
	return { ok: true, value: { lessonIds } };
}

// ─── deadlines ──────────────────────────────────────────────────────────────
// Added by the learner (Edit space) or an outside agent from the syllabus
// (MCP add_space_deadline). The store validates; these map its refusals.

function deadlineFailure(err: unknown): { ok: false; status: number; code: string; error: string } {
	if (err instanceof SpaceDeadlineError) return fail(err.code === "deadline_not_found" ? 404 : 400, err.code, err.message);
	throw err;
}

export function listSpaceDeadlines(spaceId: string): SpaceOutcome<SpaceDeadline[]> {
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record) return fail(404, "not_found", "No such space");
	return { ok: true, value: record.deadlines ?? [] };
}

export function addSpaceDeadline(spaceId: string, deadline: DeadlineInit): SpaceOutcome<SpaceDeadline> {
	if (!stores.spaceStore.getSpace(spaceId)) return fail(404, "not_found", "No such space");
	try {
		return { ok: true, value: stores.spaceStore.addDeadline(spaceId, deadline) };
	} catch (err) {
		return deadlineFailure(err);
	}
}

export function updateSpaceDeadline(spaceId: string, deadlineId: string, patch: DeadlinePatch): SpaceOutcome<SpaceDeadline> {
	if (!stores.spaceStore.getSpace(spaceId)) return fail(404, "not_found", "No such space");
	try {
		return { ok: true, value: stores.spaceStore.updateDeadline(spaceId, deadlineId, patch) };
	} catch (err) {
		return deadlineFailure(err);
	}
}

export function removeSpaceDeadline(spaceId: string, deadlineId: string): SpaceOutcome<null> {
	if (!stores.spaceStore.getSpace(spaceId)) return fail(404, "not_found", "No such space");
	if (!stores.spaceStore.removeDeadline(spaceId, deadlineId)) return fail(404, "deadline_not_found", `No deadline "${deadlineId}" in this space`);
	removeCheatSheet(spaceId, deadlineId);
	return { ok: true, value: null };
}

/** A deadline with the space it belongs to (GET /api/deadlines). */
type OpenDeadline = SpaceDeadline & { spaceId: string; spaceName: string };

/** The deadlines `keep` picks from every space that is not archived,
 *  soonest due first. */
function deadlinesWhere(keep: (d: SpaceDeadline) => boolean): OpenDeadline[] {
	const out: OpenDeadline[] = [];
	for (const record of stores.spaceStore.listSpaceRecords()) {
		if (record.archived) continue;
		for (const d of record.deadlines ?? []) {
			if (keep(d)) out.push({ ...d, spaceId: record.id, spaceName: record.name });
		}
	}
	return out.sort((a, b) => compareDeadlines(a, b) || a.spaceName.localeCompare(b.spaceName));
}

/** Every deadline not yet done (Today). */
export function listOpenDeadlines(): OpenDeadline[] {
	return deadlinesWhere((d) => !d.done);
}

/** The deadlines ticked done on `day` (a local day, YYYY-MM-DD): Today
 *  keeps them, stamped, until the day ends. */
export function listDeadlinesDoneOn(day: string): OpenDeadline[] {
	return deadlinesWhere((d) => d.done && !!d.doneAt && localDay(new Date(d.doneAt)) === day);
}

// ─── file list mutation (sync read-modify-write) ────────────────────────────

function mutateFiles(spaceId: string, fn: (files: SpaceFile[]) => SpaceFile[], removed?: readonly RemovedFile[]): SpaceRecord | null {
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record) return null;
	let files = fn(record.files);
	const recheck = recordingsToRecheck(files);
	if (recheck.length > 0) {
		files = files.map((f) => {
			if (!recheck.includes(f.id)) return f;
			const next: SpaceFile = { ...f, status: "pending" };
			delete next.transcriptId;
			return next;
		});
	}
	const next = stores.spaceStore.saveFiles(spaceId, files, removed);
	emit("spaces-changed", {});
	for (const id of recheck) enqueueFile(spaceId, id);
	return next;
}

/** Returns the patched file as stored. */
function patchFile(spaceId: string, fileId: string, patch: Partial<SpaceFile>): SpaceFile | undefined {
	return mutateFiles(spaceId, (files) =>
		files.map((f) => {
			if (f.id !== fileId) return f;
			const next = { ...f, ...patch };
			if (patch.error === undefined && "error" in patch) delete next.error;
			return next;
		}),
	)?.files.find((f) => f.id === fileId);
}

const newFileId = () => `f_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

/** Why a file can't be copied into a space; null when it can. */
export function copiedFileProblem(name: string, bytes: Uint8Array): string | null {
	const clean = safeName(name);
	if (isReadableSpaceFile(clean, () => looksLikeText(bytes))) return null;
	return `${clean}: unsupported file type. Supported: ${SUPPORTED_SPACE_FILE_EXTENSIONS.join(" ")}, and plain text with no extension. Google Docs need saving as PDF or Word first.`;
}

/** Copy a file into the space (the "Add files…" button / MCP add_space_file). */
export function addCopiedFile(spaceId: string, name: string, bytes: Uint8Array, kind: SpaceFileKind): SpaceOutcome<SpaceFile> {
	if (!stores.spaceStore.getSpace(spaceId)) return fail(404, "not_found", "No such space");
	const clean = safeName(name);
	const problem = copiedFileProblem(name, bytes);
	if (problem) return fail(400, "unsupported_type", problem);
	const id = newFileId();
	const rel = `${id}/${clean}`;
	const abs = path.join(stores.spaceStore.filesDir(spaceId), rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, bytes);
	const file: SpaceFile = {
		id,
		origin: "copied",
		name: clean,
		path: rel,
		kind,
		contentFp: "",
		status: "pending",
		addedAt: new Date().toISOString(),
	};
	mutateFiles(spaceId, (files) => [...files, file]);
	enqueueFile(spaceId, id);
	return { ok: true, value: file };
}

/** Write new contents over a copied file, keeping its id so deadlines
 *  that cover it still do; its facts are rebuilt. */
export function replaceCopiedFile(spaceId: string, fileId: string, bytes: Uint8Array, kind: SpaceFileKind): SpaceOutcome<SpaceFile> {
	const record = stores.spaceStore.getSpace(spaceId);
	const file = record?.files.find((f) => f.id === fileId);
	if (!record || file?.origin !== "copied") return fail(404, "not_found", "No such copied space file");
	if (importRunning(spaceId, file)) return fail(409, "extraction_running", AGENT_FILE_READING_REFUSAL);
	writeFileAtomic(spaceFilePath(record, file)!, bytes);
	const patched = patchFile(spaceId, fileId, { kind, status: "pending", contentFp: "", error: undefined });
	enqueueFile(spaceId, fileId);
	return { ok: true, value: patched ?? file };
}

/** Copy a file from an absolute path on this computer (MCP). */
export function addFileFromPath(spaceId: string, absPath: string, kind: SpaceFileKind): SpaceOutcome<SpaceFile> {
	if (!path.isAbsolute(absPath)) return fail(400, "bad_path", "Give the file's full (absolute) path");
	let stat: fs.Stats;
	try {
		stat = fs.statSync(absPath);
	} catch {
		return fail(404, "file_not_found", `No file at ${absPath}`);
	}
	if (!stat.isFile()) return fail(400, "not_a_file", `${absPath} is not a file`);
	return addCopiedFile(spaceId, path.basename(absPath), fs.readFileSync(absPath), kind);
}

/** Switch a file between study material and space info, by hand: godspeed
 *  never sorts it by itself again. Study → info removes its facts; info →
 *  study builds them. */
export function setFileKind(spaceId: string, fileId: string, kind: SpaceFileKind): SpaceOutcome<SpaceFile> {
	const record = stores.spaceStore.getSpace(spaceId);
	const file = record?.files.find((f) => f.id === fileId);
	if (!record || !file) return fail(404, "not_found", "No such space file");
	const chosen = { kindChosen: true as const, sortedAsInfo: undefined };
	if (file.kind === kind) return { ok: true, value: patchFile(spaceId, fileId, chosen) ?? file };
	const patched = patchFile(spaceId, fileId, { ...chosen, kind, status: "pending", contentFp: "", transcriptId: undefined, error: undefined });
	enqueueFile(spaceId, fileId);
	return { ok: true, value: patched ?? file };
}

/** Re-run a failed (or any) file. */
export function retryFile(spaceId: string, fileId: string): SpaceOutcome<null> {
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record?.files.some((f) => f.id === fileId)) return fail(404, "not_found", "No such space file");
	patchFile(spaceId, fileId, { status: "pending", contentFp: "", error: undefined });
	enqueueFile(spaceId, fileId);
	return { ok: true, value: null };
}

/** Remove a file and its facts. A copied file's copy is deleted; a linked
 *  file is only forgotten (and comes back on the next scan unless removed
 *  from the folder — the API refuses that case). */
export function removeFile(spaceId: string, fileId: string): SpaceOutcome<null> {
	const record = stores.spaceStore.getSpace(spaceId);
	const file = record?.files.find((f) => f.id === fileId);
	if (!record || !file) return fail(404, "not_found", "No such space file");
	if (file.origin === "linked") {
		return fail(409, "linked_file", "This file is in your linked folder. Remove it from the folder (or switch it to space info) instead.");
	}
	if (importRunning(spaceId, file)) {
		return fail(409, "extraction_running", "This file is being turned into facts. Try again when it finishes.");
	}
	dropFile(record, file);
	return { ok: true, value: null };
}

/** A file's import runs under sourceIdFor, which a first import has not saved on the file yet. */
function importRunning(spaceId: string, file: SpaceFile): boolean {
	const sourceId = sourceIdFor(spaceId, file.id);
	return extractionStatuses().some((r) => r.chatId === sourceId);
}

/** A recording's transcript and a document's saved text. */
function dropFileTexts(spaceId: string, fileId: string): void {
	fs.rmSync(transcriptPathOf(spaceId, fileId), { force: true });
	dropCachedTexts(spaceId, fileId);
}

/** The sync removal: facts, transcript, copy, list entry. Facts go by
 *  sourceIdFor, so an import that never saved its id leaves nothing.
 *  `listed` puts it in the Recent changes (not when a folder is unlinked). */
function dropFile(record: SpaceRecord, file: SpaceFile, { listed = true }: { listed?: boolean } = {}): void {
	deleteSourceTraces(graphStoreFor(record.id), sourceIdFor(record.id, file.id));
	dropFileTexts(record.id, file.id);
	dropSpaceFile(record.id, file.id).catch((err: unknown) => console.error(`[spaces] could not drop ${file.id} from search:`, err));
	if (file.origin === "copied") {
		fs.rmSync(path.join(stores.spaceStore.filesDir(record.id), file.id), { recursive: true, force: true });
	}
	mutateFiles(
		record.id,
		(files) => files.filter((f) => f.id !== file.id),
		listed ? [{ id: file.id, name: file.name, at: new Date().toISOString() }] : undefined,
	);
}

// ─── linked folder ──────────────────────────────────────────────────────────

/** Errors of a folder that is there but not answering (a synced folder
 *  whose app is paused or offline), unlike one that is gone. */
const NOT_RESPONDING_CODES = new Set(["ETIMEDOUT", "EIO", "EAGAIN", "ECANCELED"]);
const notResponding = (err: unknown) => NOT_RESPONDING_CODES.has((err as NodeJS.ErrnoException | null)?.code ?? "");
const FOLDER_NOT_RESPONDING = "That folder isn't responding. If it's on Google Drive, make sure Drive is open and not paused, then try again.";

export function linkFolder(spaceId: string, folder: string): SpaceOutcome<SpaceRecord> {
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record) return fail(404, "not_found", "No such space");
	// The scan skips archived spaces, so a link here would add nothing.
	if (record.archived) return fail(409, "archived", "This space is archived. Unarchive it first, then link the folder.");
	if (!path.isAbsolute(folder)) return fail(400, "bad_path", "Give the folder's full (absolute) path");
	try {
		if (!fs.statSync(folder).isDirectory()) return fail(400, "not_a_folder", `${folder} is not a folder`);
	} catch (err) {
		if (notResponding(err)) return fail(503, "folder_not_responding", FOLDER_NOT_RESPONDING);
		return fail(404, "folder_not_found", `No folder at ${folder}`);
	}
	// Linking another folder keeps the old folder's file entries: the scan
	// drops the ones the new folder lacks, and a file at the same path with
	// the same contents keeps its facts.
	stores.spaceStore.updateSpace(spaceId, { linkedFolder: path.resolve(folder) });
	scanLinkedFolder(spaceId, { linking: true });
	return { ok: true, value: stores.spaceStore.getSpace(spaceId)! };
}

/** Unlink: the linked files leave the space, their facts with them. */
export function unlinkFolder(spaceId: string): SpaceOutcome<SpaceRecord> {
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record) return fail(404, "not_found", "No such space");
	if (!record.linkedFolder) return fail(400, "no_folder", "This space has no linked folder");
	const linked = record.files.filter((f) => f.origin === "linked");
	if (linked.some((f) => importRunning(spaceId, f))) {
		return fail(409, "extraction_running", "A linked file is being turned into facts. Try again when it finishes.");
	}
	for (const file of linked) dropFile(stores.spaceStore.getSpace(spaceId)!, file, { listed: false });
	folderScans.delete(spaceId);
	return { ok: true, value: stores.spaceStore.updateSpace(spaceId, { linkedFolder: null }) };
}

export function folderStatusOf(spaceId: string): FolderStatus {
	return folderScans.get(spaceId) ?? { problem: null, checkedAt: null, settling: 0 };
}

/** Record a scan's finding. `settling` and `skipped` are given when the
 *  scan read the folder through (it counts as checked); otherwise the last
 *  skipped files are kept. The Files page re-reads when what it shows
 *  changes. */
function setFolderStatus(spaceId: string, problem: FolderProblem | null, settling?: number, skipped?: SkippedFiles): void {
	const prev = folderStatusOf(spaceId);
	const read = settling !== undefined;
	const kept = read ? skipped : prev.skipped;
	const next: FolderStatus = {
		problem,
		checkedAt: read ? new Date().toISOString() : prev.checkedAt,
		settling: settling ?? 0,
		...(kept && kept.count > 0 ? { skipped: kept } : {}),
	};
	folderScans.set(spaceId, next);
	const changed = prev.problem !== next.problem || prev.settling !== next.settling || JSON.stringify(prev.skipped) !== JSON.stringify(next.skipped);
	if (changed) emit("spaces-changed", {});
}

/** How long a folder change must hold still before a scan acts on it: a
 *  file still being written or downloaded (a synced Drive folder) keeps
 *  changing size, and reading half a PDF would mean building it twice. */
const SETTLE_MS = 30_000;

/**
 * One scan of a space's linked folder. New files are added (with the kind
 * of the series they join, else study material), edited files rebuild and
 * deleted files lose their facts, each once the change has held still for
 * SETTLE_MS. `linking` (the folder was just picked) takes the folder as it
 * is at once and announces nothing. Sync except for the triage of new
 * files and the queued processing.
 */
export function scanLinkedFolder(spaceId: string, { linking = false }: { linking?: boolean } = {}): void {
	const running = triaging.get(spaceId);
	if (running) {
		void running
			.then(() => scanLinkedFolder(spaceId, { linking }))
			.catch((err: unknown) => console.error(`[spaces] folder scan of ${spaceId} failed:`, err));
		return;
	}
	const record = stores.spaceStore.getSpace(spaceId);
	if (!record?.linkedFolder || record.archived) return;
	const root = record.linkedFolder;
	let present: string[];
	let unreadable: string[];
	let capped: boolean;
	let skipped: SkippedFiles;
	try {
		if (!fs.statSync(root).isDirectory()) throw new Error("not a folder");
		({ files: present, unreadable, capped, skipped } = walkLinkedFolder(root));
	} catch (err) {
		// Folder gone (moved, renamed, drive unplugged) or not answering
		// (Google Drive paused or offline): its files and facts stay, and the
		// Files page says which.
		setFolderStatus(spaceId, notResponding(err) ? "not-responding" : "missing");
		return;
	}
	const linked = record.files.filter((f) => f.origin === "linked");
	// A synced folder (Google Drive starting up, signed out) can look empty
	// for a while: that is never taken as every file deleted.
	if (!linking && present.length === 0 && linked.length > 0) {
		setFolderStatus(spaceId, "empty");
		return;
	}

	const now = Date.now();
	const before = seenFiles.get(spaceId);
	const seen = new Map<string, SeenFile>();
	const settled = (rel: string, sig: string | null): boolean => {
		const last = before?.get(rel);
		const since = linking ? 0 : last && last.sig === sig ? last.since : now;
		seen.set(rel, { sig, since });
		return now - since >= SETTLE_MS;
	};

	const presentSet = new Set(present);
	const known = new Map(linked.map((f) => [f.path, f]));
	// Gone from the folder → facts go. Files in a subfolder that can't be
	// read, files that couldn't be checked, or past the file cap where the
	// walk stopped, are not known to be gone, so they stay.
	const inUnreadable = (rel: string) => unreadable.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
	const gone: SpaceFile[] = [];
	for (const [rel, file] of known) {
		if (presentSet.has(rel) || inUnreadable(rel) || importRunning(spaceId, file)) continue;
		if (capped && fs.existsSync(path.join(root, rel))) continue;
		if (settled(rel, null)) gone.push(file);
	}
	const added: SpaceFile[] = [];
	const toProcess: string[] = [];
	let settling = 0;
	for (const rel of present) {
		let sig: string;
		try {
			const st = fs.statSync(path.join(root, rel));
			sig = `${st.mtimeMs}:${st.size}`;
		} catch {
			continue;
		}
		if (!settled(rel, sig)) {
			if (!known.has(rel)) settling++;
			continue;
		}
		const file = known.get(rel);
		if (file) {
			if (file.statSig !== sig && file.status !== "extracting") toProcess.push(file.id);
			continue;
		}
		added.push({
			id: newFileId(),
			origin: "linked",
			name: path.basename(rel),
			path: rel,
			kind: "study",
			contentFp: "",
			status: "pending",
			addedAt: new Date().toISOString(),
			...(linking ? {} : { foundByScan: true as const }),
		});
	}
	seenFiles.set(spaceId, seen);
	setFolderStatus(spaceId, capped ? "too-many-files" : null, settling, skipped);
	for (const id of toProcess) enqueueFile(spaceId, id);
	if (added.length === 0) {
		dropGone(spaceId, gone, !linking);
		return;
	}
	const kinds = kindsForNewFiles(stores.spaceStore.getSpace(spaceId)?.files ?? [], added);
	for (const file of added) file.kind = kinds.get(file.id) ?? "study";
	mutateFiles(spaceId, (files) => [...files, ...added]);
	triageNewFiles(spaceId, added.map((f) => f.id), gone, !linking);
}

/**
 * New folder files, before they are read. One with the same contents as
 * a copied file, or as a folder file that just went (renamed or moved),
 * becomes that file's entry, which keeps its id, kind, facts and
 * deadlines. The rest are announced (one notice, however many) and
 * queued, and the gone files nothing matched lose their facts. Runs off
 * the file queue, which can wait a long time for the agent.
 */
function triageNewFiles(spaceId: string, addedIds: string[], gone: SpaceFile[], announce: boolean): void {
	const run = async () => {
		const unmatched = new Set(gone.map((f) => f.id));
		const fresh: SpaceFile[] = [];
		for (const id of addedIds) {
			const record = stores.spaceStore.getSpace(spaceId);
			const file = record?.files.find((f) => f.id === id);
			const abs = record && file ? spaceFilePath(record, file) : null;
			if (!record || !file || !abs) continue;
			// A covered recording is never read (on Google Drive that would download the video).
			if (transcriptFor(file, record.files)) {
				fresh.push(file);
				continue;
			}
			let fp: string;
			let statSig: string;
			try {
				const st = fs.statSync(abs);
				statSig = `${st.mtimeMs}:${st.size}`;
				fp = await fingerprintFile(abs);
			} catch {
				// Unreadable (a Drive file that is online-only while offline): the queue marks it failed, with Retry.
				fresh.push(file);
				continue;
			}
			const match = stores.spaceStore.getSpace(spaceId)?.files.find((f) => f.contentFp === fp && (f.origin === "copied" || unmatched.has(f.id)));
			if (!match) {
				fresh.push(file);
				continue;
			}
			unmatched.delete(match.id);
			mutateFiles(spaceId, (files) =>
				// A copy's kind was picked when it was added, so it stays picked.
				files
					.filter((f) => f.id !== id)
					.map((f) =>
						f.id === match.id
							? { ...f, origin: "linked" as const, name: file.name, path: file.path, statSig, ...(match.origin === "copied" ? { kindChosen: true as const } : {}) }
							: f,
					),
			);
			if (match.origin === "copied") removeCopyDir(spaceId, match.id);
		}
		dropGone(
			spaceId,
			gone.filter((file) => unmatched.has(file.id) && stores.spaceStore.getSpace(spaceId)?.files.some((f) => f.id === file.id) && !importRunning(spaceId, file)),
			announce,
		);
		const folder = stores.spaceStore.getSpace(spaceId)?.linkedFolder;
		if (announce && folder && fresh.length > 0) {
			emit("files-added", { spaceId, files: fresh.map((f) => ({ id: f.id, name: f.name, kind: f.kind })) });
			recordFolderFiles(spaceId, fresh.length, folderSource(folder));
		}
		for (const file of fresh) enqueueFile(spaceId, file.id);
	};
	const done: Promise<void> = run()
		.catch((err: unknown) => console.error(`[spaces] new files in ${spaceId}:`, err))
		.finally(() => {
			if (triaging.get(spaceId) === done) triaging.delete(spaceId);
		});
	triaging.set(spaceId, done);
}

/** Files gone from the linked folder lose their facts. Unless a folder
 *  was just linked in its place, they are listed and announced (one notice). */
function dropGone(spaceId: string, gone: readonly SpaceFile[], announce: boolean): void {
	for (const file of gone) dropFile(stores.spaceStore.getSpace(spaceId)!, file, { listed: announce });
	if (announce && gone.length > 0) emit("files-removed", { spaceId, files: gone.map((f) => ({ id: f.id, name: f.name })) });
}

/** Delete a copied file's folder, read-only files included. */
function removeCopyDir(spaceId: string, fileId: string): void {
	const dir = path.join(stores.spaceStore.filesDir(spaceId), fileId);
	try {
		for (const name of fs.readdirSync(dir)) fs.chmodSync(path.join(dir, name), 0o644);
	} catch {
		/* already gone */
	}
	fs.rmSync(dir, { recursive: true, force: true });
}

// ─── the file pipeline ──────────────────────────────────────────────────────

interface SpaceQueuesGlobal {
	__lhSpaceQueues?: Map<string, Promise<void>>;
	__lhSpaceQueued?: Set<string>;
	__lhSpaceScanTimer?: ReturnType<typeof setInterval>;
	__lhFolderScans?: Map<string, FolderStatus>;
	__lhCancelledSpaces?: Set<string>;
	__lhSeenFiles?: Map<string, Map<string, SeenFile>>;
	__lhTriaging?: Map<string, Promise<void>>;
}
const G = globalThis as typeof globalThis & SpaceQueuesGlobal;

/** How long after launch the catch-up of unfinished files waits. */
const STARTUP_SCAN_DELAY_MS = 10_000;
const queues = (G.__lhSpaceQueues ??= new Map());
const queued = (G.__lhSpaceQueued ??= new Set());
/** Each space's linked folder at its last scan (memory only:
 *  every launch rescans). */
const folderScans = (G.__lhFolderScans ??= new Map());
/** Spaces deleted while work was queued — their queued work is skipped. */
const cancelledSpaces = (G.__lhCancelledSpaces ??= new Set<string>());
/** A linked-folder path at a space's last scan: its size and time
 *  (null once gone) and since when it has held still. */
interface SeenFile {
	sig: string | null;
	since: number;
}
/** Each space's folder paths at its last scan (memory only: after a
 *  restart, changes wait one settle again). */
const seenFiles = (G.__lhSeenFiles ??= new Map());
/** Spaces whose new folder files are being triaged. */
const triaging = (G.__lhTriaging ??= new Map());

/** Queue one file for processing (deduped while waiting). */
export function enqueueFile(spaceId: string, fileId: string): void {
	const key = `${spaceId}:${fileId}`;
	if (queued.has(key)) return;
	queued.add(key);
	const prev = queues.get(spaceId) ?? Promise.resolve();
	const next = prev
		.then(async () => {
			queued.delete(key);
			if (cancelledSpaces.has(spaceId)) return;
			await processFile(spaceId, fileId);
		})
		.catch((err: unknown) => console.error(`[spaces] processing ${key} failed:`, err))
		.finally(() => {
			// The queue drained: group topics once for the whole batch of files.
			if (queues.get(spaceId) === next && !cancelledSpaces.has(spaceId)) scheduleTopicGrouping(spaceId);
		});
	queues.set(spaceId, next);
}

/** Resolves when the space's new files are triaged and every queued file
 *  processed. */
export async function spaceIdle(spaceId: string): Promise<void> {
	const triage = triaging.get(spaceId);
	if (triage) return triage.then(() => spaceIdle(spaceId));
	// Work queued while waiting (a recording a new transcript covers) counts too.
	const tail = queues.get(spaceId);
	await tail;
	if (queues.get(spaceId) !== tail) return spaceIdle(spaceId);
}

/**
 * Bring one file's facts up to date with its current content and kind.
 *  - info: no facts (old ones removed); readable by the teacher
 *  - a recording its lecture's transcript covers: no facts, never read
 *  - study, unchanged: nothing
 *  - study, new/changed: old facts removed, the new text imported
 */
async function processFile(spaceId: string, fileId: string): Promise<void> {
	const record = stores.spaceStore.getSpace(spaceId);
	const file = record?.files.find((f) => f.id === fileId);
	if (!record || !file) return;
	// First, before the file is even looked for: hashing a video on Google
	// Drive would download it, and a covered recording needs no file at all.
	const transcript = transcriptFor(file, record.files);
	if (transcript) {
		useTranscript(record, file, transcript.id);
		return;
	}
	const abs = spaceFilePath(record, file);
	if (!abs || !fs.existsSync(abs)) {
		// Forget the signature so the folder scan picks the file up again once it is back (drive re-plugged).
		patchFile(spaceId, fileId, { status: "failed", error: FILE_NOT_FOUND, statSig: undefined });
		return;
	}
	const stillThere = () => stores.spaceStore.getSpace(spaceId)?.files.some((f) => f.id === fileId) === true;
	// Saved on failure too, so the folder scan stops re-queuing an unreadable file until it changes.
	let statSig: string | undefined;
	try {
		const st = fs.statSync(abs);
		statSig = `${st.mtimeMs}:${st.size}`;
		const fp = await fingerprintFile(abs);
		const store = graphStoreFor(spaceId);

		if (file.kind === "info") {
			if (file.sourceId) deleteSourceTraces(store, file.sourceId);
			patchFile(spaceId, fileId, { status: "ready", contentFp: fp, statSig, sourceId: undefined, transcriptId: undefined, error: undefined });
			await indexForSearch(spaceId, file, abs, fp);
			return;
		}
		if (file.contentFp === fp && file.status === "ready" && file.sourceId) {
			if (file.statSig !== statSig) patchFile(spaceId, fileId, { statSig });
			return; // touched, not changed
		}
		if (!effectiveSettings().graph.enabled) {
			patchFile(spaceId, fileId, { status: "pending", statSig, error: "The knowledge graph is turned off in Settings → Graph" });
			await indexForSearch(spaceId, file, abs, fp);
			return;
		}

		patchFile(spaceId, fileId, { status: "extracting", statSig, error: undefined });
		let text: string;
		try {
			text = await fileText(spaceId, file, abs, fp);
		} catch (err) {
			if (err instanceof WhisperMissingError) {
				patchFile(spaceId, fileId, { status: "needs-whisper", contentFp: fp, error: err.message });
			} else {
				patchFile(spaceId, fileId, { status: "failed", contentFp: fp, error: err instanceof Error ? err.message : String(err) });
			}
			return;
		}
		// Removed, or its space deleted, while the text was read: undo what the read wrote back.
		if (!stillThere()) {
			if (cancelledSpaces.has(spaceId)) stores.spaceStore.deleteSpace(spaceId);
			else dropFileTexts(spaceId, fileId);
			return;
		}
		await indexForSearch(spaceId, file, abs, fp, text);

		// REBUILD: the old version's facts go first — shared facts survive by the deletion law.
		const sourceId = sourceIdFor(spaceId, fileId);
		if (!stillThere()) return;
		deleteSourceTraces(store, sourceId);
		try {
			// Only a linked file's first read sorts it, and never a lecture's
			// transcript or recording (whose sort would undo other files' work).
			const mayBeSpaceInfo =
				file.origin === "linked" && !file.kindChosen && !file.contentFp && !isTranscriptFile(file.name) && !isRecordingFile(file.name);
			const result = await extraction.importNotes({ filePath: file.name, text, graphStore: store, sourceId, mayBeSpaceInfo });
			if (result.spaceInfo) {
				deleteSourceTraces(store, sourceId);
				const now = stores.spaceStore.getSpace(spaceId)?.files.find((f) => f.id === fileId);
				if (now?.kind === "study" && !now.kindChosen) {
					// Logistics: space info, which the teacher reads but never quizzes.
					patchFile(spaceId, fileId, { kind: "info", sortedAsInfo: true, status: "ready", contentFp: fp, sourceId: undefined, error: undefined });
				} else if (now?.kind === "study") {
					// Picked as study material by hand during the read: read it again as that.
					patchFile(spaceId, fileId, { status: "pending", error: undefined });
					enqueueFile(spaceId, fileId);
				}
				// Switched to space info meanwhile: its own queued run settles it.
			} else {
				patchFile(spaceId, fileId, { status: "ready", contentFp: fp, sourceId, error: undefined });
			}
		} catch (err) {
			const message =
				err instanceof NotesImportError
						? `${err.outcome}: ${err.message}`
						: err instanceof Error
							? err.message
							: String(err);
			if (stores.spaceStore.getSpace(spaceId)) {
				patchFile(spaceId, fileId, { status: "failed", contentFp: fp, sourceId, error: message });
			}
		}
		// Removed while it was imported: the facts it merged go too.
		if (stores.spaceStore.getSpace(spaceId) && !stillThere()) deleteSourceTraces(store, sourceId);
	} catch (err) {
		// An unreadable file (or a failed graph write) shows as failed with a Retry, not stuck in progress.
		if (!stillThere()) return;
		patchFile(spaceId, fileId, { status: "failed", error: err instanceof Error ? err.message : String(err), ...(statSig ? { statSig } : {}) });
	}
}

/** A recording covered by its lecture's transcript: ready with no facts
 *  of its own (any from an earlier transcription go, so nothing is in the
 *  graph twice). Its saved transcript stays in case it is needed again. */
function useTranscript(record: SpaceRecord, file: SpaceFile, transcriptId: string): void {
	if (file.sourceId) deleteSourceTraces(graphStoreFor(record.id), file.sourceId);
	if (file.contentFp) dropSpaceFile(record.id, file.id).catch((err: unknown) => console.error(`[spaces] could not drop ${file.id} from search:`, err));
	let statSig: string | undefined;
	try {
		const st = fs.statSync(spaceFilePath(record, file)!);
		statSig = `${st.mtimeMs}:${st.size}`;
	} catch {
		/* gone since the check: the scan handles it */
	}
	patchFile(record.id, file.id, { status: "ready", contentFp: "", statSig, sourceId: undefined, transcriptId, error: undefined });
}

/** A file's text for the notes pipeline: a recording's or PDF's saved (or
 *  freshly made) text, the file itself otherwise. */
async function fileText(spaceId: string, file: SpaceFile, abs: string, fp: string): Promise<string> {
	const recording = isRecordingFile(file.name);
	if (!recording && !isDocumentFile(file.name)) return fileToText(abs);
	const cached = readCachedText(spaceId, file.id, fp);
	if (cached !== null) return cached;
	const text = recording ? await transcribeRecording(abs, transcriptPathOf(spaceId, file.id)) : await fileToText(abs);
	// Removed, or its space deleted, during the read: saving would bring its folder back.
	if (stores.spaceStore.getSpace(spaceId)?.files.some((f) => f.id === file.id)) writeCachedText(spaceId, file.id, fp, text);
	return text;
}

/**
 * Put this version of a file (study or info) in the space's search index.
 * `text` is the pipeline's text when it was already read. Captions are
 * indexed from the raw file (search keeps their times); a recording only
 * once its transcript exists (never transcribed for search alone). Best
 * effort: a failure is logged and the file goes on. Not under tests (no
 * model there).
 */
async function indexForSearch(spaceId: string, file: SpaceFile, abs: string, fp: string, text?: string): Promise<void> {
	if (process.env.NODE_ENV === "test" || isFileIndexed(spaceId, file.id, fp)) return;
	try {
		let source = text;
		if (isTranscriptFile(file.name)) {
			source = fs.readFileSync(abs, "utf-8");
		} else if (source === undefined && isRecordingFile(file.name)) {
			const transcript = transcriptPathOf(spaceId, file.id);
			if (!fs.existsSync(transcript)) return;
			source = fs.readFileSync(transcript, "utf-8");
		}
		await indexSpaceFile(spaceId, file, fp, source ?? (await fileText(spaceId, file, abs, fp)));
	} catch (err) {
		console.error(`[spaces] could not index ${file.name} for search:`, err);
	}
}

/** Index every processed file the search index lacks (spaces from before
 *  search, a failed index), one file at a time in the background. */
async function indexUnindexedFiles(): Promise<void> {
	for (const summary of stores.spaceStore.listSpaces()) {
		const record = summary.archived ? null : stores.spaceStore.getSpace(summary.id);
		for (const file of record?.files ?? []) {
			if ((file.status !== "ready" && file.status !== "failed") || !file.contentFp) continue;
			const abs = spaceFilePath(record!, file);
			if (abs && fs.existsSync(abs)) await indexForSearch(summary.id, file, abs, file.contentFp);
		}
	}
}

/** Queue every file left waiting or unfinished (app start, the graph
 *  turned back on). */
export function queueWaitingFiles(): void {
	for (const record of stores.spaceStore.listSpaceRecords()) {
		if (record.archived) continue;
		for (const file of record.files) {
			if (file.status === "pending" || file.status === "extracting") enqueueFile(record.id, file.id);
		}
	}
}

/** Re-check every space: waiting files queued, linked folders rescanned
 *  (app start). */
function scanAllSpaces(): void {
	queueWaitingFiles();
	for (const record of stores.spaceStore.listSpaceRecords()) {
		if (!record.archived) scanLinkedFolder(record.id);
	}
}

/** Start the 60-second linked-folder scan (once per process; never under
 *  tests). The timer is unref'd so it never holds the process open. */
export function startSpaceScanner(): void {
	if (process.env.NODE_ENV === "test" || G.__lhSpaceScanTimer) return;
	G.__lhSpaceScanTimer = setInterval(() => {
		try {
			for (const summary of stores.spaceStore.listSpaces()) {
				if (!summary.archived && summary.linkedFolder) scanLinkedFolder(summary.id);
			}
		} catch (err) {
			console.error("[spaces] folder scan failed:", err);
		}
	}, 60_000);
	G.__lhSpaceScanTimer.unref?.();
	// App start: catch up on files left pending by a previous run — 10 s
	// later, so it never competes with the window's first load.
	setTimeout(() => {
		try {
			scanAllSpaces();
		} catch (err) {
			console.error("[spaces] startup scan failed:", err);
		}
		void indexUnindexedFiles().catch((err: unknown) => console.error("[spaces] search catch-up failed:", err));
	}, STARTUP_SCAN_DELAY_MS).unref?.();
}

// ─── moving a lesson ────────────────────────────────────────────────────────

/**
 * Move a lesson to another space (or "No space"). Its facts leave the old
 * graph (a fact another lesson or file also produced stays there) and are
 * rebuilt in the new one by re-running extraction over the whole lesson.
 * The lesson's space card is updated to the new space.
 */
export async function moveChatToSpace(chatId: string, target: SpaceScope): Promise<SpaceOutcome<{ spaceId: string | null }>> {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return fail(404, "not_found", "No such lesson");
	if (target !== null) {
		const space = stores.spaceStore.getSpace(target);
		if (!space) return fail(404, "space_not_found", "No such space");
	}
	const from = record.spaceId ?? null;
	if (from === target) return { ok: true, value: { spaceId: target } };
	const blocker = await quiesceChatForRewrite(chatId);
	if (blocker) return fail(blocker.status, blocker.code, blocker.error);
	// THE SYNC BLOCK: old graph → space field → card.
	deleteChatTraces(graphStoreFor(from), chatId, "delete-nodes");
	stores.chatStore.setChatSpace(chatId, target);
	applySpaceCard(chatId, target === null ? null : stores.spaceStore.getSpace(target));
	// Rebuild in the new graph (practice writes nothing). Fire-and-forget
	// like the post-turn trigger.
	if (extractsFacts(record.kind) && effectiveSettings().graph.enabled && process.env.NODE_ENV !== "test") {
		void extraction.runExtraction(chatId).catch((err: unknown) => console.info(`[spaces] rebuild after move skipped for ${chatId}:`, err instanceof Error ? err.message : err));
	}
	return { ok: true, value: { spaceId: target } };
}
