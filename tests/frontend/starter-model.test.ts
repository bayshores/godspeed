import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { startersFor, startersShown } from "../../src/frontend/components/terminal/starter-model.ts";
import type { TerminalFacts, TerminalRecord } from "../../src/frontend/components/terminal/terminal-model.ts";

const deadlines = [{ id: "hw 6", name: "HW 6" }];
const on = (path: string, spaceName: string | null = "CSE 21") => startersFor({ path, spaceName, deadlines });

describe("what the starters say", () => {
	it("the first follows the page: a deadline, the active space's pages, anywhere else", () => {
		assert.deepEqual(on("/space/deadline/hw%206"), ["Get me ready for HW 6", "What's due?", "What can you do?"]);
		assert.equal(on("/space")[0], "What should I study in CSE 21?");
		assert.equal(on("/space/files")[0], "What should I study in CSE 21?");
		assert.equal(on("/graph")[0], "What should I study in CSE 21?");
		assert.equal(on("/space/deadline/done-one")[0], "What should I study in CSE 21?", "a deadline no longer open is just a space page");
		assert.equal(on("/space", null)[0], "What should I study?", "no space picked");
		assert.equal(on("/")[0], "What should I study?");
		assert.equal(on("/settings")[0], "What should I study?");
		assert.equal(on("/graphs")[0], "What should I study?");
	});

	it("none on a lesson or a cheat sheet, where a typed line goes to the page", () => {
		assert.deepEqual(on("/chat/abc"), []);
		assert.deepEqual(on("/space/deadline/hw%206/cheat-sheet"), []);
	});
});

describe("when the row shows", () => {
	const term = (over: Partial<TerminalRecord> = {}): TerminalRecord => ({ id: "t1", role: "teacher", agent: "claude", startedAt: 1, ended: null, prompt: null, url: false, ...over });
	const facts = (over: Partial<TerminalFacts> = {}, t: Partial<TerminalRecord> = {}): TerminalFacts => ({ term: term(t), checkedIn: true, outsideHere: false, teaching: true, now: 2, quietSince: null, helperBusy: false, turnWaits: false, ...over });

	it("a running, checked-in teacher in an unused chat with nothing asked", () => {
		assert.ok(startersShown(facts(), false));
	});

	it("not before the check-in, while the screen asks, while a turn waits, once the chat was used, after the end, or for background work", () => {
		assert.ok(!startersShown(null, false));
		assert.ok(!startersShown(facts({ checkedIn: false }), false));
		assert.ok(!startersShown(facts({}, { prompt: "menu" }), false));
		assert.ok(!startersShown(facts({}, { url: true }), false), "a sign-in link");
		assert.ok(!startersShown(facts({ turnWaits: true }), false));
		assert.ok(!startersShown(facts(), true));
		assert.ok(!startersShown(facts({}, { ended: { stopped: true, code: null } }), false));
		assert.ok(!startersShown(facts({}, { role: "helper" }), false));
	});
});
