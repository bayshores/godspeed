/**
 * THE [Today] NOTE: a hidden lesson message that
 * tells the agent today's date, time and time zone, then the space's open
 * deadlines, the files added in the last few days (space info apart, so
 * the teacher knows it can read it), and the practice problems the learner
 * needed hints on lately. It is appended (never rewritten) right before the learner's
 * message when the lesson has none yet, the day changed, the part after the
 * date changed, or a compaction cut the last one out of the model's view.
 *
 * Pure: `now` and `timeZone` are inputs so tests are deterministic.
 */

import { type SpaceDeadline } from "./contracts/space.ts";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri Oct 30" for 2026-10-30. */
export function dayLabel(day: string): string {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return `${WEEKDAYS[weekday]} ${MONTHS[m - 1]} ${d}`;
}

/** The local calendar day of a moment, YYYY-MM-DD (the app runs on the
 *  learner's computer, so local is the learner's day). */
export function localDay(at: Date | number = new Date()): string {
	const d = new Date(at);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "11:59 PM" for 23:59. */
export function clockLabel(time: string): string {
	const [h, m] = time.split(":").map(Number) as [number, number];
	return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Fri Oct 30 11:59 PM", or just "Fri Oct 30" when the deadline has no time. */
export function whenLabel(d: Pick<SpaceDeadline, "date" | "time">): string {
	return d.time ? `${dayLabel(d.date)} ${clockLabel(d.time)}` : dayLabel(d.date);
}

