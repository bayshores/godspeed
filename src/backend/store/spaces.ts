/**
 * SpaceStore — the fs adapter for spaces.
 *
 *   data/spaces/<id>/space.json   the SpaceRecord (class.json before the
 *                                  rename; read until the next write)
 *   data/spaces/<id>/files/       copied space files (the app's own copies)
 *   data/spaces/<id>/graph/       the space's own graph family
 *                                  (src/backend/store/graph.ts createGraphStore)
 *
 * Same idioms as src/backend/store/chats.ts: sync fs, id-guarded paths, tab-indented
 * JSON, a lazy version stamp with honest refusal of newer records. Wired in
 * the composition root (src/backend/server/stores.ts) only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../config.ts";
import { emit } from "../../shared/core/events.ts";
import { isRecentChange } from "../../shared/core/new-files.ts";
import { isFirstRound, isWaitingFile, workAfterDeadline, workAfterFiles } from "../../shared/core/space-work.ts";
import { sanitizeRules } from "../../shared/core/teaching-areas.ts";
import type { SpacePatch, SpaceStore, DeadlineInit, DeadlinePatch } from "../../shared/core/ports.ts";
import type { SpaceColor, SpaceDeadline, SpaceFile, SpaceIcon, SpaceNote, SpaceRecord, SpaceSignature, SpaceSummary, SpaceWork, DeadlineKind, HomeworkProblem, RemovedFile } from "../../shared/core/contracts.ts";
import {
	SpaceDeadlineError,
	cleanSignature,
	compareDeadlines,
	CURRENT_SPACE_VERSION,
	isCalendarDate,
	isSpaceColor,
	isSpaceIcon,
	isSpaceId,
	isClockTime,
	isDeadlineKind,
	MAX_HOMEWORK_PROBLEMS,
	nextSpaceColor,
} from "../../shared/core/contracts.ts";
import { isRecord, isString } from "./guards.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

function spaceDir(id: string): string {
	if (!isSpaceId(id)) throw new Error(`Invalid space id: ${id}`);
	return path.join(PATHS.spaces, id);
}

function recordFile(id: string): string {
	return path.join(spaceDir(id), "space.json");
}

/** The record under the name it had before spaces were called spaces. */
function oldRecordFile(id: string): string {
	return path.join(spaceDir(id), "class.json");
}

/** Spaces were kept in data/classes before the rename. Tried at every start:
 *  the folder moves in one step, or, when data/spaces is already there (a
 *  move that failed, or a space made first), entry by entry. An entry both
 *  folders have stays where it is, so nothing is overwritten. */
function adoptOldFolder(): void {
	const old = path.join(PATHS.data, "classes");
	if (!fs.existsSync(old)) return;
	try {
		if (!fs.existsSync(PATHS.spaces)) {
			fs.renameSync(old, PATHS.spaces);
			return;
		}
		let stayed = 0;
		for (const name of fs.readdirSync(old)) {
			const from = path.join(old, name);
			const to = path.join(PATHS.spaces, name);
			try {
				if (!fs.lstatSync(to, { throwIfNoEntry: false })) fs.renameSync(from, to);
				// Finder's file on both sides would keep data/classes for good.
				else if (name === ".DS_Store" && fs.lstatSync(from).isFile()) fs.unlinkSync(from);
				else stayed++;
			} catch {
				stayed++;
			}
		}
		if (stayed > 0) console.error(`[spaces] ${stayed} entries stayed in data/classes: data/spaces has the same names or they could not move`);
		else fs.rmdirSync(old);
	} catch (err) {
		console.error("[spaces] moving data/classes to data/spaces failed:", err);
	}
}
adoptOldFolder();

function readRecordText(id: string): string {
	try {
		return fs.readFileSync(recordFile(id), "utf-8");
	} catch {
		return fs.readFileSync(oldRecordFile(id), "utf-8");
	}
}

/** THE WRITE CHOKE POINT: every persist stamps the current version and goes
 *  through a temp file + rename (a torn write never replaces the record). */
function writeSpace(record: SpaceRecord): void {
	writeFileAtomic(recordFile(record.id), JSON.stringify({ ...record, version: CURRENT_SPACE_VERSION }, null, "\t"));
	fs.rmSync(oldRecordFile(record.id), { force: true });
}

