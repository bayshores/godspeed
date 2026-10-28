/** The [Today] note (plan 2026-10-28, Phase 2): the exact text, when a new
 *  note is appended, how it reaches the model, and that the lesson view
 *  shows nothing for it. Pure core, no data dir. */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import type { ClassDeadline } from "../src/core/contracts/class.ts";
import {
	deadlinePartOf,
	timeZoneLabel,
	todayNoteText,
	todayNoteToAppend,
	type TodayNoteClass,
} from "../src/core/today-note.ts";
import {
	nativeInputCause,
	newMessageId,
	newTodayContextMessage,
	newUserMessage,
	toLlmMessages,
	type LhMessage,
} from "../src/core/native-messages.ts";
import { projectView } from "../src/core/view.ts";
import { classTools } from "../src/agent/tools/class.ts";

const TZ = "America/Los_Angeles";
/** Wed Oct 28 2026, 4:12 PM Pacific (PDT, UTC-7). */
const NOW = new Date("2026-10-28T23:12:00Z");

const FILES = [
	"Lecture 4 · Pigeonhole principle",
	"Lecture 5 · Permutations",
	"Lecture 9 · Recurrences",
	"Lecture 10 · Asymptotics",
	"Lecture 11 · Big-O",
	"Lecture 12 · Master theorem",
	"Lecture 13 · Trees",
	"Lecture 14 · Graphs",
].map((name, i) => ({ id: `f${i}`, name }));

function dl(d: Partial<ClassDeadline> & Pick<ClassDeadline, "id" | "kind" | "name" | "date">): ClassDeadline {
	return { fileIds: [], done: false, ...d };
}

/** Board 4's class (owner-approved text). */
const BOARD: TodayNoteClass = {
	files: FILES,
	deadlines: [
		dl({ id: "b", kind: "exam", name: "Midterm 2", date: "2026-11-05", time: "19:00", fileIds: ["f2", "f3", "f4", "f5", "f6", "f7"] }),
		dl({ id: "a", kind: "homework", name: "HW 4", date: "2026-10-30", time: "23:59", fileIds: ["f0", "f1"] }),
		dl({ id: "c", kind: "homework", name: "HW 3", date: "2026-10-23", time: "23:59" }),
		dl({ id: "d", kind: "quiz", name: "Done quiz", date: "2026-10-29", done: true }),
	],
};

const BOARD_TEXT = [
	"[Today] Wed Oct 28 2026, 4:12 PM (Pacific Time)",
	"",
	"Coming up in this class (not marked done):",
	"- Overdue: HW 3 (homework), was due Fri Oct 23 11:59 PM",
	"- HW 4 (homework), due Fri Oct 30 11:59 PM, in 2 days.",
	"  Covers: Lecture 4 · Pigeonhole principle, Lecture 5 · Permutations",
	"- Midterm 2 (exam), Thu Nov 5 7:00 PM, in 8 days.",
	"  Covers: Lecture 9 · Recurrences, Lecture 10 · Asymptotics, Lecture 11 · Big-O, and 3 more",
].join("\n");

