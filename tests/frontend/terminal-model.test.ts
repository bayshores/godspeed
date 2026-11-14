import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHECK_IN_WAIT_MS,
	TEACH_WAIT_MS,
	firstRunFooter,
	fitFontSize,
	helperShouldStart,
	needsYou,
	restartAsks,
	statusFromTerminals,
	teacherStartRefused,
	teacherStatusLine,
	terminalFooter,
	wakeAgent,
	type TerminalFacts,
	type TerminalRecord,
} from "../../src/frontend/components/terminal/terminal-model.ts";

const T0 = 1_000_000;
const term = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", role: "teacher", agent: "claude", startedAt: T0, ended: null, prompt: null, url: false, ...over });
const facts = (over: Partial<TerminalFacts> = {}, t: Partial<TerminalRecord> = {}): TerminalFacts => ({ term: term(t), checkedIn: true, outsideHere: false, teaching: true, now: T0 + 1000, quietSince: null, helperBusy: false, ...over });
const names = { name: "Ada", folder: "~/godspeed" };
const words = (f: TerminalFacts) => terminalFooter(f, names);

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
		assert.equal(words(facts(later)).text, "Ada is running in ~/godspeed.");
		assert.equal(teacherStatusLine(facts(later), "Ada"), null);
	});

	it("the timers count only for the teacher", () => {
		assert.equal(needsYou(facts({ checkedIn: false, now: T0 + 10 * CHECK_IN_WAIT_MS }, { role: "helper" })), null);
		assert.equal(needsYou(facts({}, { role: "helper", prompt: "trust" })), "prompt");
	});
});

describe("the footer's words", () => {
	it("starting, then running", () => {
		assert.equal(words(facts({ checkedIn: false })).text, "Claude Code is starting in ~/godspeed. If it asks you something, answer it here.");
		assert.equal(words(facts()).text, "Ada is running in ~/godspeed.");
	});

	it("the trust question gets the one assist key", () => {
		const f = words(facts({ checkedIn: false }, { prompt: "trust" }));
		assert.equal(f.text, "Claude Code asks whether it may work in ~/godspeed. godspeed made this folder for it.");
		assert.deepEqual(f.assist, { kind: "trust", label: "Yes, trust this folder" });
		assert.equal(f.startAgain, false);
	});

	it("a sign-in: a link or a menu before the first check-in", () => {
		const signIn = "Finish signing in to Codex in your browser. If it gives you a code, copy it and click Paste.";
		assert.equal(words(facts({ checkedIn: false }, { agent: "codex", url: true })).text, signIn);
		assert.equal(words(facts({ checkedIn: false }, { agent: "codex", prompt: "menu" })).text, signIn);
		assert.equal(words(facts({}, { prompt: "menu" })).text, "Claude Code is asking you something. Answer it on the screen.");
	});

	it("the timers", () => {
		const late = "Ada hasn't started teaching yet. It may be waiting for you on the screen.";
		assert.equal(words(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS })).text, late);
		assert.equal(words(facts({ teaching: false, quietSince: T0, now: T0 + TEACH_WAIT_MS })).text, late);
	});

	it("stopped, crashed, not installed, no Node", () => {
		const stopped = words(facts({}, { ended: { stopped: true, code: null } }));
		assert.equal(stopped.text, "You stopped Ada.");
		assert.equal(stopped.startAgain, true);
		assert.equal(words(facts({}, { ended: { stopped: false, code: 1 } })).text, "Claude Code closed with an error. The last lines are above.");
		const missing = words(facts({}, { agent: "codex", ended: { stopped: false, code: 3 } }));
		assert.equal(missing.text, "Codex isn't installed on this computer.");
		assert.deepEqual(missing.get, { label: "Get Codex", url: "https://developers.openai.com/codex" });
		assert.equal(words(facts({}, { ended: { stopped: false, code: 3 } })).get?.url, "https://claude.com/claude-code");
		const node = words(facts({}, { ended: { stopped: false, code: 4 } }));
		assert.equal(node.text, "godspeed needs Node.js to connect Claude Code.");
		assert.deepEqual(node.get, { label: "Get Node.js", url: "https://nodejs.org" });
		assert.equal(node.startAgain, true);
	});

	it("the helper", () => {
		assert.equal(words(facts({ helperBusy: true }, { role: "helper" })).text, "The helper is reading your files.");
		assert.equal(words(facts({}, { role: "helper" })).text, "The helper is waiting for files to read.");
		assert.equal(words(facts({}, { role: "helper", ended: { stopped: true, code: null } })).text, "The helper stopped.");
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
		].map((f) => words(f).text);
		for (const text of all) assert.ok(!text.includes("—") && !text.includes(" · "), text);
	});
});