const isSpaceFile = (v: unknown): v is SpaceFile =>
	isRecord(v) &&
	isString(v.id) &&
	(v.origin === "copied" || v.origin === "linked") &&
	isString(v.name) &&
	isString(v.path) &&
	(v.kind === "study" || v.kind === "info") &&
	isString(v.contentFp) &&
	isString(v.status) &&
	isString(v.addedAt);

/** A v3 deadline as saved. */
const isSpaceDeadline = (v: unknown): v is SpaceDeadline =>
	isRecord(v) &&
	isString(v.id) &&
	isDeadlineKind(v.kind) &&
	isString(v.name) &&
	isString(v.date) &&
	(v.time === undefined || isString(v.time)) &&
	Array.isArray(v.fileIds) &&
	v.fileIds.every(isString) &&
	typeof v.done === "boolean";

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isString);

const isHomeworkProblem = (v: unknown): v is HomeworkProblem =>
	isRecord(v) && isString(v.number) && isString(v.title) && isString(v.text) && (v.page === undefined || typeof v.page === "number") && typeof v.done === "boolean";

const cleanProblem = (p: HomeworkProblem): HomeworkProblem => ({
	number: p.number,
	title: p.title,
	text: p.text,
	...(p.page !== undefined ? { page: p.page } : {}),
	done: p.done,
});

/** A v2 exam as saved (read as a deadline of kind "exam"). */
const isLegacyExam = (v: unknown): v is { id: string; name: string; date: string; fileIds: string[] } =>
	isRecord(v) && isString(v.id) && isString(v.name) && isString(v.date) && Array.isArray(v.fileIds) && v.fileIds.every(isString);

/** The record's deadlines: v3 `deadlines`, or an older record's `exams`
 *  upgraded (kind "exam", not done, same id). Undefined when it has none. */
function readDeadlines(parsed: Record<string, unknown>): SpaceDeadline[] | undefined {
	if (Array.isArray(parsed.deadlines)) {
		return parsed.deadlines.filter(isSpaceDeadline).map((d) => ({
			id: d.id,
			kind: d.kind,
			name: d.name,
			date: d.date,
			...(d.time !== undefined ? { time: d.time } : {}),
			fileIds: d.fileIds,
			...(isIdList(d.leftOutIds) && d.leftOutIds.length > 0 ? { leftOutIds: d.leftOutIds } : {}),
			...(isString(d.source) && d.source ? { source: d.source } : {}),
			...(isString(d.assignmentFileId) ? { assignmentFileId: d.assignmentFileId } : {}),
			...(Array.isArray(d.problems) && d.problems.some(isHomeworkProblem) ? { problems: d.problems.filter(isHomeworkProblem).map(cleanProblem) } : {}),
			done: d.done,
			...(d.done && isString(d.doneAt) ? { doneAt: d.doneAt } : {}),
		}));
	}
	if (Array.isArray(parsed.exams)) {
		return parsed.exams
			.filter(isLegacyExam)
			.map((e) => ({ id: e.id, kind: "exam" as const, name: e.name, date: e.date, fileIds: e.fileIds, done: false }));
	}
	return undefined;
}

const isRemovedFile = (v: unknown): v is RemovedFile => isRecord(v) && isString(v.id) && isString(v.name) && isString(v.at);

/** Removed files still in the Recent changes window (older ones drop out
 *  here; the next write persists that). */
function recentRemoved(list: readonly RemovedFile[], now: number): RemovedFile[] {
	return list.filter((r) => isRecentChange(r.at, now)).map((r) => ({ id: r.id, name: r.name, at: r.at }));
}

const isSpaceNote = (v: unknown): v is SpaceNote => isRecord(v) && isString(v.text) && isString(v.at);

function readWork(v: unknown): SpaceWork | undefined {
	if (!isRecord(v) || !isString(v.startedAt) || !isIdList(v.fileIds) || !isIdList(v.deadlineIds)) return undefined;
	return { startedAt: v.startedAt, ...(isString(v.endedAt) ? { endedAt: v.endedAt } : {}), fileIds: v.fileIds, deadlineIds: v.deadlineIds };
}

