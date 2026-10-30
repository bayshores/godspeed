/**
 * "Where you left off": the end of godspeed's MCP instructions, built each
 * time an agent connects, so an agent started in any folder knows the
 * learner's classes, last lessons, next deadlines and saved notes.
 *
 * Pure: `now` and `timeZone` are inputs so tests are deterministic.
 */

import type { AgentNote } from "./agent-notes.ts";
import { compareDeadlines, deadlineDueAt, type ClassDeadline } from "./contracts/class.ts";
import { clockLabel, dayLabel, todayNoteText, wallClock, whenLabel } from "./today-note.ts";

const LAST_LESSONS = 5;
const NEXT_DEADLINES = 5;

export interface BriefingInput {
	now: Date;
	timeZone: string;
	classes: readonly { id: string; name: string; archived: boolean; deadlines: readonly ClassDeadline[] }[];
	lessons: readonly { id: string; title: string; classId?: string; updatedAt: string; waiting: boolean }[];
	notes: readonly AgentNote[];
}

export function agentBriefing(input: BriefingInput): string {
	const { now, timeZone, classes, lessons, notes } = input;
	const names = new Map(classes.map((c) => [c.id, c.name]));
	const day = (iso: string) => dayLabel(wallClock(new Date(iso), timeZone).day);
	const moment = (iso: string) => {
		const clock = wallClock(new Date(iso), timeZone);
		return `${dayLabel(clock.day)} ${clockLabel(clock.time)}`;
	};

	const lines = ["## Where you left off", "", `Now: ${todayNoteText({ now, timeZone, cls: null }).replace(/^\[Today\] /, "")}.`];

	const active = classes.filter((c) => !c.archived);
	lines.push("", active.length ? "Classes:" : "Classes: none yet.");
	for (const c of active) lines.push(`- ${c.name} (class_id "${c.id}")`);

	const recent = [...lessons].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, LAST_LESSONS);
	if (recent.length) {
		lines.push("", "Last lessons (newest first):");
		for (const l of recent) {
			const cls = (l.classId && names.get(l.classId)) || "No class";
			lines.push(`- ${l.title} (${cls}), last active ${moment(l.updatedAt)}, lesson_id "${l.id}"${l.waiting ? ", waiting for the learner's answer" : ""}`);
		}
	}

	const clock = wallClock(now, timeZone);
	const nowStamp = `${clock.day}T${clock.time}`;
	const open = active
		.flatMap((c) => c.deadlines.filter((d) => !d.done).map((d) => ({ ...d, className: c.name })))
		.sort(compareDeadlines)
		.slice(0, NEXT_DEADLINES);
	if (open.length) {
		lines.push("", "Next deadlines (not marked done):");
		for (const d of open) {
			const due = deadlineDueAt(d);
			const overdue = `${due.date}T${due.time}:00` < nowStamp;
			lines.push(`- ${d.className}: ${d.name} (${d.kind}), ${overdue ? "overdue, was due" : "due"} ${whenLabel(d)}`);
		}
	}

	if (notes.length) {
		lines.push("", "Notes saved with remember (oldest first):");
		for (const n of notes) {
			const cls = n.classId && names.get(n.classId);
			lines.push(`- ${n.text} (${cls ? `${cls}, ` : ""}saved ${day(n.createdAt)}, note_id "${n.id}")`);
		}
	} else {
		lines.push("", "Notes saved with remember: none yet.");
	}
	return lines.join("\n");
}
