/**
 * "All facts": its head, sort row, the three levels (group, chain,
 * statement), the picked bar and the search, drawn with
 * renderToStaticMarkup.
 */

import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { ChainTableBody } from "../../src/frontend/components/chain-table.tsx";
import { ChainTableOverlay } from "../../src/frontend/components/chain-table-overlay.tsx";
import type { ChainSort } from "../../src/frontend/components/chain-table-model.ts";
import type { GraphChain, GraphNode } from "../../src/shared/core/contracts.ts";

/** The fixture graph — two follows-chains + one standalone:
 *  a → c1 ← b  (chain one, conclusion born chat1), d → e (chain two,
 *  conclusion born notes1), solo (singleton born chat1). b is born
 *  chat2 — a PREMISE-only birth: no chain concludes there, so chat2
 *  never appears as a group (the conclusion's-cluster law). */
function node(id: string, name: string, statement: string, chatId: string | null): GraphNode {
	return {
		id,
		name,
		statement,
		aliases: [] as string[],
		state: "new",
		createdAt: "2026-09-20T10:00:00.000Z",
		provenance: chatId === null ? [] : [{ chatId, messageId: `m_${id}` }],
	} as unknown as GraphNode;
}

const NODES: GraphNode[] = [
	node("a", "Premise one", "Statement A.", "chat1"),
	node("b", "Premise two", "Statement B.", "chat2"),
	node("c1", "Conclusion", "Statement C.", "chat1"),
	node("d", "Support", "Statement D.", null),
	node("e", "Follow-up", "Statement E with keyword zebra.", "notes1"),
	node("solo", "Standalone", "Statement S.", "chat1"),
	node("orphan", "Orphan", "Statement O.", null),
];

const CHAINS: GraphChain[] = [
	{ id: "c1", premises: ["a", "b"], conclusion: "c1", provenance: [], createdAt: "2026-09-20T10:00:00.000Z" },
	{ id: "e", premises: ["d"], conclusion: "e", provenance: [], createdAt: "2026-09-20T10:00:00.000Z" },
];

const BASE = {
	nodes: NODES,
	chains: CHAINS,
	sessions: { chat1: "Ethics lesson", chat2: "Second chat" },
	fileSources: { notes1: "notes/raw/ethics.md" },
	spaceLabel: "CSE 21" as string | null,
	query: "",
	onQuery: () => {},
	sort: { col: "name", dir: 1 } as ChainSort,
	onSort: () => {},
	selection: new Set<string>(),
	expandedClusters: new Set<string>(),
	expandedChains: new Set<string>(),
	onToggleCluster: () => {},
	onToggleChain: () => {},
	onToggleNodes: () => {},
	onClear: () => {},
	onDelete: () => {},
	onClose: () => {},
};

function render(props: Partial<typeof BASE> = {}) {
	return renderToStaticMarkup(React.createElement(ChainTableBody, { ...BASE, ...props }));
}

describe("ChainTableBody — clusters (the outermost layer)", () => {
	it("collapsed by default: group rows render, chain rows do not", () => {
		const html = render();
		assert.ok(html.includes('data-testid="cluster-group-chat1"'), "the lesson group");
		assert.ok(html.includes('data-testid="cluster-group-notes1"'), "the file group");
		assert.ok(html.includes("Ethics lesson"), "lesson name");
		assert.match(html, /title="notes\/raw\/ethics.md"[^>]*>ethics.md</, "a file shows its own name, the path on hover");
		assert.ok(!html.includes('data-testid="chain-row-c1"'), "no chain row when collapsed");
		assert.ok(!html.includes("Premise one"), "no chips when collapsed");
	});

	it("a premise-only birth never becomes a group — chains live in their CONCLUSION's cluster", () => {
		const html = render();
		assert.ok(!html.includes("cluster-group-chat2"), "chat2 births only a premise");
		assert.ok(!html.includes("Second chat"), "its label never renders");
	});

	it("an unnameable CONCLUSION birth forms one honest muted unlabeled group", () => {
		const html = render();
		assert.ok(html.includes("unlabeled"), "the muted label");
		// orphan (birth null) concludes its own singleton chain → the group exists;
		// d (also birth null) is a premise of e and never forms one
		assert.ok(html.includes('data-testid="chain-row-orphan"') === false, "collapsed, like every group");
	});

	it("group rows carry a box, the fact count and newest date; lessons are marked, files not", () => {
		const html = render();
		assert.ok(html.includes('data-testid="cluster-checkbox-chat1"'));
		// chat1: chains c1 (a, b, c1) + solo → 4 facts
		assert.ok(html.includes(">4 facts</span>"), "chat1's fact count");
		assert.ok(html.includes("2026-09-20"), "the newest fact's date");
		assert.ok(html.includes(">Lesson</span>"), "the lesson tag");
		assert.ok(!html.includes(">Notes</span>"), "no tag on files");
	});
});

