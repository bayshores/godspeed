/**
 * The deadline countdown's text and color.
 * Pure and unit-tested; src/components/countdown.tsx ticks it.
 *
 *  - more than 24h left: "in N days" (whole days, rounded down), muted;
 *  - the last 24h: "HH:MM:SS", fading from grey to red;
 *  - the last hour: "MM:SS.hh" (hundredths), or "MM:SS" with reduced motion;
 *  - past due: "Overdue", red.
 *
 * Times are the computer's wall clock: a deadline with no time is due at
 * 23:59 that day.
 */
import { deadlineDueAt } from "@/core";

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Grey at 24h left, red at 0. */
export const COUNTDOWN_GREY = "#8D8D8D";
export const COUNTDOWN_RED = "#EF4444";

/** The local moment a deadline is due (ms since epoch). */
export function dueAtMs(d: { date: string; time?: string }): number {
	const due = deadlineDueAt(d);
	const [y, m, day] = due.date.split("-").map(Number) as [number, number, number];
	const [h, min] = due.time.split(":").map(Number) as [number, number];
	return new Date(y, m - 1, day, h, min).getTime();
}

export type CountdownMode = "days" | "clock" | "fine" | "overdue";

export interface Countdown {
	mode: CountdownMode;
	text: string;
	/** #RRGGBB. */
	color: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The countdown for a due moment at `now`. `hundredths: false` (reduced
 *  motion) writes the last hour as "MM:SS". */
export function countdown(dueMs: number, nowMs: number, opts: { hundredths?: boolean } = {}): Countdown {
	const left = dueMs - nowMs;
	if (left <= 0) return { mode: "overdue", text: "Overdue", color: COUNTDOWN_RED };
	if (left >= DAY) {
		const days = Math.floor(left / DAY);
		return { mode: "days", text: `in ${days} ${days === 1 ? "day" : "days"}`, color: COUNTDOWN_GREY };
	}
	const color = countdownColor(left);
	if (left >= HOUR) {
		const s = Math.floor(left / SECOND);
		return { mode: "clock", text: `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`, color };
	}
	const s = Math.floor(left / SECOND);
	const base = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
	if (opts.hundredths === false) return { mode: "fine", text: base, color };
	return { mode: "fine", text: `${base}.${pad(Math.floor((left % SECOND) / 10))}`, color };
}

/** The fade over the last 24h: t = 1 − hoursLeft/24, each channel linear
 *  from (141,141,141) to (239,68,68). */
export function countdownColor(leftMs: number): string {
	const t = Math.min(1, Math.max(0, 1 - leftMs / DAY));
	const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
	const hex = (n: number) => n.toString(16).padStart(2, "0").toUpperCase();
	return `#${hex(mix(141, 239))}${hex(mix(141, 68))}${hex(mix(141, 68))}`;
}

/** How fast the clock must tick for a set of due moments on screen:
 *  "frame" while one is in its last hour (hundredths), "second" while one
 *  is in its last 24h, else "idle" (wait for the next change). */
export function tickRate(dues: Iterable<number>, nowMs: number, reducedMotion: boolean): "frame" | "second" | "idle" {
	let rate: "frame" | "second" | "idle" = "idle";
	for (const due of dues) {
		const left = due - nowMs;
		if (left <= 0) continue;
		if (left < HOUR) return reducedMotion ? "second" : "frame";
		if (left < DAY) rate = "second";
	}
	return rate;
}

/** When an idle clock must wake next: the soonest moment a "days" text
 *  changes (a whole day passes, or the last 24h starts) or a due moment
 *  arrives, and the next minute when `minutes` is set. null = never. */
export function nextWake(dues: Iterable<number>, nowMs: number, minutes: boolean): number | null {
	let wake: number | null = minutes ? Math.floor(nowMs / MINUTE) * MINUTE + MINUTE : null;
	for (const due of dues) {
		const left = due - nowMs;
		if (left <= 0) continue;
		// At exactly N days left the text changes a moment later.
		const at = Math.max(nowMs + 1, left >= DAY ? due - Math.floor(left / DAY) * DAY : due);
		if (wake === null || at < wake) wake = at;
	}
	return wake;
}
