/**
 * THE CHEAT SHEET: the notes a space lets the learner bring to a deadline,
 * one per deadline. The agent makes it as a real PDF with its own tools,
 * keeping its source in a working folder so a change edits it. The sheet
 * has a chat: each message from the learner is one request, which the
 * agent answers, and may answer by changing the sheet too. godspeed keeps
 * the last few versions, the chat and the sheet's rules (what should
 * always hold for it). Pure and browser-safe.
 */
import type { SpaceDeadline, DeadlineKind } from "./contracts.ts";

// ─── the record ─────────────────────────────────────────────────────────────

/** A page's size in PDF points (72 to the inch). */
export interface SheetPage {
	widthPt: number;
	heightPt: number;
}

/** One PDF of the sheet, saved as v<n>.pdf. */
export interface SheetVersion {
	/** Counts up from 1 and is never reused. */
	n: number;
	/** The message it was made for ("" when there were only files). */
	prompt: string;
	at: string;
	pages: SheetPage[];
	/** Where it was made, for Show in Finder. */
	file?: string;
	/** Found newer in the working folder: made outside godspeed. */
	fromFolder?: true;
}

/** A picture or PDF sent with a message. */
export interface SheetFile {
	name: string;
	/** Its saved copy beside the sheet; absent on asks older godspeeds kept. */
	file?: string;
}

/** A box the learner drew on a page: fractions of the page's width and
 *  height from its top left corner. */
