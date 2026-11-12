/**
 * TOPICS:
 *  - the read rule (last snapshot, dead members dropped, "Ungrouped")
 *  - the write rule (every fact in exactly one topic; ids and material kept stable)
 *  - the topic grouper against a fake model (names validated → retry,
 *    material optional)
 *  - the scheduler: < 4 facts skip, unchanged skip, files-waiting skip,
 *    debounce, single-flight,
 *    the activity-dock entry, and the outside agent's labeled work item
 * Isolated LH_DATA_DIR (set before any config-loading import).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type ToolCall } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-topics-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { repairTopics, resolveTopics, sameFactSet, topicNameProblem, UNGROUPED_TOPIC_ID } = await import("../../src/shared/core/topics.ts");
const { groupTopics, TOPIC_GROUPER_INSTRUCTIONS, TOPIC_GROUPING_RULE } = await import("../../src/backend/agent/subagents/topic-grouper.ts");
const topics = await import("../../src/backend/server/topics.ts");
const { classStore } = await import("../../src/backend/store/classes.ts");
const { graphStoreFor } = await import("../../src/backend/server/stores.ts");
const { extractionStatuses } = await import("../../src/backend/agent/subagents/extraction-runs.ts");
const bridge = await import("../../src/backend/agent/agent-bridge.ts");

after(() => {
	topics.topicGroupingSeams.engine = undefined;
	topics.topicGroupingSeams.enabledInTests = undefined;
	topics.topicGroupingSeams.debounceMs = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** A faux engine answering with the given submit_topics calls in turn. */
function submitEngine(...submissions: unknown[]) {
	const faux = createFauxCore({});
	const prompts: string[] = [];
	faux.setResponses(
		submissions.map((args) => (ctx: { messages: Array<{ role: string; content: unknown }> }) => {
			const first = ctx.messages.find((m) => m.role === "user");
			prompts.push(typeof first?.content === "string" ? first.content : JSON.stringify(first?.content));
			return fauxAssistantMessage([fauxToolCall("submit_topics", args as ToolCall["arguments"])], { stopReason: "toolUse" });
		}),
	);
	return { engine: { model: faux.getModel(), streamFn: faux.streamSimple }, prompts };
}

let counter = 0;
const newId = () => `tpc_new${String(++counter).padStart(7, "0")}`;

