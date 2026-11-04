/**
 * data/classes/<id>/cheat-sheets/<deadline id>.json: one deadline's cheat
 * sheet (core/cheat-sheet.ts), and beside it <deadline id>-files/, the PDFs
 * sent with its prompts. Written only by server/cheat-sheets.ts, stamped
 * with its version; a class's delete takes its folder with it.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { isClassId } from "../core/contracts.ts";
import { CHEAT_SHEET_VERSION, parseCheatSheet, type CheatSheet } from "../core/cheat-sheet.ts";
import { setAsideCorrupt } from "./set-aside.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

function sheetFile(classId: string, deadlineId: string): string {
	if (!isClassId(classId) || !/^[a-z]+_[A-Za-z0-9_]+$/.test(deadlineId)) throw new Error(`Invalid cheat sheet id: ${classId}/${deadlineId}`);
	return path.join(PATHS.classes, classId, "cheat-sheets", `${deadlineId}.json`);
}

function filesDir(classId: string, deadlineId: string): string {
	return sheetFile(classId, deadlineId).replace(/\.json$/, "-files");
}

/** The saved sheet; null when there is none, "newer" when a newer build saved it. */
export function readCheatSheet(classId: string, deadlineId: string): CheatSheet | "newer" | null {
	const file = sheetFile(classId, deadlineId);
	let text: string;
	try {
		text = fs.readFileSync(file, "utf8");
	} catch {
		return null;
	}
	try {
		return parseCheatSheet(JSON.parse(text));
	} catch {
		setAsideCorrupt(file);
		return null;
	}
}

export function writeCheatSheet(classId: string, sheet: CheatSheet): void {
	writeFileAtomic(sheetFile(classId, sheet.deadlineId), JSON.stringify({ version: CHEAT_SHEET_VERSION, ...sheet }, null, "\t"));
}

/** A PDF sent with a prompt, saved for the agent to read; returns its path. */
export function saveCheatSheetFile(classId: string, deadlineId: string, fileName: string, data: Uint8Array): string {
	if (fileName !== path.basename(fileName)) throw new Error(`Invalid file name: ${fileName}`);
	const file = path.join(filesDir(classId, deadlineId), fileName);
	writeFileAtomic(file, data);
	return file;
}

export function removeCheatSheet(classId: string, deadlineId: string): void {
	fs.rmSync(sheetFile(classId, deadlineId), { force: true });
	fs.rmSync(filesDir(classId, deadlineId), { recursive: true, force: true });
}
