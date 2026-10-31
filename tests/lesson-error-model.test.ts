import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastLearnerText, lessonError, retryAction } from "../src/components/lesson/lesson-error-model.ts";
import { STREAM_DROPPED } from "../src/components/session-core.ts";
import { pdfNote, type LhMessage } from "../src/core/index.ts";

describe("lessonError", () => {
	it("turns known failures into plain sentences", () => {
		assert.deepEqual(lessonError("The send failed (500)."), { text: "Your message didn't go through.", kind: "send" });
		assert.equal(lessonError("The steer failed (502).").kind, "send");
		assert.equal(lessonError("A turn is already running. Try again in a moment.").text, "The teacher was still busy, so your message didn't go through.");
		assert.deepEqual(lessonError("The dismissal failed (500)."), { text: "Skipping or discarding didn't save.", kind: "sync" });
		for (const m of [STREAM_DROPPED, "Failed to attach to the running turn.", "Failed to fetch", "Load failed"]) {
			assert.deepEqual(lessonError(m), { text: "The app lost its connection to the teacher's reply.", kind: "sync" }, m);
		}
		assert.deepEqual(lessonError("An error occurred."), { text: "The teacher's reply stopped with an error.", kind: "reply" });
		assert.equal(lessonError("rate_limit_error: overloaded").kind, "reply", "unknown agent text is a failed reply");
	});
});

describe("lastLearnerText", () => {
	const user = (content: unknown) => ({ id: "u", role: "user", content }) as unknown as LhMessage;
	const failed = { id: "a", role: "assistant", stopReason: "error", content: [] } as unknown as LhMessage;
	it("finds the learner's text the failed reply was answering", () => {
		assert.equal(lastLearnerText([user("why?"), failed]), "why?");
		assert.equal(lastLearnerText([user([{ type: "text", text: "with a picture" }, { type: "image" }]), failed]), "with a picture");
	});
	it("leaves a PDF note out of the resend", () => {
		assert.equal(lastLearnerText([user([{ type: "text", text: "explain this" }, pdfNote("notes.pdf", "/p/x.pdf")]), failed]), "explain this");
		assert.equal(lastLearnerText([user([pdfNote("notes.pdf", "/p/x.pdf")]), failed]), null, "a PDF-only message runs the reply again");
	});
	it("is null when the reply answered something else", () => {
		const result = { id: "r", role: "toolResult", toolCallId: "q1", content: [] } as unknown as LhMessage;
		assert.equal(lastLearnerText([user("hi"), result, failed]), null);
		assert.equal(lastLearnerText([]), null);
	});
});

describe("retryAction", () => {
	it("sends the box again when the learner's text is back in it", () => {
		assert.deepEqual(retryAction("send", { boxHasText: true, lastText: null }), { type: "send-box" });
		assert.deepEqual(retryAction("reply", { boxHasText: true, lastText: "why?" }), { type: "send-box" });
	});
	it("resends the learner's last message after a failed reply", () => {
		assert.deepEqual(retryAction("reply", { boxHasText: false, lastText: "why?" }), { type: "resend", text: "why?" });
	});
	it("runs a failed reply to an answer again", () => {
		assert.deepEqual(retryAction("reply", { boxHasText: false, lastText: null }), { type: "continue" });
	});
	it("otherwise reads the lesson again", () => {
		assert.deepEqual(retryAction("sync", { boxHasText: true, lastText: "why?" }), { type: "resync" });
		assert.deepEqual(retryAction("send", { boxHasText: false, lastText: "why?" }), { type: "resync" });
	});
});
