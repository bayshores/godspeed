/**
 * The godspeed folder's classes/: where each class file's shortcut goes.
 * Grouped like the Files page (core/file-groups.ts): classes/<class>/
 * <group>/<file>, archived classes under classes/Archived/. Names are made
 * safe on every OS, and two of one name get " (2)". The server writes them
 * (src/server/class-shortcuts.ts).
 */
import type { ClassFile } from "./contracts.ts";
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

export interface ShortcutClass {
	id: string;
	name: string;
	archived: boolean;
	files: ClassFile[];
}

interface Shortcut {
	/** Path segments under classes/, the file's name last. */
	at: string[];
	fileId: string;
}

/** Each class's folder under classes/ (path segments), by class id. */
export function classDirs(classes: readonly Pick<ShortcutClass, "id" | "name" | "archived">[]): Map<string, string[]> {
	const out = new Map<string, string[]>();
	const top = new Set([ARCHIVED_DIR.toLowerCase(), README_NAME.toLowerCase()]);
	const archived = new Set<string>();
	for (const cls of classes) {
		const dir = uniqueName(safeEntryName(cls.name), cls.archived ? archived : top);
		out.set(cls.id, cls.archived ? [ARCHIVED_DIR, dir] : [dir]);
	}
	return out;
}

/** Every shortcut classes/ should hold, in Files page order. */
export function shortcutLayout(classes: readonly ShortcutClass[]): Shortcut[] {
	const out: Shortcut[] = [];
	const dirs = classDirs(classes);
	for (const cls of classes) {
		const base = dirs.get(cls.id)!;
		const groups = new Set<string>();
		for (const group of fileGroups(cls.files)) {
			const groupDir = uniqueName(safeEntryName(group.label), groups);
			const names = new Set<string>();
			for (const item of group.items)
				for (const file of item.files) out.push({ at: [...base, groupDir, uniqueName(safeEntryName(file.name), names)], fileId: file.id });
		}
	}
	return out;
}

/** The note in classes/, plus the files that couldn't get a shortcut. */
export function readmeText(skipped: readonly string[]): string {
	const lines = [
		"These are shortcuts to your class files in godspeed, grouped like the Files page.",
		"",
		"Add, remove or switch files in the godspeed window, not here. godspeed keeps this folder up to date and removes only the shortcuts it made, so anything else you put here stays.",
	];
	if (skipped.length > 0) lines.push("", "These files couldn't get a shortcut on this computer:", ...skipped.map((s) => `- ${s}`));
	return `${lines.join("\n")}\n`;
}
