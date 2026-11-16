import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHECK_IN_WAIT_MS,
	TEACH_WAIT_MS,
	firstRunFooter,
	gridSize,
	helperShouldStart,
	needsYou,
	restartAsks,
	statusFromTerminals,
	teacherStartRefused,
	screenStatusLine,
	terminalFooter,
	wakeAgent,
	type TerminalFacts,
	type TerminalRecord,
} from "../../src/frontend/components/terminal/terminal-model.ts";

const T0 = 1_000_000;
const term = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", role: "teacher", agent: "claude", startedAt: T0, ended: null, prompt: null, url: false, ...over });
const facts = (over: Partial<TerminalFacts> = {}, t: Partial<TerminalRecord> = {}): TerminalFacts => ({ term: term(t), checkedIn: true, outsideHere: false, teaching: true, now: T0 + 1000, quietSince: null, helperBusy: false, ...over });
/** The full words (the helper, onboarding), and the panel's under the status line. */
const words = (f: TerminalFacts) => terminalFooter(f, "Ada", false);
const tab = (f: TerminalFacts) => terminalFooter(f, "Ada", true);

describe("when the screen opens by itself", () => {
	it("a question on the screen, a crash and a missing agent open it", () => {
		assert.equal(needsYou(facts({}, { prompt: "menu" })), "prompt");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 1 } })), "crashed");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: null } })), "crashed", "a screen godspeed could not read");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 3 } })), "missing");
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 4 } })), "missing");
	});

	it("the learner's own Stop and a clean exit open nothing", () => {
		assert.equal(needsYou(facts({}, { ended: { stopped: true, code: null } })), null);
		assert.equal(needsYou(facts({}, { ended: { stopped: false, code: 0 } })), null);
	});

	it("no check-in 20 s after the start opens it, not before", () => {
		assert.equal(needsYou(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS - 1 })), null);
		assert.equal(needsYou(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS })), "no-check-in");
	});

	it("checked in but not teaching for 30 s while a turn waits opens it", () => {
		const quiet = { teaching: false, quietSince: T0 };
		assert.equal(needsYou(facts({ ...quiet, now: T0 + TEACH_WAIT_MS - 1 })), null);
		assert.equal(needsYou(facts({ ...quiet, now: T0 + TEACH_WAIT_MS })), "not-teaching");
		assert.equal(needsYou(facts({ teaching: false, now: T0 + 10 * TEACH_WAIT_MS })), null, "no turn waits");
	});

	it("after the first check-in, a long wait or turn with no request is no reason to open it", () => {
		const later = { checkedIn: true, now: T0 + 10 * 60_000 };
		assert.equal(needsYou(facts(later)), null, "10 minutes into one wait_for_work");
		assert.equal(needsYou(facts({ ...later, teaching: false })), null, "idle, no turn waits");
		assert.equal(tab(facts(later)).text, null);
		assert.equal(screenStatusLine(facts(later), "Ada"), null);
	});

	it("the timers count only for the teacher", () => {
		assert.equal(needsYou(facts({ checkedIn: false, now: T0 + 10 * CHECK_IN_WAIT_MS }, { role: "helper" })), null);
		assert.equal(needsYou(facts({}, { role: "helper", prompt: "trust" })), "prompt");
	});
});

