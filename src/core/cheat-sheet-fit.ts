/**
 * Does the cheat sheet fit its paper? The studio measures each block on
 * the real rendered paper; this packs them into columns in order (a block
 * never splits), says how full the paper is, and offers ways to make a
 * too-long sheet fit. Pure and browser-safe.
 */
import { PAPERS, TEXT_SIZES, WATCH_OUT, type CheatSheet, type CheatSheetBlock, type CheatSheetPaper, type SheetTopic } from "./cheat-sheet.ts";
import type { TopicStatus } from "./progress.ts";

export interface Placement {
	side: number;
	column: number;
	/** Top edge inside its column. */
	top: number;
	/** It doesn't fit: it hangs below the last column's end. */
	over: boolean;
}

export interface Packing {
	placements: Placement[];
	/** How full the paper is: 1 = exactly full, above 1 = too long. */
	fill: number;
	/** How far the last column runs past the paper. */
	overflow: number;
}

/**
 * Fill columns top to bottom, side by side: a block goes in the current
 * column when it fits, else starts the next one. Past the last column the
 * rest stack on in the last column, below the paper's end.
 */
export function packBlocks(heights: readonly number[], opts: { columnHeight: number; columns: number; sides: number; gap: number }): Packing {
	const total = opts.columns * opts.sides;
	const placements: Placement[] = [];
	let col = 0;
	let bottom = 0;
	let used = false;
	for (const h of heights) {
		const top = used ? bottom + opts.gap : 0;
		if (used && top + h > opts.columnHeight && col < total - 1) {
			col++;
			placements.push({ side: Math.floor(col / opts.columns), column: col % opts.columns, top: 0, over: h > opts.columnHeight && col === total - 1 });
			bottom = h;
			continue;
		}
		placements.push({ side: Math.floor(col / opts.columns), column: col % opts.columns, top, over: col === total - 1 && top + h > opts.columnHeight });
		bottom = top + h;
		used = true;
	}
	const capacity = total * opts.columnHeight;
	const end = heights.length === 0 ? 0 : col * opts.columnHeight + bottom;
	return { placements, fill: capacity > 0 ? end / capacity : 0, overflow: col === total - 1 ? Math.max(0, bottom - opts.columnHeight) : 0 };
}

/** The meter's words: "Fits on one side" or "Too long for the card". */
export function fitLabel(paper: CheatSheetPaper, fits: boolean): string {
	const where = paper === "index-card" ? "the card" : PAPERS[paper].sides === 2 ? "both sides" : "one side";
	return fits ? `Fits on ${where}` : `Too long for ${where}`;
}

/** Lines that run past the paper, at least 1 when anything does. */
export function overflowLines(overflow: number, lineHeight: number): number {
	return overflow <= 0 ? 0 : Math.max(1, Math.round(overflow / lineHeight));
}

export type FitFix =
	| { kind: "tighten"; blockIds: string[]; label: string }
	| { kind: "small-text"; label: string }
	| { kind: "leave-out"; blockId: string; label: string };

const LEAVE_OUT_ORDER: Record<TopicStatus, number> = { strong: 0, untested: 1, shaky: 2, weak: 3 };

/**
 * Ways to make a too-long sheet fit, as the studio offers them: tighten
 * the three longest blocks, use Small text, or leave out the block the
 * learner needs least (strong, then untested, then shaky; the lowest on
 * the paper among those). Pinned blocks and the Watch out block are
 * never cut.
 */
export function fitFixes(
	sheet: Pick<CheatSheet, "prefs" | "blocks">,
	heights: ReadonlyMap<string, number>,
	topics: readonly Pick<SheetTopic, "id" | "name" | "status">[],
): FitFix[] {
	const fixes: FitFix[] = [];
	const loose = sheet.blocks.filter((b) => !b.pinned);
	const longest = [...loose].sort((a, b) => (heights.get(b.id) ?? 0) - (heights.get(a.id) ?? 0)).slice(0, 3);
	if (longest.length > 0)
		fixes.push({ kind: "tighten", blockIds: longest.map((b) => b.id), label: longest.length === 1 ? "Tighten the longest block" : `Tighten the ${longest.length} longest blocks` });
	if (sheet.prefs.textSize !== "small") fixes.push({ kind: "small-text", label: `Use ${TEXT_SIZES.small.label} text` });
	const statusOf = new Map(topics.map((t) => [t.id, t]));
	const candidates = loose
		.map((b, i) => ({ b, i, t: statusOf.get(b.topicId) }))
		.filter((c): c is { b: CheatSheetBlock; i: number; t: Pick<SheetTopic, "id" | "name" | "status"> } => c.b.topicId !== WATCH_OUT && c.t !== undefined)
		.sort((x, y) => LEAVE_OUT_ORDER[x.t.status] - LEAVE_OUT_ORDER[y.t.status] || y.i - x.i);
	const drop = candidates[0];
	if (drop) fixes.push({ kind: "leave-out", blockId: drop.b.id, label: `Leave out ${drop.t.name}` });
	return fixes;
}

/** Notes in a margin, each at its block's top, pushed down so none
 *  overlaps the one above. */
export function stackNotes<T extends { y: number }>(notes: readonly T[], height: number): (T & { y: number })[] {
	const out: (T & { y: number })[] = [];
	let next = -Infinity;
	for (const n of [...notes].sort((a, b) => a.y - b.y)) {
		const y = Math.max(n.y, next);
		out.push({ ...n, y });
		next = y + height;
	}
	return out;
}
