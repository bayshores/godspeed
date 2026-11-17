/**
 * The welcome screen's boot log.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bootLines, lookUpgraded } from "../../src/frontend/components/welcome/welcome-model.ts";

// Wed Oct 28 2026, 4:12 PM local.
const NOW = new Date(2026, 9, 28, 16, 12).getTime();
const on = { connected: true };
const midterm = (date: string, time?: string) => ({ name: "Midterm 2", date, ...(time ? { time } : {}) });

describe("bootLines", () => {
	it("the version, then whether the teacher is on", () => {
		assert.deepEqual(bootLines("0.5.41", on, "Ada", undefined, NOW, false), ["Version 0.5.41", "Ada is on"]);
		assert.deepEqual(bootLines("0.5.41", { connected: false }, "Ada", undefined, NOW, false)[1], "Ada is off");
	});
	it("then the next deadline: today, tomorrow, in N days, overdue", () => {
		assert.equal(bootLines("1", on, "Ada", midterm("2026-10-28", "23:00"), NOW, false)[2], "Midterm 2 is due today");
		assert.equal(bootLines("1", on, "Ada", midterm("2026-10-29"), NOW, false)[2], "Midterm 2 is due tomorrow");
		assert.equal(bootLines("1", on, "Ada", midterm("2026-10-31"), NOW, false)[2], "Midterm 2 is due in 3 days");
		assert.equal(bootLines("1", on, "Ada", midterm("2026-10-28", "09:00"), NOW, false)[2], "Midterm 2 is overdue");
	});
	it("the first launch after the new look arrives says so", () => {
		assert.deepEqual(bootLines("0.5.41", on, "Ada", midterm("2026-10-29"), NOW, true), ["Version 0.5.41", "New look", "Loading your spaces"]);
	});
});

describe("lookUpgraded", () => {
	it("only when updating from the old look", () => {
		assert.equal(lookUpgraded("0.5.40"), true);
		assert.equal(lookUpgraded("0.5.12"), true);
		assert.equal(lookUpgraded("0.5.41"), false);
		assert.equal(lookUpgraded(null), false, "no update this launch");
	});
});