describe("topics: the read rule", () => {
	it("takes the snapshot over live facts, drops dead members, gathers the rest as Ungrouped", () => {
		const snap = { at: "t", topics: [
			{ id: "tpc_a", name: "Counting", members: ["n1", "n2", "dead"] },
			{ id: "tpc_b", name: "Gone", members: ["dead2"] },
			{ id: "tpc_c", name: "Proofs", members: ["n2", "n3"] },
		] };
		const out = resolveTopics(snap, ["n1", "n2", "n3", "n4"]);
		assert.deepEqual(out.map((t) => [t.id, t.members]), [
			["tpc_a", ["n1", "n2"]],
			["tpc_c", ["n3"]],
			[UNGROUPED_TOPIC_ID, ["n4"]],
		]);
		assert.equal(out.at(-1)!.ungrouped, true);
		assert.deepEqual(resolveTopics(null, ["n1"]).map((t) => t.name), ["Ungrouped"]);
		const withMaterial = resolveTopics({ at: "t", topics: [{ id: "tpc_a", name: "Counting", members: ["n1"], material: "procedure" }, { id: "tpc_b", name: "Old", members: ["n2"] }] }, ["n1", "n2"]);
		assert.deepEqual(withMaterial.map((t) => t.material), ["procedure", undefined], "a topic grouped before material has none");
		assert.equal("material" in withMaterial[1]!, false);
		assert.deepEqual(resolveTopics(null, []), []);
	});

	it("knows when the fact set is unchanged", () => {
		const snap = { at: "t", topics: [{ id: "tpc_a", name: "A", members: ["n1", "n2"] }] };
		assert.equal(sameFactSet(snap, ["n2", "n1"]), true);
		assert.equal(sameFactSet(snap, ["n1"]), false);
		assert.equal(sameFactSet(snap, ["n1", "n2", "n3"]), false);
		assert.equal(sameFactSet(null, ["n1"]), false);
	});

	it("the store reads the last valid snapshot line and reuses it while the file is unchanged", () => {
		const cls = classStore.createClass({ name: "Ledger read" });
		const store = graphStoreFor(cls.id);
		assert.equal(store.readTopics(), null);
		store.appendTopics({ at: "t1", topics: [{ id: "tpc_a", name: "First", members: ["n1"] }] });
		store.appendTopics({ at: "t2", topics: [{ id: "tpc_a", name: "Second", members: ["n1"] }] });
		const file = path.join(TMP_DATA, "classes", cls.id, "graph", "topics.jsonl");
		fs.appendFileSync(file, `{"at":"torn"\n${JSON.stringify({ at: "t3", topics: "bad" })}\n`);
		const snap = store.readTopics();
		assert.equal(snap?.at, "t2");
		assert.equal(store.readTopics(), snap, "an unchanged file is not parsed again");
		store.appendTopics({ at: "t4", topics: [{ id: "tpc_a", name: "Second", members: ["n1"], material: "term" }] });
		assert.equal(store.readTopics()?.topics[0]!.material, "term");
		fs.appendFileSync(file, `${JSON.stringify({ at: "t5", topics: [{ id: "tpc_a", name: "Second", members: ["n1"], material: "fact" }] })}\n`);
		assert.equal(store.readTopics()?.at, "t4", "an unknown material is a corrupt line");
	});

	it("names are 1–4 words", () => {
		assert.equal(topicNameProblem("Expected value"), null);
		assert.match(topicNameProblem("  ")!, /empty/);
		assert.match(topicNameProblem("The law of total probability")!, /5 words/);
	});
});

describe("topics: the write rule", () => {
	const facts = ["n1", "n2", "n3", "n4", "n5", "n6"];
	const existing = [{ id: "tpc_old", name: "Counting", members: ["n1"] }];

	it("keeps existing ids, borrows an id by name, drops unknown facts and duplicates", () => {
		const out = repairTopics(
			[
				{ id: "tpc_old", name: " Counting  rules ", members: ["n1", "n2", "ghost"] },
				{ name: "counting", members: ["n2", "n3"] }, // n2 already placed
				{ id: "tpc_made_up", name: "Graphs", members: ["n4", "n5", "n6"] },
			],
			facts, [], existing, newId,
		);
		assert.deepEqual(out.map((t) => [t.name, t.members]), [["Counting rules", ["n1", "n2"]], ["counting", ["n3"]], ["Graphs", ["n4", "n5", "n6"]]]);
		assert.equal(out[0]!.id, "tpc_old");
		assert.match(out[1]!.id, /^tpc_new/, "the name-match id is already used — a new id");
		assert.match(out[2]!.id, /^tpc_new/, "an invented id is not kept");
	});

	it("a topic that keeps an existing id keeps its material; the draft's is used only when there was none", () => {
		const out = repairTopics(
			[
				{ id: "tpc_proc", name: "Counting", members: ["n1"], material: "concept" },
				{ name: "proofs", members: ["n2"], material: "term" }, // borrows tpc_proof by name
				{ id: "tpc_none", name: "Sets", members: ["n3"], material: "term" },
				{ name: "Graphs", members: ["n4"], material: "concept" },
				{ name: "Trees", members: ["n5", "n6"] },
			],
			facts,
			[],
			[
				{ id: "tpc_proc", name: "Counting", members: ["n1"], material: "procedure" },
				{ id: "tpc_proof", name: "Proofs", members: ["n2"], material: "proof" },
				{ id: "tpc_none", name: "Sets", members: ["n3"] },
			],
			newId,
		);
		assert.deepEqual(out.map((t) => [t.name, t.material]), [
			["Counting", "procedure"],
			["proofs", "proof"],
			["Sets", "term"],
			["Graphs", "concept"],
			["Trees", undefined],
		]);
		assert.equal(out[1]!.id, "tpc_proof");
		assert.equal("material" in out[4]!, false);
	});

	it("places left-out facts by chain neighbors, the rest in Other", () => {
		const out = repairTopics(
			[{ name: "Counting", members: ["n1", "n2"] }, { name: "Graphs", members: ["n4"] }],
			facts,
			[
				{ premises: ["n1", "n3"], conclusion: "n2" }, // n3 → Counting
				{ premises: ["n3"], conclusion: "n5" }, // n5 → via n3 on the next pass
			],
			[], newId,
		);
		const byName = Object.fromEntries(out.map((t) => [t.name, t.members]));
		assert.deepEqual(byName.Counting, ["n1", "n2", "n3", "n5"]);
		assert.deepEqual(byName.Other, ["n6"]);
		assert.deepEqual(out.flatMap((t) => t.members).sort(), facts, "every fact exactly once");
	});
});

