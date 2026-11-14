/** A deadline page's Back: the page that opened it, or the Deadlines tab. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadlineBack, openedFrom } from "../../src/frontend/components/deadline/deadline-back.ts";

describe("a deadline page's Back", () => {
	it("returns to Today or Progress when one of them opened the deadline", () => {
		assert.deepEqual(deadlineBack(openedFrom("today")), { to: "/", label: "Today" });
		assert.deepEqual(deadlineBack(openedFrom("progress")), { to: "/space", label: "Progress" });
	});

	it("goes to the Deadlines tab with no state or a state it doesn't know", () => {
		const deadlines = { to: "/space/deadlines", label: "Deadlines" };
		assert.deepEqual(deadlineBack(null), deadlines);
		assert.deepEqual(deadlineBack(undefined), deadlines);
		assert.deepEqual(deadlineBack({ back: "settings" }), deadlines);
	});
});