describe("[Today] note text", () => {
	it("matches board 4 exactly (overdue first, done left out, exam without 'due', more than 4 files)", () => {
		assert.equal(todayNoteText({ now: NOW, timeZone: TZ, cls: BOARD }), BOARD_TEXT);
	});

	it("today, tomorrow, no time, an overdue item due earlier today, exactly 4 files", () => {
		const cls: TodayNoteClass = {
			files: FILES,
			deadlines: [
				dl({ id: "1", kind: "quiz", name: "Reading quiz", date: "2026-10-28", time: "17:00" }),
				dl({ id: "2", kind: "project", name: "Project 1", date: "2026-10-29", fileIds: ["f0", "f1", "f2", "f3"] }),
				dl({ id: "3", kind: "homework", name: "HW 2", date: "2026-10-28", time: "09:00" }),
				dl({ id: "4", kind: "homework", name: "HW 5", date: "2026-11-02" }),
			],
		};
		assert.equal(
			todayNoteText({ now: NOW, timeZone: TZ, cls }),
			[
				"[Today] Wed Oct 28 2026, 4:12 PM (Pacific Time)",
				"",
				"Coming up in this class (not marked done):",
				"- Overdue: HW 2 (homework), was due Wed Oct 28 9:00 AM",
				"- Reading quiz (quiz), due Wed Oct 28 5:00 PM, today.",
				"- Project 1 (project), due Thu Oct 29, tomorrow.",
				"  Covers: Lecture 4 · Pigeonhole principle, Lecture 5 · Permutations, Lecture 9 · Recurrences, Lecture 10 · Asymptotics",
				"- HW 5 (homework), due Mon Nov 2, in 5 days.",
			].join("\n"),
		);
	});

	it("an overdue exam drops 'due' like an open one; unknown file ids are skipped", () => {
		const cls: TodayNoteClass = {
			files: FILES,
			deadlines: [dl({ id: "1", kind: "exam", name: "Midterm 1", date: "2026-10-22", time: "19:00", fileIds: ["gone", "f0"] })],
		};
		assert.equal(
			todayNoteText({ now: NOW, timeZone: TZ, cls }),
			[
				"[Today] Wed Oct 28 2026, 4:12 PM (Pacific Time)",
				"",
				"Coming up in this class (not marked done):",
				"- Overdue: Midterm 1 (exam), was Thu Oct 22 7:00 PM",
				"  Covers: Lecture 4 · Pigeonhole principle",
			].join("\n"),
		);
	});

	it("a deadline with no time is due at 23:59: still open late in the day", () => {
		const late = new Date("2026-10-29T06:58:00Z"); // Wed Oct 28, 11:58 PM Pacific
		const cls: TodayNoteClass = { files: [], deadlines: [dl({ id: "1", kind: "homework", name: "HW 4", date: "2026-10-28" })] };
		assert.match(todayNoteText({ now: late, timeZone: TZ, cls }), /- HW 4 \(homework\), due Wed Oct 28, today\.$/);
		const after = new Date("2026-10-29T07:00:00Z"); // Thu Oct 29, 12:00 AM
		assert.match(todayNoteText({ now: after, timeZone: TZ, cls }), /^\[Today\] Thu Oct 29 2026, 12:00 AM/);
		assert.match(todayNoteText({ now: after, timeZone: TZ, cls }), /- Overdue: HW 4 \(homework\), was due Wed Oct 28$/);
	});

	it("only the [Today] line with no open deadlines, and with no class", () => {
		const head = "[Today] Wed Oct 28 2026, 4:12 PM (Pacific Time)";
		const allDone: TodayNoteClass = { files: [], deadlines: [dl({ id: "1", kind: "quiz", name: "Q", date: "2026-10-30", done: true })] };
		assert.equal(todayNoteText({ now: NOW, timeZone: TZ, cls: allDone }), head);
		assert.equal(todayNoteText({ now: NOW, timeZone: TZ, cls: { files: [], deadlines: [] } }), head);
		assert.equal(todayNoteText({ now: NOW, timeZone: TZ, cls: null }), head);
		assert.equal(deadlinePartOf(head), "");
	});

	it("uses the machine's time zone wall clock and a readable zone name, falling back to the IANA name", () => {
		assert.match(todayNoteText({ now: NOW, timeZone: "Europe/Berlin", cls: null }), /^\[Today\] Thu Oct 29 2026, 12:12 AM \(Central European Time\)$/);
		assert.equal(timeZoneLabel(NOW, "Not/AZone"), "Not/AZone");
	});
});