describe("topics: the grouper (fake model)", () => {
	it("prompts with facts and current topics, retries a bad name, returns a full grouping", async () => {
		assert.ok(TOPIC_GROUPER_INSTRUCTIONS.includes(TOPIC_GROUPING_RULE), "the approved instruction, verbatim");
		const { engine, prompts } = submitEngine(
			{ topics: [{ name: "Everything about counting and proofs here", members: ["n1"] }] },
			{ topics: [{ id: "tpc_old", name: "Counting", members: ["n1", "n2"] }, { name: "Proofs", members: ["n3"] }] },
		);
		const out = await groupTopics({
			className: "CSE 21",
			facts: ["n1", "n2", "n3", "n4"].map((id) => ({ id, name: `Fact ${id}`, statement: `${id} holds` })),
			chains: [{ premises: ["n3"], conclusion: "n4" }],
			current: [{ id: "tpc_old", name: "Counting", members: ["n1"] }],
			engine,
			newId,
		});
		assert.match(prompts[0]!, /Course: CSE 21/);
		assert.match(prompts[0]!, /n1 \| Fact n1 \| n1 holds/);
		assert.match(prompts[0]!, /"tpc_old"/);
		assert.deepEqual(out.map((t) => [t.id, t.name, t.members]), [
			["tpc_old", "Counting", ["n1", "n2"]],
			[out[1]!.id, "Proofs", ["n3", "n4"]],
		]);
	});

	it("asks for each topic's material after the grouping rule and takes a grouping with or without it", async () => {
		const rule = TOPIC_GROUPER_INSTRUCTIONS.indexOf(TOPIC_GROUPING_RULE);
		assert.ok(TOPIC_GROUPER_INSTRUCTIONS.indexOf("Also give each topic its material") > rule);
		const { engine } = submitEngine({
			topics: [
				{ id: "tpc_old", name: "Counting", members: ["n1", "n2"], material: "concept" },
				{ name: "Proofs", members: ["n3"], material: "proof" },
				{ name: "Sets", members: ["n4"] },
			],
		});
		const out = await groupTopics({
			className: "MATH 1A",
			facts: ["n1", "n2", "n3", "n4"].map((id) => ({ id, name: `Fact ${id}`, statement: `${id} holds` })),
			chains: [],
			current: [{ id: "tpc_old", name: "Counting", members: ["n1"], material: "procedure" }],
			engine,
			newId,
		});
		assert.deepEqual(out.map((t) => [t.name, t.material]), [
			["Counting", "procedure"],
			["Proofs", "proof"],
			["Sets", undefined],
		]);
	});
});

