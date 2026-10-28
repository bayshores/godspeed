/**
 * Open deadlines across classes (plan 2026-10-28, Phase 3): the sidebar's
 * Due soon, Home's Coming up groups and their short labels. Pure and
 * unit-tested. The list comes from GET /api/deadlines (open deadlines of
 * non-archived classes, soonest first).
 */
import { daysBetween, type ClassDeadline } from "@/core";
import { clockLabel, deadlineDateLabel } from "./class-deadlines-model";
import { dueAtMs } from "./countdown-model";

export type OpenDeadline = ClassDeadline & { classId: string; className: string };

/** How many rows the sidebar's Due soon shows. */
export const DUE_SOON_ROWS = 4;
/** Home's "Later" group: more than this many days away. */
export const LATER_DAYS = 14;

/** The calendar day of a local moment, YYYY-MM-DD. */
export function localDayOf(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Soonest due first (so overdue ones come first), name breaking ties. */
export function byDue<T extends { date: string; time?: string; name: string }>(list: readonly T[]): T[] {
	return [...list].sort((a, b) => dueAtMs(a) - dueAtMs(b) || a.name.localeCompare(b.name));
}

/** The sidebar's rows: overdue first, then the soonest, at most `n`. */
export function dueSoon<T extends { date: string; time?: string; name: string; done: boolean }>(list: readonly T[], n = DUE_SOON_ROWS): T[] {
	return byDue(list.filter((d) => !d.done)).slice(0, n);
}

export function isOverdue(d: { date: string; time?: string }, nowMs: number): boolean {
	return dueAtMs(d) <= nowMs;
}

/** "Fri" for a YYYY-MM-DD date. */
export function weekdayLabel(date: string): string {
	return deadlineDateLabel(date).split(" ")[0] ?? "";
}

/** The short "when" under a title: the time ("5:00 PM"), or the weekday
 *  ("Fri") for a deadline with no time. */
export function whenLabel(d: { date: string; time?: string }): string {
	return d.time ? clockLabel(d.time) : weekdayLabel(d.date);
}

/** The sidebar's line under a title: the time today ("5:00 PM"), the
 *  weekday and time within a week ("Thu 7:00 PM"), the date beyond that
 *  ("Thu Nov 12"); a deadline with no time drops the time part. */
export function sidebarWhenLabel(d: { date: string; time?: string }, today: string): string {
	const days = daysBetween(today, d.date);
	const time = d.time ? clockLabel(d.time) : "";
	if (days === 0) return time || weekdayLabel(d.date);
	if (days > 0 && days <= 7) return time ? `${weekdayLabel(d.date)} ${time}` : weekdayLabel(d.date);
	return deadlineDateLabel(d.date);
}

/** Under Home's countdown: "11:59 PM", or "was due Fri 11:59 PM" once
 *  overdue ("Fri" / "was due Fri" with no time). */
export function dueUnderLabel(d: { date: string; time?: string }, overdue: boolean): string {
	if (!overdue) return whenLabel(d);
	const day = weekdayLabel(d.date);
	return d.time ? `was due ${day} ${clockLabel(d.time)}` : `was due ${day}`;
}

export interface ComingUpGroup<T> {
	key: string;
	label: string;
	overdue: boolean;
	items: T[];
}

/** Home's groups: Overdue, Today, "Tomorrow · Thu Oct 29", one per date
 *  ("Fri Oct 30"), then Later (more than 14 days away). Empty groups are
 *  left out. */
export function comingUpGroups<T extends { date: string; time?: string; name: string; done: boolean }>(
	list: readonly T[],
	nowMs: number,
): ComingUpGroup<T>[] {
	const today = localDayOf(nowMs);
	const groups: ComingUpGroup<T>[] = [];
	const find = (key: string, label: string, overdue = false) => {
		let g = groups.find((x) => x.key === key);
		if (!g) groups.push((g = { key, label, overdue, items: [] }));
		return g;
	};
	const overdue: T[] = [];
	const later: T[] = [];
	for (const d of byDue(list.filter((x) => !x.done))) {
		if (isOverdue(d, nowMs)) {
			overdue.push(d);
			continue;
		}
		const days = daysBetween(today, d.date);
		if (days > LATER_DAYS) later.push(d);
		else if (days <= 0) find("today", "Today").items.push(d);
		else if (days === 1) find("tomorrow", `Tomorrow · ${deadlineDateLabel(d.date)}`).items.push(d);
		else find(d.date, deadlineDateLabel(d.date)).items.push(d);
	}
	const out: ComingUpGroup<T>[] = [];
	if (overdue.length > 0) out.push({ key: "overdue", label: "Overdue", overdue: true, items: overdue });
	out.push(...groups);
	if (later.length > 0) out.push({ key: "later", label: "Later", overdue: false, items: later });
	return out;
}

/** Coming up's head: "6 items · 1 overdue" ("1 item"; no overdue part at 0). */
export function itemsSummary(list: readonly { date: string; time?: string; done: boolean }[], nowMs: number): string {
	const open = list.filter((d) => !d.done);
	const overdue = open.filter((d) => isOverdue(d, nowMs)).length;
	const items = `${open.length} ${open.length === 1 ? "item" : "items"}`;
	return overdue > 0 ? `${items} · ${overdue} overdue` : items;
}

/** A class block's "Next due": "Reading quiz, today 5:00 PM",
 *  "HW 5, tomorrow", "Midterm 2, Thu Nov 5, 7:00 PM". */
export function nextDueText(d: { name: string; date: string; time?: string }, nowMs: number): string {
	const days = daysBetween(localDayOf(nowMs), d.date);
	const clock = d.time ? clockLabel(d.time) : "";
	let when: string;
	if (days === 0) when = clock ? `today ${clock}` : "today";
	else if (days === 1) when = clock ? `tomorrow ${clock}` : "tomorrow";
	else when = clock ? `${deadlineDateLabel(d.date)}, ${clock}` : deadlineDateLabel(d.date);
	return `${d.name}, ${when}`;
}

/** "Wednesday, October 28 · 4:12 PM" (Home's date line). */
export function longDateLine(ms: number): string {
	const d = new Date(ms);
	const day = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
	const h = d.getHours();
	const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
	return `${day} · ${clock}`;
}
