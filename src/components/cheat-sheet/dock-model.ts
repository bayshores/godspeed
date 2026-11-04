/**
 * The cheat sheet beside a session: which sheet it shows, what it
 * remembers per session, and the problem or question a message from it
 * carries. Pure.
 */
import type { SheetAbout, SheetCard } from "@/core";

/** What the sheet beside a session remembers: open or not, and the
 *  deadline picked. */
export interface DockState {
	open: boolean;
	deadlineId?: string;
}

export const DOCK_MIN_W = 320;
export const DOCK_DEFAULT_W = 460;
/** The session keeps at least this much room beside the sheet. */
const SESSION_MIN_W = 480;

export function dockStateKey(chatId: string): string {
	return `lh:sheet-dock:${chatId}`;
}

export function parseDockState(raw: string | null): DockState {
	try {
		const v = JSON.parse(raw ?? "") as { open?: unknown; deadlineId?: unknown };
		return { open: v.open === true, ...(typeof v.deadlineId === "string" ? { deadlineId: v.deadlineId } : {}) };
	} catch {
		return { open: false };
	}
}

/** The sheet's width: what was dragged to, within what the window leaves. */
export function dockWidth(wanted: number, windowW: number): number {
	return Math.round(Math.max(DOCK_MIN_W, Math.min(wanted, windowW - SESSION_MIN_W)));
}

/** The sheets there are to show: deadlines with a made sheet, upcoming first. */
export function sheetChoices(cards: readonly SheetCard[]): SheetCard[] {
	return cards.filter((c) => c.version !== null);
}

/**
 * The deadline whose sheet to show: the one picked before in this session,
 * else the session's own deadline when it has a sheet, else the next
 * upcoming deadline with one, else any with one. null when no deadline
 * has a sheet.
 */
export function pickSheet(cards: readonly SheetCard[], sessionDeadlineId: string | undefined, picked: string | undefined): string | null {
	const choices = sheetChoices(cards);
	const has = (id: string | undefined) => (id ? choices.some((c) => c.deadlineId === id) : false);
	if (has(picked)) return picked!;
	if (has(sessionDeadlineId)) return sessionDeadlineId!;
	return (choices.find((c) => !c.past) ?? choices[0])?.deadlineId ?? null;
}

/** Make one: the deadline a new sheet is for (the session's, else the next
 *  upcoming one), or null when the class has none. */
export function makeTarget(cards: readonly SheetCard[], sessionDeadlineId: string | undefined): string | null {
	if (sessionDeadlineId && cards.some((c) => c.deadlineId === sessionDeadlineId)) return sessionDeadlineId;
	return (cards.find((c) => !c.past) ?? cards[0])?.deadlineId ?? null;
}

/** A question's text as the learner sees it: the question, then its
 *  choices (never the answer or its explanation). */
function questionText(input: unknown): string | null {
	if (typeof input !== "object" || input === null) return null;
	const { question, options } = input as { question?: unknown; options?: unknown };
	if (typeof question !== "string" || !question.trim()) return null;
	const labels = Array.isArray(options)
		? options.map((o) => (typeof o === "string" ? o : typeof o === "object" && o !== null && typeof (o as { label?: unknown }).label === "string" ? (o as { label: string }).label : null)).filter((l): l is string => !!l)
		: [];
	return [question.trim(), ...labels.map((l) => `- ${l}`)].join("\n");
}

/** What a message from the sheet beside a session carries: the problem the
 *  learner is on and what they wrote for it, else the waiting question,
 *  else nothing. */
export function sessionAbout(s: { session: string; problem: unknown; work: string | undefined; question: unknown }): SheetAbout | null {
	const statement = typeof s.problem === "object" && s.problem !== null ? (s.problem as { statement?: unknown }).statement : undefined;
	if (typeof statement === "string" && statement.trim()) return { kind: "problem", session: s.session, text: statement.trim(), ...(s.work?.trim() ? { work: s.work.trim() } : {}) };
	const question = questionText(s.question);
	return question ? { kind: "question", session: s.session, text: question } : null;
}
