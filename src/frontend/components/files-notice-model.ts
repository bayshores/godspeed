/**
 * The "new files" notice: a class's linked folder brought files. Each
 * class gets one entry that later arrivals join (a file counts once).
 */

export interface AddedFiles {
	classId: string;
	files: { id: string; name: string; kind: "study" | "info" }[];
}

export function mergeAdded(list: readonly AddedFiles[], next: AddedFiles): AddedFiles[] {
	const at = list.findIndex((e) => e.classId === next.classId);
	if (at < 0) return [...list, { classId: next.classId, files: [...next.files] }];
	const have = new Set(list[at]!.files.map((f) => f.id));
	const files = [...list[at]!.files, ...next.files.filter((f) => !have.has(f.id))];
	return list.map((e, i) => (i === at ? { ...e, files } : e));
}

/** "3 new files in CSE 21", and when study material waits for an agent to
 *  read it, "· read when your agent connects". */
export function addedTitle(entry: AddedFiles, className: string, agentConnected: boolean): string {
	const count = entry.files.length;
	const title = `${count} new ${count === 1 ? "file" : "files"} in ${className}`;
	return !agentConnected && entry.files.some((f) => f.kind === "study") ? `${title} · read when your agent connects` : title;
}

/** "Lecture11.srt", "Lecture11.srt and HW5.pdf", "Lecture11.srt and 2 more". */
export function addedNames(files: readonly { name: string }[]): string {
	if (files.length <= 2) return files.map((f) => f.name).join(" and ");
	return `${files[0]!.name} and ${files.length - 1} more`;
}
