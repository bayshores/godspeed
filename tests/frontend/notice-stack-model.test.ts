/**
 * Which notices show under the pill (notice-stack-model.ts): update and
 * restart first, one quiet-space notice at a time, 3 at most; each shows
 * by itself for a while, then folds into the pill until its card opens.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noticeView, type Notice, type NoticeKind } from "../../src/frontend/components/notice-stack-model.ts";

const notice = (id: string, kind: NoticeKind | null = null, foldAt = 100): Notice => ({ id, title: `Title ${id}`, kind, bare: false, foldAt });

describe("noticeView", () => {
	it("shows 3 in order, the rest wait their turn", () => {
		const view = noticeView([notice("a"), notice("b"), notice("c"), notice("d")], 0, false);
		assert.deepEqual(view.shown, ["a", "b", "c"]);
		assert.equal(view.waiting, 0, "one that waits its turn is not in the pill's count");
	});

	it("update and restart come first, even when they came last", () => {
		assert.deepEqual(noticeView([notice("a"), notice("b"), notice("c"), notice("d", "first")], 0, false).shown, ["d", "a", "b"]);
	});

	it("one quiet-space notice at a time, and the waiting ones take no place", () => {
		assert.deepEqual(noticeView([notice("q1", "quiet"), notice("q2", "quiet"), notice("q3", "quiet"), notice("x")], 0, false).shown, ["q1", "x"]);
	});

	it("the pill says the first one still showing by itself", () => {
		assert.equal(noticeView([notice("a"), notice("b", "first")], 0, false).presenting?.title, "Title b");
		assert.equal(noticeView([], 0, false).presenting, null);
	});

	it("after its time a notice folds into the pill, which counts it", () => {
		const notices = [notice("a", null, 100), notice("b", null, 200)];
		assert.deepEqual(noticeView(notices, 150, false), { shown: ["b"], presenting: notices[1], waiting: 1 });
		assert.deepEqual(noticeView(notices, 250, false), { shown: [], presenting: null, waiting: 2 });
	});

	it("the open card shows the folded ones too, so the pill counts none", () => {
		const notices = [notice("a", null, 100), notice("b", null, 200)];
		assert.deepEqual(noticeView(notices, 250, true), { shown: ["a", "b"], presenting: null, waiting: 0 });
	});

	it("one that closes by itself never folds", () => {
		assert.deepEqual(noticeView([notice("a", null, Infinity)], 1e15, false).shown, ["a"]);
	});
});
