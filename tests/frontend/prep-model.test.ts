import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SpaceSummary } from "../../src/shared/core/contracts.ts";
import type { OpenDeadline } from "../../src/frontend/components/deadlines-model.ts";
import { byDue, prepDays } from "../../src/frontend/components/home-page/home-page-model.ts";
import { meterBoxes, formatLine, prepCount, solidLine, solidShare } from "../../src/frontend/components/prep/prep-model.ts";

const at = (day: string, hour = 9) => new Date(`${day}T${String(hour).padStart(2, "0")}:00:00`).getTime();

describe("the prep sheet's words", () => {
	it("fills a topic's boxes by its share right, at least one once answered", () => {
		assert.deepEqual([null, 0, 0.1, 0.5, 0.9, 1].map(meterBoxes), [0, 1, 1, 3, 5, 5]);
	});
	it("counts the solid topics", () => {
		const topics = [{ status: "strong" }, { status: "weak" }, { status: "untested" }, { status: "strong" }] as const;
		assert.equal(solidLine(topics), "2 of 4 topics solid");
		assert.equal(solidShare(topics), 0.5);
		assert.equal(solidLine([{ status: "shaky" }]), "0 of 1 topic solid");
		assert.equal(solidShare([]), 0);
	});
	it("counts whole days to the day, says today on it, and nothing after", () => {
		assert.deepEqual(prepCount("2026-11-17", at("2026-11-11", 23)), { count: "6", unit: "days" });
		assert.deepEqual(prepCount("2026-11-12", at("2026-11-11")), { count: "1", unit: "day" });
		assert.deepEqual(prepCount("2026-11-11", at("2026-11-11", 22)), { count: "today", unit: "" });
		assert.equal(prepCount("2026-11-10", at("2026-11-11")), null);
	});
	it("says what a mock is", () => {
		assert.equal(formatLine({ questions: 4, minutes: 70 }), "A mock is 4 questions in 70 minutes, like the real one.");
		assert.equal(formatLine({ questions: 1, minutes: 45 }), "A mock is 1 question in 45 minutes, like the real one.");
	});
});

describe("preps on Today", () => {
	const spaceOf = (id: string, prep?: { date?: string }, archived = false): SpaceSummary => ({ id, name: id, color: 1, archived, ...(prep ? { prep } : {}) }) as SpaceSummary;
	const now = at("2026-11-11");

	it("lists the preps with a day that hasn't passed: this week under Today, the rest Later", () => {
		const lists = prepDays([spaceOf("far", { date: "2026-12-01" }), spaceOf("soon", { date: "2026-11-17" }), spaceOf("past", { date: "2026-11-10" }), spaceOf("undated", {}), spaceOf("space"), spaceOf("gone", { date: "2026-11-12" }, true), spaceOf("today", { date: "2026-11-11" })], now);
		assert.deepEqual(lists.today.map((p) => p.spaceId), ["today", "soon"]);
		assert.deepEqual(lists.later.map((p) => p.spaceId), ["far"]);
	});
	it("puts deadlines and preps in one list, soonest first", () => {
		const deadline = (id: string, date: string, time?: string) => ({ id, date, ...(time ? { time } : {}) }) as OpenDeadline;
		const prep = (spaceId: string, date: string) => ({ spaceId, name: spaceId, date, color: 1 as const });
		const order = byDue([deadline("hw", "2026-11-12"), deadline("quiz", "2026-11-14", "09:00")], [prep("acme", "2026-11-13"), prep("same-day", "2026-11-12")]);
		assert.deepEqual(order.map((i) => ("prep" in i ? i.prep.spaceId : i.deadline.id)), ["hw", "same-day", "acme", "quiz"]);
	});
});
