/**
 * The topic Graph's pure parts (redesign Phase 5): the map layout
 * (src/components/graph/layout.ts), the panels' helpers (derive.ts) and the
 * practice picks (practice.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	COLUMN_GAP,
	FIT_MIN_SCALE,
	fitTransform,
	layoutKey,
	layoutTopics,
	MAX_PER_COLUMN,
	ringDiameter,
	ROW_GAP,
} from "../src/components/graph/layout.ts";
import {
	countdownText,
	defaultDeadlineId,
	deadlineDateText,
	deadlineFilesText,
	pickableDeadlines,
	factMark,
	neighbors,
	readinessBlocks,
	reasonText,
	searchMatches,
	statusLine,
	takeaway,
	topicFacts,
} from "../src/components/graph/derive.ts";
import { MAX_PICKS, practicePicks, practiceTitle } from "../src/components/graph/practice.ts";
import { answers, fact, fixture, topic } from "./graph-fixture.ts";

describe("ringDiameter", () => {
	it("grows with the fact count like the design (6 → 33, 18 → 51) and is clamped", () => {
		assert.equal(ringDiameter(6), 33);
		assert.equal(ringDiameter(18), 51);
		assert.equal(ringDiameter(0), 28);
		assert.equal(ringDiameter(500), 64);
	});
});

describe("layoutTopics", () => {
	const T = (id: string, column: number, size = 6) => ({ id, column, size });

	it("puts columns left to right and centers each column", () => {
		const l = layoutTopics([T("a", 0), T("b", 0), T("c", 1)], [{ from: "a", to: "c" }]);
		assert.equal(l.byId.get("a")!.x, 0);
		assert.equal(l.byId.get("c")!.x, COLUMN_GAP);
		assert.equal(l.byId.get("a")!.y, -ROW_GAP / 2);
		assert.equal(l.byId.get("b")!.y, ROW_GAP / 2);
		assert.equal(l.byId.get("c")!.y, 0);
	});

	it("orders a later column by where its arrows come from (fewer crossings)", () => {
		const l = layoutTopics(
			[T("top", 0), T("bottom", 0), T("x", 1), T("y", 1)],
			[
				{ from: "bottom", to: "x" },
				{ from: "top", to: "y" },
			],
		);
		assert.ok(l.byId.get("y")!.y < l.byId.get("x")!.y, "y follows top, x follows bottom");
	});

	it("wraps a crowded column into sub-columns (no arrows = a grid, not one tall line)", () => {
		const many = Array.from({ length: MAX_PER_COLUMN + 2 }, (_, i) => T(`t${i}`, 0));
		const l = layoutTopics(many, []);
		const xs = new Set(l.topics.map((p) => p.x));
		assert.deepEqual([...xs].sort((a, b) => a - b), [0, COLUMN_GAP]);
		const next = layoutTopics([...many, T("deep", 1)], []);
		assert.equal(next.byId.get("deep")!.x, 2 * COLUMN_GAP, "the next depth starts after the wrapped columns");
	});

	it("draws each arrow from A's right edge to just before B's ring, with an arrowhead", () => {
		const l = layoutTopics([T("a", 0, 6), T("b", 1, 6)], [{ from: "a", to: "b" }]);
		assert.equal(l.links.length, 1);
		const d = ringDiameter(6);
		const link = l.links[0]!;
		assert.ok(link.path.startsWith(`M${d / 2 + 4} 0C`), link.path);
		const tip = COLUMN_GAP - d / 2 - 3;
		assert.ok(link.arrow.includes(`${tip},0`), link.arrow);
	});

	it("skips arrows to unknown topics and is deterministic", () => {
		const input = [T("a", 0), T("b", 1)];
		const links = [{ from: "a", to: "b" }, { from: "a", to: "ghost" }];
		assert.deepEqual(layoutTopics(input, links).links.length, 1);
		assert.deepEqual(layoutTopics(input, links), layoutTopics(input, links));
	});

	it("layoutKey changes only when the layout's inputs change", () => {
		const a = layoutKey([T("a", 0, 3)], []);
		assert.equal(a, layoutKey([T("a", 0, 3)], []));
		assert.notEqual(a, layoutKey([T("a", 0, 4)], []));
		assert.notEqual(a, layoutKey([T("a", 1, 3)], []));
		assert.notEqual(a, layoutKey([T("a", 0, 3)], [{ from: "a", to: "b" }]));
	});

	it("fitTransform centers a small map and never zooms in past 1×", () => {
		const fit = fitTransform({ x: -100, y: -50, w: 200, h: 100 }, { w: 800, h: 600 });
		assert.deepEqual(fit, { k: 1, x: 400, y: 300 });
	});

	it("fitTransform keeps a big map readable and starts at the foundations", () => {
		const big = fitTransform({ x: -80, y: -40, w: 4000, h: 200 }, { w: 800, h: 600 });
		assert.equal(big.k, FIT_MIN_SCALE);
		assert.equal(big.x, 32 + 80 * FIT_MIN_SCALE, "the left edge sits at the padding");
	});
});

describe("panel helpers", () => {
	const data = fixture();
	const byId = new Map(data.topics.map((t) => [t.id, t]));
	const mini = byId.get("t-mini")!;

	it("statusLine: score + overconfident, or not tested", () => {
		assert.equal(statusLine(mini), "3/7 right · overconfident");
		assert.equal(statusLine(byId.get("t-var")!), "4/7 right");
		assert.equal(statusLine(byId.get("t-mom")!), "Not tested yet");
	});

	it("reasonText explains the overconfident group", () => {
		assert.equal(reasonText({ reason: "overconfident" }), "You felt sure on most of your misses");
		assert.equal(reasonText({ reason: "Needed for Momentum" }), "Needed for Momentum");
	});

	it("takeaway counts the sure misses", () => {
		assert.equal(takeaway(mini), "3 of 7 right. On 4 of the misses you picked 4 or 5, so you felt sure.");
		assert.equal(takeaway(byId.get("t-var")!), "4 of 7 right.");
		assert.equal(takeaway(byId.get("t-mom")!), "Not tested yet.");
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
		assert.equal(deadlineDateText("2026-11-05"), "Thu Nov 5");
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

describe("practice picks", () => {
	const data = fixture();
	const byId = new Map(data.topics.map((t) => [t.id, t]));

	it("takes each topic's facts, weakest first, in topic order", () => {
		const picks = practicePicks([byId.get("t-var")!, byId.get("t-mini")!], data.facts);
		assert.equal(picks.length, 8);
		assert.equal(picks[2]!.name, "Minibatch gradient is unbiased");
		assert.deepEqual(Object.keys(picks[0]!).sort(), ["id", "name", "statement"]);
	});

	it("caps at the server's 64 picks", () => {
		const members = Array.from({ length: 80 }, (_, i) => `m${i}`);
		const big = topic("big", "Big", 0, members, []);
		const facts = members.map((id) => fact(id, "big", id));
		assert.equal(practicePicks([big], facts).length, MAX_PICKS);
	});

	it("titles the lesson after the topics", () => {
		assert.equal(practiceTitle([{ name: "Variance" }, { name: "Momentum" }]), "Practice: Variance, Momentum");
	});
});