describe("ChainTableBody — the head", () => {
	it("All facts, the count line with the space, the search field, Close, the hint and Sort by", () => {
		const html = render();
		assert.match(html, /<h1[^>]*>All facts</);
		assert.match(html, /data-testid="chain-table-count"[^>]*>7 facts in CSE 21</);
		assert.match(html, /data-testid="chain-table-search"[^>]*placeholder="Search facts…"/);
		assert.match(html, /data-testid="chain-table-close"[\s\S]*?Close</);
		assert.ok(html.includes("Picking a file or a fact also picks the facts it builds on."));
		assert.ok(html.includes(">Sort by<"));
		assert.ok(!html.includes('data-testid="page-back"'), "no way back of its own: Close leaves");
		assert.ok(!html.includes("Pick the facts to start from"), "only while picking");
	});

	it("without a space the count line is just the count", () => {
		assert.match(render({ spaceLabel: null }), /data-testid="chain-table-count"[^>]*>7 facts</);
	});

	it("picking asks for the facts to start from", () => {
		assert.ok(renderToStaticMarkup(React.createElement(ChainTableBody, { ...BASE, selectMode: true })).includes("Pick the facts to start from"));
	});

	it("open groups and chains turn their chevron down and say so", () => {
		const html = render({ expandedClusters: new Set(["chat1"]), expandedChains: new Set(["c1"]) });
		assert.match(html, /data-testid="cluster-toggle-chat1"[^>]*aria-expanded="true"/);
		assert.match(html, /data-testid="chain-toggle-c1"[^>]*aria-expanded="true"/);
		assert.match(html, /data-testid="chain-toggle-solo"[^>]*aria-expanded="false"/);
	});

	it("a group with some facts picked is half ticked", () => {
		const html = render({ selection: new Set(["a"]) });
		const at = html.indexOf('data-testid="cluster-checkbox-chat1"');
		const box = html.slice(at, html.indexOf("</label>", at));
		assert.ok(box.includes("bg-tint"), "filled like a ticked box");
		assert.ok(!(html.match(/<input[^>]*data-testid="cluster-checkbox-chat1"[^>]*>/)?.[0] ?? "").includes("checked"), "but not checked");
	});
});

