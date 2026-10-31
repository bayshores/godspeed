/**
 * "Where you left off": part of godspeed's MCP instructions, built each
 * time an agent connects, so an agent started in any folder knows the
 * learner's classes, their unfinished setup, last lessons, next deadlines
 * and saved notes. It is trimmed to fit a length budget, least important
 * lines first.
 *
 * Pure: `now` and `timeZone` are inputs so tests are deterministic.
 */

import type { AgentNote } from "./agent-notes.ts";
import { SETUP_HOW } from "./class-setup.ts";
import { compareDeadlines, deadlineDueAt, type ClassDeadline } from "./contracts/class.ts";
import { clockLabel, dayLabel, todayNoteText, wallClock, whenLabel } from "./today-note.ts";

const LAST_LESSONS = 5;
const NEXT_DEADLINES = 5;

export interface BriefingInput {
	now: Date;
	timeZone: string;
	classes: readonly { id: string; name: string; archived: boolean; deadlines: readonly ClassDeadline[]; missingSetup: readonly string[] }[];
	lessons: readonly { id: string; title: string; classId?: string; updatedAt: string; waiting: boolean }[];
	notes: readonly AgentNote[];
	/** The longest the briefing may be: some clients cut the instructions it ends up in. */
	maxChars: number;
}

type Section = "setup" | "classes" | "lessons" | "deadlines" | "notes";

const LEFT_OUT: Record<Section, [one: string, many: string]> = {
	lessons: ["lesson", "lessons"],
	deadlines: ["deadline", "deadlines"],
	notes: ["note", "notes"],
	classes: ["class", "classes"],
	setup: ["class's setup", "classes' setup"],
};

export function agentBriefing(input: BriefingInput): string {
	const { now, timeZone, classes, lessons, notes, maxChars } = input;
	const names = new Map(classes.map((c) => [c.id, c.name]));
	const day = (iso: string) => dayLabel(wallClock(new Date(iso), timeZone).day);
	const moment = (iso: string) => {
		const clock = wallClock(new Date(iso), timeZone);
		return `${dayLabel(clock.day)} ${clockLabel(clock.time)}`;
	};

	const active = classes.filter((c) => !c.archived);
	const classLines = active.map((c) => `- ${c.name} (class_id "${c.id}")`);
	const setupLines = active.filter((c) => c.missingSetup.length).map((c) => `- ${c.name} (class_id "${c.id}"): no ${c.missingSetup.join(", no ")}`);

	const lessonLines = [...lessons]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, LAST_LESSONS)
		.map((l) => {
			const cls = (l.classId && names.get(l.classId)) || "No class";
			return `- ${l.title} (${cls}), last active ${moment(l.updatedAt)}, lesson_id "${l.id}"${l.waiting ? ", waiting for the learner's answer" : ""}`;
		});

	const clock = wallClock(now, timeZone);
	const nowStamp = `${clock.day}T${clock.time}`;
	const deadlineLines = active
		.flatMap((c) => c.deadlines.filter((d) => !d.done).map((d) => ({ ...d, className: c.name })))
		.sort(compareDeadlines)
		.slice(0, NEXT_DEADLINES)
		.map((d) => {
			const due = deadlineDueAt(d);
			const overdue = `${due.date}T${due.time}:00` < nowStamp;
			return `- ${d.className}: ${d.name} (${d.kind}), ${overdue ? "overdue, was due" : "due"} ${whenLabel(d)}`;
		});

	const noteLines = notes.map((n) => {
		const cls = n.classId && names.get(n.classId);
		return `- ${n.text} (${cls ? `${cls}, ` : ""}saved ${day(n.createdAt)}, note_id "${n.id}")`;
	});

	const left: Record<Section, number> = { setup: 0, classes: 0, lessons: 0, deadlines: 0, notes: 0 };
	const render = () => {
		const lines = ["## Where you left off", "", `Now: ${todayNoteText({ now, timeZone, cls: null }).replace(/^\[Today\] /, "")}.`];
		const keptSetup = setupLines.slice(0, setupLines.length - left.setup);
		if (keptSetup.length) lines.push("", "Class setup to finish (do this before calling wait_for_work):", ...keptSetup, SETUP_HOW);
		const kept = {
			classes: classLines.slice(0, classLines.length - left.classes),
			lessons: lessonLines.slice(0, lessonLines.length - left.lessons),
			deadlines: deadlineLines.slice(0, deadlineLines.length - left.deadlines),
			notes: noteLines.slice(left.notes),
		};
		if (!classLines.length) lines.push("", "Classes: none yet.");
		else if (kept.classes.length) lines.push("", "Classes:", ...kept.classes);
		if (kept.lessons.length) lines.push("", "Last lessons (newest first):", ...kept.lessons);
		if (kept.deadlines.length) lines.push("", "Next deadlines (not marked done):", ...kept.deadlines);
		if (!noteLines.length) lines.push("", "Notes saved with remember: none yet.");
		else if (kept.notes.length) lines.push("", "Notes saved with remember (oldest first):", ...kept.notes);
		const cut = (Object.keys(LEFT_OUT) as Section[]).filter((s) => left[s] > 0).map((s) => `${left[s]} ${LEFT_OUT[s][left[s] === 1 ? 0 : 1]}`);
		if (cut.length) lines.push("", `Left out to fit: ${cut.join(", ")}. Use list_lessons / read_class for lessons and deadlines.`);
		return lines.join("\n");
	};

	// Lessons and deadlines go first: list_lessons and read_class bring them
	// back, while notes live only here. Classes go only when nothing else is
	// left, and unfinished setup after them: the agent should act on it first.
	const repeat = (section: Section, n: number) => Array<Section>(Math.max(n, 0)).fill(section);
	const dropOrder = [
		...repeat("lessons", lessonLines.length),
		...repeat("deadlines", deadlineLines.length),
		...repeat("notes", noteLines.length),
		...repeat("classes", classLines.length),
		...repeat("setup", setupLines.length),
	];
	let text = render();
	for (const section of dropOrder) {
		if (text.length <= maxChars) break;
		left[section]++;
		text = render();
	}
	return text;
}