describe("the footer's words", () => {
	it("starting, then running: under the status line, only what it adds", () => {
		assert.equal(words(facts({ checkedIn: false })).text, "Claude Code is starting.");
		assert.equal(tab(facts({ checkedIn: false })).text, null);
		assert.equal(tab(facts()).text, null, "the status line says it runs");
	});

	it("the trust question gets the one assist key", () => {
		const f = words(facts({ checkedIn: false }, { prompt: "trust" }));
		assert.equal(f.text, "Claude Code asks to trust its folder.");
		assert.equal(tab(facts({ checkedIn: false }, { prompt: "trust" })).text, null);
		assert.deepEqual(f.assist, { kind: "trust", label: "Trust folder" });
		assert.equal(f.startAgain, false);
	});

	it("Continue says it all: under the status line, no sentence", () => {
		assert.equal(tab(facts({}, { prompt: "enter" })).text, null);
		assert.equal(words(facts({}, { prompt: "enter" })).text, "Claude Code is asking you to continue.");
	});

	it("a sign-in: a link or a menu before the first check-in", () => {
		const signIn = "Finish signing in to Codex. Got a code? Click Paste.";
		assert.equal(words(facts({ checkedIn: false }, { agent: "codex", url: true })).text, signIn);
		assert.equal(words(facts({ checkedIn: false }, { agent: "codex", prompt: "menu" })).text, signIn);
		assert.equal(tab(facts({ checkedIn: false }, { agent: "codex", prompt: "menu" })).text, "Got a code? Click Paste.");
		assert.equal(tab(facts({ checkedIn: false }, { url: true })).text, "Finish signing in to Claude Code. Got a code? Click Paste.", "the status line still says it starts");
		assert.equal(words(facts({}, { prompt: "menu" })).text, "Claude Code is asking you something.");
		assert.equal(tab(facts({}, { prompt: "menu" })).text, null);
	});

	it("the timers", () => {
		const late = "Ada hasn't started teaching yet.";
		assert.equal(words(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS })).text, late);
		assert.equal(words(facts({ teaching: false, quietSince: T0, now: T0 + TEACH_WAIT_MS })).text, late);
		assert.equal(tab(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS })).text, null);
	});

	it("stopped, crashed, not installed, no Node", () => {
		const stopped = tab(facts({}, { ended: { stopped: true, code: null } }));
		assert.equal(stopped.text, "You stopped Ada.", "the status line says only that none is connected");
		assert.equal(stopped.startAgain, true);
		assert.equal(words(facts({}, { ended: { stopped: false, code: 1 } })).text, "Claude Code closed with an error.");
		assert.equal(tab(facts({}, { ended: { stopped: false, code: 1 } })).text, null);
		assert.equal(tab(facts({}, { ended: { stopped: false, code: 0 } })).text, "Claude Code closed.");
		const missing = words(facts({}, { agent: "codex", ended: { stopped: false, code: 3 } }));
		assert.equal(missing.text, "Codex isn't installed on this computer.");
		assert.deepEqual(missing.get, { label: "Get Codex", url: "https://developers.openai.com/codex" });
		assert.equal(tab(facts({}, { agent: "codex", ended: { stopped: false, code: 3 } })).text, null);
		assert.equal(words(facts({}, { ended: { stopped: false, code: 3 } })).get?.url, "https://claude.com/claude-code");
		const node = words(facts({}, { ended: { stopped: false, code: 4 } }));
		assert.equal(node.text, "godspeed needs Node.js to connect Claude Code.");
		assert.deepEqual(node.get, { label: "Get Node.js", url: "https://nodejs.org" });
		assert.equal(node.startAgain, true);
		const gone = words(facts({}, { ended: { stopped: false, code: 5 } }));
		assert.deepEqual([gone.text, gone.startAgain], ["Couldn't open that chat.", true]);
	});

	it("background work's footer leaves out what its own status chip says", () => {
		assert.equal(tab(facts({ helperBusy: true }, { role: "helper" })).text, "Reading your files.");
		assert.equal(tab(facts({}, { role: "helper" })).text, "Waiting for files.");
		assert.equal(tab(facts({}, { role: "helper", ended: { stopped: true, code: null } })).text, "Stopped.");
		assert.equal(tab(facts({}, { role: "helper", prompt: "trust" })).text, null);
		assert.equal(screenStatusLine(facts({}, { role: "helper", prompt: "trust" }), "Background work"), "Claude Code asks to trust its folder.");
	});

	it("an agent outside godspeed teaches: the status line says nothing of the old screen, so its footer says it all", () => {
		assert.equal(tab(facts({ outsideHere: true }, { ended: { stopped: false, code: 1 } })).text, "Claude Code closed with an error.");
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
		].flatMap((f) => [words(f).text, tab(f).text]);
		for (const text of all) assert.ok(!text?.includes("—") && !text?.includes(" · "), text ?? "");
	});
});

