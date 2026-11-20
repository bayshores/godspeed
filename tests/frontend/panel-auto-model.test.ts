import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	FIRST_LOOK,
	TYPING_PAUSE_MS,
	isWritingBox,
	stepPanel,
	typingWaitLeft,
	welcomeNow,
	type PanelAct,
	type PanelMemory,
	type PanelNow,
	type PanelSeen,
} from "../../src/frontend/components/teacher/panel-auto-model.ts";

const SHUT: PanelSeen = { open: false, byApp: false, popped: false };
const BY_APP: PanelSeen = { open: true, byApp: true, popped: false };
const BY_LEARNER: PanelSeen = { open: true, byApp: false, popped: false };
const calm: PanelMemory = { need: null, replying: false, waiting: false };

const step = (mem: PanelMemory, now: PanelNow, pane: PanelSeen, waitLeft = 0) => stepPanel(mem, now, pane, waitLeft);
const act = (mem: PanelMemory, now: PanelNow, pane: PanelSeen, waitLeft = 0): PanelAct => step(mem, now, pane, waitLeft).act;

describe("a need opens the panel", () => {
	it("opens on the screen that needs the learner, whichever terminal", () => {
		assert.deepEqual(act(calm, { need: "teacher", replying: false }, SHUT), { open: "teacher" });
		assert.deepEqual(act(calm, { need: "helper", replying: false }, SHUT), { open: "helper" });
	});

	it("opens while a lesson reply is running", () => {
		assert.deepEqual(act({ ...calm, replying: true }, { need: "teacher", replying: true }, SHUT), { open: "teacher" });
	});

	it("does nothing while the panel is already open", () => {
		assert.equal(act(calm, { need: "teacher", replying: false }, BY_LEARNER), null);
	});

	it("is a change only: a need already there when the learner closed the panel does not reopen it", () => {
		const there: PanelMemory = { need: "teacher", replying: false, waiting: false };
		assert.equal(act(there, { need: "teacher", replying: false }, SHUT), null);
		assert.equal(act(FIRST_LOOK, { need: null, replying: null }, SHUT), null);
	});

	it("a need that goes before the panel opens never opens it", () => {
		const waiting = step(calm, { need: "teacher", replying: false }, SHUT, 1500);
		assert.equal(waiting.act, null);
		assert.equal(waiting.mem.waiting, true);
		const gone = step(waiting.mem, { need: null, replying: false }, SHUT);
		assert.equal(gone.act, null);
		assert.equal(gone.mem.waiting, false);
	});
});

describe("the teacher's screen is in its own window", () => {
	const POPPED: PanelSeen = { open: false, byApp: false, popped: true };
	it("a need opens no panel and is not kept for when the screen comes back", () => {
		const came = step(calm, { need: "teacher", replying: false }, POPPED);
		assert.equal(came.act, null);
		assert.equal(came.mem.waiting, false);
		assert.equal(act(came.mem, { need: "teacher", replying: false }, SHUT), null, "put back with the need still there: nothing opens");
	});

	it("a need that comes after it is put back opens the panel as before", () => {
		assert.deepEqual(act(calm, { need: "teacher", replying: false }, SHUT), { open: "teacher" });
	});
});

describe("the learner is typing", () => {
	it("waits, then opens once the pause is over if the need and the shut panel are still there", () => {
		const waiting = step(calm, { need: "teacher", replying: false }, SHUT, 2000);
		assert.equal(waiting.act, null);
		assert.equal(waiting.mem.waiting, true);
		const again = step(waiting.mem, { need: "teacher", replying: false }, SHUT, 500);
		assert.equal(again.act, null, "another key moved the end of the wait");
		assert.deepEqual(step(again.mem, { need: "teacher", replying: false }, SHUT, 0).act, { open: "teacher" });
	});

	it("does not open if the learner opened the panel meanwhile", () => {
		const waiting = step(calm, { need: "teacher", replying: false }, SHUT, 2000);
		const after = step(waiting.mem, { need: "teacher", replying: false }, BY_LEARNER, 0);
		assert.equal(after.act, null);
		assert.equal(after.mem.waiting, false);
	});

	it("measures the pause from the last key", () => {
		assert.equal(typingWaitLeft(null, 10_000), 0);
		assert.equal(typingWaitLeft(10_000, 11_000), TYPING_PAUSE_MS - 1000);
		assert.equal(typingWaitLeft(10_000, 10_000 + TYPING_PAUSE_MS), 0);
		assert.equal(typingWaitLeft(10_000, 99_000), 0);
	});

	it("counts keys in text boxes, fields and editable elements, not in the terminal or on buttons", () => {
		const box = { tag: "TEXTAREA", inputType: "", editable: false, inTerminal: false };
		assert.ok(isWritingBox(box));
		assert.ok(isWritingBox({ ...box, tag: "INPUT", inputType: "text" }));
		assert.ok(isWritingBox({ ...box, tag: "INPUT", inputType: "search" }));
		assert.ok(isWritingBox({ ...box, tag: "DIV", editable: true }));
		assert.ok(!isWritingBox({ ...box, tag: "INPUT", inputType: "checkbox" }));
		assert.ok(!isWritingBox({ ...box, tag: "BUTTON" }));
		assert.ok(!isWritingBox({ ...box, inTerminal: true }), "the terminal's own hidden box");
	});
});

describe("a settled need closes the panel", () => {
	const needed: PanelMemory = { need: "teacher", replying: false, waiting: false };

	it("closes a panel it opened", () => {
		assert.equal(act(needed, { need: null, replying: false }, BY_APP), "close");
	});

	it("leaves a panel the learner opened", () => {
		assert.equal(act(needed, { need: null, replying: false }, BY_LEARNER), null);
	});

	it("waits for both terminals: a need still there keeps it", () => {
		assert.equal(act(needed, { need: "helper", replying: false }, BY_APP), null);
	});
});

describe("a lesson reply starting closes the panel", () => {
	it("closes it whoever opened it, when no need is present", () => {
		assert.equal(act(calm, { need: null, replying: true }, BY_LEARNER), "close");
		assert.equal(act(calm, { need: null, replying: true }, BY_APP), "close");
	});

	it("does not close while a need is present", () => {
		const needed: PanelMemory = { need: "teacher", replying: false, waiting: false };
		assert.equal(act(needed, { need: "teacher", replying: true }, BY_APP), null);
	});

	it("is a change only: a lesson already replying when it first reports is no change", () => {
		assert.equal(act({ ...calm, replying: null }, { need: null, replying: true }, BY_LEARNER), null);
		assert.equal(act({ ...calm, replying: true }, { need: null, replying: true }, BY_LEARNER), null, "the learner opened it during the reply");
	});

	it("does nothing to a panel that is shut", () => {
		assert.equal(act(calm, { need: null, replying: true }, SHUT), null);
	});
});

describe("the new learner's first look", () => {
	it("is the first look at Home after onboarding with the teacher on", () => {
		assert.ok(welcomeNow({ marked: true, onHome: true, teacherOn: true }));
		assert.ok(!welcomeNow({ marked: false, onHome: true, teacherOn: true }), "anyone who did not just finish onboarding");
		assert.ok(!welcomeNow({ marked: true, onHome: false, teacherOn: true }), "it waits for Home");
		assert.ok(!welcomeNow({ marked: true, onHome: true, teacherOn: false }), "it waits for the teacher");
	});
});
