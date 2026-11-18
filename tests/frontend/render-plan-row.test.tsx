/**
 * The plan row pinned over the lesson's page and the plan dialog, mounted
 * over linkedom: the folded line and its remembered unfolding, a plan
 * lesson's steps and map, homework's problems and practice's blocks, and
 * what a click does.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { SpaceSummary, HomeworkProblem, PlanStepBar } from "../../src/shared/core/index.ts";

const dom = parseHTML("<!doctype html><html><body></body></html>");
// linkedom's document has no "oninput"; without it React would watch text
// fields an old-IE way.
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
	localStorage: (() => {
		const kept = new Map<string, string>();
		return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v), removeItem: (k: string) => void kept.delete(k) };
	})(),
});
const STEPS_OPEN = "lh:steps-open";
/** The row unfolded, as a learner who left it open finds it. */
const unfold = () => {
	beforeEach(() => localStorage.setItem(STEPS_OPEN, "1"));
	afterEach(() => localStorage.removeItem(STEPS_OPEN));
};
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const { PlanRow } = await import("../../src/frontend/components/lesson/plan-row.tsx");
const { PlanPopup } = await import("../../src/frontend/components/plan-block.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

const SPACE = { id: "cse21", name: "CSE 21", color: 3 } as unknown as SpaceSummary;

const bar: PlanStepBar = {
	currentIndex: 1,
	steps: [
		{ id: "a", title: "The update rule", status: "visited", answers: [{ toolCallId: "c1", outcome: "right" }, { toolCallId: "c2", outcome: "wrong", level: 4 }] },
		{ id: "b", title: "Gradient as an expectation", status: "current", answers: [] },
		{ id: "c", title: "Variance", status: "upcoming", answers: [] },
	],
};

const problems: HomeworkProblem[] = [
	{ number: "1", title: "Gradient", text: "…", done: true },
	{ number: "2", title: "Step size", text: "…", done: false },
	{ number: "3", title: "Momentum", text: "…", done: false },
];

type RowProps = Parameters<typeof PlanRow>[0];
const chainEdges = [
	{ from: "a", to: "b" },
	{ from: "b", to: "c" },
];
const base: RowProps = { kind: "teach", spaceId: undefined, stepBar: bar, edges: chainEdges, stop: null, homework: null, practice: null, onJump: () => {}, onPick: () => {}, onOpenPlan: () => {} };

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(async () => {
	if (root) await act(async () => root!.unmount());
	host?.remove();
	host = root = null;
});

async function mount(node: React.ReactNode) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(node));
	return host;
}

