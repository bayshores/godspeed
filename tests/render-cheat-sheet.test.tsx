/**
 * The cheat sheet's screens: the setup (where the rules came from, the
 * paper choices, what goes on it, Make), the studio's rail (rules, banned
 * kinds, the fixes when it runs long, the left-out topics) and a block's
 * lines with real KaTeX, the top bar's status while a request runs or
 * waits, and the box that asks for a change to a block.
 */
import React, { act } from "react";
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
const { StudioStatus } = await import("../src/components/cheat-sheet/studio-states.tsx");
const { AskPanel } = await import("../src/components/cheat-sheet/block-tools.tsx");

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
		assert.match(html, /Your instructions<\/span><textarea data-testid="cheat-sheet-instructions"[^>]*maxLength="600"[^>]*placeholder="Optional\. Like: use my professor/);
		assert.doesNotMatch(html, /—/, "no em-dashes");
	});

	it("shows the reading, refuses to make what isn't allowed, and makes it again once made", () => {
		assert.match(setup(view({ readingRules: true })), /Claude Code is reading your syllabus for the rules/);
		assert.match(setup(view({ readingRules: true }), DEFAULT_RULES, true), /Claude Code will read your syllabus for the rules once it connects/);
		const html = setup(view(), { ...DEFAULT_RULES, allowed: false });
		assert.match(html, /doesn&#x27;t allow a cheat sheet/);
		assert.match(html, /data-testid="cheat-sheet-make"[^>]*disabled/);
		assert.doesNotMatch(html, /cheat-sheet-instructions/, "nothing to instruct");
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
		assert.match(html, /Your instructions.*data-testid="cheat-sheet-rail-instructions"/);
		assert.doesNotMatch(html, /cheat-sheet-remake/, "the setup makes the first sheet");
		assert.match(rail({ onRemake: () => {} }), /data-testid="cheat-sheet-remake"[^>]*>Remake sheet<.*Pinned blocks stay\./);
		assert.match(rail({ onRemake: () => {}, busy: true }), /data-testid="cheat-sheet-remake" disabled=""/);
	});

	it("offers the fixes when the sheet runs long", () => {
		const html = rail({ overLines: 4, fixes: [{ kind: "tighten", blockIds: ["x"], label: "Tighten the 3 longest blocks" }, { kind: "small-text", label: "Use Small text" }, { kind: "leave-out", blockId: "y", label: "Leave out Sums" }] });
		assert.match(html, /About 4 lines don&#x27;t fit.*Pick one:.*Tighten the 3 longest blocks.*Use Small text.*Leave out Sums/);
		assert.match(rail({ leftOut: [] }), /Nothing right now/);
		assert.match(rail({ sheet: { ...newCheatSheet("d", "t"), rules: { ...DEFAULT_RULES, allowed: false }, prefs: DEFAULT_PREFS } }), /Not allowed for this one/);
	});
});

describe("the studio's status", () => {
	const status = (v: CheatSheetView, agentGone: boolean) =>
		renderToStaticMarkup(<StudioStatus view={v} agentName="Claude Code" agentGone={agentGone} planned={4} fits fill={0.5} showMeter={false} onStop={() => {}} />);

	it("says what the agent is changing, or that none is connected to do it, with Stop either way", () => {
		const tighten = view({ running: { kind: "change", blockIds: ["b1"] } });
		assert.match(status(tighten, false), /braille[\s\S]*Claude Code is changing a block/);
		const waiting = status(tighten, true);
		assert.match(waiting, />No agent connected</);
		assert.doesNotMatch(waiting, /is changing|braille/i, "no endless spinner");
		assert.match(waiting, />Stop</);
		assert.match(status(view({ running: { kind: "change", blockIds: [], topicId: "c" } }), true), />No agent connected</, "Add waits the same way");
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

describe("asking for a change to a block", () => {
	const block = { id: "blk_1", topicId: "a", title: "Counting", body: "", reason: "Missed twice" };

	async function mountAsk(onAsk: (text: string) => Promise<string | null>) {
		Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
		const { createRoot } = await import("react-dom/client");
		const host = document.createElement("div");
		document.body.appendChild(host);
		const root = createRoot(host);
		await act(async () => root.render(<AskPanel block={block} color="red" busy={false} onAsk={onAsk} />));
		const field = host.querySelector("textarea")!;
		// The box's own handlers: linkedom's text field events don't reach React here.
		const props = () => Object.entries(field).find(([k]) => k.startsWith("__reactProps"))![1] as { onChange: (e: unknown) => void; onKeyDown: (e: unknown) => void };
		const type = (value: string) => act(async () => props().onChange({ target: { value } }));
		const key = (k: string, shiftKey = false) =>
			act(async () => props().onKeyDown({ key: k, shiftKey, metaKey: false, ctrlKey: false, preventDefault() {}, stopPropagation() {} }));
		return { field, type, key, done: () => act(async () => root.unmount()) };
	}

	it("Enter sends, Shift+Enter doesn't; the text clears only once the request went through", async () => {
		const asked: string[] = [];
		let answer: string | null = "Couldn't reach the agent.";
		const box = await mountAsk(async (text) => {
			asked.push(text);
			return answer;
		});
		await box.type("shorter please");
		await box.key("Enter", true);
		assert.deepEqual(asked, []);
		await box.key("Enter");
		assert.deepEqual(asked, ["shorter please"]);
		assert.equal(box.field.value, "shorter please", "a failed request keeps the text");
		answer = null;
		await box.key("Enter");
		assert.deepEqual(asked, ["shorter please", "shorter please"]);
		assert.equal(box.field.value, "");
		await box.done();
	});
});
