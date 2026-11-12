/** What the drop zone holds: a folder to link, or files to copy in. */
export type Picked = { kind: "folder"; path: string } | { kind: "files"; files: File[] } | null;

/** The drop zone's summary line. */
export function pickedLabel(picked: Picked): string | null {
	if (!picked) return null;
	if (picked.kind === "folder") return `Folder: ${picked.path}`;
	const names = picked.files.map((f) => f.name);
	return `${names.length} file${names.length === 1 ? "" : "s"}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`;
}
