/**
 * STUDY (core/study.ts): each topic's material and standing, the class
 * order, the typed-topic fallback, the study context text, the plan the
 * app writes, and the topics a deadline's Study button picks.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	deadlineStudyTopicIds,
	factClassOrder,
	FREE_TOPIC_ID,
	MAX_STUDY_FACTS,
	studyContextText,
	studyPlanTree,
	studyTitle,
	studyTopics,
	topicStudy,
} from "../../src/shared/core/study.ts";
import { firstPhase, phaseAt3Lh, phaseTimeline } from "../../src/shared/core/phases.ts";
import { derivePlanStatusesLh } from "../../src/shared/core/contracts.ts";
import type { LhMessage } from "../../src/shared/core/native-messages.ts";

const answered = (...outcomes: ("right" | "wrong" | "dontKnow")[]) => outcomes.map((outcome) => ({ chatId: "c", toolCallId: "q", outcome, answeredAt: "" }));
const TOPICS = [
	{ id: "tpc_sets", name: "Sets", members: ["f1", "f2"], material: "term" as const, status: "strong" as const, answers: answered("right") },
	{ id: "tpc_count", name: "Counting", members: ["f3", "f4"], material: "procedure" as const, status: "untested" as const, answers: [] },
	// Grouped before topics had a material.
	{ id: "tpc_prob", name: "Probability", members: ["f5"], status: "shaky" as const, answers: answered("wrong", "right", "right") },
	{ id: "tpc_logic", name: "Logic", members: ["f6"], material: "proof" as const, status: "weak" as const, answers: answered("right", "wrong") },
	{ id: "tpc_graph", name: "Graphs", members: ["f7"], material: "concept" as const, status: "weak" as const, answers: answered("wrong", "wrong", "right") },
];

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
	it("groups the picks by topic, in class order, with each topic's material and standing", () => {
		const classOrder = new Map([
			["f1", 2],
			["f3", 0],
			["f5", 1],
		]);
		const topics = studyTopics({ factIds: ["f1", "f2", "f5", "f3", "f4", "f6", "f7"], topics: TOPICS, classOrder, freeTopic: "unused" });
		assert.deepEqual(
			topics.map((t) => [t.id, t.material, t.status, t.latestWrong, t.factIds]),
			[
				["tpc_count", "procedure", "untested", undefined, ["f3", "f4"]],
				["tpc_prob", undefined, "shaky", undefined, ["f5"]],
				["tpc_sets", "term", "strong", undefined, ["f1", "f2"]],
				// No class file: last.
				["tpc_logic", "proof", "weak", true, ["f6"]],
				["tpc_graph", "concept", "weak", undefined, ["f7"]],
			],
		);
	});

	it("a weak topic whose latest answer was not right is marked, whatever came before", () => {
		const weak = (...outcomes: ("right" | "wrong" | "dontKnow")[]) =>
			studyTopics({ factIds: ["f6"], topics: [{ ...TOPICS[3]!, answers: answered(...outcomes) }], classOrder: new Map(), freeTopic: "x" })[0]!.latestWrong;
		assert.equal(weak("wrong"), true);
		assert.equal(weak("right", "dontKnow"), true, "I don't know is not right");
		assert.equal(weak("wrong", "wrong", "right"), undefined, "caught up since");
	});

	it("keeps the picked order when the class order can't tell topics apart", () => {
		const topics = studyTopics({ factIds: ["f6", "f1"], topics: TOPICS, classOrder: new Map(), freeTopic: "x" });
		assert.deepEqual(topics.map((t) => t.id), ["tpc_logic", "tpc_sets"]);
	});

	it("a typed topic with no matched facts is one untested topic with no material", () => {
		assert.deepEqual(studyTopics({ factIds: [], topics: TOPICS, classOrder: new Map(), freeTopic: "Bayes' rule" }), [
			{ id: FREE_TOPIC_ID, name: "Bayes' rule", status: "untested", factIds: [] },
		]);
		// Picks that are no longer in the graph count as none.
		assert.equal(studyTopics({ factIds: ["gone"], topics: TOPICS, classOrder: new Map(), freeTopic: "x" })[0]!.id, FREE_TOPIC_ID);
	});
});

describe("topicStudy", () => {
	/** A topic with `size` facts born in class file `rank`. */
	function build(spec: { id: string; size: number; rank: number; status: "untested" | "weak" | "shaky" | "strong" }[]) {
		const topics = spec.map((s) => ({ id: s.id, name: s.id.toUpperCase(), status: s.status, answers: [], members: Array.from({ length: s.size }, (_, i) => `${s.id}_${i}`) }));
		const facts = topics.flatMap((t) => t.members.map((id) => ({ id, name: id, statement: `${id} holds`, topicId: t.id, born: null, inLessons: false, answers: [] })));
		const classOrder = new Map(spec.flatMap((s, i) => topics[i]!.members.map((id) => [id, s.rank] as const)));
		return { topics, facts, classOrder };
	}
	const ids = (topics: { id: string }[]) => topics.map((t) => t.id);

	it("fills whole topics in class order up to 64 facts, listed in class order", () => {
		const input = build([
			{ id: "a", size: 30, rank: 2, status: "weak" },
			{ id: "b", size: 30, rank: 0, status: "untested" },
			{ id: "c", size: 10, rank: 1, status: "strong" },
		]);
		const topics = topicStudy({ ...input, topicIds: ["a", "b", "c"] });
		assert.deepEqual(ids(topics), ["b", "c"], "a would pass 64 facts, so it waits");
		assert.deepEqual(topics.map((t) => t.factIds.length), [30, 10], "never half a topic");
		assert.equal(studyTitle(topics), "Study: B, C");
	});

	it("always keeps one topic; a topic over 64 facts keeps its first 64, the ones to fix first", () => {
		const input = build([{ id: "big", size: 80, rank: 0, status: "weak" }, { id: "next", size: 1, rank: 1, status: "weak" }]);
		input.facts.find((f) => f.id === "big_79")!.answers = [{ chatId: "c", toolCallId: "q", outcome: "wrong", answeredAt: "" }] as never;
		const [only, ...rest] = topicStudy({ ...input, topicIds: ["big", "next"] });
		assert.equal(rest.length, 0);
		assert.equal(only!.factIds.length, MAX_STUDY_FACTS);
		assert.equal(only!.factIds[0], "big_79", "a missed fact first");
	});

	it("a deadline start takes not-strong topics not studied today first, then studied today, then strong", () => {
		const input = build([
			{ id: "t1", size: 20, rank: 3, status: "untested" },
			{ id: "t2", size: 20, rank: 0, status: "weak" },
			{ id: "t3", size: 20, rank: 1, status: "strong" },
			{ id: "t4", size: 20, rank: 2, status: "shaky" },
		]);
		const topics = topicStudy({ ...input, topicIds: ["t1", "t2", "t3", "t4"], studiedToday: new Set(["t2"]) });
		assert.deepEqual(ids(topics), ["t2", "t4", "t1"], "t4, t1, then t2 fill it; listed in class order; strong t3 waits");
		assert.deepEqual(topics.map((t) => t.status), ["weak", "shaky", "untested"]);
	});

	it("each deadline Study click moves on to the next topics", () => {
		const input = build(Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, size: 30, rank: i, status: "untested" as const })));
		const topicIds = input.topics.map((t) => t.id);
		const first = topicStudy({ ...input, topicIds, studiedToday: new Set() });
		assert.deepEqual(ids(first), ["t0", "t1"]);
		const second = topicStudy({ ...input, topicIds, studiedToday: new Set(ids(first)) });
		assert.deepEqual(ids(second), ["t2", "t3"]);
		const all = topicStudy({ ...input, topicIds, studiedToday: new Set(topicIds) });
		assert.deepEqual(ids(all), ["t0", "t1"], "every topic studied today: back to class order");
	});

	it("drops unknown topics and repeats", () => {
		const input = build([{ id: "a", size: 2, rank: 0, status: "weak" }]);
		assert.deepEqual(ids(topicStudy({ ...input, topicIds: ["a", "gone", "a"] })), ["a"]);
		assert.deepEqual(topicStudy({ ...input, topicIds: ["gone"] }), []);
	});
});

describe("the study context and plan", () => {
	const topics = [
		{ id: "tpc_count", name: "Counting", status: "untested" as const, factIds: ["f3", "f4"] },
		{ id: "tpc_sets", name: "Sets", status: "strong" as const, factIds: ["f1"] },
	];

	it("lists names, nodes, material and standing, and fact ids only", () => {
		const text = studyContextText(studyTopics({ factIds: ["f3", "f5", "f1", "f6", "f7"], topics: TOPICS, classOrder: new Map(), freeTopic: "x" }));
		assert.match(text, /^\[Study plan\]/);
		assert.equal(
			text.split("\n").slice(1).join("\n"),
			[
				"1. Counting — node tpc_count, procedure, untested, facts f3",
				"2. Probability — node tpc_prob, shaky, facts f5",
				"3. Sets — node tpc_sets, term, strong, facts f1",
				"4. Logic — node tpc_logic, proof, weak (latest wrong), facts f6",
				"5. Graphs — node tpc_graph, concept, weak, facts f7",
			].join("\n"),
		);
		assert.match(studyContextText([{ id: FREE_TOPIC_ID, name: "Bayes", status: "untested", factIds: [] }]), /1\. Bayes — node topic, untested, no facts in the class graph yet/);
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
