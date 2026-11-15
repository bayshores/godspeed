/**
 * STUDY (core/study.ts): each topic's material and standing, the
 * typed-topic fallback, and the topics a deadline's Study button picks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	deadlineStudyTopicIds,
	FREE_TOPIC_ID,
	studyTopics,
} from "../../src/shared/core/study.ts";
import { firstPhase, phaseAt3Lh, phaseTimeline } from "../../src/shared/core/phases.ts";
const answered = (...outcomes: ("right" | "wrong" | "dontKnow")[]) => outcomes.map((outcome) => ({ chatId: "c", toolCallId: "q", outcome, answeredAt: "" }));
const TOPICS = [
	{ id: "tpc_sets", name: "Sets", members: ["f1", "f2"], material: "term" as const, status: "strong" as const, answers: answered("right") },
	{ id: "tpc_count", name: "Counting", members: ["f3", "f4"], material: "procedure" as const, status: "untested" as const, answers: [] },
	// Grouped before topics had a material.
	{ id: "tpc_prob", name: "Probability", members: ["f5"], status: "shaky" as const, answers: answered("wrong", "right", "right") },
	{ id: "tpc_logic", name: "Logic", members: ["f6"], material: "proof" as const, status: "weak" as const, answers: answered("right", "wrong") },
	{ id: "tpc_graph", name: "Graphs", members: ["f7"], material: "concept" as const, status: "weak" as const, answers: answered("wrong", "wrong", "right") },
];

describe("studyTopics", () => {
	it("groups the picks by topic, in space order, with each topic's material and standing", () => {
		const spaceOrder = new Map([
			["f1", 2],
			["f3", 0],
			["f5", 1],
		]);
		const topics = studyTopics({ factIds: ["f1", "f2", "f5", "f3", "f4", "f6", "f7"], topics: TOPICS, spaceOrder, freeTopic: "unused" });
		assert.deepEqual(
			topics.map((t) => [t.id, t.material, t.status, t.latestWrong, t.factIds]),
			[
				["tpc_count", "procedure", "untested", undefined, ["f3", "f4"]],
				["tpc_prob", undefined, "shaky", undefined, ["f5"]],
				["tpc_sets", "term", "strong", undefined, ["f1", "f2"]],
				// No space file: last.
				["tpc_logic", "proof", "weak", true, ["f6"]],
				["tpc_graph", "concept", "weak", undefined, ["f7"]],
			],
		);
	});

	it("a weak topic whose latest answer was not right is marked, whatever came before", () => {
		const weak = (...outcomes: ("right" | "wrong" | "dontKnow")[]) =>
			studyTopics({ factIds: ["f6"], topics: [{ ...TOPICS[3]!, answers: answered(...outcomes) }], spaceOrder: new Map(), freeTopic: "x" })[0]!.latestWrong;
		assert.equal(weak("wrong"), true);
		assert.equal(weak("right", "dontKnow"), true, "I don't know is not right");
		assert.equal(weak("wrong", "wrong", "right"), undefined, "caught up since");
	});

	it("keeps the picked order when the space order can't tell topics apart", () => {
		const topics = studyTopics({ factIds: ["f6", "f1"], topics: TOPICS, spaceOrder: new Map(), freeTopic: "x" });
		assert.deepEqual(topics.map((t) => t.id), ["tpc_logic", "tpc_sets"]);
	});

	it("a typed topic with no matched facts is one untested topic with no material", () => {
		assert.deepEqual(studyTopics({ factIds: [], topics: TOPICS, spaceOrder: new Map(), freeTopic: "Bayes' rule" }), [
			{ id: FREE_TOPIC_ID, name: "Bayes' rule", status: "untested", factIds: [] },
		]);
		// Picks that are no longer in the graph count as none.
		assert.equal(studyTopics({ factIds: ["gone"], topics: TOPICS, spaceOrder: new Map(), freeTopic: "x" })[0]!.id, FREE_TOPIC_ID);
	});
});

describe("a study session's phase", () => {
	it("starts at teach (no probe, no plan to write); other kinds start probing", () => {
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
