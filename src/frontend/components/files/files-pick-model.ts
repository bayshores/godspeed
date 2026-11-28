/** The files picked on the Files page to study together, in click order
 *  (the first one names the lesson). Pure. */

/** Most files one lesson works from: the server's MAX_LESSON_FILES
 *  (tests/repo/rust-twins.test.ts keeps the two the same). */
export const MAX_LESSON_FILES = 8;

/** Why a row no longer picks once the lesson's files are all picked. */
export const FULL_LINE = `A lesson takes ${MAX_LESSON_FILES} files at most.`;

/** The picks after a click on a file: picked again it leaves, else it joins
 *  at the end while there is room. */
export function togglePick(picked: readonly string[], fileId: string): readonly string[] {
	if (picked.includes(fileId)) return picked.filter((id) => id !== fileId);
	return picked.length < MAX_LESSON_FILES ? [...picked, fileId] : picked;
}

/** The picks whose files are still in the list; the same array when none left. */
export function keepListed(picked: readonly string[], listed: ReadonlySet<string>): readonly string[] {
	return picked.every((id) => listed.has(id)) ? picked : picked.filter((id) => listed.has(id));
}

/** The bar's line: the picked files' names in click order. */
export function pickedNames(picked: readonly string[], nameOf: ReadonlyMap<string, string>): string {
	return picked.map((id) => nameOf.get(id) ?? id).join(", ");
}