export interface SheetRegion {
	/** The version, and its page from 1. */
	n: number;
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** One message in the sheet's chat. */
export type SheetMessage =
	| { id: string; role: "you"; text: string; at: string; files?: SheetFile[]; region?: SheetRegion }
	| {
			id: string;
			role: "agent";
			text: string;
			at: string;
			/** The version this reply made. */
			version?: number;
			/** Rules this reply saved. */
			rules?: string[];
	  };

/** Something that should always hold for this sheet ("A4, both sides"). */
export interface SheetRule {
	text: string;
	at: string;
}

export interface CheatSheet {
	deadlineId: string;
	/** Oldest first, the last VERSIONS_KEPT. */
	versions: SheetVersion[];
	/** The chat, oldest first, the last MESSAGES_KEPT. */
	messages: SheetMessage[];
	rules: SheetRule[];
	/** The working folder's name under the godspeed folder's cheat-sheets/,
	 *  picked at the first request so a renamed deadline keeps its source. */
	folder?: string;
	/** An older godspeed made a sheet here that this one can't show. */
	olderFormat?: true;
	updatedAt: string;
}

/** The newest version, or null before the first. */
export function currentVersion(sheet: Pick<CheatSheet, "versions">): SheetVersion | null {
	return sheet.versions[sheet.versions.length - 1] ?? null;
}

// ─── pointing at the sheet ──────────────────────────────────────────────────

const pct = (f: number) => `${Math.round(f * 100)}%`;

/** "page 1 (the front), from 10% to 40% across and 20% to 35% down". */
export function regionText(r: SheetRegion, pages: number): string {
	const side = pages === 2 ? ` (the ${r.page === 1 ? "front" : "back"})` : "";
	return `page ${r.page}${side}, from ${pct(r.x)} to ${pct(r.x + r.w)} across and ${pct(r.y)} to ${pct(r.y + r.h)} down`;
}

// ─── reading a saved record ─────────────────────────────────────────────────

// ─── the page size ──────────────────────────────────────────────────────────

/** Paper sizes by name, upright; a card reads the same either way. */
const NAMED_SIZES: { name: string; w: number; h: number; card?: true }[] = [
	{ name: "Letter", w: 8.5, h: 11 },
	{ name: "A4", w: 8.27, h: 11.69 },
	{ name: "Legal", w: 8.5, h: 14 },
	{ name: "3 × 5 card", w: 3, h: 5, card: true },
	{ name: "4 × 6 card", w: 4, h: 6, card: true },
	{ name: "5 × 8 card", w: 5, h: 8, card: true },
];

const near = (a: number, b: number) => Math.abs(a - b) < 0.06;

/** "A4, front and back", "Letter sideways, one side", "6 × 9 in, 3 pages"
 *  (named by the first page). */
export function pageSizeLabel(pages: readonly SheetPage[]): string {
	const first = pages[0];
	if (!first) return "";
	const w = first.widthPt / 72;
	const h = first.heightPt / 72;
	const upright = NAMED_SIZES.find((s) => near(s.w, w) && near(s.h, h));
	const turned = NAMED_SIZES.find((s) => near(s.h, w) && near(s.w, h));
	const inches = (v: number) => String(Math.round(v * 100) / 100);
	const size = upright ? upright.name : turned ? (turned.card ? turned.name : `${turned.name} sideways`) : `${inches(w)} × ${inches(h)} in`;
	const n = pages.length;
	return `${size}, ${n === 1 ? "one side" : n === 2 ? "front and back" : `${n} pages`}`;
}

/** The label above a page: "Front" and "Back" for two, else its number. */
export function pageCaption(index: number, pages: number): string {
	return pages === 2 ? (index === 0 ? "Front" : "Back") : `Page ${index + 1}`;
}

// ─── what the request says ──────────────────────────────────────────────────

// ─── a space's cheat sheets ─────────────────────────────────────────────────

/** Where a deadline's sheet is: made, the agent on it, made in an older
 *  format (or by a newer godspeed), or not there. */
type SheetStatus = "made" | "making" | "older" | "newer" | "none";

/** One deadline on the space's Cheat sheets page. */
export interface SheetCard {
	deadlineId: string;
	name: string;
	kind: DeadlineKind;
	date: string;
	time?: string;
	/** Done, or its day has gone by. */
	past: boolean;
	status: SheetStatus;
	/** The newest version, for its preview (also while the agent is on it). */
	version: SheetVersion | null;
}

/** GET /api/spaces/<id>/cheat-sheets. */
export interface SpaceSheetsView {
	spaceName: string;
	cards: SheetCard[];
}

/** Every deadline of the space with its sheet: upcoming soonest first, then
 *  past ones, latest first. */
export function sheetCards(
	deadlines: readonly SpaceDeadline[],
	sheetOf: (deadlineId: string) => CheatSheet | "newer" | null,
	running: (deadlineId: string) => boolean,
	today: string,
): SheetCard[] {
	const cards = deadlines.map((d): SheetCard => {
		const sheet = sheetOf(d.id);
		const version = sheet && sheet !== "newer" ? currentVersion(sheet) : null;
		const status: SheetStatus = running(d.id)
			? "making"
			: sheet === "newer"
				? "newer"
				: version
					? "made"
					: sheet?.olderFormat
						? "older"
						: "none";
		return { deadlineId: d.id, name: d.name, kind: d.kind, date: d.date, ...(d.time ? { time: d.time } : {}), past: d.done || d.date < today, status, version };
	});
	const when = (c: SheetCard) => `${c.date} ${c.time ?? "23:59"}`;
	return [...cards.filter((c) => !c.past).sort((a, b) => when(a).localeCompare(when(b))), ...cards.filter((c) => c.past).sort((a, b) => when(b).localeCompare(when(a)))];
}

// ─── what the studio reads ──────────────────────────────────────────────────

/** GET …/cheat-sheet: everything the studio and the sheet beside a
 *  session show. */
export interface CheatSheetView {
	spaceName: string;
	deadlineName: string;
	/** The due day, YYYY-MM-DD. */
	date: string;
	sheet: CheatSheet;
	/** The message the agent is answering. */
	running: { messageId: string } | null;
	/** The message the last request failed on and why (Try again sends it again). */
	error: { messageId: string; text: string } | null;
	/** A newer godspeed saved it: shown, never changed. */
	newer?: true;
}
