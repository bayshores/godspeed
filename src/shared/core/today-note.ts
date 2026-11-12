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

import { compareDeadlines, deadlineDueAt, type SpaceDeadline } from "./contracts/space.ts";
import { daysBetween } from "./progress.ts";
import { activeCompactionOf, keptIndexFor } from "./compaction.ts";
import { isRecent, NEW_FILE_DAYS } from "./new-files.ts";
import { newTodayContextMessage, type LhMarkerMessage, type LhMessage } from "./native-messages.ts";

/** What the note needs to know about the lesson's space (null = no space). */
export interface TodayNoteSpace {
	deadlines: readonly SpaceDeadline[];
	files: readonly { id: string; name: string; addedAt?: string; kind?: "study" | "info" }[];
	/** The space's practice problems solved with hints. */
	hinted?: readonly { statement: string; at: string }[];
}

/** Most file names on a Covers line before "and N more". */
const MAX_COVERS = 4;
/** Most new files listed by name. */
const MAX_NEW_FILES = 5;
/** Hinted problems from this many days back, at most MAX_HINTED of them. */
const HINTED_DAYS = 14;
const MAX_HINTED = 3;
/** A hinted problem's statement is cut to this many characters. */
const HINTED_CHARS = 140;

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

function relativeDay(days: number): string {
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return `in ${days} days`;
}

function coversLine(d: SpaceDeadline, names: ReadonlyMap<string, string>): string | null {
	const files = d.fileIds.map((id) => names.get(id)).filter((n): n is string => n !== undefined);
	if (files.length === 0) return null;
	if (files.length <= MAX_COVERS) return `  Covers: ${files.join(", ")}`;
	const shown = files.slice(0, MAX_COVERS - 1);
	return `  Covers: ${shown.join(", ")}, and ${files.length - shown.length} more`;
}

/** The note's full text. */
export function todayNoteText(input: { now: Date; timeZone: string; space: TodayNoteSpace | null }): string {
	const { now, timeZone, space } = input;
	const clock = wallClock(now, timeZone);
	const [year] = clock.day.split("-");
	const head = `[Today] ${dayLabel(clock.day)} ${year}, ${clockLabel(clock.time)} (${timeZoneLabel(now, timeZone)})`;
	const open = (space?.deadlines ?? []).filter((d) => !d.done).slice().sort(compareDeadlines);
	const fresh = newFilesPart(space?.files ?? [], now);
	const hinted = hintedPart(space?.hinted ?? [], now, timeZone);
	if (open.length === 0) return [head, fresh, hinted].filter((part) => part !== null).join("\n\n");

	const nowStamp = `${clock.day}T${clock.time}`;
	const dueStamp = (d: SpaceDeadline) => {
		const due = deadlineDueAt(d);
		return `${due.date}T${due.time}:00`;
	};
	const overdue = open.filter((d) => dueStamp(d) < nowStamp);
	const upcoming = open.filter((d) => dueStamp(d) >= nowStamp);
	const names = new Map((space?.files ?? []).map((f) => [f.id, f.name]));

	const lines = [head, "", "Coming up in this space (not marked done):"];
	const push = (line: string, d: SpaceDeadline) => {
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
	if (fresh) lines.push("", fresh);
	if (hinted) lines.push("", hinted);
	return lines.join("\n");
}

/** The practice problems the learner needed hints on lately, newest first; null when none. */
function hintedPart(hinted: NonNullable<TodayNoteSpace["hinted"]>, now: Date, timeZone: string): string | null {
	const recent = hinted
		.filter((h) => now.getTime() - Date.parse(h.at) <= HINTED_DAYS * 86_400_000)
		.sort((a, b) => b.at.localeCompare(a.at))
		.slice(0, MAX_HINTED);
	if (recent.length === 0) return null;
	const short = (text: string) => {
		const line = text.replace(/\s+/g, " ").trim();
		return line.length <= HINTED_CHARS ? line : `${line.slice(0, HINTED_CHARS - 1)}…`;
	};
	return [
		`Practice problems the learner solved only with hints (last ${HINTED_DAYS} days), worth coming back to:`,
		...recent.map((h) => `- "${short(h.statement)}" (${dayLabel(wallClock(new Date(h.at), timeZone).day)})`),
	].join("\n");
}

/** The new files, newest first: "New files (last 3 days): a, b, and 4 more"
 *  for study files, then a space-info line the teacher may read; null when
 *  none. */
function newFilesPart(files: TodayNoteSpace["files"], now: Date): string | null {
	const fresh = files.filter((f) => isRecent(f.addedAt, now.getTime())).sort((a, b) => Date.parse(b.addedAt!) - Date.parse(a.addedAt!));
	const list = (names: string[]) =>
		names.length <= MAX_NEW_FILES ? names.join(", ") : `${names.slice(0, MAX_NEW_FILES).join(", ")}, and ${names.length - MAX_NEW_FILES} more`;
	const study = fresh.filter((f) => f.kind !== "info").map((f) => f.name);
	const info = fresh.filter((f) => f.kind === "info").map((f) => f.name);
	const lines: string[] = [];
	if (study.length > 0) lines.push(`New files (last ${NEW_FILE_DAYS} days): ${list(study)}`);
	if (info.length > 0) lines.push(`New space info (last ${NEW_FILE_DAYS} days): ${list(info)}. Read it when it might matter, like an exam change or an announcement.`);
	return lines.length > 0 ? lines.join("\n") : null;
}

/** Everything after the [Today] line: deadlines, new files and hinted problems ("" when none). */
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
