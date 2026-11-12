/**
 * data/spaces/<id>/cheat-sheets/<deadline id>.json: one deadline's cheat
 * sheet (core/cheat-sheet.ts), and beside it <deadline id>-files/, the
 * pictures and PDFs sent in its chat, and <deadline id>-versions/v<n>.pdf, the sheets
 * the agent made. Written only by server/cheat-sheets.ts, stamped with its
 * format; a space's delete takes its folder with it.
 */
import fs from "node:fs";
import path from "node:path";
import { PATHS } from "../config.ts";
import { isSpaceId } from "../../shared/core/contracts.ts";
import { CHEAT_SHEET_FORMAT, parseCheatSheet, type CheatSheet } from "../../shared/core/cheat-sheet.ts";
import { setAsideCorrupt } from "./set-aside.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

function sheetFile(spaceId: string, deadlineId: string): string {
	if (!isSpaceId(spaceId) || !/^[a-z]+_[A-Za-z0-9_]+$/.test(deadlineId)) throw new Error(`Invalid cheat sheet id: ${spaceId}/${deadlineId}`);
	return path.join(PATHS.spaces, spaceId, "cheat-sheets", `${deadlineId}.json`);
}

function filesDir(spaceId: string, deadlineId: string): string {
	return sheetFile(spaceId, deadlineId).replace(/\.json$/, "-files");
}

function versionsDir(spaceId: string, deadlineId: string): string {
	return sheetFile(spaceId, deadlineId).replace(/\.json$/, "-versions");
}

function versionFile(spaceId: string, deadlineId: string, n: number): string {
	if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Invalid cheat sheet version: ${n}`);
	return path.join(versionsDir(spaceId, deadlineId), `v${n}.pdf`);
}

/** The saved sheet; null when there is none, "newer" when a newer build saved it. */
export function readCheatSheet(spaceId: string, deadlineId: string): CheatSheet | "newer" | null {
	const file = sheetFile(spaceId, deadlineId);
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

export function writeCheatSheet(spaceId: string, sheet: CheatSheet): void {
	writeFileAtomic(sheetFile(spaceId, sheet.deadlineId), JSON.stringify({ version: CHEAT_SHEET_FORMAT, ...sheet }, null, "\t"));
}

function sheetFilePath(spaceId: string, deadlineId: string, fileName: string): string {
	if (fileName !== path.basename(fileName) || fileName.startsWith(".")) throw new Error(`Invalid file name: ${fileName}`);
	return path.join(filesDir(spaceId, deadlineId), fileName);
}

/** A picture or PDF sent with a message, kept for the chat and the agent;
 *  returns its path. */
export function saveCheatSheetFile(spaceId: string, deadlineId: string, fileName: string, data: Uint8Array): string {
	const file = sheetFilePath(spaceId, deadlineId, fileName);
	writeFileAtomic(file, data);
	return file;
}

/** A file sent with a message, or null when it is gone. */
export function readCheatSheetFile(spaceId: string, deadlineId: string, fileName: string): { path: string; bytes: Buffer } | null {
	try {
		const file = sheetFilePath(spaceId, deadlineId, fileName);
		return { path: file, bytes: fs.readFileSync(file) };
	} catch {
		return null;
	}
}

/** A version's PDF, kept as the agent made it. */
export function saveSheetPdf(spaceId: string, deadlineId: string, n: number, data: Uint8Array): void {
	writeFileAtomic(versionFile(spaceId, deadlineId, n), data);
}

/** A version's PDF, or null when it is gone. */
export function readSheetPdf(spaceId: string, deadlineId: string, n: number): Buffer | null {
	try {
		return fs.readFileSync(versionFile(spaceId, deadlineId, n));
	} catch {
		return null;
	}
}

export function removeSheetPdfs(spaceId: string, deadlineId: string, ns: readonly number[]): void {
	for (const n of ns) fs.rmSync(versionFile(spaceId, deadlineId, n), { force: true });
}

export function removeCheatSheet(spaceId: string, deadlineId: string): void {
	fs.rmSync(sheetFile(spaceId, deadlineId), { force: true });
	fs.rmSync(filesDir(spaceId, deadlineId), { recursive: true, force: true });
	fs.rmSync(versionsDir(spaceId, deadlineId), { recursive: true, force: true });
}
