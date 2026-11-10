/**
 * The Graph page's pure parts: the panes' helpers and levels
 * (src/frontend/components/graph/derive.ts) and the fact order from
 * core/progress.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	countdownText,
	defaultDeadlineId,
	deadlineFilesText,
	factLinks,
	levelName,
	pickableDeadlines,
	neighbors,
	readinessBlocks,
	readyCount,
	reasonText,
	searchMatches,
	statusLine,
	takeaway,
	topicLevels,
} from "../../src/frontend/components/graph/derive.ts";
import { factMark, topicFacts } from "../../src/shared/core/progress.ts";
import { answers, fact, fixture } from "../graph-fixture.ts";

describe("levels", () => {
	it("topicLevels: one list per column, by name, skipping empty columns", () => {
		const levels = topicLevels([
			{ column: 2, name: "b" },
			{ column: 0, name: "z" },
			{ column: 0, name: "a" },
			{ column: 2, name: "a" },
		]);
		assert.deepEqual(levels.map((l) => l.map((t) => `${t.column}${t.name}`)), [["0a", "0z"], ["2a", "2b"]]);
	});

	it("levelName: the first says start here, the last advanced; one level is just a level", () => {
		assert.equal(levelName(0, 3), "level 1, start here");
		assert.equal(levelName(1, 3), "level 2");
		assert.equal(levelName(2, 3), "level 3, advanced");
		assert.equal(levelName(0, 1), "level 1");
	});

	it("readyCount counts the strong topics", () => {
		assert.equal(readyCount(fixture().topics), 2);
	});

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

	it("statusLine: score + overconfident, or not tested", () => {
		assert.equal(statusLine(mini), "3/7 right, overconfident");
		assert.equal(statusLine(byId.get("t-var")!), "4/7 right");
		assert.equal(statusLine(byId.get("t-mom")!), "Not tested");
	});

	it("reasonText explains the overconfident group", () => {
		assert.equal(reasonText({ reason: "overconfident" }), "You felt sure on most of your misses");
		assert.equal(reasonText({ reason: "Needed for Momentum" }), "Needed for Momentum");
	});

	it("takeaway counts the sure misses", () => {
		assert.equal(takeaway(mini), "3 of 7 right. On 4 of the misses you picked 4 or 5, so you felt sure.");
		assert.equal(takeaway(byId.get("t-var")!), "4 of 7 right.");
		assert.equal(takeaway(byId.get("t-mom")!), "Not tested.");
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

	it("defaultDeadlineId: the soonest deadline still ahead, else the last", () => {
		assert.equal(defaultDeadlineId([]), null);
		assert.equal(defaultDeadlineId([{ id: "a", daysUntil: -3 }, { id: "b", daysUntil: 4 }]), "b");
		assert.equal(defaultDeadlineId([{ id: "a", daysUntil: -9 }, { id: "b", daysUntil: -2 }]), "b");
	});

	it("pickableDeadlines: open ones that cover files", () => {
		const f = [{ id: "f1", name: "Lecture 1" }];
		const picked = pickableDeadlines([
			{ id: "done", done: true, files: f },
			{ id: "empty", done: false, files: [] },
			{ id: "ok", done: false, files: f },
		]);
		assert.deepEqual(picked.map((d) => d.id), ["ok"]);
	});

	it("countdown, date and files lines", () => {
		assert.equal(countdownText(9), "9 days");
		assert.equal(countdownText(1), "1 day");
		assert.equal(countdownText(0), "Today");
		assert.equal(countdownText(-2), "2 days ago");
		assert.equal(deadlineFilesText([{ name: "Lecture 1" }]), "Lecture 1");
		assert.equal(deadlineFilesText([{ name: "a" }, { name: "b" }]), "2 files");
	});

	it("readinessBlocks: strong, shaky, weak, then not tested", () => {
		assert.deepEqual(readinessBlocks(data.topics).map((t) => t.status), ["strong", "strong", "shaky", "weak", "untested"]);
	});

	it("searchMatches: topic names and their facts' names and statements", () => {
		assert.equal(searchMatches("  ", data.topics, data.facts), null);
		assert.deepEqual([...searchMatches("variance", data.topics, data.facts)!].sort(), ["t-mini", "t-var"]);
		assert.deepEqual([...searchMatches("ATTENTION weights", data.topics, data.facts)!], ["t-attn"]);
	});
});
