/**
 * ClassStore — the fs adapter for classes (classes wave, 2026-10-26).
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
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { ClassPatch, ClassStore } from "../core/ports.ts";
import type { ClassFile, ClassRecord, ClassSummary } from "../core/contracts.ts";
import { CURRENT_CLASS_VERSION, isClassId } from "../core/contracts.ts";

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
	const file = recordFile(record.id);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
	fs.writeFileSync(tmp, JSON.stringify({ ...record, version: CURRENT_CLASS_VERSION }, null, "\t"), "utf-8");
	fs.renameSync(tmp, file);
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

const isString = (v: unknown): v is string => typeof v === "string";

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

function getClass(id: string): ClassRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(recordFile(id), "utf-8"));
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;
	// Honest refusal (same ruling as chats, 2026-10-10).
	if (typeof parsed.version === "number" && parsed.version > CURRENT_CLASS_VERSION) {
		console.error(`[class ${id}] record stamped with schema version ${parsed.version} > ${CURRENT_CLASS_VERSION} — refusing to read it`);
		return null;
	}
	if (!isString(parsed.id) || !isString(parsed.name) || !isString(parsed.createdAt) || !isString(parsed.updatedAt)) return null;
	return {
		id: parsed.id,
		name: parsed.name,
		description: isString(parsed.description) ? parsed.description : "",
		createdAt: parsed.createdAt,
		updatedAt: parsed.updatedAt,
		archived: parsed.archived === true,
		...(isString(parsed.linkedFolder) ? { linkedFolder: parsed.linkedFolder } : {}),
		files: Array.isArray(parsed.files) ? parsed.files.filter(isClassFile) : [],
		...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
	};
}

function summarize(record: ClassRecord): ClassSummary {
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
		archived: record.archived,
		...(record.linkedFolder ? { linkedFolder: record.linkedFolder } : {}),
		fileCount: record.files.length,
	};
}

function cleanName(name: string): string {
	return name.trim().replace(/\s+/g, " ").slice(0, 120) || "Untitled class";
}

function createClass(init: { name: string; description?: string }): ClassRecord {
	const now = new Date().toISOString();
	const record: ClassRecord = {
		id: `cls_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		name: cleanName(init.name),
		description: (init.description ?? "").trim(),
		createdAt: now,
		updatedAt: now,
		archived: false,
		files: [],
	};
	writeClass(record);
	emit("classes-changed", {});
	return { ...record, version: CURRENT_CLASS_VERSION };
}

function listClasses(): ClassSummary[] {
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
		.map(summarize)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function updateClass(id: string, patch: ClassPatch): ClassRecord {
	const record = getClass(id);
	if (!record) throw new Error(`Class not found: ${id}`);
	if (patch.name !== undefined) record.name = cleanName(patch.name);
	if (patch.description !== undefined) record.description = patch.description.trim();
	if (patch.archived !== undefined) record.archived = patch.archived;
	if (patch.linkedFolder !== undefined) {
		if (patch.linkedFolder === null) delete record.linkedFolder;
		else record.linkedFolder = patch.linkedFolder;
	}
	record.updatedAt = new Date().toISOString();
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
	listClasses,
	updateClass,
	saveFiles,
	deleteClass,
	filesDir: (id) => path.join(classDir(id), "files"),
	graphDir: (id) => path.join(classDir(id), "graph"),
};
