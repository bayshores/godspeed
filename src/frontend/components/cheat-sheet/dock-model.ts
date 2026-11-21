/** The cheat sheet beside a lesson: which sheet it shows. Pure. */
import type { SheetCard } from "@/shared/core";

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
 *  upcoming one), or null when the space has none. */
export function makeTarget(cards: readonly SheetCard[], sessionDeadlineId: string | undefined): string | null {
	if (sessionDeadlineId && cards.some((c) => c.deadlineId === sessionDeadlineId)) return sessionDeadlineId;
	return (cards.find((c) => !c.past) ?? cards[0])?.deadlineId ?? null;
}
