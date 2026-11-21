/**
 * The Graph page's pure parts: the panels' helpers and Find
 * (src/frontend/components/graph/derive.ts) and the fact order from
 * core/progress.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	factCellLabel,
	factLinks,
	neighbors,
	findMatches,
	nothingGrouped,
	sortsNextLine,
	sureMissNote,
	topicCountLine,
} from "../../src/frontend/components/graph/derive.ts";
import { factMark, topicFacts } from "../../src/shared/core/progress.ts";
import { answers, fact, fixture, unsorted } from "../graph-fixture.ts";

describe("fact links", () => {
	it("factLinks: premises of chains concluding it, conclusions of chains it starts, each once", () => {
		const chains = [
			{ premises: ["a", "b"], conclusion: "x" },
			{ premises: ["a"], conclusion: "x" },
			{ premises: ["x", "c"], conclusion: "y" },
			{ premises: ["x"], conclusion: "x" },
		];
		assert.deepEqual(factLinks("x", chains), { buildsOn: ["a", "b"], leadsTo: ["y"] });
		assert.deepEqual(factLinks("q", chains), { buildsOn: [], leadsTo: [] });
	});
});

describe("panel helpers", () => {
	const data = fixture();
	const byId = new Map(data.topics.map((t) => [t.id, t]));
	const mini = byId.get("t-mini")!;

	it("sureMissNote counts the sure misses, and says nothing without any", () => {
		assert.equal(sureMissNote(mini), "On 4 of the misses you picked 4 or 5, so you felt sure.");
		assert.equal(sureMissNote(byId.get("t-var")!), "");
		assert.equal(sureMissNote(byId.get("t-mom")!), "");
	});

	it("topicCountLine: the fact count and the score", () => {
		assert.equal(topicCountLine(6, mini), "6 facts, 3 of 7 right");
		assert.equal(topicCountLine(1, byId.get("t-mom")!), "1 fact, not tested");
	});

	it("factCellLabel: the score, in a lesson, or not studied", () => {
		assert.equal(factCellLabel(fact("x", "t", "x", answers("rw"))), "1 of 2 right");
		assert.equal(factCellLabel({ ...fact("x", "t", "x"), inLessons: true }), "In a lesson, not answered");
		assert.equal(factCellLabel({ ...fact("x", "t", "x"), inLessons: false }), "Not studied");
	});

	it("topicFacts: wrong first, then don't know, right, untested", () => {
		const names = topicFacts(data.facts, mini).map((f) => f.name);
		assert.deepEqual(names, [
			"Minibatch gradient is unbiased",
			"Noise variance shrinks like $1/B$",
			"Batch size and learning rate",
			"Bigger batches cost more per step",
			"Gradient noise scale",
			"Noise can help escape flat regions",
		]);
		assert.equal(factMark(fact("x", "t", "x", answers("wr"))), "right", "the latest answer counts");
		assert.equal(factMark(fact("x", "t", "x")), null);
	});

	it("neighbors: needs first (heaviest first) and leads to", () => {
		const { needs, leadsTo } = neighbors("t-mini", data.topicLinks, byId);
		assert.deepEqual(needs.map((t) => t.id), ["t-var", "t-deriv"]);
		assert.deepEqual(leadsTo.map((t) => t.id), ["t-mom"]);
	});

	it("findMatches: topics by name or by a matching fact; facts by name, statement or their topic's name", () => {
		assert.equal(findMatches("  ", data.topics, data.facts), null);
		const variance = findMatches("variance", data.topics, data.facts)!;
		assert.deepEqual([...variance.topics].sort(), ["t-mini", "t-var"]);
		assert.deepEqual([...variance.facts].sort(), ["f3", "f4", "f6"], "every fact of Variance, and the one fact of Minibatch noise that says it");
		const weights = findMatches("ATTENTION weights", data.topics, data.facts)!;
		assert.deepEqual([...weights.topics], ["t-attn"]);
		assert.deepEqual([...weights.facts], ["f12"]);
		const none = findMatches("zzz", data.topics, data.facts)!;
		assert.equal(none.topics.size + none.facts.size, 0);
	});
});

describe("before any topic", () => {
	it("nothing is grouped while Ungrouped is the only topic; a space with topics, or none at all, is not waiting", () => {
		assert.equal(nothingGrouped(unsorted().topics), true);
		assert.equal(nothingGrouped(fixture().topics), false);
		assert.equal(nothingGrouped([]), false);
	});

	it("the line names the teacher and counts the facts; with fewer than the server sorts it says when topics come", () => {
		assert.equal(sortsNextLine("Quigley", 12, 4), "Quigley sorts these 12 facts into topics next.");
		assert.equal(sortsNextLine("Quigley", 4, 4), "Quigley sorts these 4 facts into topics next.");
		assert.equal(sortsNextLine("Quigley", 1, 4), "Topics appear once this space has 4 facts.");
	});
});