/** The colors the other spaces wear, read straight from their records. */
function colorsBeside(id: string): SpaceColor[] {
	let entries: string[];
	try {
		entries = fs.readdirSync(PATHS.spaces);
	} catch {
		return [];
	}
	return entries.flatMap((name) => {
		if (name === id || !isSpaceId(name)) return [];
		try {
			const other: unknown = JSON.parse(readRecordText(name));
			return isRecord(other) && isSpaceColor(other.color) ? [other.color] : [];
		} catch {
			return [];
		}
	});
}

function getSpace(id: string): SpaceRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readRecordText(id));
	} catch (err) {
		if (err instanceof SyntaxError) console.error(`[space ${id}] its record is not valid JSON; skipping the space`);
		return null;
	}
	if (!isRecord(parsed)) return null;
	// Honest refusal, as in chats.ts: a newer record reads as absent so a
	// later write never rewrites what this build doesn't understand.
	if (typeof parsed.version === "number" && parsed.version > CURRENT_SPACE_VERSION) {
		console.error(`[space ${id}] record stamped with schema version ${parsed.version} > ${CURRENT_SPACE_VERSION} — refusing to read it`);
		return null;
	}
	if (!isString(parsed.id) || !isString(parsed.name) || !isString(parsed.createdAt) || !isString(parsed.updatedAt)) return null;
	const files = Array.isArray(parsed.files) ? parsed.files.filter(isSpaceFile) : [];
	const removedFiles = Array.isArray(parsed.removedFiles) ? recentRemoved(parsed.removedFiles.filter(isRemovedFile), Date.now()) : [];
	// A removed file drops out of every deadline that covered it (read-side —
	// the next write persists the cleaned list).
	const fileIds = new Set(files.map((f) => f.id));
	const deadlines = readDeadlines(parsed);
	const signature = isRecord(parsed.signature) ? cleanSignature(parsed.signature) : null;
	const rules = sanitizeRules(parsed.rules);
	const colored = isSpaceColor(parsed.color);
	const lastWork = readWork(parsed.lastWork);
	const record: SpaceRecord = {
		id: parsed.id,
		name: parsed.name,
		description: isString(parsed.description) ? parsed.description : "",
		createdAt: parsed.createdAt,
		updatedAt: parsed.updatedAt,
		archived: parsed.archived === true,
		...(isString(parsed.linkedFolder) ? { linkedFolder: parsed.linkedFolder } : {}),
		files,
		...(removedFiles.length ? { removedFiles } : {}),
		...(deadlines ? { deadlines: deadlines.map((d) => withFiles(knownAssignment(d, fileIds), d.fileIds.filter((f) => fileIds.has(f)), d.leftOutIds?.filter((f) => fileIds.has(f)))).sort(compareDeadlines) } : {}),
		...(signature ? { signature } : {}),
		...(isSpaceIcon(parsed.icon) ? { icon: parsed.icon } : {}),
		color: colored ? (parsed.color as SpaceColor) : nextSpaceColor(colorsBeside(id)),
		...(isSpaceNote(parsed.note) ? { note: { text: parsed.note.text, at: parsed.note.at } } : {}),
		...(rules.length ? { rules } : {}),
		...(lastWork ? { lastWork } : {}),
		...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
	};
	// A space from before colors keeps the one it is given here.
	if (!colored) {
		writeSpace(record);
		record.version = CURRENT_SPACE_VERSION;
	}
	return record;
}

function summarize(record: SpaceRecord): SpaceSummary {
	const newest = (pick: (f: SpaceFile) => boolean) => record.files.reduce<string | undefined>((at, f) => (pick(f) && (!at || f.addedAt > at) ? f.addedAt : at), undefined);
	const lastFoundAt = newest((f) => f.foundByScan === true);
	const lastFolderFileAt = newest((f) => f.origin === "linked");
	const filesLeft = record.files.filter(isWaitingFile).length;
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		archived: record.archived,
		...(record.linkedFolder ? { linkedFolder: record.linkedFolder } : {}),
		fileCount: record.files.length,
		...(lastFoundAt ? { lastFoundAt } : {}),
		...(lastFolderFileAt ? { lastFolderFileAt } : {}),
		...(record.signature ? { signature: record.signature } : {}),
		...(record.icon ? { icon: record.icon } : {}),
		color: record.color,
		...(record.note ? { note: record.note } : {}),
		filesLeft,
		...(filesLeft > 0 && isFirstRound(record.files, record.lastWork) ? { building: true as const } : {}),
	};
}

