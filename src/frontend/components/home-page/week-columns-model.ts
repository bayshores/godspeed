/** Today's week: seven day columns from today, each with what is due that day, then Later. Pure. */
import { localDay, monthDay } from "@/shared/core";
import { dueAtMs } from "@/frontend/components/countdown-model";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { clockLabel } from "@/frontend/components/space-deadlines-model";
import { dueWords, type TodayLists } from "./home-page-model";

export interface WeekItem {
	deadline: OpenDeadline;
	/** Past due and not done; it sits first in today's column. */
	late: boolean;
	/** Ticked done today; it sits last in today's column. */
	done: boolean;
	/** Under the name: in a day, its time ("5:00 PM"), shown in a wide week, and
	 *  null without one (the color already says the space); in Later, its date
	 *  ("Nov 29"), always shown, as the column names no day. */
	detail: string | null;
	/** What a screen reader hears: "HW 4, CSE 21, was due Mon Nov 9, late". */
	label: string;
}

export interface WeekColumn {
	/** YYYY-MM-DD, local; null for Later. */
	day: string | null;
	/** "Mon", or "Later". */
	short: string;
	/** The day of the month beside the short name ("Mon 23"); null for Later. */
	date: number | null;
	/** "Monday", "Monday, today", or "Later". */
	long: string;
	today: boolean;
	items: WeekItem[];
}

function item(d: OpenDeadline, nowMs: number, late: boolean, done: boolean, later = false): WeekItem {
	return {
		deadline: d,
		late,
		done,
		detail: later ? monthDay(d.date) : d.time ? clockLabel(d.time) : null,
		label: `${d.name}, ${d.spaceName}, ${dueWords(d, nowMs)}${late ? ", late" : ""}${done ? ", done" : ""}`,
	};
}

/** Today and the six days after it, then Later when anything is due after
 *  the week. Today's column holds what is late first (oldest first), then
 *  what is still due today by time, then what was ticked done today; the
 *  other days hold what is due that day by time, and Later all the rest by date. */
export function weekColumns(lists: TodayLists, nowMs: number): WeekColumn[] {
	const now = new Date(nowMs);
	const byDue = [...lists.today].sort((a, b) => dueAtMs(a) - dueAtMs(b));
	const days = Array.from({ length: 7 }, (_, i): WeekColumn => {
		const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
		const day = localDay(date);
		const long = date.toLocaleDateString("en-US", { weekday: "long" });
		const short = date.toLocaleDateString("en-US", { weekday: "short" });
		const dueOn = byDue.filter((d) => localDay(dueAtMs(d)) === day);
		if (i > 0) return { day, short, date: date.getDate(), long, today: false, items: dueOn.map((d) => item(d, nowMs, false, false)) };
		const late = byDue.filter((d) => dueAtMs(d) <= nowMs);
		const items = [
			...late.map((d) => item(d, nowMs, true, false)),
			...dueOn.filter((d) => dueAtMs(d) > nowMs).map((d) => item(d, nowMs, false, false)),
			...lists.done.map((d) => item(d, nowMs, false, true)),
		];
		return { day, short, date: date.getDate(), long: `${long}, today`, today: true, items };
	});
	if (lists.later.length === 0) return days;
	const later = [...lists.later].sort((a, b) => dueAtMs(a) - dueAtMs(b)).map((d) => item(d, nowMs, false, false, true));
	return [...days, { day: null, short: "Later", date: null, long: "Later", today: false, items: later }];
}

/** A column with more than MOST things shows its FIRST few and a key for the rest. */
const MOST = 4;
const FIRST = 3;

/** A column's things as shown folded, and the rest its "+N more" key unfolds. */
export function cutColumn<T>(items: readonly T[]): { first: T[]; rest: T[] } {
	if (items.length <= MOST) return { first: [...items], rest: [] };
	return { first: items.slice(0, FIRST), rest: items.slice(FIRST) };
}
