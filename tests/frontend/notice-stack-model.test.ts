/**
 * Which notices show in the peek (notice-stack-model.ts): errors, then an
 * update, one quiet-space notice at a time, 3 at most. Beside the strip only
 * an error shows by itself; the rest wait folded until the count is asked for.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noticeView, type Notice, type NoticeKind } from "../../src/frontend/components/notice-stack-model.ts";

const notice = (id: string, kind: NoticeKind | null = null, foldAt = 100): Notice => ({ id, kind, foldAt });

describe("noticeView", () => {
	it("shows 3 in order, the rest wait their turn", () => {
		const view = noticeView([notice("a"), notice("b"), notice("c"), notice("d")], 0, false, "all");
		assert.deepEqual(view.shown, ["a", "b", "c"]);
		assert.equal(view.waiting, 0, "one that waits its turn is not in the strip's count");
	});

	it("an update comes first, even when it came last", () => {
		assert.deepEqual(noticeView([notice("a"), notice("b"), notice("c"), notice("d", "first")], 0, false, "all").shown, ["d", "a", "b"]);
	});

	it("one quiet-space notice at a time, and the waiting ones take no place", () => {
		assert.deepEqual(noticeView([notice("q1", "quiet"), notice("q2", "quiet"), notice("q3", "quiet"), notice("x")], 0, false, "all").shown, ["q1", "x"]);
	});

	it("after its time a notice folds into the strip, which counts it", () => {
		const notices = [notice("a", null, 100), notice("b", null, 200)];
		assert.deepEqual(noticeView(notices, 150, false, "all"), { shown: ["b"], waiting: 1 });
		assert.deepEqual(noticeView(notices, 250, false, "all"), { shown: [], waiting: 2 });
	});

	it("under the teacher's open panel none shows by itself: all wait folded, a never-timed one too", () => {
		const notices = [notice("a", null, 100), notice("b", "quiet", Infinity)];
		assert.deepEqual(noticeView(notices, 50, false, "none"), { shown: [], waiting: 2 });
		assert.deepEqual(noticeView(notices, 50, true, "none").shown, ["a", "b"], "the count still opens them");
		assert.deepEqual(noticeView(notices, 150, false, "all").shown, ["b"], "the panel closed: the never-timed one shows again");
	});

	it("beside the strip only an error shows by itself, ahead of the rest; the others wait in the count", () => {
		const notices = [notice("read"), notice("update", "first"), notice("failed", "error"), notice("gap", "quiet", Infinity)];
		assert.deepEqual(noticeView(notices, 50, false, "errors"), { shown: ["failed"], waiting: 3 });
		assert.deepEqual(noticeView(notices, 50, true, "errors").shown, ["failed", "update", "read"], "asked for: errors, the update, then the rest");
		assert.deepEqual(noticeView(notices, 150, false, "errors"), { shown: [], waiting: 4 }, "the error folded too");
	});

	it("asking for the folded ones shows them, and the strip still counts them", () => {
		const notices = [notice("a", null, 100), notice("b", null, 200)];
		assert.deepEqual(noticeView(notices, 250, true, "all"), { shown: ["a", "b"], waiting: 2 });
	});

	it("one that closes by itself never folds", () => {
		assert.deepEqual(noticeView([notice("a", null, Infinity)], 1e15, false, "all").shown, ["a"]);
	});
});
