/**
 * "Where you left off" (core/agent-briefing.ts): the MCP instructions'
 * briefing and its length budget, the class setup to-dos in it
 * (core/class-setup.ts), and the note parsing behind it (core/agent-notes.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentBriefing, type BriefingInput } from "../src/core/agent-briefing.ts";
import { cleanNoteText, parseAgentNotes } from "../src/core/agent-notes.ts";
import { missingSetup, SETUP_HOW } from "../src/core/class-setup.ts";
import type { ClassDeadline } from "../src/core/contracts/class.ts";

const TZ = "America/Los_Angeles";
// Thu Oct 29 2026, 8:30 PM Pacific.
const NOW = new Date("2026-10-30T03:30:00Z");

function deadline(name: string, date: string, extra: Partial<ClassDeadline> = {}): ClassDeadline {
	return { id: `ddl_${name}`, kind: "homework", name, date, fileIds: [], done: false, ...extra };
}

function input(over: Partial<BriefingInput> = {}): BriefingInput {
	return { now: NOW, timeZone: TZ, classes: [], lessons: [], notes: [], maxChars: Infinity, ...over };
}

/** Two classes, 5 lessons (newest ch_0), 4 open deadlines (nearest HW 1) and 4 notes (oldest note_0). */
function busy(maxChars: number): BriefingInput {
	return input({
		maxChars,
		classes: [
			{ id: "cls_21", name: "CSE 21", archived: false, missingSetup: [], deadlines: [1, 2, 3, 4].map((n) => deadline(`HW ${n}`, `2026-11-0${n}`)) },
			{ id: "cls_29", name: "CSE 29", archived: false, missingSetup: [], deadlines: [] },
		],
		lessons: [0, 1, 2, 3, 4].map((n) => ({ id: `ch_${n}`, title: `Lesson ${n}`, classId: "cls_21", updatedAt: `2026-10-2${9 - n}T12:00:00Z`, waiting: false })),
		notes: [0, 1, 2, 3].map((n) => ({ id: `note_${n}`, text: `Note number ${n} about the learner.`, createdAt: `2026-10-2${n}T12:00:00Z` })),
	});
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
					{ id: "cls_21", name: "CSE 21", archived: false, missingSetup: [], deadlines: [deadline("HW 5", "2026-11-05"), deadline("HW 3", "2026-10-20"), deadline("HW 4", "2026-11-02", { done: true })] },
					{ id: "cls_29", name: "CSE 29", archived: false, missingSetup: [], deadlines: [deadline("Final", "2026-12-10", { kind: "exam", time: "08:00" })] },
					{ id: "cls_old", name: "MATH 18", archived: true, missingSetup: [], deadlines: [deadline("Old HW", "2026-11-01")] },
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

	it("within its budget, it is the whole briefing", () => {
		const full = agentBriefing(busy(Infinity));
		assert.equal(agentBriefing(busy(full.length)), full);
		assert.doesNotMatch(full, /Left out/);
	});

	/** The briefing at `maxChars`, checked to fit. */
	function fitted(maxChars: number): string {
		const text = agentBriefing(busy(maxChars));
		assert.ok(text.length <= maxChars, `${text.length} > ${maxChars}`);
		return text;
	}

	it("over budget, lessons go first, then deadlines, then notes (only here), and classes last", () => {
		const full = agentBriefing(busy(Infinity)).length;
		const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
		let last = { lessons: 5, deadlines: 4, notes: 4, classes: 2 };
		for (let max = full; max >= 250; max -= 10) {
			const text = fitted(max);
			const now = { lessons: count(text, /Lesson \d/g), deadlines: count(text, /HW \d/g), notes: count(text, /note_\d/g), classes: count(text, /^- CSE \d+/gm) };
			if (now.deadlines < 4) assert.equal(now.lessons, 0, `deadlines cut while lessons remain at ${max}`);
			if (now.notes < 4) assert.equal(now.deadlines, 0, `notes cut while deadlines remain at ${max}`);
			if (now.classes < 2) assert.equal(now.notes, 0, `classes cut while notes remain at ${max}`);
			assert.ok(now.lessons <= last.lessons && now.deadlines <= last.deadlines && now.notes <= last.notes);
			last = now;
		}
	});

	it("the newest items stay longest, and the last line says what was left out", () => {
		const text = fitted(agentBriefing(busy(Infinity)).length - 1);
		assert.match(text, /Lesson 0/);
		assert.doesNotMatch(text, /Lesson 4/);
		assert.match(text, /\n\nLeft out to fit: \d lessons?\. Use list_lessons \/ read_class for lessons and deadlines\.$/);
		const notesOnly = agentBriefing(busy(1));
		assert.doesNotMatch(notesOnly, /Last lessons|Next deadlines|Notes saved/, "a section left out entirely loses its heading too");
		assert.match(notesOnly, /Left out to fit: 5 lessons, 4 deadlines, 4 notes, 2 classes\./);
	});

	it("puts each active class's unfinished setup first, and trims it last", () => {
		const classes = [
			{ id: "cls_21", name: "CSE 21", archived: false, missingSetup: ["icon", "signature"], deadlines: [] },
			{ id: "cls_29", name: "CSE 29", archived: false, missingSetup: [], deadlines: [] },
			{ id: "cls_old", name: "MATH 18", archived: true, missingSetup: ["icon"], deadlines: [] },
		];
		const todo = ["", "Class setup to finish (do this before calling wait_for_work):", '- CSE 21 (class_id "cls_21"): no icon, no signature', SETUP_HOW, "", "Classes:"].join("\n");
		assert.ok(agentBriefing(input({ classes })).includes(todo));
		const full = agentBriefing({ ...busy(Infinity), classes }).length;
		for (let max = full; max >= 1; max -= 10) {
			const text = agentBriefing({ ...busy(max), classes });
			if (!text.includes("no icon, no signature")) assert.doesNotMatch(text, /^- CSE \d+ \(class_id "cls_\d+"\)$/m, `setup cut while classes remain at ${max}`);
		}
		assert.match(agentBriefing({ ...busy(1), classes }), /Left out to fit: .*2 classes, 1 class's setup\./);
	});
});

describe("missingSetup", () => {
	it("lists a missing icon, signature and description, in that order", () => {
		assert.deepEqual(missingSetup({ description: " " }), ["icon", "signature", "description"]);
	});

	it("a fully set up class is missing nothing", () => {
		assert.deepEqual(missingSetup({ description: "Discrete math.", icon: "sigma", signature: { kind: "math", value: "x" } }), []);
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