describe("ChainTableBody — chain rows (chips + connectors)", () => {
	it("names render as chips; premises join by ∧, the conclusion by ⟹, as real KaTeX glyphs", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(html.includes('data-testid="chain-row-c1"'));
		assert.ok(html.includes('data-testid="prop-chip-a"'), "premise chip");
		assert.ok(html.includes('data-testid="prop-chip-c1"'), "conclusion chip");
		assert.ok(html.includes("Premise one"), "chip text");
		assert.ok(html.includes('data-testid="chain-and-c1-1"'), "the land between premises");
		assert.ok(html.includes('data-testid="chain-implies-c1"'), "the implication before the conclusion");
		assert.match(html.match(/data-testid="chain-and-c1-1"[^>]*>/)?.[0] ?? "", /text-ink/);
		assert.ok(html.includes("katex"), "a real KaTeX render, not a unicode arrow");
		assert.doesNotMatch(html, />\s*→\s*</, "no textual arrow");
		assert.ok(html.includes(">3 facts</span>"), "the chain's fact count");
	});

	it("a singleton renders ONE lonely chip, no connector; the annotation survives only for screen readers", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(html.includes('data-testid="chain-row-solo"'));
		assert.ok(html.includes('data-testid="prop-chip-solo"'));
		assert.ok(!html.includes('data-testid="chain-arrow-solo-1"'), "no connector on a singleton");
		// the visible line is the chip alone; "(no premises)" exists ONLY as the
		// row's aria-label (the a11y one-liner) — exactly one occurrence
		assert.equal(html.split("no premises").length - 1, 1, "aria-label only, never visible text");
		assert.ok(html.includes('aria-label="Standalone (no premises)"'));
	});

	it("the row carries the one-line derivation as its aria-label (core formatChainLine)", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(html.includes('aria-label="Premise one, Premise two → Conclusion"'));
	});

	it("expanding a chain shows each fact's statement with its own box", () => {
		const html = render({
			expandedClusters: new Set(["chat1"]),
			expandedChains: new Set(["c1"]),
		});
		assert.ok(html.includes('data-testid="prop-row-a"'), "premise statement row");
		assert.ok(html.includes('data-testid="prop-checkbox-a"'));
		assert.ok(html.includes("Statement A."), "the statement text");
		assert.ok(html.includes("Statement C."), "the conclusion statement");
		assert.ok(!html.includes("prop-conclusion"), "no conclusion marker");
	});
});

describe("ChainTableBody — the sortable table headers", () => {
	it("all three sorts are buttons with aria-sort, words Name, Facts, Created", () => {
		const html = render();
		assert.match(html, /data-testid="sort-name"[^>]*aria-sort="ascending"[^>]*>Name<svg/, "the picked sort has its arrow");
		assert.match(html, /data-testid="sort-props"[^>]*aria-sort="none"[^>]*>Facts</);
		assert.match(html, /data-testid="sort-created"[^>]*aria-sort="none"[^>]*>Created</);
		assert.match(html, /data-testid="sort-name"[^>]*>Name<svg[^>]*-rotate-90/, "up while ascending");
	});

	it("descending shows on the picked sort only", () => {
		const html = render({ sort: { col: "created", dir: -1 } });
		assert.match(html, /data-testid="sort-created"[^>]*aria-sort="descending"[^>]*>Created<svg[^>]*rotate-90/);
		assert.match(html, /data-testid="sort-name"[^>]*aria-sort="none"[^>]*>Name</);
	});

	it("Props sort orders cluster rows AND chains within (largest-first by default)", () => {
		const html = render({ sort: { col: "props", dir: 1 }, expandedClusters: new Set(["chat1"]) }); // ascending: smallest first
		const unlabeled = html.indexOf("cluster-group-\0unlabeled");
		const notes = html.indexOf('data-testid="cluster-group-notes1"');
		const chat = html.indexOf('data-testid="cluster-group-chat1"');
		assert.ok(unlabeled > 0 && notes > 0 && chat > 0, "all three groups render");
		assert.ok(unlabeled < notes && notes < chat, "1 < 2 < 4 member ids ascending");
		// within chat1: the singleton (1) sorts before the three-member chain
		const soloRow = html.indexOf('data-testid="chain-row-solo"');
		const c1Row = html.indexOf('data-testid="chain-row-c1"');
		assert.ok(soloRow > 0 && c1Row > 0 && soloRow < c1Row, "chain sizes ascending within the cluster");
	});

	it("the unlabeled cluster sorts last under Name, descending too", () => {
		for (const dir of [1, -1] as const) {
			const html = render({ sort: { col: "name", dir } });
			const unlabeled = html.indexOf("cluster-group-\0unlabeled");
			const notes = html.indexOf('data-testid="cluster-group-notes1"');
			const chat = html.indexOf('data-testid="cluster-group-chat1"');
			assert.ok(notes > 0 && chat > 0 && unlabeled > notes && unlabeled > chat, `unlabeled last (dir ${dir})`);
			assert.ok(dir === 1 ? chat < notes : notes < chat, `labeled groups follow the direction (dir ${dir})`);
		}
	});
});

