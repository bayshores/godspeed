/** The cheat sheet beside a session: which sheet it shows and what it remembers per session. Pure. */
import type { SheetCard } from "@/shared/core";

/** What the sheet beside a session remembers: open or not, and the
 *  deadline picked. */
export interface DockState {
	open: boolean;
	deadlineId?: string;
}

export const DOCK_MIN_W = 320;
export const DOCK_DEFAULT_W = 340;
/** The lesson keeps at least this much room beside the sheet: the 480px teacher column and the reading sheet. */
const SESSION_MIN_W = 1000;

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
