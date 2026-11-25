import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHECK_IN_WAIT_MS,
	gridSize,
	needsYou,
	statusFromTerminals,
	teacherStartRefused,
	screenStatusLine,
	type TerminalFacts,
	type TerminalRecord,
} from "../../src/frontend/components/terminal/terminal-model.ts";

const T0 = 1_000_000;
const term = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", agent: "claude", startedAt: T0, ended: null, prompt: null, url: false, ...over });
const facts = (over: Partial<TerminalFacts> = {}, t: Partial<TerminalRecord> = {}): TerminalFacts => ({ term: term(t), checkedIn: true, outsideHere: false, now: T0 + 1000, ...over });

describe("when the screen opens by itself", () => {
	it("a question on the screen, a crash and a missing agent open it", () => {
		assert.equal(needsYou(facts({}, { prompt: "menu" })), "prompt");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 1 } })), "crashed");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: null } })), "crashed", "a screen godspeed could not read");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 3 } })), "missing");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 4 } })), "missing");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 6 } })), "missing");
	});

	it("the learner's own Stop and a clean exit open nothing", () => {
		assert.equal(needsYou(facts({}, { ended: { stopped: true, code: null } })), null);
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 0 } })), null);
	});

	it("no check-in 20 s after the start opens it, not before", () => {
		assert.equal(needsYou(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS - 1 })), null);
		assert.equal(needsYou(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS })), "no-check-in");
	});

	it("after the first check-in, a long quiet is no reason to open it", () => {
		const later = { checkedIn: true, now: T0 + 10 * 60_000 };
		assert.equal(needsYou(facts(later)), null);
		assert.equal(screenStatusLine(facts(later), "Ada"), null);
	});
});

describe("the teacher's status line", () => {
	it("starting, what it needs from the learner, else the usual line", () => {
		assert.equal(screenStatusLine(null, "Ada"), null);
		assert.equal(screenStatusLine(facts({ checkedIn: false }), "Ada"), "Ada is starting.");
		assert.equal(screenStatusLine(facts({}, { prompt: "trust" }), "Ada"), "Ada asks to trust its folder.");
		assert.equal(screenStatusLine(facts({}, { prompt: "enter" }), "Ada"), "Ada is asking you to continue.");
		assert.equal(screenStatusLine(facts({}, { prompt: "menu" }), "Ada"), "Ada is asking you something.");
		assert.equal(screenStatusLine(facts({ checkedIn: false }, { prompt: "menu" }), "Ada"), "Ada is asking you something.");
		assert.equal(screenStatusLine(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS }), "Ada"), "Ada hasn't connected to godspeed yet.");
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: false, code: 1 } }), "Ada"), "Ada closed with an error.");
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: false, code: 3 } }), "Ada"), "Claude Code isn't installed on this computer.");
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: false, code: 4 } }), "Ada"), "godspeed needs Node.js to connect Claude Code.");
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: false, code: 6 } }), "Ada"), "Claude Code needs an update.");
		assert.equal(screenStatusLine(facts(), "Ada"), null);
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: true, code: null } }), "Ada"), null);
		assert.equal(screenStatusLine(facts({ outsideHere: true }, { ended: { stopped: false, code: 1 } }), "Ada"), null, "an agent outside godspeed teaches now");
	});

	it("no line has an em-dash or a dot divider", () => {
		const all = [
			facts({ checkedIn: false }),
			facts({}, { prompt: "trust" }),
			facts({}, { prompt: "enter" }),
			facts({}, { prompt: "menu" }),
			facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS }, { url: true }),
			facts({}, { ended: { stopped: false, code: 1 } }),
			facts({}, { ended: { stopped: false, code: 3 } }),
			facts({}, { ended: { stopped: false, code: 4 } }),
			facts({}, { ended: { stopped: false, code: 5 } }),
			facts({}, { ended: { stopped: false, code: 6 } }),
		].map((f) => screenStatusLine(f, "Ada"));
		for (const text of all) assert.ok(text && !text.includes("—") && !text.includes(" · "), text ?? "no line");
	});
});

describe("which start is allowed", () => {
	it("one teacher at a time, and none beside an agent from outside godspeed", () => {
		assert.equal(teacherStartRefused(null, false), null);
		assert.equal(teacherStartRefused(term(), false), "running");
		assert.equal(teacherStartRefused(term({ ended: { stopped: true, code: null } }), false), null);
		assert.equal(teacherStartRefused(null, true), "outside");
	});
});

describe("the screen's size", () => {
	it("is the columns and rows that fit its box, at one font size", () => {
		assert.deepEqual(gridSize(404, 700, { width: 8, height: 22 }), { cols: 50, rows: 31 });
		assert.deepEqual(gridSize(407.9, 703, { width: 8, height: 22 }), { cols: 50, rows: 31 }, "never a column or row that is cut");
		assert.deepEqual(gridSize(100, 50, { width: 8, height: 22 }), { cols: 40, rows: 10 }, "too small a box scrolls inside");
		assert.deepEqual(gridSize(9000, 9000, { width: 8, height: 22 }), { cols: 200, rows: 100 });
		// Before xterm has drawn a cell: 13 px type.
		assert.deepEqual(gridSize(404, 700), { cols: 50, rows: 31 });
	});
});

describe("the status the terminals correct", () => {
	it("says none connected once godspeed's teacher ended or before it checked in, though the server still says connected; the pick stays", () => {
		const server = { connected: true, name: "Claude Code" };
		const none = { connected: false };
		assert.deepEqual(statusFromTerminals(server, term({ ended: { stopped: true, code: null } }), false), none);
		assert.deepEqual(statusFromTerminals(server, term(), false), none, "starting, not checked in");
		assert.ok(statusFromTerminals(server, term(), true) === server, "checked in: the server's word");
		assert.ok(statusFromTerminals(server, null, false) === server, "never started here: the server's word");
		assert.equal(statusFromTerminals(null, term(), false), null);
		const quiet = { connected: false };
		assert.deepEqual(statusFromTerminals(quiet, term(), true), { connected: true }, "its own teacher, checked in, is connected; picking is the server's");
	});
});
