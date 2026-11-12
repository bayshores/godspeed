/**
 * SOURCE MARKS, SERVER SIDE: checks the marks in a teacher reply before it
 * is stored, and serves what a click on a class file source shows (the
 * passage text and the PDF page). The marks themselves are core/citations.ts.
 */
import fs from "node:fs";
import { fileCiteMark, replaceCiteMarks } from "../../shared/core/citations.ts";
import { rangePoint } from "../../shared/core/search.ts";
import { spaceFilePath } from "./space-card.ts";
import { passagesAt } from "./search-index.ts";
import { stores } from "./stores.ts";
import { isPdf, renderPdfPage, type ReadingOutcome } from "./reading-pages.ts";

/** Whose file this is: the class that holds it and the file itself. */
function findFile(fileId: string) {
	for (const record of stores.spaceStore.listSpaceRecords()) {
		const file = record.files.find((f) => f.id === fileId);
		if (file) return { record, file };
	}
	return null;
}

/** The text with every class file mark checked. A passage id becomes the
 *  stored mark (file, place, file name); a mark that points at nothing is
 *  taken out and its id listed in `removed`. Web marks stay as written. */
export function checkCites(text: string): { text: string; removed: string[] } {
	const removed: string[] = [];
	const checked = replaceCiteMarks(text, (mark) => {
		if (mark.kind === "web") return `[[${mark.url}]]`;
		const fileId = mark.kind === "passage" ? mark.passageId.slice(0, mark.passageId.indexOf(":")) : mark.fileId;
		const found = findFile(fileId);
		const passage = found && passagesAt(found.record.id, mark.kind === "passage" ? { passageId: mark.passageId } : { fileId, range: mark.range })[0];
		if (found && passage) return fileCiteMark(fileId, mark.kind === "passage" ? passage.range : mark.range, found.file.name);
		const bad = mark.kind === "passage" ? mark.passageId : `${fileId}/${mark.range}`;
		if (!removed.includes(bad)) removed.push(bad);
		return "";
	});
	return { text: checked, removed };
}

/** What a click on a class file source shows. */
interface CitedPassage {
	name: string;
	range: string;
	/** The PDF page to show as an image, when the file is a PDF still on disk. */
	page: number | null;
	/** The passage text ("" when the file is not indexed). */
	text: string;
}

export function citedPassage(fileId: string, range: string): ReadingOutcome<CitedPassage> {
	const found = findFile(fileId);
	if (!found) return { ok: false, status: 404, error: "No class has that file" };
	const { record, file } = found;
	const onDisk = spaceFilePath(record, file);
	const page = isPdf(file.name) && onDisk && fs.existsSync(onDisk) ? rangePoint(range) : null;
	const text = passagesAt(record.id, { fileId, range }).map((p) => p.text).join("\n");
	if (page === null && text === "") return { ok: false, status: 404, error: "No passage at that place" };
	return { ok: true, value: { name: file.name, range, page, text } };
}

export async function citedPage(fileId: string, page: number): Promise<ReadingOutcome<Buffer>> {
	if (!Number.isInteger(page) || page < 1) return { ok: false, status: 400, error: "page must be a whole number from 1" };
	const found = findFile(fileId);
	const onDisk = found && isPdf(found.file.name) ? spaceFilePath(found.record, found.file) : null;
	const stat = onDisk ? await fs.promises.stat(onDisk).catch(() => null) : null;
	if (!onDisk || !stat?.isFile()) return { ok: false, status: 404, error: "No PDF for that file" };
	return renderPdfPage(onDisk, stat.mtimeMs, page);
}
