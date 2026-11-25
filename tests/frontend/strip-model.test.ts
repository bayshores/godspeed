/**
 * The strip's model (strip-model.ts): what the strip marks at rest, the
 * rows its peek lists, what a click does, the lessons whose reply waits
 * and the deadline in its last day.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dueSoon, keepReady, noticeCount, stripClick, stripView } from "../../src/frontend/components/strip/strip-model.ts";

const off = { connected: false, turnsRunning: 0 };
const teaching = { ...off, connected: true, name: "Claude Code" };
const nothing = { agent: teaching, terminal: null, working: false, work: null, ready: [], asking: [], panelOpen: false };
const reading = { doing: "Reading files", count: "6 of 17" };
const counting = { id: "l1", title: "Counting" };

describe("the strip at rest", () => {
	it("marks nothing while nothing is live: a still square", () => {
		assert.deepEqual(stripView(nothing), { square: "still", need: false, ask: null, flag: null, rows: [] });
	});

	it("its square breathes while the teacher works, and is hollow before the agent's state is read", () => {
		assert.equal(stripView({ ...nothing, working: true }).square, "working");
		assert.equal(stripView({ ...nothing, working: true, agent: null }).square, "off", "before the agent's state is read");
		assert.equal(stripView({ ...nothing, agent: off }).square, "still", "lessons and jobs need no terminal");
		assert.equal(stripView({ ...nothing, agent: null, terminal: "starting" }).square, "still", "godspeed's own terminal starts it");
		assert.equal(stripView({ ...nothing, working: true, terminal: "needsYou" }).square, "still", "it waits for the learner");
	});

	it("puts what waits for the learner on the highlighter: an agent's screen first, then a reply in another lesson", () => {
		assert.deepEqual([stripView({ ...nothing, terminal: "needsYou" }).flag, stripView({ ...nothing, terminal: "needsYou" }).need], ["needs you", true]);
		assert.deepEqual([stripView({ ...nothing, ready: [counting] }).flag, stripView({ ...nothing, ready: [counting] }).need], ["your turn", false]);
		assert.equal(stripView({ ...nothing, ready: [counting], terminal: "needsYou" }).flag, "needs you");
		assert.equal(stripView({ ...nothing, work: reading, working: true }).flag, null, "work under way waits for nobody");
	});

	it("says needs you while a lesson's teacher waits for the learner to allow something, also beside the open panel", () => {
		const asks = stripView({ ...nothing, working: true, asking: ["l1", "l2"], ready: [counting] });
		assert.deepEqual([asks.flag, asks.ask, asks.need, asks.square], ["needs you", "l1", false, "still"], "the oldest, and the teacher waits");
		assert.equal(stripView({ ...nothing, asking: ["l1"], panelOpen: true }).flag, "needs you", "the panel's head does not say it");
	});

	it("beside the open panel it leaves out what the panel's head says", () => {
		const open = stripView({ ...nothing, terminal: "needsYou", ready: [counting], panelOpen: true });
		assert.deepEqual([open.need, open.flag], [false, "your turn"]);
		assert.deepEqual(open.rows, [{ kind: "ready", lesson: counting }]);
		assert.deepEqual(stripView({ ...nothing, terminal: "needsYou", panelOpen: true }), { square: "still", need: false, ask: null, flag: null, rows: [] });
	});
});

describe("the peek's rows", () => {
	it("first what waits for the learner, then what works", () => {
		const second = { id: "l2", title: "Limits" };
		assert.deepEqual(stripView({ ...nothing, work: reading, ready: [counting, second] }).rows, [
			{ kind: "ready", lesson: counting },
			{ kind: "ready", lesson: second },
			{ kind: "work", work: reading },
		]);
	});

	it("the teacher's own need is the status row's, never a row of its own", () => {
		assert.deepEqual(stripView({ ...nothing, terminal: "needsYou" }).rows, []);
	});

	it("counts the folded notices in words", () => {
		assert.equal(noticeCount(1), "1 notice");
		assert.equal(noticeCount(2), "2 notices");
	});
});

describe("a click on the strip", () => {
	it("opens the teacher's panel, or closes it", () => {
		assert.equal(stripClick(false, null, false), "open");
		assert.equal(stripClick(false, null, true), "close");
	});
	it("shows the teacher's screen that needs the learner", () => {
		assert.equal(stripClick(true, null, false), "show");
	});
	it("goes to the lesson that waits for the learner to allow something, after the teacher's own screen", () => {
		assert.deepEqual(stripClick(false, "l1", true), { lesson: "l1" });
		assert.equal(stripClick(true, "l1", false), "show");
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

	it("none on Home, which lists them, and not the one whose own page is open", () => {
		assert.equal(dueSoon(soon, now, "/"), null);
		assert.equal(dueSoon(soon, now, "/space/deadline/sooner")?.id, "tonight");
		assert.equal(dueSoon(soon, now, "/space/deadline/sooner/cheat-sheet")?.id, "tonight");
		assert.equal(dueSoon(soon, now, "/space/deadlines")?.id, "sooner");
	});
});
