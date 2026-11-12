import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countLine, groupChains, groupName, matchingChains, nextSort, tickState, toggled, withIds, UNLABELED, type ClusterGroup, type ReasoningChain } from "../../src/frontend/components/chain-table-model.ts";
import type { GraphNode } from "../../src/shared/core/contracts.ts";

function node(id: string, name: string, born: string | null, createdAt = "2026-09-20T10:00:00.000Z", aliases: string[] = []): GraphNode {
	return { id, name, statement: `About ${name}.`, aliases, createdAt, provenance: born ? [{ chatId: born, messageId: "m" }] : [] } as unknown as GraphNode;
}

const NODES = [node("a", "Alpha", "chat1"), node("b", "Beta", "chat1", "2026-09-22T00:00:00.000Z"), node("c", "Gamma", "notes1", "2026-09-21T00:00:00.000Z"), node("o", "Orphan", null)];
const byId = new Map(NODES.map((n) => [n.id, n]));
const CHAINS: ReasoningChain[] = [
	{ id: "b", premises: ["a"], conclusion: "b" },
	{ id: "c", premises: [], conclusion: "c" },
	{ id: "o", premises: [], conclusion: "o" },
];
const sessions = { chat1: "Lesson one" };
const files = { notes1: "notes/raw/week 2.pdf" };

describe("sorting", () => {
	it("the same sort flips; a new one starts A to Z for names, biggest or newest first otherwise", () => {
		assert.deepEqual(nextSort({ col: "name", dir: 1 }, "name"), { col: "name", dir: -1 });
		assert.deepEqual(nextSort({ col: "name", dir: 1 }, "props"), { col: "props", dir: -1 });
		assert.deepEqual(nextSort({ col: "props", dir: -1 }, "name"), { col: "name", dir: 1 });
	});

	it("groups follow the sort, the unnamed group last by name either way", () => {
		const keys = (sort: Parameters<typeof groupChains>[4]) => groupChains(CHAINS, byId, sessions, files, sort).map((g) => g.key);
		assert.deepEqual(keys({ col: "name", dir: 1 }), ["chat1", "notes1", UNLABELED]);
		assert.deepEqual(keys({ col: "name", dir: -1 }), ["notes1", "chat1", UNLABELED]);
		assert.deepEqual(keys({ col: "props", dir: -1 }).slice(0, 1), ["chat1"]);
		assert.deepEqual(keys({ col: "created", dir: -1 }), ["chat1", "notes1", UNLABELED]);
	});

	it("a group knows its kind, facts and newest date", () => {
		const [chat, notes, none] = groupChains(CHAINS, byId, sessions, files, { col: "name", dir: 1 }) as [ClusterGroup, ClusterGroup, ClusterGroup];
		assert.deepEqual([chat.kind, chat.nodeIds, chat.newestCreatedAt], ["chat", ["a", "b"], "2026-09-22T00:00:00.000Z"]);
		assert.equal(notes.kind, "notes");
		assert.deepEqual([none.label, none.kind], [null, null]);
	});
});

describe("search", () => {
	it("keeps chains with any matching fact, by name, alias or statement", () => {
		assert.equal(matchingChains(CHAINS, byId, " ").length, 3);
		assert.deepEqual(matchingChains(CHAINS, byId, "alpha").map((c) => c.id), ["b"]);
		const aliased = new Map(byId).set("o", node("o", "Orphan", null, undefined, ["zebra"]));
		assert.deepEqual(matchingChains(CHAINS, aliased, "zebra").map((c) => c.id), ["o"]);
		assert.deepEqual(matchingChains(CHAINS, byId, "qqqq"), []);
	});
});

describe("picking", () => {
	it("a box is ticked when all its facts are picked, half ticked when some are", () => {
		assert.deepEqual(tickState(["a", "b"], new Set(["a", "b"])), { checked: true, mixed: false });
		assert.deepEqual(tickState(["a", "b"], new Set(["a"])), { checked: false, mixed: true });
		assert.deepEqual(tickState(["a", "b"], new Set()), { checked: false, mixed: false });
		assert.deepEqual(tickState([], new Set()), { checked: false, mixed: false });
	});

	it("adds or takes out ids, and flips one", () => {
		assert.deepEqual([...withIds(new Set(["a"]), ["b", "c"], true)], ["a", "b", "c"]);
		assert.deepEqual([...withIds(new Set(["a", "b"]), ["a"], false)], ["b"]);
		assert.deepEqual([...toggled(new Set(["a"]), "a")], []);
		assert.deepEqual([...toggled(new Set(), "a")], ["a"]);
	});
});

describe("words", () => {
	it("a file group shows its own name; a lesson keeps its title", () => {
		assert.equal(groupName({ label: "notes/raw/week 2.pdf", kind: "notes" }), "week 2.pdf");
		assert.equal(groupName({ label: "Lesson / one", kind: "chat" }), "Lesson / one");
		assert.equal(groupName({ label: null, kind: null }), null);
	});

	it("the count line names the space when there is one", () => {
		assert.equal(countLine(221, "CSE 21"), "221 facts in CSE 21");
		assert.equal(countLine(1, null), "1 fact");
	});
});