describe("[Today] note append rule", () => {
	const user = (text: string) => newUserMessage(text) as LhMessage;
	const note = (text: string, day: string) => newTodayContextMessage(text, day) as LhMessage;
	const text = todayNoteText({ now: NOW, timeZone: TZ, cls: BOARD });

	it("the first turn gets a note", () => {
		const added = todayNoteToAppend([], text, "2026-10-28");
		assert.ok(added);
		assert.equal(added.customType, "today-context");
		assert.equal(added.display, false);
		assert.equal(added.content, text);
		assert.deepEqual(added.details, { day: "2026-10-28" });
	});

	it("same day and same deadlines: no new note, even when the clock time moved", () => {
		const later = todayNoteText({ now: new Date("2026-10-29T01:40:00Z"), timeZone: TZ, cls: BOARD }); // 6:40 PM
		assert.notEqual(later, text);
		assert.equal(todayNoteToAppend([note(text, "2026-10-28"), user("hi")], later, "2026-10-28"), null);
	});

	it("a new day gets a note", () => {
		const tomorrow = todayNoteText({ now: new Date("2026-10-29T17:00:00Z"), timeZone: TZ, cls: null });
		const msgs = [note(todayNoteText({ now: NOW, timeZone: TZ, cls: null }), "2026-10-28"), user("hi")];
		assert.ok(todayNoteToAppend(msgs, tomorrow, "2026-10-29"));
	});

	it("an edited deadline gets a note", () => {
		const edited = todayNoteText({
			now: NOW,
			timeZone: TZ,
			cls: { ...BOARD, deadlines: BOARD.deadlines.map((d) => (d.id === "a" ? { ...d, date: "2026-10-31" } : d)) },
		});
		assert.ok(todayNoteToAppend([note(text, "2026-10-28"), user("hi")], edited, "2026-10-28"));
	});

	it("a deadline marked done (so it drops out) gets a note", () => {
		const done = todayNoteText({
			now: NOW,
			timeZone: TZ,
			cls: { ...BOARD, deadlines: BOARD.deadlines.map((d) => (d.id === "c" ? { ...d, done: true } : d)) },
		});
		assert.doesNotMatch(done, /HW 3/);
		assert.ok(todayNoteToAppend([note(text, "2026-10-28"), user("hi")], done, "2026-10-28"));
	});

	it("only the newest note counts", () => {
		const other = todayNoteText({ now: NOW, timeZone: TZ, cls: null });
		const msgs = [note(other, "2026-10-28"), user("a"), note(text, "2026-10-28"), user("b")];
		assert.equal(todayNoteToAppend(msgs, text, "2026-10-28"), null);
	});

	it("a compaction that cut the last note out of view gets a note; one that kept it does not", () => {
		const first = note(text, "2026-10-28");
		const a = user("a");
		const b = user("b");
		const compaction = (keptId: string) =>
			({
				id: newMessageId(),
				role: "custom",
				customType: "compaction",
				content: "[Compacted history] summary",
				display: true,
				details: { firstKeptMessageId: keptId },
				timestamp: Date.now(),
			}) as LhMessage;
		assert.ok(todayNoteToAppend([first, a, b, compaction(b.id)], text, "2026-10-28"), "cut before b: the note is gone");
		assert.equal(todayNoteToAppend([first, a, b, compaction(first.id)], text, "2026-10-28"), null, "kept from the note: still in view");
	});
});

describe("[Today] note on the wire and on screen", () => {
	const text = todayNoteText({ now: NOW, timeZone: TZ, cls: BOARD });
	const marker = newTodayContextMessage(text, "2026-10-28") as LhMessage;
	const learner = newUserMessage("teach me permutations") as LhMessage;

	it("reaches the model as a user-role message right before the learner's", () => {
		const wire = toLlmMessages([marker, learner] as never);
		assert.equal(wire.length, 2);
		assert.equal(wire[0]!.role, "user");
		assert.deepEqual(wire[0]!.content, [{ type: "text", text }]);
		assert.equal(wire[1]!.content, "teach me permutations");
	});

	it("renders nothing in the lesson view", () => {
		const view = projectView([marker, learner]);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.id, learner.id);
		assert.ok(!JSON.stringify(view).includes("[Today]"));
	});

	it("is context, not learner input, for the request-cause fold", () => {
		assert.equal(nativeInputCause(marker as never, []), "neutral");
	});
});

describe("read_class and the prompt", () => {
	it("read_class returns the card, a blank line, then the current note", async () => {
		const tools = classTools({
			classCard: () => ({ classId: "cls_x", name: "CSE 21", description: "", files: [] }),
			todayNote: () => BOARD_TEXT,
		});
		const out = (await tools.read_class!.execute!("tc", {})).details as string;
		assert.equal(out, `[Class context] — this lesson belongs to a course the learner is taking:\n\nClass: CSE 21\n\n${BOARD_TEXT}`);
	});

	it("12-class-context.md tells the teacher how to use the deadlines", () => {
		const prompt = fs.readFileSync(path.join(import.meta.dirname, "../src/agent/prompts/shared/12-class-context.md"), "utf8");
		assert.ok(
			prompt.includes(
				"When the learner hasn't picked a topic, use the deadlines in the [Today] note to choose what to teach first (the soonest one's files). Don't bring up deadlines unless the learner does.",
			),
		);
	});
});
