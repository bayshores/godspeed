/**
 * The godspeed folder's spaces/: where each space file's shortcut goes.
 * Grouped like the Files page (core/file-groups.ts): spaces/<space>/
 * <group>/<file>, archived spaces under spaces/Archived/. Names are made
 * safe on every OS, and two of one name get " (2)". The server writes them
 * (src/backend/server/space-shortcuts.ts).
 */
import type { SpaceFile } from "./contracts.ts";
import { fileGroups } from "./file-groups.ts";

const ARCHIVED_DIR = "Archived";
export const README_NAME = "READ ME.txt";

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A file or folder name that works on macOS, Windows and Linux. */
export function safeEntryName(name: string): string {
	let out = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-").replace(/[. ]+$/, "").trim();
	if (!out) out = "Untitled";
	const dot = out.lastIndexOf(".");
	const stem = dot > 0 ? out.slice(0, dot) : out;
	if (RESERVED.test(stem)) out = `${stem}_${out.slice(stem.length)}`;
	return out.slice(0, 150);
}

/** `name`, or "name (2).ext", "name (3).ext"… when it's taken (any case,
 *  since macOS and Windows folders ignore it). Marks the result taken. */
export function uniqueName(name: string, taken: Set<string>): string {
	const dot = name.lastIndexOf(".");
	const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	let pick = name;
	for (let n = 2; taken.has(pick.toLowerCase()); n++) pick = `${stem} (${n})${ext}`;
	taken.add(pick.toLowerCase());
	return pick;
}

export interface ShortcutSpace {
	id: string;
	name: string;
	archived: boolean;
	files: SpaceFile[];
}

interface Shortcut {
	/** Path segments under spaces/, the file's name last. */
	at: string[];
	fileId: string;
}

/** Each space's folder under spaces/ (path segments), by space id. */
export function spaceDirs(spaces: readonly Pick<ShortcutSpace, "id" | "name" | "archived">[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const top = new Set([ARCHIVED_DIR.toLowerCase(), README_NAME.toLowerCase()]);
	const archived = new Set<string>();
	for (const space of spaces) {
		const dir = uniqueName(safeEntryName(space.name), space.archived ? archived : top);
		out.set(space.id, space.archived ? [ARCHIVED_DIR, dir] : [dir]);
	}
	return out;
}

/** Every shortcut spaces/ should hold, in Files page order. */
export function shortcutLayout(spaces: readonly ShortcutSpace[]): Shortcut[] {
	const out: Shortcut[] = [];
	const dirs = spaceDirs(spaces);
	for (const space of spaces) {
		const base = dirs.get(space.id)!;
		const groups = new Set<string>();
		for (const group of fileGroups(space.files)) {
			const groupDir = uniqueName(safeEntryName(group.label), groups);
			const names = new Set<string>();
			for (const item of group.items)
				for (const file of item.files) out.push({ at: [...base, groupDir, uniqueName(safeEntryName(file.name), names)], fileId: file.id });
		}
	}
	return out;
}

/** The note in spaces/, plus the files that couldn't get a shortcut. */
export function readmeText(skipped: readonly string[]): string {
	const lines = [
		"These are shortcuts to your space files in godspeed, grouped like the Files page.",
		"",
		"Add, remove or switch files in the godspeed window, not here. godspeed keeps this folder up to date and removes only the shortcuts it made, so anything else you put here stays.",
	];
	if (skipped.length > 0) lines.push("", "These files couldn't get a shortcut on this computer:", ...skipped.map((s) => `- ${s}`));
	return `${lines.join("\n")}\n`;
}