describe("ChainTableBody — the floating selection bar (never shifts layout)", () => {
	it("absent when nothing is selected", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(!html.includes('data-testid="chain-selection-bar"'));
	});

	it("appears with the picked count, Clear and Delete", () => {
		const html = render({ selection: new Set(["a", "b", "c1"]) });
		assert.ok(html.includes('data-testid="chain-selection-bar"'));
		assert.match(html, /data-testid="chain-selected-summary"[^>]*>3 facts picked</);
		assert.match(html, /data-testid="chain-clear"[^>]*>Clear</);
		assert.match(html, /data-testid="chain-delete"[^>]*aria-label="Delete 3 selected facts"[^>]*>Delete</);
		assert.ok(html.indexOf('chain-clear"') < html.indexOf('chain-delete"'), "Delete at the right end");
	});

	it("Delete shows only with picked facts", () => {
		const html = render({ expandedClusters: new Set(["chat1"]) });
		assert.ok(!html.includes('data-testid="chain-delete"'));
	});

	it("counts picked facts, not chains", () => {
		const html = render({ selection: new Set(["a", "d"]) });
		assert.ok(html.includes("2 facts picked"));
	});
});

describe("ChainTableBody — the fuzzy search (grouped + auto-expand)", () => {
	it("matching groups open to show their chains to reveal their chains; others hide; the bar is unaffected", () => {
		const aliased = NODES.map((n) => (n.id === "b" ? { ...n, aliases: ["zebra alias"] } : n));
		const html = render({
			nodes: aliased,
			query: "zebra",
			selection: new Set(["a", "b", "c1"]), // selection spans BOTH chains
		});
		// zebra hits: chain e (statement) + chain c1 (alias on b)
		assert.ok(html.includes('data-testid="chain-row-c1"'), "auto-expanded cluster reveals the chain");
		assert.ok(html.includes('data-testid="chain-row-e"'), "statement match");
		assert.ok(!html.includes('data-testid="chain-row-solo"'), "non-matching chain hidden");
		assert.ok(!html.includes("cluster-group-notes1") === false, "notes1 still renders (it has a match)");
		assert.ok(!html.includes("Ethics lesson") === false, "chat1 still renders (it has a match)");
		// the floating bar is never search-filtered
		assert.ok(html.includes("3 facts picked"));
	});

	it("no matches: the honest empty line", () => {
		const html = render({ query: "qqqq" });
		assert.ok(html.includes('data-testid="chain-table-nomatch"'));
		assert.ok(html.includes("No matching facts."));
	});
});

describe("ChainTableOverlay — the lifted practice pick", () => {
	function overlay(extra: Record<string, unknown> = {}) {
		return renderToStaticMarkup(
			React.createElement(ChainTableOverlay, {
				open: true,
				nodes: NODES,
				chains: CHAINS,
				sessions: { chat1: "Ethics lesson", chat2: "Follow-up", notes1: "Notes" },
				fileSources: {},
				onClose: () => {},
				...extra,
			} as never),
		);
	}

	it("CONTROLLED selection renders the caller's set — the bar counts it live", () => {
		const html = overlay({ controlledSelection: new Set(["a", "b", "c1"]) });
		assert.ok(html.includes("3 facts picked"), "the bar reflects the lifted set, not internal state");
	});

	it("select mode: Done replaces Delete, so picking never deletes", () => {
		const html = overlay({
			selectMode: true,
			controlledSelection: new Set(["a", "b"]),
		});
		assert.ok(html.includes('data-testid="chain-practice-done"'));
		assert.ok(html.includes("Done"));
		assert.ok(!html.includes('data-testid="chain-delete"'), "no delete while picking");
	});

	it("covers the page under the app's top bar, not the top bar", () => {
		assert.match(overlay(), /data-testid="chain-table-overlay"[^>]*class="[^"]*fixed top-12 /);
	});

	it("browse mode: Delete stays", () => {
		const html = overlay({ controlledSelection: new Set(["a"]) });
		assert.ok(html.includes('data-testid="chain-delete"'));
		assert.ok(!html.includes('data-testid="chain-practice-done"'));
	});
});
