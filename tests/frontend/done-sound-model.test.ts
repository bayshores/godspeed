/**
 * The teacher's sound plays only while the learner looks away, once for
 * moments close together.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DONE_GAP_MS, donePlays } from "../../src/frontend/components/teacher/done-sound-model.ts";

const at = { focused: true, panelOpen: true, lastAt: null, now: 10_000 };

describe("the teacher's done sound", () => {
	it("a reply plays it only while godspeed isn't the front window", () => {
		assert.equal(donePlays({ ...at, moment: "reply" }), false);
		assert.equal(donePlays({ ...at, moment: "reply", panelOpen: false }), false, "a lesson on screen is watched");
		assert.equal(donePlays({ ...at, moment: "reply", focused: false }), true);
	});
	it("the terminal plays it while its panel is closed or the window is behind", () => {
		assert.equal(donePlays({ ...at, moment: "terminal" }), false, "the learner is watching the terminal");
		assert.equal(donePlays({ ...at, moment: "terminal", panelOpen: false }), true);
		assert.equal(donePlays({ ...at, moment: "terminal", focused: false }), true);
	});
	it("moments close together play once", () => {
		assert.equal(donePlays({ ...at, moment: "reply", focused: false, lastAt: at.now - DONE_GAP_MS + 1 }), false);
		assert.equal(donePlays({ ...at, moment: "reply", focused: false, lastAt: at.now - DONE_GAP_MS }), true);
	});
});
