/**
 * Which notices show in the peek (notice-stack-model.ts): update and
 * restart first, one quiet-space notice at a time, 3 at most; each shows
 * by itself for a while, then folds into the strip until its count is asked for.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noticeView, type Notice, type NoticeKind } from "../../src/frontend/components/notice-stack-model.ts";

const notice = (id: string, kind: NoticeKind | null = null, foldAt = 100): Notice => ({ id, kind, foldAt });

describe("noticeView", () => {
	it("shows 3 in order, the rest wait their turn", () => {
		const view = noticeView([notice("a"), notice("b"), notice("c"), notice("d")], 0, false, false);
		assert.deepEqual(view.shown, ["a", "b", "c"]);
		assert.equal(view.waiting, 0, "one that waits its turn is not in the strip's count");
	});

	it("update and restart come first, even when they came last", () => {
		assert.deepEqual(noticeView([notice("a"), notice("b"), notice("c"), notice("d", "first")], 0, false, false).shown, ["d", "a", "b"]);
	});

	it("one quiet-space notice at a time, and the waiting ones take no place", () => {
		assert.deepEqual(noticeView([notice("q1", "quiet"), notice("q2", "quiet"), notice("q3", "quiet"), notice("x")], 0, false, false).shown, ["q1", "x"]);
	});

	it("after its time a notice folds into the strip, which counts it", () => {
		const notices = [notice("a", null, 100), notice("b", null, 200)];
		assert.deepEqual(noticeView(notices, 150, false, false), { shown: ["b"], waiting: 1 });
		assert.deepEqual(noticeView(notices, 250, false, false), { shown: [], waiting: 2 });
	});

	it("under the teacher's open panel none shows by itself: all wait folded, a never-timed one too", () => {
		const notices = [notice("a", null, 100), notice("b", "quiet", Infinity)];
		assert.deepEqual(noticeView(notices, 50, false, true), { shown: [], waiting: 2 });
		assert.deepEqual(noticeView(notices, 50, true, true).shown, ["a", "b"], "the count still opens them");
		assert.deepEqual(noticeView(notices, 150, false, false).shown, ["b"], "the panel closed: the never-timed one shows again");
	});

	it("asking for the folded ones shows them, and the strip still counts them", () => {
		const notices = [notice("a", null, 100), notice("b", null, 200)];
		assert.deepEqual(noticeView(notices, 250, true, false), { shown: ["a", "b"], waiting: 2 });
	});

	it("one that closes by itself never folds", () => {
		assert.deepEqual(noticeView([notice("a", null, Infinity)], 1e15, false, false).shown, ["a"]);
	});
});
