/**
 * STUDY (core/study.ts): a study session's phase and the topics a
 * deadline's Study button picks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deadlineStudyTopicIds } from "../../src/shared/core/study.ts";
import { firstPhase, phaseAt3Lh, phaseTimeline } from "../../src/shared/core/phases.ts";

describe("a study session's phase", () => {
	it("starts at teach (no probe); other kinds start probing", () => {
		assert.equal(firstPhase("study"), "teach");
		assert.equal(firstPhase(undefined), "probe");
		assert.equal(firstPhase("practice"), "probe");
		assert.equal(phaseAt3Lh([], firstPhase("study")), "teach");
		assert.deepEqual(phaseTimeline([{ parts: [] }], "teach"), ["teach"]);
	});
});

describe("deadlineStudyTopicIds", () => {
	const deadline = {
		date: "2026-11-10",
		topics: [
			{ id: "a", name: "A", rate: 0.9 },
			{ id: "b", name: "B", rate: null },
			{ id: "c", name: "C", rate: 0.2 },
		],
	};

	const answered = (id: string, status: "strong" | "weak", at: string) => ({ id, status, answers: [{ chatId: "c", toolCallId: "q", outcome: "right" as const, answeredAt: at }] });
	// Local noon, so the answer's day is the same in every time zone.
	const noon = (day: string) => new Date(`${day}T12:00:00`).toISOString();
	const topics = [answered("a", "strong", noon("2026-11-02")), answered("c", "weak", noon("2026-10-01"))];

	it("studies today's planned topics", () => {
		// 7 days, two topics need work: one a day, weakest first.
		assert.deepEqual(deadlineStudyTopicIds("2026-11-03", deadline, topics), ["c"]);
	});

	it("adds a strong topic once its newest answer is 7 days old", () => {
		assert.deepEqual(deadlineStudyTopicIds("2026-11-08", deadline, topics), ["c"], "6 days: not yet");
		// The last day takes both topics that need work, then the strong one.
		assert.deepEqual(deadlineStudyTopicIds("2026-11-09", deadline, topics), ["c", "b", "a"]);
		const other = [...topics, answered("z", "strong", noon("2026-10-01"))];
		assert.deepEqual(deadlineStudyTopicIds("2026-11-09", deadline, other), ["c", "b", "a"], "only the deadline's topics");
	});

	it("studies every topic once all are strong or the deadline has passed", () => {
		assert.deepEqual(deadlineStudyTopicIds("2026-11-03", { ...deadline, topics: [deadline.topics[0]!] }, topics), ["a"]);
		assert.deepEqual(deadlineStudyTopicIds("2026-11-20", deadline, topics), ["a", "b", "c"]);
	});
});