function cleanName(name: string): string {
	return name.trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled space";
}

function createSpace(init: { name: string; description?: string; signature?: SpaceSignature; icon?: SpaceIcon }): SpaceRecord {
	const now = new Date().toISOString();
	const id = `spc_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
	const record: SpaceRecord = {
		id,
		name: cleanName(init.name),
		description: (init.description ?? "").trim(),
		createdAt: now,
		updatedAt: now,
		archived: false,
		files: [],
		...(init.signature ? { signature: init.signature } : {}),
		...(init.icon ? { icon: init.icon } : {}),
		color: nextSpaceColor(colorsBeside(id)),
	};
	writeSpace(record);
	emit("spaces-changed", {});
	return { ...record, version: CURRENT_SPACE_VERSION };
}

function listSpaceRecords(): SpaceRecord[] {
	let entries: string[];
	try {
		entries = fs.readdirSync(PATHS.spaces);
	} catch {
		return [];
	}
	return entries
		.filter((name) => isSpaceId(name))
		.map((name) => getSpace(name))
		.filter((r): r is SpaceRecord => r !== null)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function listSpaces(): SpaceSummary[] {
	return listSpaceRecords().map(summarize);
}

function updateSpace(id: string, patch: SpacePatch): SpaceRecord {
	const record = getSpace(id);
	if (!record) throw new Error(`Space not found: ${id}`);
	if (patch.name !== undefined) record.name = cleanName(patch.name);
	if (patch.description !== undefined) record.description = patch.description.trim();
	if (patch.archived !== undefined) record.archived = patch.archived;
	if (patch.rules !== undefined) {
		const rules = sanitizeRules(patch.rules);
		if (rules.length) record.rules = rules;
		else delete record.rules;
	}
	if (patch.linkedFolder !== undefined) {
		if (patch.linkedFolder === null) delete record.linkedFolder;
		else record.linkedFolder = patch.linkedFolder;
	}
	if (patch.signature !== undefined) {
		if (patch.signature === null) delete record.signature;
		else record.signature = patch.signature;
	}
	if (patch.icon !== undefined) record.icon = patch.icon;
	if (patch.color !== undefined) record.color = patch.color;
	if (patch.note !== undefined) record.note = patch.note;
	// A new note alone doesn't count as an edit: the space list is ordered
	// by updatedAt and shouldn't reshuffle after every lesson.
	const edited = Object.entries(patch).some(([k, v]) => k !== "note" && v !== undefined);
	if (edited) record.updatedAt = new Date().toISOString();
	writeSpace(record);
	emit("spaces-changed", {});
	return record;
}

function saveFiles(id: string, files: SpaceFile[], removed: readonly RemovedFile[] = []): SpaceRecord {
	const record = getSpace(id);
	if (!record) throw new Error(`Space not found: ${id}`);
	setWork(record, workAfterFiles(record.lastWork, record.files, files, new Date().toISOString()));
	record.files = files;
	if (removed.length) record.removedFiles = [...(record.removedFiles ?? []), ...removed];
	writeSpace(record);
	return record;
}

function setWork(record: SpaceRecord, work: SpaceWork | undefined): void {
	if (work) record.lastWork = work;
	else delete record.lastWork;
}

function closeWork(id: string): boolean {
	const record = getSpace(id);
	if (!record?.lastWork?.endedAt) return false;
	delete record.lastWork;
	writeSpace(record);
	emit("spaces-changed", {});
	return true;
}

// ─── deadlines ──────────────────────────────────────────────────────────────

function deadlineName(name: unknown): string {
	const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, 120) : "";
	if (!clean) throw new SpaceDeadlineError("bad_name", "A deadline needs a name");
	return clean;
}

function deadlineKind(kind: unknown): DeadlineKind {
	if (!isDeadlineKind(kind)) throw new SpaceDeadlineError("bad_kind", `The kind must be exam, homework, quiz or project (got ${JSON.stringify(kind)})`);
	return kind;
}

function deadlineDate(date: unknown): string {
	if (!isCalendarDate(date)) throw new SpaceDeadlineError("bad_date", `The date must be a calendar date written YYYY-MM-DD (got ${JSON.stringify(date)})`);
	return date;
}

function deadlineTime(time: unknown): string {
	if (!isClockTime(time)) throw new SpaceDeadlineError("bad_time", `The time must be a 24-hour time written HH:MM (got ${JSON.stringify(time)})`);
	return time;
}

function deadlineFiles(record: SpaceRecord, fileIds: unknown): string[] {
	if (!Array.isArray(fileIds) || !fileIds.every(isString)) throw new SpaceDeadlineError("unknown_file", "file ids must be a list of space file ids");
	const known = new Set(record.files.map((f) => f.id));
	const unknown = fileIds.filter((f) => !known.has(f));
	if (unknown.length > 0) throw new SpaceDeadlineError("unknown_file", `Not files of this space: ${unknown.join(", ")}`);
	return [...new Set(fileIds)];
}

function deadlineSource(source: unknown): string | undefined {
	if (typeof source !== "string") throw new SpaceDeadlineError("bad_source", "The source must be text");
	return source.trim().replace(/\s+/g, " ").slice(0, 300) || undefined;
}

/** The deadline without its assignment file once that file is gone. */
function knownAssignment(d: SpaceDeadline, fileIds: ReadonlySet<string>): SpaceDeadline {
	if (d.assignmentFileId === undefined || fileIds.has(d.assignmentFileId)) return d;
	const { assignmentFileId: _gone, ...rest } = d;
	return rest;
}

function deadlineAssignment(record: SpaceRecord, fileId: unknown): string {
	if (!isString(fileId) || !record.files.some((f) => f.id === fileId)) throw new SpaceDeadlineError("unknown_file", `Not a file of this space: ${JSON.stringify(fileId)}`);
	return fileId;
}

/** A problem list as the store keeps it: numbers unique, text trimmed. */
function deadlineProblems(problems: unknown): HomeworkProblem[] {
	if (!Array.isArray(problems) || problems.length > MAX_HOMEWORK_PROBLEMS) throw new SpaceDeadlineError("bad_problems", `The problems must be a list of at most ${MAX_HOMEWORK_PROBLEMS}`);
	const seen = new Set<string>();
	return problems.map((p, i) => {
		if (!isRecord(p)) throw new SpaceDeadlineError("bad_problems", `Problem ${i + 1} is not an object`);
		const number = isString(p.number) ? p.number.trim().slice(0, 20) : "";
		const title = isString(p.title) ? p.title.trim().replace(/\s+/g, " ").slice(0, 120) : "";
		const text = isString(p.text) ? p.text.trim().slice(0, 8000) : "";
		if (!number || !text) throw new SpaceDeadlineError("bad_problems", `Problem ${i + 1} needs a number and its text`);
		if (seen.has(number)) throw new SpaceDeadlineError("bad_problems", `Two problems are numbered ${number}`);
		seen.add(number);
		const page = typeof p.page === "number" && Number.isInteger(p.page) && p.page > 0 ? p.page : undefined;
		return { number, title: title || number, text, ...(page !== undefined ? { page } : {}), done: p.done === true };
	});
}

/** The deadline with these covered and left-out files; a file is never both
 *  (`leftOutWins` says which list was just set). */
function withFiles(d: SpaceDeadline, fileIds: string[], leftOutIds: string[] | undefined, leftOutWins = false): SpaceDeadline {
	const out = new Set(leftOutIds ?? []);
	const covered = leftOutWins ? fileIds.filter((f) => !out.has(f)) : fileIds;
	const left = (leftOutIds ?? []).filter((f) => leftOutWins || !covered.includes(f));
	const { leftOutIds: _old, ...rest } = d;
	return { ...rest, fileIds: covered, ...(left.length > 0 ? { leftOutIds: left } : {}) };
}

function requireSpace(id: string): SpaceRecord {
	const record = getSpace(id);
	if (!record) throw new Error(`Space not found: ${id}`);
	return record;
}

function saveDeadlines(record: SpaceRecord, deadlines: SpaceDeadline[]): void {
	record.deadlines = [...deadlines].sort(compareDeadlines);
	record.updatedAt = new Date().toISOString();
	writeSpace(record);
	emit("spaces-changed", {});
}

function addDeadline(id: string, init: DeadlineInit): SpaceDeadline {
	const record = requireSpace(id);
	const time = init.time !== undefined ? deadlineTime(init.time) : undefined;
	const source = init.source !== undefined ? deadlineSource(init.source) : undefined;
	const assignmentFileId = init.assignmentFileId !== undefined ? deadlineAssignment(record, init.assignmentFileId) : undefined;
	const base: SpaceDeadline = {
		id: `ddl_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
		kind: deadlineKind(init.kind),
		name: deadlineName(init.name),
		date: deadlineDate(init.date),
		...(time !== undefined ? { time } : {}),
		fileIds: [],
		...(source !== undefined ? { source } : {}),
		...(assignmentFileId !== undefined ? { assignmentFileId } : {}),
		done: false,
	};
	const deadline = withFiles(base, deadlineFiles(record, init.fileIds ?? []), init.leftOutIds !== undefined ? deadlineFiles(record, init.leftOutIds) : undefined);
	setWork(record, workAfterDeadline(record.lastWork, deadline.id));
	saveDeadlines(record, [...(record.deadlines ?? []), deadline]);
	return deadline;
}

