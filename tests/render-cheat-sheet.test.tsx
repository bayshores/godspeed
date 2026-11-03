/**
 * The cheat sheet's screens: the setup (where the rules came from, the
 * paper choices, what goes on it, Make), the studio's rail (rules, banned
 * kinds, the fixes when it runs long, the left-out topics) and a block's
 * lines with real KaTeX.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { DEFAULT_PREFS, DEFAULT_RULES, newCheatSheet, type CheatSheetView, type SheetTopic } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, self: globalThis });

const { SetupBody } = await import("../src/components/cheat-sheet/setup-dialog.tsx");
const { Rail } = await import("../src/components/cheat-sheet/rail.tsx");
const { SheetLines } = await import("../src/components/cheat-sheet/paper.tsx");

const topics: SheetTopic[] = [
	{ id: "a", name: "Counting", status: "weak", mistakes: 3 },
	{ id: "b", name: "Probability", status: "shaky", mistakes: 0 },
	{ id: "c", name: "Sums", status: "untested", mistakes: 0 },
	{ id: "d", name: "Sum and product rules", status: "strong", mistakes: 0 },
];

const view = (over: Partial<CheatSheetView> = {}): CheatSheetView => ({
	className: "CSE 21",
	deadlineName: "Midterm",
	date: "2026-11-04",
	sheet: newCheatSheet("ddl_1", "t"),
	saved: false,
	topics,
	mistakes: 3,
	running: null,
	readingRules: false,
	error: null,
	...over,
});

const setup = (v: CheatSheetView, rules = v.sheet.rules, away = false) =>
	renderToStaticMarkup(
		<SetupBody view={v} rules={rules} prefs={v.sheet.prefs} agentName="Claude Code" agentAway={away} busy={false} error={null} onChange={() => {}} onClose={() => {}} onMake={() => {}} />,
	);

describe("the cheat sheet setup", () => {
	it("says where the rules came from and offers the four papers, the plan and Make", () => {
		const read = view({ sheet: { ...newCheatSheet("ddl_1", "t"), rules: { ...DEFAULT_RULES, banned: ["Worked examples"], source: "Syllabus.pdf, page 3" }, rulesRead: true } });
		const html = setup(read);
		assert.match(html, /Make a cheat sheet for the Midterm/);
		assert.match(html, /Claude Code read these rules in your syllabus\. Check them and you&#x27;re done here\./);
		assert.equal(html.split('role="radio" aria-checked="true" data-testid="cheat-sheet-paper-letter"').length, 2);
		assert.match(html, /Letter, both sides.*Index card.*A4/);
		assert.match(html, /Worked examples/);
		assert.match(html, /First: your 3 mistakes from practice and your weak topic</);
		assert.match(html, /Left out: the 1 topic you know cold/);
		assert.match(html, /From Syllabus\.pdf, page 3/);
		assert.match(html, /data-testid="cheat-sheet-make"[^>]*>Make my cheat sheet</);
		assert.doesNotMatch(html, /—/, "no em-dashes");
	});

	it("shows the reading, refuses to make what isn't allowed, and makes it again once made", () => {
		assert.match(setup(view({ readingRules: true })), /Claude Code is reading your syllabus for the rules/);
		assert.match(setup(view({ readingRules: true }), DEFAULT_RULES, true), /Claude Code will read your syllabus for the rules once it connects/);
		const html = setup(view(), { ...DEFAULT_RULES, allowed: false });
		assert.match(html, /doesn&#x27;t allow a cheat sheet/);
		assert.match(html, /data-testid="cheat-sheet-make"[^>]*disabled/);
		const made = view({ sheet: { ...newCheatSheet("ddl_1", "t"), blocks: [{ id: "x", topicId: "a", title: "Counting", body: "b", reason: "r" }] } });
		assert.match(setup(made), />Make it again</);
	});
});

describe("the studio rail", () => {
	const rail = (over: Partial<React.ComponentProps<typeof Rail>> = {}) =>
		renderToStaticMarkup(
			<Rail
				sheet={{ ...newCheatSheet("ddl_1", "t"), rules: { ...DEFAULT_RULES, banned: ["Worked examples"] } }}
				leftOut={[topics[3]!]}
				fixes={[]}
				overLines={0}
				busy={false}
				onEditRules={() => {}}
				onPrefs={() => {}}
				onFix={() => {}}
				onAdd={() => {}}
				{...over}
			/>,
		);

	it("lists the rules, greys out a banned kind and the topics known cold", () => {
		const html = rail();
		assert.match(html, /Letter, one side.*Printed.*No worked examples/);
		assert.match(html, /disabled=""[^>]*\/>.*Examples<\/span><span[^>]*>not allowed/);
		assert.match(html, /Left out: you know it.*Sum and product rules.*Add/);
		assert.match(html, /aria-checked="true"[^>]*>Medium</);
		assert.doesNotMatch(html, /cheat-sheet-fixes/);
	});

	it("offers the fixes when the sheet runs long", () => {
		const html = rail({ overLines: 4, fixes: [{ kind: "tighten", blockIds: ["x"], label: "Tighten the 3 longest blocks" }, { kind: "small-text", label: "Use Small text" }, { kind: "leave-out", blockId: "y", label: "Leave out Sums" }] });
		assert.match(html, /About 4 lines don&#x27;t fit.*Pick one:.*Tighten the 3 longest blocks.*Use Small text.*Leave out Sums/);
		assert.match(rail({ leftOut: [] }), /Nothing right now/);
		assert.match(rail({ sheet: { ...newCheatSheet("d", "t"), rules: { ...DEFAULT_RULES, allowed: false }, prefs: DEFAULT_PREFS } }), /Not allowed for this one/);
	});
});

describe("a block's lines", () => {
	it("renders text, bold, bullets, steps and display math with KaTeX", () => {
		const html = renderToStaticMarkup(<SheetLines body={"**Bayes:** $P(A \\mid B)$\n- one\n2. two\n$$\\sum_{k=0}^n \\binom{n}{k} = 2^n$$"} />);
		assert.match(html, /<strong[^>]*>Bayes:<\/strong>/);
		assert.match(html, /class="katex"/);
		assert.match(html, /•<\/span><span><span>one/);
		assert.match(html, /2\.<\/span>/);
		assert.match(html, /lh-sheet-display.*katex-display/);
	});
});