describe("the teacher's status line", () => {
	it("starting, needs you, else the usual line", () => {
		assert.equal(teacherStatusLine(null, "Ada"), null);
		assert.equal(teacherStatusLine(facts({ checkedIn: false }), "Ada"), "Ada is starting.");
		assert.equal(teacherStatusLine(facts({}, { prompt: "trust" }), "Ada"), "Ada needs you.");
		assert.equal(teacherStatusLine(facts({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS }), "Ada"), "Ada needs you.");
		assert.equal(teacherStatusLine(facts({}, { ended: { stopped: false, code: 1 } }), "Ada"), "Ada needs you.");
		assert.equal(teacherStatusLine(facts(), "Ada"), null);
		assert.equal(teacherStatusLine(facts({}, { ended: { stopped: true, code: null } }), "Ada"), null);
		assert.equal(teacherStatusLine(facts({ outsideHere: true }, { ended: { stopped: false, code: 1 } }), "Ada"), null, "an agent outside godspeed teaches now");
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
		const base = { teacher, teacherCheckedIn: true, helper: null, helperHere: false, backgroundWaiting: 2 };
		assert.equal(helperShouldStart(base), true);
		assert.equal(helperShouldStart({ ...base, teacherCheckedIn: false }), false);
		assert.equal(helperShouldStart({ ...base, backgroundWaiting: 0 }), false);
		assert.equal(helperShouldStart({ ...base, helperHere: true }), false, "a helper from outside is here");
		assert.equal(helperShouldStart({ ...base, teacher: term({ ended: { stopped: true, code: null } }) }), false);
		const helper = term({ id: "h1", role: "helper", startedAt: T0 + 5 });
		assert.equal(helperShouldStart({ ...base, helper }), false, "one runs");
		assert.equal(helperShouldStart({ ...base, helper: { ...helper, ended: { stopped: false, code: 1 } } }), false, "never restarted in the same run");
		assert.equal(helperShouldStart({ ...base, helper: { ...helper, startedAt: T0 - 5, ended: { stopped: true, code: null } } }), true, "a new teacher run");
	});
});

describe("the screen's font", () => {
	it("fits the whole 100 by 30 screen between 8 and 14 px, in width and height", () => {
		assert.equal(fitFontSize(2000, 1000), 14);
		assert.equal(fitFontSize(920, 480), 13);
		assert.equal(fitFontSize(2000, 300), 8, "the height decides too");
		assert.equal(fitFontSize(300, 200), 8, "too small even at 8 px: it scrolls inside");
		// The overlay's screen box (inside its padding), measured at a 640x600 and a 520x500 window,
		// where the screen measured 542x300 and 482x270: whole in both.
		assert.equal(fitFontSize(580, 378), 9);
		assert.ok(9 * 0.62 * 100 <= 580 && 9 * 1.2 * 30 <= 378, "at 640x600 the whole screen fits");
		assert.equal(fitFontSize(484, 286), 8);
	});
});

describe("onboarding's first start", () => {
	it("says the agent is starting, then connected; a question or an end uses the overlay's words", () => {
		const first = (over: Partial<TerminalFacts>, t: Partial<TerminalRecord> = {}) => firstRunFooter(facts(over, t), "~/godspeed");
		assert.equal(first({ checkedIn: false }).text, "Claude Code is starting in ~/godspeed. If it asks you something, answer it here.");
		assert.equal(first({ checkedIn: false, now: T0 + CHECK_IN_WAIT_MS + 1 }).text, "Claude Code is starting in ~/godspeed. If it asks you something, answer it here.", "no timer words here");
		assert.equal(first({ checkedIn: true }).text, "Claude Code is connected.");
		const trust = first({ checkedIn: false }, { prompt: "trust" });
		assert.equal(trust.assist?.label, "Yes, trust this folder");
		assert.match(first({ checkedIn: false }, { url: true }).text, /^Finish signing in to Claude Code/);
		assert.equal(first({}, { ended: { stopped: true, code: null } }).text, "You stopped Claude Code.");
	});
});

describe("starting the teacher hidden, and restarting", () => {
	it("Start lesson and Talk start the agent last started here, only when nothing is here, runs or starts", () => {
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
	});

	it("Restart now asks first only while the teacher's terminal runs and a turn waits", () => {
		assert.equal(restartAsks(term(), 1), true);
		assert.equal(restartAsks(term(), 0), false);
		assert.equal(restartAsks(null, 2), false);
		assert.equal(restartAsks(term({ ended: { stopped: false, code: 1 } }), 2), false);
	});
});
