/**
 * STUDY (core/study.ts): the mode per topic from its readiness, the class
 * order, the typed-topic fallback, the study context text, the plan the
 * app writes, and the topics a deadline's Study button picks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	deadlineStudyTopicIds,
	factClassOrder,
	FREE_TOPIC_ID,
	studyContextText,
	studyMode,
	studyPlanTree,
	studyTopics,
} from "../src/core/study.ts";
import { firstPhase, phaseAt3Lh, phaseTimeline } from "../src/core/phases.ts";
import { derivePlanStatusesLh } from "../src/core/contracts.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

const TOPICS = [
	{ id: "tpc_sets", name: "Sets", members: ["f1", "f2"], status: "strong" as const },
	{ id: "tpc_count", name: "Counting", members: ["f3", "f4"], status: "untested" as const },
	{ id: "tpc_prob", name: "Probability", members: ["f5"], status: "shaky" as const },
	{ id: "tpc_logic", name: "Logic", members: ["f6"], status: "weak" as const },
];

describe("studyMode", () => {
	it("never tested teaches, weak or shaky drills, strong checks", () => {
		assert.equal(studyMode("untested"), "teach");
		assert.equal(studyMode("weak"), "problems");
		assert.equal(studyMode("shaky"), "problems");
		assert.equal(studyMode("strong"), "check");
	});
});

describe("factClassOrder", () => {
	it("orders facts by their file's class day, undated files after by name, lesson facts nowhere", () => {
		const order = factClassOrder(
			[
				{ id: "late", born: "src_b" },
				{ id: "early", born: "src_a" },
				{ id: "undated", born: "src_c" },
				{ id: "lesson", born: "chat_x" },
				{ id: "orphan", born: null },
			],
			[
				{ name: "Notes 10.pdf", sourceId: "src_c" },
				{ name: "2026-10-02 Counting.pdf", sourceId: "src_b" },
				{ name: "2026-09-25 Sets.pdf", sourceId: "src_a" },
			],
		);
		assert.deepEqual([...order.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id), ["early", "late", "undated"]);
		assert.equal(order.has("lesson"), false);
		assert.equal(order.has("orphan"), false);
	});
});

describe("studyTopics", () => {
	it("groups the picks by topic, in class order, with each topic's mode", () => {
		const classOrder = new Map([
			["f1", 2],
			["f3", 0],
			["f5", 1],
		]);
		const topics = studyTopics({ factIds: ["f1", "f2", "f5", "f3", "f4", "f6"], topics: TOPICS, classOrder, freeTopic: "unused" });
		assert.deepEqual(
			topics.map((t) => [t.id, t.mode, t.factIds]),
			[
				["tpc_count", "teach", ["f3", "f4"]],
				["tpc_prob", "problems", ["f5"]],
				["tpc_sets", "check", ["f1", "f2"]],
				// No class file: last.
				["tpc_logic", "problems", ["f6"]],
			],
		);
	});

	it("keeps the picked order when the class order can't tell topics apart", () => {
		const topics = studyTopics({ factIds: ["f6", "f1"], topics: TOPICS, classOrder: new Map(), freeTopic: "x" });
		assert.deepEqual(topics.map((t) => t.id), ["tpc_logic", "tpc_sets"]);
	});

	it("a typed topic with no matched facts is one teach topic", () => {
		assert.deepEqual(studyTopics({ factIds: [], topics: TOPICS, classOrder: new Map(), freeTopic: "Bayes' rule" }), [
			{ id: FREE_TOPIC_ID, name: "Bayes' rule", mode: "teach", factIds: [] },
		]);
		// Picks that are no longer in the graph count as none.
		assert.equal(studyTopics({ factIds: ["gone"], topics: TOPICS, classOrder: new Map(), freeTopic: "x" })[0]!.id, FREE_TOPIC_ID);
	});
});

describe("the study context and plan", () => {
	const topics = [
		{ id: "tpc_count", name: "Counting", mode: "teach" as const, factIds: ["f3", "f4"] },
		{ id: "tpc_sets", name: "Sets", mode: "check" as const, factIds: ["f1"] },
	];

	it("lists names, nodes, modes and fact ids only", () => {
		const text = studyContextText(topics);
		assert.match(text, /^\[Study plan\]/);
		assert.match(text, /1\. Counting — node tpc_count, teach \(never tested\), facts f3, f4/);
		assert.match(text, /2\. Sets — node tpc_sets, check \(strong\), facts f1/);
		assert.match(studyContextText([{ id: FREE_TOPIC_ID, name: "Bayes", mode: "teach", factIds: [] }]), /no facts in the class graph yet/);
	});

	it("the plan has one node per topic, in order, and problems tag position", () => {
		const tree = studyPlanTree(topics);
		assert.deepEqual(tree.nodes.map((n) => [n.id, n.title]), [["tpc_count", "Counting"], ["tpc_sets", "Sets"]]);
		assert.deepEqual(tree.edges, []);
		const messages = [
			{ id: "a1", role: "assistant", content: [{ type: "toolCall", id: "q1", name: "quiz", arguments: { nodeId: "tpc_count" } }] },
			{ id: "a2", role: "assistant", content: [{ type: "toolCall", id: "p1", name: "problem", arguments: { nodeId: "tpc_sets" } }] },
		] as unknown as LhMessage[];
		const statuses = derivePlanStatusesLh(tree, messages);
		assert.equal(statuses.current, "tpc_sets");
		assert.deepEqual([...statuses.visited], ["tpc_count"]);
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

	it("studies today's planned topics", () => {
		// 7 days, two topics need work: one a day, weakest first.
		assert.deepEqual(deadlineStudyTopicIds("2026-11-03", deadline), ["c"]);
	});

	it("studies every topic once all are strong or the deadline has passed", () => {
		assert.deepEqual(deadlineStudyTopicIds("2026-11-03", { ...deadline, topics: [deadline.topics[0]!] }), ["a"]);
		assert.deepEqual(deadlineStudyTopicIds("2026-11-20", deadline), ["a", "b", "c"]);
	});
});
