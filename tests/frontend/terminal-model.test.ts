import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHECK_IN_WAIT_MS,
	gridSize,
	needsYou,
	statusFromTerminals,
	teacherStartRefused,
	screenStatusLine,
	terminalFooter,
	type TerminalFacts,
	type TerminalRecord,
} from "../../src/frontend/components/terminal/terminal-model.ts";

const T0 = 1_000_000;
const term = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", agent: "claude", startedAt: T0, ended: null, prompt: null, url: false, ...over });
const facts = (over: Partial<TerminalFacts> = {}, t: Partial<TerminalRecord> = {}): TerminalFacts => ({ term: term(t), checkedIn: true, outsideHere: false, now: T0 + 1000, ...over });
/** The full words (onboarding), and the panel's under the status line. */
const words = (f: TerminalFacts) => terminalFooter(f, "Ada", false);
const tab = (f: TerminalFacts) => terminalFooter(f, "Ada", true);

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
		assert.equal(tab(facts(later)).text, null);
		assert.equal(screenStatusLine(facts(later), "Ada"), null);
	});
});

describe("the footer's words", () => {
	it("starting, then running: under the status line, only what it adds", () => {
		assert.equal(words(facts({ checkedIn: false })).text, "Ada is starting.");
		assert.equal(tab(facts({ checkedIn: false })).text, null);
		assert.equal(tab(facts()).text, null, "the status line says it runs");
	});

	it("the trust question gets the one assist key", () => {
		const f = words(facts({ checkedIn: false }, { prompt: "trust" }));
		assert.equal(f.text, "Ada asks to trust its folder.");
		assert.equal(tab(facts({ checkedIn: false }, { prompt: "trust" })).text, null);
		assert.deepEqual(f.assist, { kind: "trust", label: "Trust folder" });
		assert.equal(f.startAgain, false);
	});

	it("Continue says it all: under the status line, no sentence", () => {
		assert.equal(tab(facts({}, { prompt: "enter" })).text, null);
		assert.equal(words(facts({}, { prompt: "enter" })).text, "Ada is asking you to continue.");
	});

	it("a sign-in: a link before the first check-in; a menu then is a question like any other", () => {
		assert.equal(words(facts({ checkedIn: false }, { agent: "codex", url: true })).text, "Finish signing in to Codex. Got a code? Click Paste.");
		assert.equal(words(facts({ checkedIn: false }, { agent: "codex", prompt: "menu" })).text, "Ada is asking you something.");
		assert.equal(tab(facts({ checkedIn: false }, { url: true })).text, "Finish signing in to Claude Code. Got a code? Click Paste.", "the status line still says it starts");
		assert.equal(words(facts({}, { prompt: "menu" })).text, "Ada is asking you something.");
		assert.equal(tab(facts({}, { prompt: "menu" })).text, null);
	});

	it("the check-in timer", () => {
		const late = "Ada hasn't connected to godspeed yet.";
		assert.equal(words(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS })).text, late);
		assert.equal(tab(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS })).text, null);
	});

	it("stopped, crashed, not installed, no Node", () => {
		const stopped = tab(facts({}, { ended: { stopped: true, code: null } }));
		assert.equal(stopped.text, "You stopped Ada.", "the status line says only that none is connected");
		assert.equal(stopped.startAgain, true);
		assert.equal(words(facts({}, { ended: { stopped: false, code: 1 } })).text, "Ada closed with an error.");
		assert.equal(tab(facts({}, { ended: { stopped: false, code: 1 } })).text, null);
		assert.equal(tab(facts({}, { ended: { stopped: false, code: 0 } })).text, "Ada closed.");
		const missing = words(facts({}, { agent: "codex", ended: { stopped: false, code: 3 } }));
		assert.equal(missing.text, "Codex isn't installed on this computer.");
		assert.deepEqual(missing.get, { label: "Get Codex", url: "https://developers.openai.com/codex" });
		assert.equal(tab(facts({}, { agent: "codex", ended: { stopped: false, code: 3 } })).text, null);
		assert.equal(words(facts({}, { ended: { stopped: false, code: 3 } })).get?.url, "https://claude.com/claude-code");
		const node = words(facts({}, { ended: { stopped: false, code: 4 } }));
		assert.equal(node.text, "godspeed needs Node.js to connect Claude Code.");
		assert.deepEqual(node.get, { label: "Get Node.js", url: "https://nodejs.org" });
		assert.equal(node.startAgain, true);
		const old = words(facts({}, { ended: { stopped: false, code: 6 } }));
		assert.deepEqual([old.text, old.get, old.startAgain], ["Claude Code needs an update.", null, true]);
		const gone = words(facts({}, { ended: { stopped: false, code: 5 } }));
		assert.deepEqual([gone.text, gone.startAgain], ["Couldn't open that chat.", true]);
	});

	it("an agent outside godspeed teaches: the status line says nothing of the old screen, so its footer says it all", () => {
		assert.equal(tab(facts({ outsideHere: true }, { ended: { stopped: false, code: 1 } })).text, "Ada closed with an error.");
	});

	it("no sentence has an em-dash or a dot divider", () => {
		const all = [
			facts({ checkedIn: false }),
			facts(),
			facts({}, { prompt: "trust" }),
			facts({}, { prompt: "enter" }),
			facts({}, { prompt: "menu" }),
			facts({ checkedIn: false }, { url: true }),
			facts({}, { ended: { stopped: true, code: null } }),
			facts({}, { ended: { stopped: false, code: 1 } }),
			facts({}, { ended: { stopped: false, code: 0 } }),
			facts({}, { ended: { stopped: false, code: 3 } }),
			facts({}, { ended: { stopped: false, code: 4 } }),
			facts({}, { ended: { stopped: false, code: 6 } }),
		].flatMap((f) => [words(f).text, tab(f).text]);
		for (const text of all) assert.ok(!text?.includes("—") && !text?.includes(" · "), text ?? "");
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
