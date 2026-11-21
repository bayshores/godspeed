import { fileBrowserName } from "@/frontend/components/files/files-model";

/** What opens a note, or the vault folder, where the learner reads it: Obsidian for a vault it
 *  knows, the file manager for any other folder. Nothing in a plain browser. */
function opener(obsidian: boolean) {
	const lh = typeof window === "undefined" ? undefined : window.lh;
	return obsidian ? lh?.openInObsidian : lh?.showInFolder;
}

/** Whether this window can open it at all. */
export function canOpenNote(obsidian: boolean): boolean {
	return !!opener(obsidian);
}

export function openNote(path: string, obsidian: boolean): void {
	void opener(obsidian)?.(path);
}

/** The file browser's name for "Show in …": Finder, File Explorer or Files. */
export function browserName(): string {
	return fileBrowserName(typeof window === "undefined" ? undefined : window.lh?.platform);
}
