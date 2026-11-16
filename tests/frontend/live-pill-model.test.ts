/**
 * The live pill's words (live-pill-model.ts): the live things in order,
 * what the pill says, the lessons whose reply waits and the deadline in
 * its last day.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dueSoon, firstWord, idleWords, keepReady, pillClick, pillLine, pillThings, shortName, thingsAt } from "../../src/frontend/components/top-bar/live-pill-model.ts";

const off = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, helperWork: 0, claimedLessons: [] };
const teaching = { ...off, connected: true, teaching: true, name: "Claude Code" };
const reading = { text: "Reading Lecture 14 notes", count: "3 of 12", working: true };
const nothing = { name: "marco", doing: null, agent: teaching, terminal: null, background: false, work: null, ready: [], due: null, offer: null };
const helper = { doing: "Reading files", count: "6 of 17", tag: "6 of 17 files" };
const homework = { id: "hw5", spaceId: "c21", name: "Homework 5", date: "2026-11-15", time: "23:59" };
const words = (i: Parameters<typeof pillThings>[0]) => pillThings(i).map((t) => [t.head, t.detail, t.count].filter(Boolean).join(" "));

describe("the live things", () => {
	it("none while the teacher has nothing to say", () => {
		assert.deepEqual(pillThings(nothing), []);
		assert.deepEqual(pillThings({ ...nothing, doing: { text: "Idle", working: false } }), []);
		assert.deepEqual(pillThings({ ...nothing, doing: reading, agent: null }), [], "before the agent's state is read");
	});

	it("the teacher at work: what it does and how far it is, on the highlighter, its square breathing", () => {
		const [thing] = pillThings({ ...nothing, doing: reading });
		assert.deepEqual(thing, { kind: "teacher", key: "teacher", head: "marco", detail: "reading Lecture 14 notes", count: "3 of 12", due: null, lit: true, working: true, tag: null, needs: false, action: null });
	});

	it("godspeed's own terminal: starting, or needing the learner", () => {
		assert.deepEqual(words({ ...nothing, agent: off, terminal: "starting" }), ["marco starting"]);
		assert.deepEqual(words({ ...nothing, agent: null, terminal: "starting" }), ["marco starting"]);
		const [needs] = pillThings({ ...nothing, doing: reading, terminal: "needsYou" });
		assert.deepEqual([needs!.detail, needs!.needs, needs!.action, needs!.lit, needs!.working], ["needs you", true, null, true, false]);
	});

	it("background work needing the learner, by its name, after the teacher's own need", () => {
		const [first, second] = pillThings({ ...nothing, doing: reading, terminal: "needsYou", background: true });
		assert.deepEqual([first!.kind, second!.kind, second!.head, second!.detail, second!.needs, second!.lit], ["teacher", "background", "Background work", "needs you", true, true]);
		assert.deepEqual(words({ ...nothing, doing: reading, background: true }), ["Background work needs you", "marco reading Lecture 14 notes 3 of 12"]);
	});

	it("says so while the helper answers", () => {
		assert.deepEqual(words({ ...nothing, doing: reading, agent: { ...teaching, helperCovering: true } }), ["marco tidying its memory"]);
	});

	it("with Follow off, a fresh change on another page", () => {
		assert.deepEqual(words({ ...nothing, offer: "Adding Lab 4" }), ["marco adding Lab 4"]);
		assert.deepEqual(words({ ...nothing, doing: reading, offer: "Adding Lab 4" }), ["marco reading Lecture 14 notes 3 of 12"], "the work it does now comes first");
	});

	it("what waits for the learner first, then what works, then the deadline", () => {
		const all = { ...nothing, doing: reading, work: helper, ready: [{ id: "l1", title: "Counting" }], due: homework };
		assert.deepEqual(words(all), ["Counting your turn", "marco reading Lecture 14 notes 3 of 12", "Reading files 6 of 17", "Homework 5 due in"]);
		assert.deepEqual(words({ ...all, terminal: "needsYou" }), ["marco needs you", "Counting your turn", "Reading files 6 of 17", "Homework 5 due in"]);
	});

	it("a lesson and a deadline open with a click; their key is their id", () => {
		const [lesson, due] = pillThings({ ...nothing, ready: [{ id: "l1", title: "Counting" }], due: homework });
		assert.deepEqual([lesson!.kind, lesson!.key, lesson!.action], ["ready", "l1", "open"]);
		assert.deepEqual([due!.kind, due!.key, due!.due, due!.action], ["due", "hw5", homework, "open"]);
	});
});

describe("the pill", () => {
	const things = pillThings({ ...nothing, doing: reading, work: helper, due: homework });

	it("says the first live thing, with background work as a tag", () => {
		const line = pillLine({ things, notice: null, idle: "marco" });
		assert.deepEqual([line.head, line.thing, line.lit, line.tag?.tag], ["marco", things[0], true, "6 of 17 files"]);
	});

	it("says a notice that just came; the live thing moves to the tag", () => {
		const line = pillLine({ things: things.slice(1), notice: "Claude Code saved a rule", idle: "marco" });
		assert.deepEqual([line.head, line.thing, line.lit, line.tag?.tag], ["Claude Code saved a rule", null, true, "6 of 17 files"]);
	});

	it("the teacher is never a tag", () => {
		assert.equal(pillLine({ things, notice: "godspeed 0.6.7 is ready", idle: "marco" }).tag, null);
	});

	it("with nothing live: the teacher's name, or the agent's state when none is teaching", () => {
		const idle = (agent: Parameters<typeof idleWords>[0]["agent"]) => idleWords({ name: "marco", agent, notices: 2, own: false });
		assert.deepEqual(pillLine({ things: [], notice: null, idle: idle(teaching) }), { head: "marco", thing: null, lit: false, tag: null, idle: true });
		assert.equal(idle(off), "No agent connected");
		assert.equal(idle({ ...off, connected: true, name: "Codex" }), "Codex connected, not teaching");
		assert.equal(idle({ ...off, pendingWork: 1 }), "Waiting for your agent");
		assert.equal(idle(null), "marco", "before the agent's state is read");
	});

	it("in a page's own bar with nothing live: the notices it holds, or nothing", () => {
		assert.equal(idleWords({ name: "marco", agent: teaching, notices: 0, own: true }), "");
		assert.equal(idleWords({ name: "marco", agent: teaching, notices: 1, own: true }), "1 notice");
		assert.equal(idleWords({ name: "marco", agent: off, notices: 2, own: true }), "2 notices");
	});

	it("out of room, a long name keeps its first letters and what happens its first word", () => {
		assert.equal(shortName("Quigley"), "Quigley");
		assert.equal(shortName("Claude Code"), "Claude Code", "one letter is not worth an ellipsis");
		assert.equal(shortName("Homework 5: graphing pairs"), "Homework 5…");
		assert.equal(firstWord("reading Lecture 14 notes"), "reading…");
		assert.equal(firstWord("working"), "working");
		assert.equal(firstWord("your turn"), "your turn", "too short to cut");
	});

	it("beside a teacher head the teacher shows only while it needs the learner", () => {
		const beside = { own: true, named: true };
		assert.deepEqual(thingsAt(things, beside).map((t) => t.kind), ["work", "due"]);
		assert.deepEqual(thingsAt(things, { own: true, named: false }), things);
		const needs = pillThings({ ...nothing, doing: reading, terminal: "needsYou", due: homework });
		assert.deepEqual(thingsAt(needs, beside).map((t) => t.kind), ["teacher", "due"]);
	});
});

describe("a click on the pill", () => {
	const app = { own: false, named: false };
	const lesson = { own: true, named: true };
	const [work] = pillThings({ ...nothing, work: helper });
	it("opens the teacher's panel on the agent's screen, or closes it; it never holds one key in a card", () => {
		assert.deepEqual(pillClick({ main: null, place: app, panelOpen: false, notices: 2 }), { open: "teacher" });
		assert.deepEqual(pillClick({ main: work!, place: app, panelOpen: false, notices: 0 }), { open: "teacher" });
		assert.equal(pillClick({ main: work!, place: app, panelOpen: true, notices: 0 }), "close");
	});
	it("background work's need opens its own view, in the app's bar and in a lesson's", () => {
		const [need] = pillThings({ ...nothing, background: true });
		assert.ok(need!.lit, "the pill lights");
		assert.deepEqual(pillClick({ main: need!, place: app, panelOpen: false, notices: 0 }), { open: "helper" });
		assert.deepEqual(pillClick({ main: need!, place: lesson, panelOpen: false, notices: 0 }), { open: "helper" });
		const [teacher] = pillThings({ ...nothing, terminal: "needsYou", background: true });
		assert.deepEqual(pillClick({ main: teacher!, place: lesson, panelOpen: false, notices: 0 }), { open: "teacher" }, "the teacher's own need first");
	});
	it("in a page's own bar: the folded notices, or nothing to do", () => {
		assert.equal(pillClick({ main: work!, place: lesson, panelOpen: false, notices: 1 }), "notices");
		assert.equal(pillClick({ main: work!, place: lesson, panelOpen: false, notices: 0 }), null);
	});
	it("the open panel closes from a page's own bar too", () => {
		assert.equal(pillClick({ main: null, place: lesson, panelOpen: true, notices: 1 }), "close");
	});
});

describe("the lessons whose reply waits", () => {
	const chats = [
		{ id: "l1", title: "Counting" },
		{ id: "l2", title: "Proofs" },
	];

	it("a settled lesson joins last, once", () => {
		assert.deepEqual(keepReady([], chats, "l2"), [{ id: "l2", title: "Proofs" }]);
		assert.deepEqual(keepReady([chats[1]!, chats[0]!], chats, "l2"), [chats[0], chats[1]]);
	});

	it("a chat that is not a lesson adds nothing", () => {
		assert.deepEqual(keepReady([chats[0]!], chats, "talk"), [chats[0]]);
	});

	it("a deleted lesson drops out and a renamed one takes its new title", () => {
		assert.deepEqual(keepReady([{ id: "gone", title: "Old" }, { id: "l1", title: "Count" }], chats, null), [chats[0]]);
	});
});

describe("the deadline in its last day", () => {
	const now = new Date(2026, 10, 14, 12, 0).getTime();
	const at = (id: string, date: string, time?: string) => ({ id, spaceId: "c21", name: id, date, ...(time ? { time } : {}) });

	const soon = [at("week", "2026-11-20", "10:00"), at("tonight", "2026-11-14", "23:59"), at("sooner", "2026-11-14", "18:00")];

	it("the soonest one due within 24 hours", () => {
		assert.equal(dueSoon(soon, now, "/space")?.id, "sooner");
	});

	it("none when the next is a day away or already past", () => {
		assert.equal(dueSoon([at("past", "2026-11-14", "09:00"), at("later", "2026-11-15", "12:30")], now, "/space"), null);
		assert.equal(dueSoon([], now, "/space"), null);
	});

	it("none on Today, which lists them, and not the one whose own page is open", () => {
		assert.equal(dueSoon(soon, now, "/"), null);
		assert.equal(dueSoon(soon, now, "/space/deadline/sooner")?.id, "tonight");
		assert.equal(dueSoon(soon, now, "/space/deadline/sooner/cheat-sheet")?.id, "tonight");
		assert.equal(dueSoon(soon, now, "/space/deadlines")?.id, "sooner");
	});
});
