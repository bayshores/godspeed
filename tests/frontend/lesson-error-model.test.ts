import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lessonError, retryAction } from "../../src/frontend/components/lesson/lesson-error-model.ts";
import { STREAM_DROPPED } from "../../src/frontend/components/session-core.ts";

describe("lessonError", () => {
	it("turns known failures into plain sentences", () => {
		assert.deepEqual(lessonError("The send failed (500)."), { text: "Your message didn't go through.", kind: "send" });
		assert.equal(lessonError("The steer failed (502).").kind, "send");
		assert.equal(lessonError("A turn is already running. Try again in a moment.").text, "The teacher was still busy, so your message didn't go through.");
		assert.deepEqual(lessonError("The dismissal failed (500)."), { text: "Discarding didn't save.", kind: "sync" });
		assert.deepEqual(lessonError("Keep going failed: status 400"), { text: "Keep going didn't save.", kind: "sync" });
		assert.deepEqual(lessonError("Keep going failed: Failed to fetch"), { text: "Keep going didn't save.", kind: "sync" }, "never the lost reply");
		assert.deepEqual(lessonError("The kept change failed: status 400"), { text: "That change didn't save.", kind: "sync" });
		assert.deepEqual(lessonError("The kept change failed: Failed to fetch"), { text: "That change didn't save.", kind: "sync" });
		for (const m of [STREAM_DROPPED, "Failed to attach to the running turn.", "Failed to fetch", "Load failed"]) {
			assert.deepEqual(lessonError(m), { text: "The app lost its connection to the teacher's reply.", kind: "sync" }, m);
		}
		assert.deepEqual(lessonError("An error occurred."), { text: "The teacher's reply stopped with an error.", kind: "reply" });
		assert.equal(lessonError("rate_limit_error: overloaded").kind, "reply", "unknown agent text is a failed reply");
	});
});

describe("retryAction", () => {
	it("sends the box again when the learner's text is back in it", () => {
		assert.deepEqual(retryAction("send", { boxHasText: true }), { type: "send-box" });
		assert.deepEqual(retryAction("reply", { boxHasText: true }), { type: "send-box" });
	});
	it("runs a failed reply again from the record, so the learner's line is not sent a second time", () => {
		assert.deepEqual(retryAction("reply", { boxHasText: false }), { type: "continue" });
	});
	it("otherwise reads the lesson again", () => {
		assert.deepEqual(retryAction("sync", { boxHasText: true }), { type: "resync" });
		assert.deepEqual(retryAction("send", { boxHasText: false }), { type: "resync" });
	});
});