describe("topics: the scheduler", () => {
	before(() => {
		topics.topicGroupingSeams.enabledInTests = true;
	});
	after(() => {
		topics.topicGroupingSeams.enabledInTests = undefined;
		topics.topicGroupingSeams.debounceMs = undefined;
	});

	const fact = (id: string) => ({ id, name: id, statement: `${id} holds`, aliases: [], createdAt: "2026-10-27T00:00:00.000Z", provenance: [{ chatId: "src_file", messageId: "" }] });
	const seed = (classId: string, n: number) => {
		const store = graphStoreFor(classId);
		for (let i = 1; i <= n; i++) store.appendNode(fact(`n_${classId.slice(-4)}_${i}`));
		return store;
	};
	const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
	/** A scheduled run with no debounce, awaited to its end. */
	const scheduleAndSettle = async (classId: string) => {
		topics.scheduleTopicGrouping(classId, 0);
		await tick(10);
		await topics.topicGroupingIdle(classId);
	};
	/** A faux engine putting every current fact in one topic, counting calls. */
	const groupAllEngine = (store: ReturnType<typeof graphStoreFor>, name: string) => {
		const faux = createFauxCore({});
		const counter = { calls: 0 };
		const answer = () => {
			counter.calls++;
			return fauxAssistantMessage([fauxToolCall("submit_topics", { topics: [{ name, members: store.readNodes().map((n) => n.id) }] } as unknown as ToolCall["arguments"])], { stopReason: "toolUse" });
		};
		faux.setResponses([answer, answer, answer]);
		topics.topicGroupingSeams.engine = { model: faux.getModel(), streamFn: faux.streamSimple };
		return counter;
	};

	it("skips under 4 facts and when nothing changed; writes a snapshot otherwise", async () => {
		const cls = classStore.createClass({ name: "CSE 21" });
		const store = seed(cls.id, 3);
		const counter = groupAllEngine(store, "Counting");
		await scheduleAndSettle(cls.id);
		assert.equal(counter.calls, 0, "too few facts");
		assert.equal(store.readTopics(), null);
		store.appendNode(fact(`n_${cls.id.slice(-4)}_4`));
		const ids = store.readNodes().map((n) => n.id);
		await scheduleAndSettle(cls.id);
		assert.equal(counter.calls, 1);
		const snap = store.readTopics()!;
		assert.deepEqual(snap.topics[0]!.members, ids);
		assert.match(snap.topics[0]!.id, /^tpc_[0-9a-f]{10}$/);
		assert.ok(fs.existsSync(path.join(TMP_DATA, "classes", cls.id, "graph", "topics.jsonl")));
		await scheduleAndSettle(cls.id);
		assert.equal(counter.calls, 1, "the fact set is unchanged");
		await scheduleAndSettle("cls_gone_1");
		assert.equal(counter.calls, 1, "no such class");
	});

	it("a regroup keeps a stored topic's material", async () => {
		const cls = classStore.createClass({ name: "MATH 18" });
		const store = seed(cls.id, 4);
		const ids = store.readNodes().map((n) => n.id);
		store.appendTopics({ at: "2026-10-27T00:00:00.000Z", topics: [{ id: "tpc_kept000001", name: "Matrices", members: ids.slice(0, 3), material: "procedure" }] });
		const counter = groupAllEngine(store, "Matrices");
		await scheduleAndSettle(cls.id);
		assert.equal(counter.calls, 1);
		assert.deepEqual(store.readTopics()!.topics.map((t) => [t.id, t.members.length, t.material]), [["tpc_kept000001", 4, "procedure"]]);
	});

	it("a scheduled run waits while a class file is still pending", async () => {
		const cls = classStore.createClass({ name: "CSE 29" });
		const store = seed(cls.id, 4);
		const file = { id: "f_000000000001", origin: "copied" as const, name: "notes.md", path: "notes.md", kind: "study" as const, contentFp: "", addedAt: "2026-10-27T00:00:00.000Z" };
		classStore.saveFiles(cls.id, [{ ...file, status: "pending" }]);
		const counter = groupAllEngine(store, "Pointers");
		await scheduleAndSettle(cls.id);
		assert.equal(counter.calls, 0, "a file is waiting");
		assert.equal(store.readTopics(), null);
		classStore.saveFiles(cls.id, [{ ...file, status: "ready" }]);
		await scheduleAndSettle(cls.id);
		assert.equal(counter.calls, 1);
		assert.equal(store.readTopics()!.topics[0]!.name, "Pointers");
	});

	it("debounces scheduled runs and runs once more after a busy one", async () => {
		const cls = classStore.createClass({ name: "MATH 20C" });
		const store = seed(cls.id, 4);
		const ids = store.readNodes().map((n) => n.id);
		const counter = groupAllEngine(store, "Vectors");
		topics.topicGroupingSeams.debounceMs = 30;
		try {
			for (let i = 0; i < 5; i++) topics.scheduleTopicGrouping(cls.id); // five files finishing together
			await tick(80);
			await topics.topicGroupingIdle(cls.id);
		} finally {
			topics.topicGroupingSeams.debounceMs = undefined;
		}
		assert.equal(counter.calls, 1, "one run for the burst");
		assert.deepEqual(store.readTopics()!.topics[0]!.members, ids);

		// The outside agent holds the run open, so requests land while it is going.
		topics.topicGroupingSeams.engine = { model: bridge.agentModel(), streamFn: bridge.agentStream };
		store.appendNode(fact(`n_${cls.id.slice(-4)}_5`));
		topics.scheduleTopicGrouping(cls.id, 0);
		const first = await bridge.waitForWork(5000);
		assert.ok(first, "the first run parked a work item");
		assert.equal(topics.topicGroupingRunning(cls.id), true);
		store.appendNode(fact(`n_${cls.id.slice(-4)}_6`));
		for (let i = 0; i < 2; i++) {
			topics.scheduleTopicGrouping(cls.id, 0);
			await tick(10);
		}
		const answer = () => ({ toolCalls: [{ name: "submit_topics", arguments: { topics: [{ name: "Vectors", members: store.readNodes().map((n) => n.id) }] } }] });
		assert.equal(bridge.respondToWork(first.workId, answer(), 0).ok, true);
		const followUp = await bridge.waitForWork(5000);
		assert.ok(followUp, "two requests while busy queue one follow-up run");
		assert.equal(bridge.respondToWork(followUp.workId, answer(), 0).ok, true);
		await topics.topicGroupingIdle(cls.id);
		assert.equal(bridge.pendingWorkCount(), 0, "no third run");
		assert.equal(store.readTopics()!.topics[0]!.members.length, 6);
	});

	it("shows in the activity registry and reaches an outside agent as a labeled work item", async () => {
		const cls = classStore.createClass({ name: "PHYS 2B" });
		const store = seed(cls.id, 4);
		const ids = store.readNodes().map((n) => n.id);
		topics.topicGroupingSeams.engine = { model: bridge.agentModel(), streamFn: bridge.agentStream };
		topics.scheduleTopicGrouping(cls.id, 0);
		const work = await bridge.waitForWork(5000);
		assert.ok(work, "the grouper parked a work item");
		assert.equal(work.label, "Topic grouping: PHYS 2B");
		assert.match(work.instructions ?? "", /topic grouper/);
		assert.ok(work.tools?.some((t) => t.name === "submit_topics"));
		const row = extractionStatuses().find((r) => r.chatId === topics.topicRunKey(cls.id));
		assert.ok(row, "the dock lists the run");
		assert.equal(row.kind, "topics");
		assert.equal(row.phase, "grouping");
		assert.equal(row.label, "Topic grouping: PHYS 2B");
		const answered = bridge.respondToWork(work.workId, { toolCalls: [{ name: "submit_topics", arguments: { topics: [{ name: "Electrostatics", members: ids }] } }] }, 0);
		assert.equal(answered.ok, true);
		await topics.topicGroupingIdle(cls.id);
		assert.ok(!extractionStatuses().some((r) => r.chatId === topics.topicRunKey(cls.id)), "the row leaves the dock");
		assert.equal(store.readTopics()!.topics[0]!.name, "Electrostatics");
	});
});
