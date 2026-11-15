/**
 * What is clickable on a line of the agent's screen: the names of the
 * learner's space files (with their `spaces/<space>/<group>/` shortcut path
 * when the agent wrote one) and passage ids of those files, also when a name
 * runs on to the next row. Pure.
 */

/** A space file the screen can name. */
export interface LinkFile {
	id: string;
	name: string;
	spaceId: string;
	/** Its space's name, as the space's folder under `spaces/` is named. */
	space: string;
}

export interface ScreenLink {
	/** UTF-16 offsets in the line's text, end exclusive. */
	start: number;
	end: number;
	file: LinkFile;
	/** Set for a passage id: the passage's number in the file. */
	passage?: number;
}

/** A cell as xterm reads it: its characters, and how many columns it takes
 *  (0 for the right half of a wide character). */
interface Cell {
	chars: string;
	width: number;
}

/** A line's text and the 1-based screen column of each of its UTF-16 units. */
function lineText(cells: readonly Cell[]): { text: string; columns: number[] } {
	let text = "";
	const columns: number[] = [];
	cells.forEach((cell, i) => {
		if (cell.width === 0) return;
		const chars = cell.chars || " ";
		text += chars;
		for (let n = 0; n < chars.length; n++) columns.push(i + 1);
	});
	return { text, columns };
}

const PASSAGE = /f_[0-9a-f]{12}:\d+/g;
/** What may sit right before and after a name, so it is not part of a longer word or name. */
const BEFORE = /[\s"'`([<]/;
const AFTER = /[\s"'`)\]>.,;:!?]/;
/** The shortcut folders before a name: `spaces/<space>/<group>/`, or `spaces/Closed/<space>/<group>/`. */
const SHORTCUT = /(?:^|[\s"'`([</])(spaces\/(?:[^/]+\/){2,3})$/;
/** What the godspeed folder puts in place of characters a folder name can't hold. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** A space's folder name, as the godspeed folder makes it (without the " (2)" of a twin). */
const folderOf = (space: string) => space.replace(UNSAFE, "-").replace(/[. ]+$/, "").trim().toLowerCase();

/** The space a shortcut path names, or null when it names none. */
function pathSpace(path: string): string | null {
	const parts = path.split("/");
	if (parts.length === 4) return parts[1]!.toLowerCase();
	return parts.length === 5 && parts[1] === "Closed" ? parts[2]!.toLowerCase() : null;
}

const opens = (text: string, at: number) => at === 0 || BEFORE.test(text[at - 1]!);
const closes = (text: string, end: number) => end === text.length || AFTER.test(text[end]!);

export function screenLinks(text: string, files: readonly LinkFile[]): ScreenLink[] {
	const links: ScreenLink[] = [];
	const taken = (start: number, end: number) => links.some((l) => start < l.end && l.start < end);
	const byId = new Map(files.map((f) => [f.id, f]));
	for (const m of text.matchAll(PASSAGE)) {
		const [id, n] = m[0].split(":");
		const file = byId.get(id!);
		const end = m.index + m[0].length;
		if (file && opens(text, m.index) && closes(text, end)) links.push({ start: m.index, end, file, passage: Number(n) });
	}
	// A name without an extension ("notes") is too often a plain word. Longer
	// names go first, so "week 3 notes.pdf" wins over "notes.pdf".
	const byName = new Map<string, LinkFile[]>();
	for (const f of files) if (f.name.includes(".")) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
	for (const [name, same] of [...byName].sort(([a], [b]) => b.length - a.length)) {
		for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
			const end = at + name.length;
			if (!closes(text, end)) continue;
			// After a slash, only a shortcut path counts, and the whole path links
			// to the file in the space it names. A bare name links only when one
			// file has it.
			const path = text[at - 1] === "/" ? SHORTCUT.exec(text.slice(0, at)) : null;
			if (!path && !opens(text, at)) continue;
			const space = path && pathSpace(path[1]!);
			const file = path ? same.find((f) => folderOf(f.space) === space) : same.length === 1 ? same[0] : undefined;
			const start = path ? at - path[1]!.length : at;
			if (file && !taken(start, end)) links.push({ start, end, file });
		}
	}
	return links.sort((a, b) => a.start - b.start);
}

/** A buffer row: its cells, and whether it carries on the row above (the terminal wrapped it). */
export interface Row {
	cells: readonly Cell[];
	wrapped: boolean;
}

/** One row's piece of a link: its first and last screen columns (from 1). */
interface Part {
	row: number;
	from: number;
	to: number;
}

interface RowLink {
	link: ScreenLink;
	text: string;
	/** Top to bottom, one per row the link covers. */
	parts: Part[];
}

/**
 * Rows `first`, `first + 1`, ... as one text. A row the terminal wrapped
 * carries straight on. Between other rows sits a space, or with `tight` the
 * next row's indent is dropped and it carries straight on too, as when a
 * program breaks a long path itself. `breaks` are where tight joins fall.
 */
function joinRows(rows: readonly Row[], first: number, tight: boolean) {
	let text = "";
	const spots: { row: number; col: number }[] = [];
	const breaks: number[] = [];
	rows.forEach((r, i) => {
		const row = first + i;
		let cells = r.cells;
		while (cells.length > 0 && cells.at(-1)!.chars === "") cells = cells.slice(0, -1);
		let { text: line, columns } = lineText(cells);
		if (i > 0 && !r.wrapped) {
			if (tight) {
				const trimmed = text.trimEnd();
				spots.length = trimmed.length;
				text = trimmed;
				const indent = line.length - line.trimStart().length;
				line = line.slice(indent);
				columns = columns.slice(indent);
				breaks.push(text.length);
			} else {
				text += " ";
				spots.push(spots.at(-1) ?? { row, col: 1 });
			}
		}
		text += line;
		for (const col of columns) spots.push({ row, col });
	});
	return { text, spots, breaks };
}

/** The links in rows `first`, `first + 1`, ..., each with its piece on every row it covers. */
export function rowLinks(rows: readonly Row[], first: number, files: readonly LinkFile[]): RowLink[] {
	const found = (tight: boolean) => {
		const { text, spots, breaks } = joinRows(rows, first, tight);
		return screenLinks(text, files)
			.filter((l) => !tight || breaks.some((b) => l.start < b && b < l.end))
			.map((link) => {
				const parts: Part[] = [];
				for (const { row, col } of spots.slice(link.start, link.end)) {
					const last = parts.at(-1);
					if (last?.row === row) last.to = col;
					else parts.push({ row, from: col, to: col });
				}
				return { link, text: text.slice(link.start, link.end), parts };
			});
	};
	const at = (p: Part) => p.row * 10_000 + p.from;
	const end = (l: RowLink) => at({ ...l.parts.at(-1)!, from: l.parts.at(-1)!.to });
	const loose = found(false);
	const broken = found(true).filter((b) => !loose.some((l) => at(b.parts[0]!) <= end(l) && at(l.parts[0]!) <= end(b)));
	return [...loose, ...broken];
}
