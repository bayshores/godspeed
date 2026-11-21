import { plural } from "@/frontend/lib/plural";

/** Who writes a note's "My words". The same two values as `VAULT_WORDS` in the server's settings. */
export const VAULT_WORDS = ["teacher", "mine"] as const;
export type VaultWords = (typeof VAULT_WORDS)[number];

/** A folder as the server names it: `short` and `parent` write the home folder as "~". */
export interface VaultFolder {
	path: string;
	name: string;
	short: string;
	parent: string;
}

/** GET /api/vault: the notes folder, what is in it and whether it can be read now. */
export interface VaultStatus {
	/** The picked folder; null with none. */
	folder: VaultFolder | null;
	words: VaultWords;
	/** The folder is a vault Obsidian knows, so a note opens in Obsidian. */
	obsidian: boolean;
	/** The vaults Obsidian lists. */
	vaults: VaultFolder[];
	notes: number;
	/** The folder holds more notes than godspeed reads. */
	capped: boolean;
	state: "none" | "ok" | "missing" | "failed";
	/** Why the folder cannot be read, with "missing" and "failed". */
	message?: string;
	/** The names of the notes the folder has not taken yet, and why; null with none waiting. */
	waiting: { names: string[]; why: string } | null;
}

/** The group's head: "Obsidian" while the learner picks among Obsidian's vaults or holds one. */
export function vaultHead(status: VaultStatus): string {
	return status.obsidian || (status.state === "none" && status.vaults.length > 0) ? "Obsidian" : "Notes folder";
}

export function pickLine(status: VaultStatus): string {
	return status.vaults.length > 0 ? "Pick the vault godspeed writes notes in." : "Pick the folder godspeed writes notes in.";
}

/** What names the picked folder: a vault by its name, any other folder by its path. */
export function folderTitle(folder: VaultFolder, obsidian: boolean): string {
	return obsidian ? folder.name : folder.short;
}

/** Where the notes are said to go: "Obsidian" for a vault, else "your notes folder". */
export function destination(obsidian: boolean): string {
	return obsidian ? "Obsidian" : "your notes folder";
}

/** The failure notice's first line: "Couldn't save Stars and bars and Combinations to Obsidian." Three or more: "A, B and 3 more". */
export function waitingLine(names: string[], obsidian: boolean): string {
	const named = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
	return `Couldn't save ${named} to ${destination(obsidian)}.`;
}

/** What opening a note says: Obsidian for a vault it knows, else the file browser (named by `browser`). */
export function openLabel(obsidian: boolean, browser: string): string {
	return obsidian ? "Open in Obsidian" : `Show in ${browser}`;
}

/** The line under the folder's name; its problem, when it has one. */
export function folderLine(status: VaultStatus, browser: string): string {
	if (status.message) return status.message;
	const notes = plural(status.notes, "note");
	const capped = status.capped ? " That is as many as godspeed reads, so the rest are not searched." : "";
	if (status.obsidian) return `In ${status.folder?.parent ?? ""}, ${notes}.${capped} Each space gets a folder in it.`;
	return `${notes}.${capped} It is not an Obsidian vault, so notes open in ${browser}.`;
}
