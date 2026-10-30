/** The lesson panel's Enter decision (src/components/lesson/enter-action.ts). */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enterAction } from "../src/components/lesson/enter-action.ts";

// The Enter decision (composer steering, 2026-10-03): while a turn runs,
// typed text makes Enter a STEER; Enter with an empty composer stays the
// stop shortcut. (The plan-verdict accept branch died 2026-09-26 with the
// verdict itself — the post-plan reply is a natural text message.) Pure
// function so the static-render harness can pin it (key events can't be
// simulated in renderToStaticMarkup).
describe("enterAction", () => {
	it("busy stream with text: Enter steers (the queued send)", () => {
		assert.equal(enterAction({ busy: true, canSend: true }), "send");
	});

	it("busy stream, empty composer: Enter stops", () => {
		assert.equal(enterAction({ busy: true, canSend: false }), "stop");
	});

	it("busy stream with files waiting: Enter does nothing (no steer, no stop)", () => {
		assert.equal(enterAction({ busy: true, canSend: false, hasFiles: true }), "none");
	});

	it("idle: send when there is the text, nothing when there is not", () => {
		assert.equal(enterAction({ busy: false, canSend: true }), "send");
		assert.equal(enterAction({ busy: false, canSend: false }), "none");
	});

	it("the practice pause (owner round 16): Enter on an EMPTY composer fires the move-on signal", () => {
		assert.equal(enterAction({ busy: false, canSend: false, nextProblem: true }), "next");
	});

	it("typing anything outranks the pause — text makes Enter a send again", () => {
		assert.equal(enterAction({ busy: false, canSend: true, nextProblem: true }), "send");
	});

	it("busy outranks the pause — steering and Stop keep their lanes", () => {
		assert.equal(enterAction({ busy: true, canSend: false, nextProblem: true }), "stop");
		assert.equal(enterAction({ busy: true, canSend: true, nextProblem: true }), "send");
	});
});
