/**
 * Home (redesign Phase 6): the Teach/Practice switch, the topic box
 * ("Start from facts", the white "Start lesson ↵", Enter starts) and the
 * "Suggested for <class>" rows (Continue / Next up / Work on next with
 * their buttons and meta).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { FileCoverage, LessonProgress, TopicProgress } from "../src/core/index.ts";
import type { Suggestion } from "../src/components/home/suggestions-model.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
	requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
	cancelIdleCallback: (id: number) => clearTimeout(id),
});

const { ModeSwitch, TopicBox, isStartKey } = await import("../src/components/home/topic-box.tsx");
const { SuggestionList } = await import("../src/components/home/suggestions.tsx");

// ─── fixture ────────────────────────────────────────────────────────────────

const LESSON: LessonProgress = {
	chatId: "c1",
	title: "HW4 methods: expected value",
	kind: "teach",
	updatedAt: "2026-10-27T12:00:00Z",
	answers: [],
	right: 0,
	answered: 0,
	score: null,
};
const FILE: FileCoverage = { fileId: "f4", name: "Rosen 6.2 — Probability theory.pdf", facts: 22, inLessons: 0, share: 0 };

function topic(id: string, name: string, status: TopicProgress["status"], right: number, answered: number): TopicProgress {
	return {
		id,
		name,
		members: [],
		answered,
		right,
		wrong: answered - right,
		dontKnow: 0,
		rate: answered ? right / answered : null,
		status,
		color: "#F2545B",
		overconfident: false,
		answers: [],
		column: 0,
	};
}
const WEAK = topic("t1", "Conditional probability", "weak", 2, 6);
const UNTESTED = topic("t2", "Linearity of expectation", "untested", 0, 0);

const SUGGESTIONS: Suggestion[] = [
	{ kind: "continue", lesson: LESSON },
	{ kind: "next-up", file: FILE },
	{ kind: "work-on-next", item: { topicId: "t1", name: WEAK.name, status: "weak", reason: "" }, topic: WEAK },
	{ kind: "work-on-next", item: { topicId: "t2", name: UNTESTED.name, status: "untested", reason: "" }, topic: UNTESTED },
];

function list(props: Partial<React.ComponentProps<typeof SuggestionList>> = {}) {
	return renderToStaticMarkup(
		<SuggestionList
			classLabel="CSE 21"
			suggestions={SUGGESTIONS}
			step={{ position: 1, total: 11 }}
			busy={false}
			onLearn={() => {}}
			onPractice={() => {}}
			{...props}
		/>,
	);
}

function box(props: Partial<React.ComponentProps<typeof TopicBox>> = {}) {
	return renderToStaticMarkup(
		<TopicBox
			text=""
			onText={() => {}}
			onStart={() => {}}
			busy={false}
			picks={0}
			canPick
			onOpenPicker={() => {}}
			onClearPicks={() => {}}
			{...props}
		/>,
	);
}

/** The whole <li> carrying `testid`. */
function row(html: string, testid: string): string {
	const start = html.indexOf(`data-testid="${testid}"`);
	assert.ok(start >= 0, `expected ${testid}`);
	return html.slice(start, html.indexOf("</li>", start));
}

// ─── static ─────────────────────────────────────────────────────────────────

describe("Home: mode switch and topic box", () => {
	it("Teach and Practice; the selected one is the white block", () => {
		const html = renderToStaticMarkup(<ModeSwitch mode="teach" onMode={() => {}} />);
		assert.match(html, /data-testid="home-mode-teach"[^>]*aria-pressed="true"[^>]*class="[^"]*bg-ink text-background/);
		assert.match(html, /data-testid="home-mode-practice"[^>]*aria-pressed="false"/);
	});

	it("the box: the placeholder, Start from facts and the white Start lesson", () => {
		const html = box();
		assert.ok(html.includes("A topic, a homework method, or a question you&#x27;re stuck on…"));
		assert.ok(html.includes("Start from facts"));
		assert.match(html, /data-testid="home-start"[^>]*class="[^"]*bg-ink[^"]*text-background/);
		assert.ok(html.includes("Start lesson"));
		assert.doesNotMatch(html, /practice-props-clear/);
	});

	it("picked facts: the count and a clear button", () => {
		const html = box({ picks: 3 });
		assert.match(html, /<span class="font-mono tabular-nums">3<\/span> facts picked/);
		assert.ok(html.includes('data-testid="practice-props-clear"'));
	});

	it("no facts in the class: Start from facts is disabled", () => {
		assert.match(box({ canPick: false }), /data-testid="practice-props-chip"[^>]*disabled/);
	});
});

