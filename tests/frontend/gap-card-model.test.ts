import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpaceGap } from "../../src/shared/core/contracts/space.ts";
import { gapToShow } from "../../src/frontend/components/gap-card-model.ts";

const rhythm: SpaceGap = { spaceId: "spc_21", key: "spc_21:ddl_hw6:1", title: "Homework in CSE 21 this week?", line: "It came every week.", answer: "None this week", close: false, kind: "homework", day: "2026-11-23", label: "HW7?" };
const nothing: SpaceGap = { spaceId: "spc_29", key: "spc_29:ddl_t2:recent", title: "Nothing coming up in CSE 29", line: "Test 2 was the last, 2 days ago.", answer: "Nothing new", close: false };
const known = new Set(["spc_21", "spc_29"]);
const none = new Set<string>();
const show = (gaps: SpaceGap[], pathname: string, active: string | null = null, updated = none) => gapToShow(gaps, { pathname, active }, known, updated);

describe("the gap card's page rule", () => {
	it("leaves a rhythm gap to Home's week", () => {
		assert.equal(show([rhythm], "/"), null);
	});

	it("leaves a rhythm gap to its own space's Deadlines tab, but not another space's", () => {
		assert.equal(show([rhythm], "/space/deadlines", "spc_21"), null);
		assert.equal(show([rhythm], "/space/deadlines/", "spc_21"), null);
		assert.equal(show([rhythm], "/space/deadlines", "spc_29"), rhythm);
		assert.equal(show([rhythm], "/space/files", "spc_21"), rhythm);
		assert.equal(show([rhythm], "/graph", null), rhythm);
	});

	it("shows a gap with no day on every page", () => {
		for (const page of ["/", "/space/deadlines", "/space", "/graph"]) assert.equal(show([nothing], page, "spc_29"), nothing, page);
	});

	it("takes the first gap the page allows", () => {
		assert.equal(show([rhythm, nothing], "/"), nothing);
		assert.equal(show([rhythm, nothing], "/space/files"), rhythm);
	});

	it("skips a space that is not in the list and a gap already sent to the teacher", () => {
		assert.equal(gapToShow([nothing], { pathname: "/space", active: null }, new Set(["spc_21"]), none), null);
		assert.equal(show([rhythm, nothing], "/space", null, new Set([rhythm.key])), nothing);
		assert.equal(show([rhythm], "/space", null, new Set([rhythm.key])), null);
	});
});
