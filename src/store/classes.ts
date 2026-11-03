/**
 * ClassStore — the fs adapter for classes.
 *
 *   data/classes/<id>/class.json   the ClassRecord
 *   data/classes/<id>/files/       copied class files (the app's own copies)
 *   data/classes/<id>/graph/       the class's own graph family
 *                                  (src/store/graph.ts createGraphStore)
 *
 * Same idioms as src/store/chats.ts: sync fs, id-guarded paths, tab-indented
 * JSON, a lazy version stamp with honest refusal of newer records. Wired in
 * the composition root (src/server/stores.ts) only.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../config.ts";
import { emit } from "../core/events.ts";
import { sanitizeRules } from "../core/teaching-areas.ts";
import type { ClassPatch, ClassStore, DeadlineInit, DeadlinePatch } from "../core/ports.ts";
import type { ClassDeadline, ClassFile, ClassIcon, ClassNote, ClassRecord, ClassSignature, ClassSummary, DeadlineKind } from "../core/contracts.ts";
import {
	ClassDeadlineError,
	cleanSignature,
	compareDeadlines,
	CURRENT_CLASS_VERSION,
	isCalendarDate,
	isClassIcon,
	isClassId,
	isClockTime,
	isDeadlineKind,
} from "../core/contracts.ts";
import { isRecord, isString } from "./guards.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

function classDir(id: string): string {
	if (!isClassId(id)) throw new Error(`Invalid class id: ${id}`);
	return path.join(PATHS.classes, id);
}

function recordFile(id: string): string {
	return path.join(classDir(id), "class.json");
}

/** THE WRITE CHOKE POINT: every persist stamps the current version and goes
 *  through a temp file + rename (a torn write never replaces the record). */
function writeClass(record: ClassRecord): void {
	writeFileAtomic(recordFile(record.id), JSON.stringify({ ...record, version: CURRENT_CLASS_VERSION }, null, "\t"));
}

const isClassFile = (v: unknown): v is ClassFile =>
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
const isClassDeadline = (v: unknown): v is ClassDeadline =>
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

/** A v2 exam as saved (read as a deadline of kind "exam"). */
const isLegacyExam = (v: unknown): v is { id: string; name: string; date: string; fileIds: string[] } =>
	isRecord(v) && isString(v.id) && isString(v.name) && isString(v.date) && Array.isArray(v.fileIds) && v.fileIds.every(isString);

/** The record's deadlines: v3 `deadlines`, or an older record's `exams`
 *  upgraded (kind "exam", not done, same id). Undefined when it has none. */