describe("Home: suggestions", () => {
	it("the label names the class; no class: just Suggested", () => {
		assert.ok(list().includes(">Suggested for CSE 21</h2>"));
		assert.ok(list({ classLabel: null }).includes(">Suggested</h2>"));
	});

	it("nothing to suggest: nothing renders", () => {
		assert.equal(list({ suggestions: [] }), "");
	});

	it("rows in order: Continue, Next up, Work on next ×2", () => {
		const kinds = [...list().matchAll(/data-testid="home-suggestion-([a-z-]+)"/g)].map((m) => m[1]);
		assert.deepEqual(kinds, ["continue", "next-up", "work-on-next", "work-on-next"]);
	});

	it("Continue: white dot, the lesson, step N / M in mono, Open links to the lesson", () => {
		const html = row(list(), "home-suggestion-continue");
		assert.ok(html.includes(">Continue</span>"));
		assert.ok(html.includes("HW4 methods: expected value"));
		assert.match(html, /rounded-full bg-ink-max/);
		assert.match(html, /step <span class="font-mono tabular-nums">1 \/ 11<\/span>/);
		assert.match(html, /<a[^>]*href="\/chat\/c1"[^>]*data-testid="home-continue"|data-testid="home-continue"[^>]*href="\/chat\/c1"/);
	});

	it("Continue before its step is read: no meta", () => {
		assert.doesNotMatch(row(list({ step: null }), "home-suggestion-continue"), /step /);
	});

	it("Next up: no dot, the file name without its extension, the fact count, Learn this", () => {
		const html = row(list(), "home-suggestion-next-up");
		assert.ok(html.includes("Rosen 6.2 — Probability theory<"));
		assert.doesNotMatch(html, /\.pdf/);
		assert.doesNotMatch(html, /rounded-full/);
		assert.match(html, /<span class="font-mono tabular-nums">22<\/span> facts/);
		assert.ok(html.includes("Learn this"));
	});

	it("Work on next: the status color dot, right / answered, or untested on the gray dot", () => {
		const html = list();
		const weak = html.slice(html.indexOf("Conditional probability") - 600, html.indexOf("Linearity of expectation"));
		assert.match(weak, /background:#F2545B/);
		assert.match(weak, /<span class="font-mono tabular-nums">2 \/ 6<\/span>/);
		const untested = row(html.slice(html.indexOf("Conditional probability")), "home-suggestion-work-on-next");
		assert.ok(untested.includes("Linearity of expectation"));
		assert.match(untested, /bg-ans-dontknow/);
		assert.ok(untested.includes(">untested</span>"));
	});
});

// ─── clicks ─────────────────────────────────────────────────────────────────

describe("Home: actions", () => {
	let root: Root | null = null;
	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		document.body.innerHTML = "";
	});

	async function mount(node: React.ReactElement): Promise<HTMLElement> {
		const host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => root!.render(node));
		return host;
	}

	it("Learn this and Practice call back with the file and the topic", async () => {
		const learned: FileCoverage[] = [];
		const practiced: TopicProgress[] = [];
		const host = await mount(
			<SuggestionList
				classLabel="CSE 21"
				suggestions={SUGGESTIONS}
				step={null}
				busy={false}
				onLearn={(f) => learned.push(f)}
				onPractice={(t) => practiced.push(t)}
			/>,
		);
		await act(async () => (host.querySelector('[data-testid="home-learn-this"]') as HTMLButtonElement).click());
		const practice = host.querySelectorAll('[data-testid="home-practice-topic"]');
		await act(async () => (practice[1] as HTMLButtonElement).click());
		assert.deepEqual(learned.map((f) => f.fileId), ["f4"]);
		assert.deepEqual(practiced.map((t) => t.id), ["t2"]);
	});

	it("busy: the start buttons are disabled", () => {
		const html = list({ busy: true });
		assert.match(html, /data-testid="home-learn-this"[^>]*disabled/);
		assert.match(html, /data-testid="home-practice-topic"[^>]*disabled/);
	});

	it("Enter starts; Shift+Enter and an IME composition's Enter don't", () => {
		assert.equal(isStartKey({ key: "Enter", shiftKey: false }), true);
		assert.equal(isStartKey({ key: "Enter", shiftKey: true }), false);
		assert.equal(isStartKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
		assert.equal(isStartKey({ key: "a", shiftKey: false }), false);
	});

	it("the mode switch reports the picked mode", async () => {
		const picked: string[] = [];
		const host = await mount(<ModeSwitch mode="teach" onMode={(m) => picked.push(m)} />);
		await act(async () => (host.querySelector('[data-testid="home-mode-practice"]') as HTMLButtonElement).click());
		assert.deepEqual(picked, ["practice"]);
	});
});
