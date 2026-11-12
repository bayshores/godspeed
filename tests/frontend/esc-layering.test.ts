import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { escAbortTarget } from "../../src/frontend/components/lesson/chat-helpers.ts";

/**
 * THE LAYERED ESC: Esc over an open mermaid focus must CLOSE IT, never
 * dismiss a pending question (or abort a turn) underneath.
 * KeyboardShortcuts dispatches lh:kbd-abort-turn on every unclaimed Esc
 * and its window listener registers FIRST, so the overlay's own listener
 * can never outrun it, so the state gate in ChatView (exported pure) is
 * the defense. Priority = stacking order.
 */
describe("escAbortTarget", () => {
	const none = { abortAsk: false, mermaidFocus: false, pending: false, problem: false, busy: false };

	it("no overlays: the base chain stands (question before turn)", () => {
		assert.equal(escAbortTarget({ ...none, pending: true }), "question");
		assert.equal(escAbortTarget({ ...none, busy: true }), "turn");
		assert.equal(escAbortTarget(none), null);
		assert.equal(escAbortTarget({ ...none, pending: true, busy: true }), "turn", "a side reply stops alone; the question stays");
	});

	it("an active practice problem sits between question and turn", () => {
		assert.equal(escAbortTarget({ ...none, problem: true }), "problem");
		assert.equal(escAbortTarget({ ...none, problem: true, busy: true }), "problem", "the problem card outranks the turn abort");
		assert.equal(escAbortTarget({ ...none, mermaidFocus: true, problem: true }), "mermaid", "an open overlay still outranks the problem");
	});

	it("an open overlay claims Esc over a pending question", () => {
		const target = escAbortTarget({ ...none, mermaidFocus: true, pending: true });
		assert.notEqual(target, "question", "mermaid open must not dismiss the question");
		assert.notEqual(target, "turn", "mermaid open must not abort the turn");
		assert.equal(target, "mermaid");
	});

	it("the abort confirm is topmost — its own Esc is claimed by the dialog", () => {
		assert.equal(
			escAbortTarget({ ...none, abortAsk: true, mermaidFocus: true, pending: true }),
			null,
			"never chain: the dialog owns that Esc",
		);
	});
});