describe("the teacher's status line", () => {
	it("starting, what it needs from the learner, else the usual line", () => {
		assert.equal(screenStatusLine(null, "Ada"), null);
		assert.equal(screenStatusLine(facts({ checkedIn: false }), "Ada"), "Ada is starting.");
		assert.equal(screenStatusLine(facts({}, { prompt: "trust" }), "Ada"), "Claude Code asks to trust its folder.");
		assert.equal(screenStatusLine(facts({}, { prompt: "enter" }), "Ada"), "Claude Code is asking you to continue.");
		assert.equal(screenStatusLine(facts({}, { prompt: "menu" }), "Ada"), "Claude Code is asking you something.");
		assert.equal(screenStatusLine(facts({ checkedIn: false }, { prompt: "menu" }), "Ada"), "Finish signing in to Claude Code.");
		assert.equal(screenStatusLine(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS }), "Ada"), "Ada hasn't started teaching yet.");
		assert.equal(screenStatusLine(facts({ teaching: false, quietSince: T0, now: T0 + TEACH_WAIT_MS }), "Ada"), "Ada hasn't started teaching yet.");
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: false, code: 1 } }), "Ada"), "Claude Code closed with an error.");
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: false, code: 3 } }), "Ada"), "Claude Code isn't installed on this computer.");
		assert.equal(screenStatusLine(facts({}, { ended: { stopped: false, code: 4 } }), "Ada"), "godspeed needs Node.js to connect Claude Code.");
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

	it("the helper starts once per teacher run, after the check-in, while jobs wait", () => {
		const teacher = term();
		const base = { teacher, teacherCheckedIn: true, helper: null, helperHere: false, helperWork: 2 };
		assert.equal(helperShouldStart(base), true);
		assert.equal(helperShouldStart({ ...base, teacherCheckedIn: false }), false);
		assert.equal(helperShouldStart({ ...base, helperWork: 0 }), false);
		assert.equal(helperShouldStart({ ...base, helperHere: true }), false, "a helper from outside is here");
		assert.equal(helperShouldStart({ ...base, teacher: term({ ended: { stopped: true, code: null } }) }), false);
		const helper = term({ id: "h1", role: "helper", startedAt: T0 + 5 });
		assert.equal(helperShouldStart({ ...base, helper }), false, "one runs");
		assert.equal(helperShouldStart({ ...base, helper: { ...helper, ended: { stopped: false, code: 1 } } }), false, "never restarted in the same run");
		assert.equal(helperShouldStart({ ...base, helper: { ...helper, startedAt: T0 - 5, ended: { stopped: true, code: null } } }), true, "a new teacher run");
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

describe("onboarding's first start", () => {
	it("says the agent is starting, then connected; a question or an end uses the panel's full words", () => {
		const first = (over: Partial<TerminalFacts>, t: Partial<TerminalRecord> = {}) => firstRunFooter(facts(over, t), "~/godspeed");
		assert.equal(first({ checkedIn: false }).text, "Claude Code is starting in ~/godspeed. If it asks you something, answer it here.");
		assert.equal(first({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS + 1 }).text, "Claude Code is starting in ~/godspeed. If it asks you something, answer it here.", "no timer words here");
		assert.equal(first({ checkedIn: true }).text, "Claude Code is connected.");
		const trust = first({ checkedIn: false }, { prompt: "trust" });
		assert.equal(trust.assist?.label, "Trust folder");
		assert.match(first({ checkedIn: false }, { url: true }).text ?? "", /^Finish signing in to Claude Code/);
		assert.equal(first({}, { ended: { stopped: true, code: null } }).text, "You stopped Claude Code.");
	});
});

describe("starting the teacher hidden, and restarting", () => {
	it("Start lesson and a lesson's send start the agent last started here, only when nothing is here, runs or starts", () => {
		const base = { teacher: null, agentHere: false, outsideHere: false, saved: "codex" };
		assert.equal(wakeAgent(base), "codex");
		assert.equal(wakeAgent({ ...base, saved: null }), null, "never started in godspeed: the no-agent line offers Start");
		assert.equal(wakeAgent({ ...base, saved: "other" }), null);
		assert.equal(wakeAgent({ ...base, agentHere: true }), null);
		assert.equal(wakeAgent({ ...base, outsideHere: true }), null);
		assert.equal(wakeAgent({ ...base, teacher: term() }), null, "one already runs or starts");
		assert.equal(wakeAgent({ ...base, teacher: term({ ended: { stopped: true, code: null } }) }), "codex");
		assert.equal(wakeAgent({ ...base, teacher: term({ ended: { stopped: false, code: 0 } }) }), "codex", "it closed itself");
		assert.equal(wakeAgent({ ...base, teacher: term({ ended: { stopped: false, code: 1 } }) }), null, "a crash waits for Start again");
		assert.equal(wakeAgent({ ...base, teacher: term({ ended: { stopped: false, code: null } }) }), null, "a screen godspeed could not read");
		assert.equal(wakeAgent({ ...base, teacher: term({ ended: { stopped: false, code: 3 } }) }), null, "not installed");
		assert.equal(wakeAgent({ ...base, teacher: term({ ended: { stopped: false, code: 4 } }) }), null, "no Node.js");
	});

	it("the status says no agent once godspeed's teacher ended or before it checked in, though the server still says connected", () => {
		const server = { connected: true, teaching: true, helperHere: true, helperCovering: true, name: "Claude Code", pendingWork: 1 };
		const none = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 1 };
		assert.deepEqual(statusFromTerminals(server, term({ ended: { stopped: true, code: null } }), false), none);
		assert.deepEqual(statusFromTerminals(server, term(), false), none, "starting, not checked in");
		assert.ok(statusFromTerminals(server, term(), true) === server, "checked in: the server's word");
		assert.ok(statusFromTerminals(server, null, false) === server, "never started here: the server's word");
		assert.equal(statusFromTerminals(null, term(), false), null);
		const quiet = { ...server, connected: false, teaching: false };
		assert.deepEqual(statusFromTerminals(quiet, term(), true), { ...quiet, connected: true, teaching: true }, "its own teacher, checked in and quiet, is ready");
	});

	it("Restart now asks first only while the teacher's terminal runs and a turn waits", () => {
		assert.equal(restartAsks(term(), 1), true);
		assert.equal(restartAsks(term(), 0), false);
		assert.equal(restartAsks(null, 2), false);
		assert.equal(restartAsks(term({ ended: { stopped: false, code: 1 } }), 2), false);
	});
});