describe("the folded line", () => {
	const homework: RowProps = { ...base, kind: "homework", stepBar: null, homework: { problems, open: "2", blocked: null } };
	const line = (html: string) => html.match(/data-testid="plan-fold"[^>]*>([\s\S]*?)<\/button>/)![1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

	it("is folded by default: the step's place and name over a slim bar, and no list", () => {
		const html = renderToStaticMarkup(<PlanRow {...base} />);
		assert.match(html, /data-testid="plan-fold" aria-expanded="false"/);
		assert.equal(line(html), "Step 2 of 3 Gradient as an expectation");
		assert.match(html, /class="shrink-0 font-count[^"]*">Step 2 of 3</, "the count keeps the count font");
		assert.equal([...html.matchAll(/class="block h-1\.5 min-w-0 flex-1/g)].length, 3, "one bar segment per step");
		assert.doesNotMatch(html, /plan-step|<ol/);
	});

	it("homework: the open problem and its title, the title dropped when it is only the number, and a done count with nothing open", () => {
		assert.equal(line(renderToStaticMarkup(<PlanRow {...homework} />)), "Problem 2 Step size");
		const untitled = [...problems, { number: "4", title: "4", text: "…", done: false }];
		assert.equal(line(renderToStaticMarkup(<PlanRow {...homework} homework={{ problems: untitled, open: "4", blocked: null }} />)), "Problem 4");
		assert.equal(line(renderToStaticMarkup(<PlanRow {...homework} homework={{ problems, open: null, blocked: null }} />)), "1 of 3 done");
	});

	it("a click unfolds every step by name and is remembered for every lesson; a second click folds it", async () => {
		const el = await mount(<PlanRow {...base} />);
		const fold = el.querySelector<HTMLButtonElement>('[data-testid="plan-fold"]')!;
		await act(async () => fold.click());
		assert.equal(fold.getAttribute("aria-expanded"), "true");
		assert.equal(el.querySelectorAll('[data-testid="plan-step"]').length, 3);
		assert.equal(fold.textContent, "Step 2 of 3", "unfolded, the row names the step and the line only counts");
		assert.equal(localStorage.getItem(STEPS_OPEN), "1");
		assert.match(renderToStaticMarkup(<PlanRow {...homework} />), /aria-expanded="true"[\s\S]*data-testid="problem-pick"/, "another lesson opens unfolded");
		await act(async () => fold.click());
		assert.equal(fold.getAttribute("aria-expanded"), "false");
		assert.equal(localStorage.getItem(STEPS_OPEN), null);
	});
});

describe("the plan row of a plan lesson", () => {
	unfold();

	it("names every step in order in a list, the current one marked, counted once and with no plan button", () => {
		const html = renderToStaticMarkup(<PlanRow {...base} />);
		assert.match(html, /<ol aria-label="Plan steps"/);
		assert.deepEqual([...html.matchAll(/data-testid="plan-step" data-status="(\w+)"/g)].map((m) => m[1]), ["visited", "current", "upcoming"]);
		assert.deepEqual([...html.matchAll(/aria-current="step"/g)].length, 1);
		assert.match(html, /aria-current="step" title="Gradient as an expectation"/);
		assert.match(html, />2<\/span><span[^>]*>Gradient as an expectation</);
		assert.match(html, />Variance</);
		assert.equal(html.split("Gradient as an expectation").length - 1, 2, "the cell and its hover, not the line too");
		assert.doesNotMatch(html, /See the plan/);
	});

	it("paints the current step's bar in the space's color, or ink with no space", async () => {
		const el = await mount(
			<ServerEventsProvider connect={quietEvents as never}>
				<SpaceProvider initialActive={null} initialSpaces={[SPACE]}>
					<PlanRow {...base} spaceId="cse21" />
				</SpaceProvider>
			</ServerEventsProvider>,
		);
		assert.match(el.querySelector('[data-status="current"] span[style]')!.getAttribute("style") ?? "", /var\(--lh-space-3\)/);
		assert.match(renderToStaticMarkup(<PlanRow {...base} />), /aria-current="step"[^]*?style="background:var\(--color-ink\)"/);
	});

	it("only a done step is a button: its hover says how it went, and it jumps to the step's first answer", async () => {
		const jumps: string[] = [];
		const el = await mount(<PlanRow {...base} onJump={(id) => jumps.push(id)} />);
		const buttons = el.querySelectorAll<HTMLButtonElement>('[data-testid="plan-step"] button');
		assert.equal(buttons.length, 1);
		assert.equal(buttons[0]!.closest("li")!.getAttribute("title"), "The update rule, 1 of 2 right");
		await act(async () => buttons[0]!.click());
		assert.deepEqual(jumps, ["c1"]);
	});

	it("a plan that is one chain shows no map", () => {
		assert.doesNotMatch(renderToStaticMarkup(<PlanRow {...base} />), /plan-map-open/);
		assert.doesNotMatch(renderToStaticMarkup(<PlanRow {...base} edges={[]} />), /plan-map-open/);
		assert.doesNotMatch(renderToStaticMarkup(<PlanRow {...base} />), /plan-map-box/, "and keeps no room for one");
	});

	it("a branching plan keeps the map's box while the map loads, so the steps never narrow", () => {
		const branched = [
			{ from: "a", to: "b" },
			{ from: "a", to: "c" },
		];
		const html = renderToStaticMarkup(<PlanRow {...base} edges={branched} />);
		assert.doesNotMatch(html, /plan-map-open/, "the map has not loaded");
		assert.match(html, /data-testid="plan-map-box" class="[^"]*\bh-9 w-\[140px\]/);
	});

	it("a branching plan shows its map, which opens the plan", async () => {
		let opened = 0;
		const branched = [
			{ from: "a", to: "b" },
			{ from: "a", to: "c" },
		];
		const el = await mount(<PlanRow {...base} edges={branched} onOpenPlan={() => opened++} />);
		await act(async () => new Promise((r) => setTimeout(r, 0)));
		const map = el.querySelector<HTMLButtonElement>('[data-testid="plan-map-open"]')!;
		assert.equal(map.getAttribute("aria-label"), "Open the plan map");
		assert.deepEqual([...map.querySelectorAll("rect")].map((r) => r.getAttribute("data-tone")), ["done", "current", "later"]);
		assert.equal(map.querySelectorAll("path").length, 2);
		await act(async () => map.click());
		assert.equal(opened, 1);
	});

	it("shows nothing with no steps", () => {
		assert.equal(renderToStaticMarkup(<PlanRow {...base} stepBar={null} />), "");
		assert.equal(renderToStaticMarkup(<PlanRow {...base} stepBar={{ steps: [], currentIndex: -1 }} />), "");
	});
});

describe("the plan row of a homework lesson", () => {
	const hw = { problems, open: "2", blocked: null };
	const homework: RowProps = { ...base, kind: "homework", stepBar: null, homework: hw };
	unfold();

	it("names every problem by its own number over its bar, the open one marked, with no count and no button to a list", () => {
		const html = renderToStaticMarkup(<PlanRow {...homework} />);
		assert.deepEqual([...html.matchAll(/data-testid="plan-step" data-status="(\w+)"/g)].map((m) => m[1]), ["done", "current", "upcoming"]);
		assert.match(html, /aria-current="step" title="Step size"/);
		assert.match(html, />2<\/span><span[^>]*>Step size</);
		assert.doesNotMatch(html, /of 3 done|See the problems|problems-open/);
	});

	it("every problem is a button: a pick opens it, the open one goes to the work, and the pick is said aloud", async () => {
		const picks: Array<string | null> = [];
		const el = await mount(<PlanRow {...homework} onPick={(n) => picks.push(n)} />);
		const buttons = el.querySelectorAll<HTMLButtonElement>('[data-testid="problem-pick"]');
		assert.deepEqual([...buttons].map((b) => b.getAttribute("aria-label")), ["Problem 1, Gradient, done. Open it again", "Problem 2, Step size, open now. Go to your work", "Problem 3, Momentum. Open it"]);
		assert.equal(el.querySelector('[aria-label="Problems"]') !== null, true);
		await act(async () => buttons[2]!.click());
		await act(async () => buttons[1]!.click());
		await act(async () => buttons[0]!.click());
		assert.deepEqual(picks, ["3", null, "1"]);
		assert.equal(el.querySelector('[aria-live="polite"]')!.textContent, "Opening problem 1");
	});

	it("while no problem can open, a cell stays focusable, says why and picks nothing", async () => {
		const picks: Array<string | null> = [];
		const el = await mount(<PlanRow {...homework} homework={{ ...hw, blocked: "Answer the question first." }} onPick={(n) => picks.push(n)} />);
		const later = el.querySelectorAll<HTMLButtonElement>('[data-testid="problem-pick"]')[2]!;
		assert.equal(later.disabled, false);
		assert.equal(later.getAttribute("aria-disabled"), "true");
		assert.equal(later.getAttribute("aria-label"), "Problem 3, Momentum. Answer the question first.");
		await act(async () => later.click());
		assert.deepEqual(picks, []);
		assert.equal(el.querySelector('[aria-live="polite"]')!.textContent, "");
		const open = el.querySelectorAll<HTMLButtonElement>('[data-testid="problem-pick"]')[1]!;
		assert.equal(open.hasAttribute("aria-disabled"), false, "the open one still goes to the work");
	});

	it("however many problems, every cell shows its full name", () => {
		const many = Array.from({ length: 15 }, (_, i) => ({ number: String(i + 1), title: `Made-up problem ${i + 1}`, text: "…", done: i < 4 }));
		const html = renderToStaticMarkup(<PlanRow {...homework} homework={{ problems: many, open: "5", blocked: null }} />);
		assert.equal([...html.matchAll(/data-testid="plan-step"/g)].length, 15);
		assert.match(html, />15<\/span><span[^>]*>Made-up problem 15</);
	});

	it("draws nothing while no problems are posted: the desk shows the assignment instead", () => {
		const none = { ...hw, problems: [], open: null };
		assert.equal(renderToStaticMarkup(<PlanRow {...homework} homework={none} />), "");
	});
});

describe("the plan row of a practice lesson", () => {
	const practice = { ...base, kind: "practice" as const, stepBar: null };

	it("counts the solved problems and draws a block per problem", () => {
		const html = renderToStaticMarkup(<PlanRow {...practice} practice={{ blocks: ["solved", "missed", "solved", "current"], solved: 2, finished: 3 }} />);
		assert.match(html, /data-testid="practice-progress"/);
		assert.match(html, />2 of 3 solved</);
		assert.deepEqual([...html.matchAll(/data-block="(\w+)"/g)].map((m) => m[1]), ["solved", "missed", "solved", "current"]);
		assert.doesNotMatch(html, /<button/, "no button");
	});

	it("the first problem shows its block with no count yet; no blocks show nothing", () => {
		const first = renderToStaticMarkup(<PlanRow {...practice} practice={{ blocks: ["current"], solved: 0, finished: 0 }} />);
		assert.match(first, /data-block="current"/);
		assert.doesNotMatch(first, /solved/);
		assert.equal(renderToStaticMarkup(<PlanRow {...practice} practice={{ blocks: [], solved: 0, finished: 0 }} />), "");
		assert.equal(renderToStaticMarkup(<PlanRow {...practice} practice={null} />), "");
	});
});

describe("the plan dialog", () => {
	const tree = {
		nodes: [
			{ id: "a", title: "The update rule" },
			{ id: "b", title: "Gradient as an expectation" },
			{ id: "c", title: "Variance" },
		],
		edges: [
			{ from: "a", to: "b" },
			{ from: "b", to: "c" },
		],
	};
	const messages = [
		{ parts: [{ type: "tool-plan_init", state: "output-available", output: { ok: true, tree } }] },
		{ parts: [{ type: "tool-quiz", state: "output-available", toolCallId: "c1", input: { nodeId: "a" }, output: { kind: "quiz", correct: true } }] },
		{ parts: [{ type: "tool-quiz", state: "input-available", toolCallId: "c3", input: { nodeId: "b" } }] },
	];

	it("draws the live diagram alone, with no list of steps", async () => {
		await mount(<PlanPopup tree={tree} messages={messages} onClose={() => {}} />);
		const dialog = document.querySelector('[data-testid="plan-popup"]')!;
		assert.match(dialog.querySelector("h2")!.textContent ?? "", /^The plan$/);
		assert.match(dialog.textContent ?? "", /Updates as you answer/);
		assert.ok(dialog.querySelector("ol") === null);
		assert.equal(dialog.querySelector('[data-testid="plan-node-b"]')!.getAttribute("data-status"), "current");
		assert.match(dialog.querySelector('[data-testid="plan-node-b"] rect')!.getAttribute("class") ?? "", /fill-highlight/);
	});

	it("light links point at or leave a step not reached yet; a link between two reached steps is dark", async () => {
		const chain = {
			nodes: [
				{ id: "x", title: "Gray origin" },
				{ id: "y", title: "Covered middle" },
				{ id: "z", title: "Covered latest" },
			],
			edges: [
				{ from: "x", to: "y" },
				{ from: "y", to: "z" },
			],
		};
		const msgs = [
			{ parts: [{ type: "tool-plan_init", state: "output-available", output: { ok: true, tree: chain } }] },
			{ parts: [{ type: "tool-quiz", state: "output-available", input: { nodeId: "y" }, output: { kind: "quiz", correct: true } }] },
			{ parts: [{ type: "tool-quiz", state: "output-available", input: { nodeId: "z" }, output: { kind: "quiz", correct: true } }] },
		];
		await mount(<PlanPopup tree={chain} messages={msgs} onClose={() => {}} />);
		const dialog = document.querySelector('[data-testid="plan-popup"]')!;
		assert.deepEqual(["x", "y", "z"].map((id) => dialog.querySelector(`[data-testid="plan-node-${id}"]`)!.getAttribute("data-status")), ["upcoming", "visited", "current"]);
		const heads = [...dialog.querySelectorAll("path[marker-end]")].map((p) => (p.getAttribute("marker-end") ?? "").endsWith("-dim)"));
		assert.deepEqual(heads, [true, false], "x to y fades, y to z stays dark");
	});

	it("says so when the session has no plan yet", async () => {
		await mount(<PlanPopup tree={null} messages={[{ parts: [] }]} onClose={() => {}} />);
		assert.match(document.querySelector('[data-testid="plan-popup"]')!.textContent ?? "", /No plan in this lesson yet\./);
	});

	it("Close and Esc both close it", async () => {
		let closed = 0;
		await mount(<PlanPopup tree={tree} messages={messages} onClose={() => closed++} />);
		await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="plan-popup-close"]')!.click());
		const esc = new dom.window.Event("keydown", { bubbles: true, cancelable: true });
		Object.defineProperty(esc, "key", { value: "Escape" });
		await act(async () => void document.dispatchEvent(esc));
		assert.equal(closed, 2);
	});
});
