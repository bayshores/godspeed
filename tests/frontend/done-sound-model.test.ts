/**
 * The teacher's sound plays only while the learner looks away, once for
 * replies close together.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DONE_GAP_MS, donePlays } from "../../src/frontend/components/teacher/done-sound-model.ts";

const at = { focused: true, lastAt: null, now: 10_000 };

describe("the teacher's done sound", () => {
	it("a reply plays it only while godspeed isn't the front window", () => {
		assert.equal(donePlays(at), false);
		assert.equal(donePlays({ ...at, focused: false }), true);
	});
	it("replies close together play once", () => {
		assert.equal(donePlays({ ...at, focused: false, lastAt: at.now - DONE_GAP_MS + 1 }), false);
		assert.equal(donePlays({ ...at, focused: false, lastAt: at.now - DONE_GAP_MS }), true);
	});
});
