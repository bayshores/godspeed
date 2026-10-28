/**
 * THE [Today] NOTE: a hidden lesson message that
 * tells the agent today's date, time and time zone, then the class's open
 * deadlines. It is appended (never rewritten) right before the learner's
 * message when the lesson has none yet, the day changed, the deadline part
 * changed, or a compaction cut the last one out of the model's view.
 *
 * Pure: `now` and `timeZone` are inputs so tests are deterministic.
 */

import { compareDeadlines, deadlineDueAt, type ClassDeadline } from "./contracts/class.ts";
import { daysBetween } from "./progress.ts";
import { activeCompactionOf, keptIndexFor } from "./compaction.ts";
import { newTodayContextMessage, type LhMarkerMessage, type LhMessage } from "./native-messages.ts";

/** What the note needs to know about the lesson's class (null = no class). */
export interface TodayNoteClass {
	deadlines: readonly ClassDeadline[];
	files: readonly { id: string; name: string }[];
}

/** Most file names on a Covers line before "and N more". */
const MAX_COVERS = 4;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The wall clock in `timeZone` at `now`. */
interface WallClock {
	/** YYYY-MM-DD */
	day: string;
	/** HH:MM:SS, 24h */
	time: string;
}

export function wallClock(now: Date, timeZone: string): WallClock {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	}).formatToParts(now);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
	return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

/** "Pacific Time" for America/Los_Angeles; the IANA name when Intl has none. */
export function timeZoneLabel(now: Date, timeZone: string): string {
	try {
		const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longGeneric" })
			.formatToParts(now)
			.find((p) => p.type === "timeZoneName")?.value;
		return name || timeZone;
	} catch {
		return timeZone;
	}
}

/** "Fri Oct 30" for 2026-10-30. */
function dayLabel(day: string): string {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
	return `${WEEKDAYS[weekday]} ${MONTHS[m - 1]} ${d}`;
}

/** "11:59 PM" for 23:59. */
function clockLabel(time: string): string {
	const [h, m] = time.split(":").map(Number) as [number, number];
	return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Fri Oct 30 11:59 PM", or just "Fri Oct 30" when the deadline has no time. */
function whenLabel(d: ClassDeadline): string {
	return d.time ? `${dayLabel(d.date)} ${clockLabel(d.time)}` : dayLabel(d.date);
}

function relativeDay(days: number): string {
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return `in ${days} days`;
}

function coversLine(d: ClassDeadline, names: ReadonlyMap<string, string>): string | null {
	const files = d.fileIds.map((id) => names.get(id)).filter((n): n is string => n !== undefined);
	if (files.length === 0) return null;
	if (files.length <= MAX_COVERS) return `  Covers: ${files.join(", ")}`;
	const shown = files.slice(0, MAX_COVERS - 1);
	return `  Covers: ${shown.join(", ")}, and ${files.length - shown.length} more`;
}

/** The note's full text. */
export function todayNoteText(input: { now: Date; timeZone: string; cls: TodayNoteClass | null }): string {
	const { now, timeZone, cls } = input;
	const clock = wallClock(now, timeZone);
	const [year] = clock.day.split("-");
	const head = `[Today] ${dayLabel(clock.day)} ${year}, ${clockLabel(clock.time)} (${timeZoneLabel(now, timeZone)})`;
	const open = (cls?.deadlines ?? []).filter((d) => !d.done).slice().sort(compareDeadlines);
	if (open.length === 0) return head;

	const nowStamp = `${clock.day}T${clock.time}`;
	const dueStamp = (d: ClassDeadline) => {
		const due = deadlineDueAt(d);
		return `${due.date}T${due.time}:00`;
	};
	const overdue = open.filter((d) => dueStamp(d) < nowStamp);
	const upcoming = open.filter((d) => dueStamp(d) >= nowStamp);
	const names = new Map((cls?.files ?? []).map((f) => [f.id, f.name]));

	const lines = [head, "", "Coming up in this class (not marked done):"];
	const push = (line: string, d: ClassDeadline) => {
		lines.push(line);
		const covers = coversLine(d, names);
		if (covers) lines.push(covers);
	};
	for (const d of overdue) {
		push(`- Overdue: ${d.name} (${d.kind}), was ${d.kind === "exam" ? "" : "due "}${whenLabel(d)}`, d);
	}
	for (const d of upcoming) {
		const rel = relativeDay(daysBetween(clock.day, d.date));
		push(`- ${d.name} (${d.kind}), ${d.kind === "exam" ? "" : "due "}${whenLabel(d)}, ${rel}.`, d);
	}
	return lines.join("\n");
}

/** Everything after the [Today] line ("" when there are no open deadlines). */
export function deadlinePartOf(text: string): string {
	const at = text.indexOf("\n");
	return at < 0 ? "" : text.slice(at + 1);
}

function isTodayNote(m: LhMessage): m is LhMessage & LhMarkerMessage {
	return m.role === "custom" && m.customType === "today-context";
}

/** The note to append before the learner's next message, or null when the
 *  last one still holds: same local day, same deadline part, and still in
 *  the model's view (not cut by a compaction). */
export function todayNoteToAppend(messages: readonly LhMessage[], text: string, day: string): LhMarkerMessage | null {
	let at = -1;
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isTodayNote(messages[i]!)) {
			at = i;
			break;
		}
	}
	if (at >= 0) {
		const last = messages[at] as LhMarkerMessage;
		const lastDay = (last.details as { day?: unknown } | null)?.day;
		const active = activeCompactionOf(messages);
		const kept = active ? keptIndexFor(messages, active) : -1;
		const inView = kept <= 0 || at >= kept;
		if (inView && lastDay === day && deadlinePartOf(last.content) === deadlinePartOf(text)) return null;
	}
	return newTodayContextMessage(text, day);
}
