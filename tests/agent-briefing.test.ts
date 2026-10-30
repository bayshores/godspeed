/**
 * "Where you left off" (core/agent-briefing.ts): the end of the MCP
 * instructions, and the note parsing behind it (core/agent-notes.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentBriefing, type BriefingInput } from "../src/core/agent-briefing.ts";
import { cleanNoteText, parseAgentNotes } from "../src/core/agent-notes.ts";
import type { ClassDeadline } from "../src/core/contracts/class.ts";

const TZ = "America/Los_Angeles";
// Thu Oct 29 2026, 8:30 PM Pacific.
const NOW = new Date("2026-10-30T03:30:00Z");

function deadline(name: string, date: string, extra: Partial<ClassDeadline> = {}): ClassDeadline {
	return { id: `ddl_${name}`, kind: "homework", name, date, fileIds: [], done: false, ...extra };
}

function input(over: Partial<BriefingInput> = {}): BriefingInput {
	return { now: NOW, timeZone: TZ, classes: [], lessons: [], notes: [], ...over };
}

describe("agentBriefing", () => {
	it("an empty app still gives the time and says nothing is saved", () => {
		assert.equal(
			agentBriefing(input()),
			["## Where you left off", "", "Now: Thu Oct 29 2026, 8:30 PM (Pacific Time).", "", "Classes: none yet.", "", "Notes saved with remember: none yet."].join("\n"),
		);
	});

	it("lists active classes, the last 5 lessons, the next open deadlines and the notes", () => {
		const text = agentBriefing(
			input({
				classes: [
					{ id: "cls_21", name: "CSE 21", archived: false, deadlines: [deadline("HW 5", "2026-11-05"), deadline("HW 3", "2026-10-20"), deadline("HW 4", "2026-11-02", { done: true })] },
					{ id: "cls_29", name: "CSE 29", archived: false, deadlines: [deadline("Final", "2026-12-10", { kind: "exam", time: "08:00" })] },
					{ id: "cls_old", name: "MATH 18", archived: true, deadlines: [deadline("Old HW", "2026-11-01")] },
				],
				lessons: [
					{ id: "ch_a", title: "Pointers", classId: "cls_29", updatedAt: "2026-10-30T01:31:00Z", waiting: true },
					{ id: "ch_b", title: "Counting", classId: "cls_21", updatedAt: "2026-10-29T01:00:00Z", waiting: false },
					{ id: "ch_c", title: "Loose", updatedAt: "2026-10-01T00:00:00Z", waiting: false },
					{ id: "ch_d", title: "Old 1", updatedAt: "2026-09-01T00:00:00Z", waiting: false },
					{ id: "ch_e", title: "Old 2", updatedAt: "2026-08-01T00:00:00Z", waiting: false },
					{ id: "ch_f", title: "Oldest", updatedAt: "2026-07-01T00:00:00Z", waiting: false },
				],
				notes: [
					{ id: "note_1", text: "CSE 29 exam is done.", classId: "cls_29", createdAt: "2026-10-30T02:00:00Z" },
					{ id: "note_2", text: "Wants hints, not answers.", createdAt: "2026-10-30T02:05:00Z" },
				],
			}),
		);
		assert.equal(
			text,
			[
				"## Where you left off",
				"",
				"Now: Thu Oct 29 2026, 8:30 PM (Pacific Time).",
				"",
				"Classes:",
				'- CSE 21 (class_id "cls_21")',
				'- CSE 29 (class_id "cls_29")',
				"",
				"Last lessons (newest first):",
				`- Pointers (CSE 29), last active Thu Oct 29 6:31 PM, lesson_id "ch_a", waiting for the learner's answer`,
				'- Counting (CSE 21), last active Wed Oct 28 6:00 PM, lesson_id "ch_b"',
				'- Loose (No class), last active Wed Sep 30 5:00 PM, lesson_id "ch_c"',
				'- Old 1 (No class), last active Mon Aug 31 5:00 PM, lesson_id "ch_d"',
				'- Old 2 (No class), last active Fri Jul 31 5:00 PM, lesson_id "ch_e"',
				"",
				"Next deadlines (not marked done):",
				"- CSE 21: HW 3 (homework), overdue, was due Tue Oct 20",
				"- CSE 21: HW 5 (homework), due Thu Nov 5",
				"- CSE 29: Final (exam), due Thu Dec 10 8:00 AM",
				"",
				"Notes saved with remember (oldest first):",
				'- CSE 29 exam is done. (CSE 29, saved Thu Oct 29, note_id "note_1")',
				'- Wants hints, not answers. (saved Thu Oct 29, note_id "note_2")',
			].join("\n"),
		);
	});
});

describe("agent notes", () => {
	it("cleanNoteText makes one trimmed line and refuses empty or long notes", () => {
		assert.equal(cleanNoteText("  exam\n is   done "), "exam is done");
		assert.equal(cleanNoteText(" \n "), null);
		assert.equal(cleanNoteText("x".repeat(201)), null);
		assert.equal(cleanNoteText("x".repeat(200))?.length, 200);
	});

	it("parseAgentNotes keeps well-formed notes and drops the rest", () => {
		const good = { id: "note_1", text: "hi", createdAt: "2026-10-29T00:00:00Z" };
		assert.deepEqual(parseAgentNotes({ version: 1, notes: [good, { id: 3 }, null, { ...good, id: "note_2", classId: "cls_x" }] }), [good, { ...good, id: "note_2", classId: "cls_x" }]);
		assert.deepEqual(parseAgentNotes(null), []);
		assert.deepEqual(parseAgentNotes({ notes: "nope" }), []);
	});
});