function readDeadlines(parsed: Record<string, unknown>): ClassDeadline[] | undefined {
	if (Array.isArray(parsed.deadlines)) {
		return parsed.deadlines.filter(isClassDeadline).map((d) => ({
			id: d.id,
			kind: d.kind,
			name: d.name,
			date: d.date,
			...(d.time !== undefined ? { time: d.time } : {}),
			fileIds: d.fileIds,
			...(isIdList(d.leftOutIds) && d.leftOutIds.length > 0 ? { leftOutIds: d.leftOutIds } : {}),
			...(isString(d.source) && d.source ? { source: d.source } : {}),
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

const isClassNote = (v: unknown): v is ClassNote => isRecord(v) && isString(v.text) && isString(v.at);

function getClass(id: string): ClassRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(recordFile(id), "utf-8"));
	} catch (err) {
		if (err instanceof SyntaxError) console.error(`[class ${id}] class.json is not valid JSON; skipping the class`);
		return null;
	}
	if (!isRecord(parsed)) return null;
	// Honest refusal, as in chats.ts: a newer record reads as absent so a
	// later write never rewrites what this build doesn't understand.
	if (typeof parsed.version === "number" && parsed.version > CURRENT_CLASS_VERSION) {
		console.error(`[class ${id}] record stamped with schema version ${parsed.version} > ${CURRENT_CLASS_VERSION} — refusing to read it`);
		return null;
	}
	if (!isString(parsed.id) || !isString(parsed.name) || !isString(parsed.createdAt) || !isString(parsed.updatedAt)) return null;
	const files = Array.isArray(parsed.files) ? parsed.files.filter(isClassFile) : [];
	// A removed file drops out of every deadline that covered it (read-side —
	// the next write persists the cleaned list).
	const fileIds = new Set(files.map((f) => f.id));
	const deadlines = readDeadlines(parsed);
	const signature = isRecord(parsed.signature) ? cleanSignature(parsed.signature) : null;
	const rules = sanitizeRules(parsed.rules);
	return {
		id: parsed.id,
		name: parsed.name,
		description: isString(parsed.description) ? parsed.description : "",
		createdAt: parsed.createdAt,
		updatedAt: parsed.updatedAt,
		archived: parsed.archived === true,
		...(isString(parsed.linkedFolder) ? { linkedFolder: parsed.linkedFolder } : {}),
		files,
		...(deadlines ? { deadlines: deadlines.map((d) => withFiles(d, d.fileIds.filter((f) => fileIds.has(f)), d.leftOutIds?.filter((f) => fileIds.has(f)))).sort(compareDeadlines) } : {}),
		...(signature ? { signature } : {}),
		...(isClassIcon(parsed.icon) ? { icon: parsed.icon } : {}),
		...(isClassNote(parsed.note) ? { note: { text: parsed.note.text, at: parsed.note.at } } : {}),
		...(rules.length ? { rules } : {}),
		...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
	};
}

function summarize(record: ClassRecord): ClassSummary {
	const lastFoundAt = record.files.reduce<string | undefined>((at, f) => (f.foundByScan && (!at || f.addedAt > at) ? f.addedAt : at), undefined);
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
		...(record.signature ? { signature: record.signature } : {}),
		...(record.icon ? { icon: record.icon } : {}),
		...(record.note ? { note: record.note } : {}),
	};
}

function cleanName(name: string): string {
	return name.trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled class";
}

function createClass(init: { name: string; description?: string; signature?: ClassSignature; icon?: ClassIcon }): ClassRecord {
	const now = new Date().toISOString();
	const record: ClassRecord = {
		id: `cls_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		name: cleanName(init.name),
		description: (init.description ?? "").trim(),
		createdAt: now,
		updatedAt: now,
		archived: false,
		files: [],
		...(init.signature ? { signature: init.signature } : {}),
		...(init.icon ? { icon: init.icon } : {}),
	};
	writeClass(record);
	emit("classes-changed", {});
	return { ...record, version: CURRENT_CLASS_VERSION };
}

function listClassRecords(): ClassRecord[] {
	let entries: string[];
	try {
		entries = fs.readdirSync(PATHS.classes);
	} catch {
		return [];
	}
	return entries
		.filter((name) => isClassId(name))
		.map((name) => getClass(name))
		.filter((r): r is ClassRecord => r !== null)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function listClasses(): ClassSummary[] {
	return listClassRecords().map(summarize);
}

function updateClass(id: string, patch: ClassPatch): ClassRecord {
	const record = getClass(id);
	if (!record) throw new Error(`Class not found: ${id}`);
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
	if (patch.note !== undefined) record.note = patch.note;
	// A new note alone doesn't count as an edit: the class list is ordered
	// by updatedAt and shouldn't reshuffle after every lesson.
	const edited = Object.entries(patch).some(([k, v]) => k !== "note" && v !== undefined);
	if (edited) record.updatedAt = new Date().toISOString();
	writeClass(record);
	emit("classes-changed", {});
	return record;
}

function saveFiles(id: string, files: ClassFile[]): ClassRecord {
	const record = getClass(id);
	if (!record) throw new Error(`Class not found: ${id}`);
	record.files = files;
	writeClass(record);
	return record;
}

// ─── deadlines ──────────────────────────────────────────────────────────────

function deadlineName(name: unknown): string {
	const clean = typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, 120) : "";
	if (!clean) throw new ClassDeadlineError("bad_name", "A deadline needs a name");
	return clean;
}

function deadlineKind(kind: unknown): DeadlineKind {
	if (!isDeadlineKind(kind)) throw new ClassDeadlineError("bad_kind", `The kind must be exam, homework, quiz or project (got ${JSON.stringify(kind)})`);
	return kind;
}

function deadlineDate(date: unknown): string {
	if (!isCalendarDate(date)) throw new ClassDeadlineError("bad_date", `The date must be a calendar date written YYYY-MM-DD (got ${JSON.stringify(date)})`);
	return date;
}

function deadlineTime(time: unknown): string {
	if (!isClockTime(time)) throw new ClassDeadlineError("bad_time", `The time must be a 24-hour time written HH:MM (got ${JSON.stringify(time)})`);
	return time;
}

function deadlineFiles(record: ClassRecord, fileIds: unknown): string[] {
	if (!Array.isArray(fileIds) || !fileIds.every(isString)) throw new ClassDeadlineError("unknown_file", "file ids must be a list of class file ids");
	const known = new Set(record.files.map((f) => f.id));
	const unknown = fileIds.filter((f) => !known.has(f));
	if (unknown.length > 0) throw new ClassDeadlineError("unknown_file", `Not files of this class: ${unknown.join(", ")}`);
	return [...new Set(fileIds)];
}

function deadlineSource(source: unknown): string | undefined {
	if (typeof source !== "string") throw new ClassDeadlineError("bad_source", "The source must be text");
	return source.trim().replace(/\s+/g, " ").slice(0, 300) || undefined;
}

/** The deadline with these covered and left-out files; a file is never both
 *  (`leftOutWins` says which list was just set). */
function withFiles(d: ClassDeadline, fileIds: string[], leftOutIds: string[] | undefined, leftOutWins = false): ClassDeadline {
	const out = new Set(leftOutIds ?? []);
	const covered = leftOutWins ? fileIds.filter((f) => !out.has(f)) : fileIds;
	const left = (leftOutIds ?? []).filter((f) => leftOutWins || !covered.includes(f));
	const { leftOutIds: _old, ...rest } = d;
	return { ...rest, fileIds: covered, ...(left.length > 0 ? { leftOutIds: left } : {}) };
}

function requireClass(id: string): ClassRecord {
	const record = getClass(id);
	if (!record) throw new Error(`Class not found: ${id}`);
	return record;
}

function saveDeadlines(record: ClassRecord, deadlines: ClassDeadline[]): void {
	record.deadlines = [...deadlines].sort(compareDeadlines);
	record.updatedAt = new Date().toISOString();
	writeClass(record);
	emit("classes-changed", {});
}

function addDeadline(id: string, init: DeadlineInit): ClassDeadline {
	const record = requireClass(id);
	const time = init.time !== undefined ? deadlineTime(init.time) : undefined;
	const source = init.source !== undefined ? deadlineSource(init.source) : undefined;
	const base: ClassDeadline = {
		id: `ddl_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
		kind: deadlineKind(init.kind),
		name: deadlineName(init.name),
		date: deadlineDate(init.date),
		...(time !== undefined ? { time } : {}),
		fileIds: [],
		...(source !== undefined ? { source } : {}),
		done: false,
	};
	const deadline = withFiles(base, deadlineFiles(record, init.fileIds ?? []), init.leftOutIds !== undefined ? deadlineFiles(record, init.leftOutIds) : undefined);
	saveDeadlines(record, [...(record.deadlines ?? []), deadline]);
	return deadline;
}

function updateDeadline(id: string, deadlineId: string, patch: DeadlinePatch): ClassDeadline {
	const record = requireClass(id);
	const prev = record.deadlines?.find((d) => d.id === deadlineId);
	if (!prev) throw new ClassDeadlineError("deadline_not_found", `No deadline "${deadlineId}" in this class`);
	const time = patch.time === undefined ? prev.time : patch.time === null ? undefined : deadlineTime(patch.time);
	const source = patch.source === undefined ? prev.source : patch.source === null ? undefined : deadlineSource(patch.source);
	const done = patch.done ?? prev.done;
	// Ticking stamps the time; unticking clears it; leaving it alone keeps it.
	const doneAt = !done ? undefined : patch.done === true && !prev.done ? new Date().toISOString() : prev.doneAt;
	const base: ClassDeadline = {
		id: prev.id,
		kind: patch.kind !== undefined ? deadlineKind(patch.kind) : prev.kind,
		name: patch.name !== undefined ? deadlineName(patch.name) : prev.name,
		date: patch.date !== undefined ? deadlineDate(patch.date) : prev.date,
		...(time !== undefined ? { time } : {}),
		fileIds: [],
		...(source !== undefined ? { source } : {}),
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
	const record = requireClass(id);
	if (!record.deadlines?.some((d) => d.id === deadlineId)) return false;
	saveDeadlines(record, record.deadlines.filter((d) => d.id !== deadlineId));
	return true;
}

function deleteClass(id: string): boolean {
	const dir = classDir(id);
	if (!fs.existsSync(dir)) return false;
	fs.rmSync(dir, { recursive: true, force: true });
	emit("classes-changed", {});
	return true;
}

export const classStore: ClassStore = {
	createClass,
	getClass,
	listClassRecords,
	listClasses,
	updateClass,
	saveFiles,
	addDeadline,
	updateDeadline,
	removeDeadline,
	deleteClass,
	filesDir: (id) => path.join(classDir(id), "files"),
	graphDir: (id) => path.join(classDir(id), "graph"),
};
