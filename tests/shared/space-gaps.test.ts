import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readGaps } from "../../src/shared/core/contracts/space.ts";

const nothing = { spaceId: "spc_29", key: "spc_29:ddl_t2:recent", title: "Nothing coming up in CSE 29", line: "Test 2 was the last.", answer: "Nothing new", close: false };
const rhythm = { ...nothing, spaceId: "spc_21", kind: "homework", day: "2026-11-23", name: "HW7", label: "HW7?" };

describe("the gaps in a read of the open deadlines", () => {
	it("keeps whole gaps, with or without the rhythm fields", () => {
		assert.deepEqual(readGaps([nothing, rhythm]), [nothing, rhythm]);
	});

	it("leaves out what is not a gap", () => {
		assert.deepEqual(readGaps(undefined), []);
		assert.deepEqual(readGaps({ gaps: [nothing] }), []);
		const bad = [null, "gap", { ...nothing, key: 7 }, { ...nothing, close: "no" }, { ...nothing, spaceId: "../x" }, { ...rhythm, kind: "party" }, { ...rhythm, day: "2026-13-40" }, { ...rhythm, label: 3 }, { ...rhythm, name: 7 }];
		assert.deepEqual(readGaps([...bad, nothing]), [nothing]);
	});
});