function updateDeadline(id: string, deadlineId: string, patch: DeadlinePatch): SpaceDeadline {
	const record = requireSpace(id);
	const prev = record.deadlines?.find((d) => d.id === deadlineId);
	if (!prev) throw new SpaceDeadlineError("deadline_not_found", `No deadline "${deadlineId}" in this space`);
	const time = patch.time === undefined ? prev.time : patch.time === null ? undefined : deadlineTime(patch.time);
	const source = patch.source === undefined ? prev.source : patch.source === null ? undefined : deadlineSource(patch.source);
	const assignmentFileId =
		patch.assignmentFileId === undefined ? prev.assignmentFileId : patch.assignmentFileId === null ? undefined : deadlineAssignment(record, patch.assignmentFileId);
	const problems = patch.problems !== undefined ? deadlineProblems(patch.problems) : prev.problems;
	const done = patch.done ?? prev.done;
	// Ticking stamps the time; unticking clears it; leaving it alone keeps it.
	const doneAt = !done ? undefined : patch.done === true && !prev.done ? new Date().toISOString() : prev.doneAt;
	const base: SpaceDeadline = {
		id: prev.id,
		kind: patch.kind !== undefined ? deadlineKind(patch.kind) : prev.kind,
		name: patch.name !== undefined ? deadlineName(patch.name) : prev.name,
		date: patch.date !== undefined ? deadlineDate(patch.date) : prev.date,
		...(time !== undefined ? { time } : {}),
		fileIds: [],
		...(source !== undefined ? { source } : {}),
		...(assignmentFileId !== undefined ? { assignmentFileId } : {}),
		...(problems !== undefined && problems.length > 0 ? { problems } : {}),
		done,
		...(doneAt !== undefined ? { doneAt } : {}),
	};
	const next = withFiles(
		base,
		patch.fileIds !== undefined ? deadlineFiles(record, patch.fileIds) : prev.fileIds,
		patch.leftOutIds !== undefined ? deadlineFiles(record, patch.leftOutIds) : prev.leftOutIds,
		patch.leftOutIds !== undefined && patch.fileIds === undefined,
	);
	saveDeadlines(record, (record.deadlines ?? []).map((d) => (d.id === deadlineId ? next : d)));
	return next;
}

function removeDeadline(id: string, deadlineId: string): boolean {
	const record = requireSpace(id);
	if (!record.deadlines?.some((d) => d.id === deadlineId)) return false;
	saveDeadlines(record, record.deadlines.filter((d) => d.id !== deadlineId));
	return true;
}

function deleteSpace(id: string): boolean {
	const dir = spaceDir(id);
	if (!fs.existsSync(dir)) return false;
	fs.rmSync(dir, { recursive: true, force: true });
	emit("spaces-changed", {});
	return true;
}

export const spaceStore: SpaceStore = {
	createSpace,
	getSpace,
	listSpaceRecords,
	listSpaces,
	updateSpace,
	saveFiles,
	closeWork,
	addDeadline,
	updateDeadline,
	removeDeadline,
	deleteSpace,
	filesDir: (id) => path.join(spaceDir(id), "files"),
	graphDir: (id) => path.join(spaceDir(id), "graph"),
};
