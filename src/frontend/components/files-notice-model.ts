/**
 * The folder notices: a space's linked folder brought files, or lost
 * some. Each space gets one entry per change that later ones join (a file
 * counts once).
 */

export interface FolderChange {
	spaceId: string;
	change: "added" | "removed";
	/** `kind` is known for added files only. */
	files: { id: string; name: string; kind?: "study" | "info" }[];
}

export function mergeChange(list: readonly FolderChange[], next: FolderChange): FolderChange[] {
	const at = list.findIndex((e) => e.spaceId === next.spaceId && e.change === next.change);
	if (at < 0) return [...list, { ...next, files: [...next.files] }];
	const have = new Set(list[at]!.files.map((f) => f.id));
	const files = [...list[at]!.files, ...next.files.filter((f) => !have.has(f.id))];
	return list.map((e, i) => (i === at ? { ...e, files } : e));
}

/** "3 new files in CSE 21", and when study material waits for an agent to
 *  read it, "· read when your agent connects". "2 files removed from CSE 21". */
export function changeTitle(entry: FolderChange, spaceName: string, agentConnected: boolean): string {
	const count = entry.files.length;
	const files = count === 1 ? "file" : "files";
	if (entry.change === "removed") return `${count} ${files} removed from ${spaceName}`;
	const title = `${count} new ${files} in ${spaceName}`;
	return !agentConnected && entry.files.some((f) => f.kind === "study") ? `${title}, read when your agent connects` : title;
}

/** "Lecture11.srt", "Lecture11.srt and HW5.pdf", "Lecture11.srt and 2 more". */
export function changeNames(files: readonly { name: string }[]): string {
	if (files.length <= 2) return files.map((f) => f.name).join(" and ");
	return `${files[0]!.name} and ${files.length - 1} more`;
}
