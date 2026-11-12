/**
 * "Where you left off": part of godspeed's MCP instructions, built each
 * time an agent connects, so an agent started in any folder knows the
 * learner's spaces, their unfinished setup, last lessons, next deadlines
 * and saved notes. It is trimmed to fit a length budget, least important
 * lines first.
 *
 * Pure: `now` and `timeZone` are inputs so tests are deterministic.
 */

import type { AgentNote } from "./agent-notes.ts";
import { SETUP_HOW } from "./space-setup.ts";
import { compareDeadlines, deadlineDueAt, type SpaceDeadline } from "./contracts/space.ts";
import { clockLabel, dayLabel, todayNoteText, wallClock, whenLabel } from "./today-note.ts";

const LAST_LESSONS = 5;
const NEXT_DEADLINES = 5;

export interface BriefingInput {
	now: Date;
	timeZone: string;
	spaces: readonly { id: string; name: string; archived: boolean; deadlines: readonly SpaceDeadline[]; missingSetup: readonly string[] }[];
	lessons: readonly { id: string; title: string; spaceId?: string; updatedAt: string; waiting: boolean }[];
	notes: readonly AgentNote[];
	/** The longest the briefing may be: some clients cut the instructions it ends up in. */
	maxChars: number;
}

type Section = "setup" | "spaces" | "lessons" | "deadlines" | "notes";

const LEFT_OUT: Record<Section, [one: string, many: string]> = {
	lessons: ["lesson", "lessons"],
	deadlines: ["deadline", "deadlines"],
	notes: ["note", "notes"],
	spaces: ["space", "spaces"],
	setup: ["space's setup", "spaces' setup"],
};

export function agentBriefing(input: BriefingInput): string {
	const { now, timeZone, spaces, lessons, notes, maxChars } = input;
	const names = new Map(spaces.map((c) => [c.id, c.name]));
	const day = (iso: string) => dayLabel(wallClock(new Date(iso), timeZone).day);
	const moment = (iso: string) => {
		const clock = wallClock(new Date(iso), timeZone);
		return `${dayLabel(clock.day)} ${clockLabel(clock.time)}`;
	};

	const active = spaces.filter((c) => !c.archived);
	const spaceLines = active.map((c) => `- ${c.name} (space_id "${c.id}")`);
	const setupLines = active.filter((c) => c.missingSetup.length).map((c) => `- ${c.name} (space_id "${c.id}"): no ${c.missingSetup.join(", no ")}`);

	const lessonLines = [...lessons]
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
		.slice(0, LAST_LESSONS)
		.map((l) => {
			const space = (l.spaceId && names.get(l.spaceId)) || "No space";
			return `- ${l.title} (${space}), last active ${moment(l.updatedAt)}, lesson_id "${l.id}"${l.waiting ? ", waiting for the learner's answer" : ""}`;
		});

	const clock = wallClock(now, timeZone);
	const nowStamp = `${clock.day}T${clock.time}`;
	const deadlineLines = active
		.flatMap((c) => c.deadlines.filter((d) => !d.done).map((d) => ({ ...d, spaceName: c.name })))
		.sort(compareDeadlines)
		.slice(0, NEXT_DEADLINES)
		.map((d) => {
			const due = deadlineDueAt(d);
			const overdue = `${due.date}T${due.time}:00` < nowStamp;
			return `- ${d.spaceName}: ${d.name} (${d.kind}), ${overdue ? "overdue, was due" : "due"} ${whenLabel(d)}`;
		});

	const noteLines = notes.map((n) => {
		const space = n.spaceId && names.get(n.spaceId);
		return `- ${n.text} (${space ? `${space}, ` : ""}saved ${day(n.createdAt)}, note_id "${n.id}")`;
	});

	const left: Record<Section, number> = { setup: 0, spaces: 0, lessons: 0, deadlines: 0, notes: 0 };
	const render = () => {
		const lines = ["## Where you left off", "", `Now: ${todayNoteText({ now, timeZone, space: null }).replace(/^\[Today\] /, "")}.`];
		const keptSetup = setupLines.slice(0, setupLines.length - left.setup);
		if (keptSetup.length) lines.push("", "Space setup to finish (do this before calling wait_for_work):", ...keptSetup, SETUP_HOW);
		const kept = {
			spaces: spaceLines.slice(0, spaceLines.length - left.spaces),
			lessons: lessonLines.slice(0, lessonLines.length - left.lessons),
			deadlines: deadlineLines.slice(0, deadlineLines.length - left.deadlines),
			notes: noteLines.slice(left.notes),
		};
		if (!spaceLines.length) lines.push("", "Spaces: none yet.");
		else if (kept.spaces.length) lines.push("", "Spaces:", ...kept.spaces);
		if (kept.lessons.length) lines.push("", "Last lessons (newest first):", ...kept.lessons);
		if (kept.deadlines.length) lines.push("", "Next deadlines (not marked done):", ...kept.deadlines);
		if (!noteLines.length) lines.push("", "Notes saved with remember: none yet.");
		else if (kept.notes.length) lines.push("", "Notes saved with remember (oldest first):", ...kept.notes);
		const cut = (Object.keys(LEFT_OUT) as Section[]).filter((s) => left[s] > 0).map((s) => `${left[s]} ${LEFT_OUT[s][left[s] === 1 ? 0 : 1]}`);
		if (cut.length) lines.push("", `Left out to fit: ${cut.join(", ")}. Use list_lessons / read_space for lessons and deadlines.`);
		return lines.join("\n");
	};

	// Lessons and deadlines go first: list_lessons and read_space bring them
	// back, while notes live only here. Spaces go only when nothing else is
	// left, and unfinished setup after them: the agent should act on it first.
	const repeat = (section: Section, n: number) => Array<Section>(Math.max(n, 0)).fill(section);
	const dropOrder = [
		...repeat("lessons", lessonLines.length),
		...repeat("deadlines", deadlineLines.length),
		...repeat("notes", noteLines.length),
		...repeat("spaces", spaceLines.length),
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
