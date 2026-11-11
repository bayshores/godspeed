/**
 * Open deadlines across classes: their order.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { byDue, type OpenDeadline } from "../../src/frontend/components/deadlines-model.ts";

function d(id: string, date: string, time?: string): OpenDeadline {
	return { id, kind: "homework", name: id, date, ...(time ? { time } : {}), fileIds: [], done: false, classId: "c1", className: "CSE 21" };
}

describe("byDue", () => {
	it("soonest first, a no-time deadline at the end of its day, names breaking ties", () => {
		const list = [d("c", "2026-10-30"), d("b", "2026-10-30", "17:00"), d("a", "2026-10-30")];
		assert.deepEqual(byDue(list).map((x) => x.id), ["b", "a", "c"]);
	});
});
