import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { dayLabel, localDay, longDay, monthDay } from "../../src/shared/core/index.ts";

describe("calendar day labels", () => {
	it("dayLabel adds the weekday to the month and day", () => {
		assert.equal(dayLabel("2026-09-25"), "Fri Sep 25");
		assert.equal(dayLabel("2026-11-01"), "Sun Nov 1");
	});

	it("monthDay is the month and day alone", () => {
		assert.equal(monthDay("2026-09-25"), "Sep 25");
		assert.equal(monthDay("2026-11-01"), "Nov 1");
	});

	it("longDay spells the weekday in full", () => {
		assert.equal(longDay("2026-11-11"), "Wednesday Nov 11");
		assert.equal(longDay("2026-12-08"), "Tuesday Dec 8");
	});

	it("localDay is the learner's own calendar day", () => {
		assert.equal(localDay(new Date(2026, 10, 4, 23, 30)), "2026-11-04");
	});
});
