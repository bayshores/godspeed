/** The paper on the lesson's desk, cut into printed pages. Pure. */

/** A page holds this many printed rows; a long line wraps every ROW_CHARS characters. */
const ROWS_PER_PAGE = 38;
const ROW_CHARS = 64;

/** A text file cut into pages by printed rows; `start` is the first line's number. */
export function textPages(text: string): { start: number; lines: string[] }[] {
	const pages: { start: number; lines: string[] }[] = [];
	let rows = ROWS_PER_PAGE;
	text.split("\n").forEach((line, i) => {
		const need = Math.max(1, Math.ceil(line.length / ROW_CHARS));
		if (rows + need > ROWS_PER_PAGE && rows > 0) {
			pages.push({ start: i + 1, lines: [] });
			rows = 0;
		}
		pages.at(-1)!.lines.push(line);
		rows += need;
	});
	return pages;
}
