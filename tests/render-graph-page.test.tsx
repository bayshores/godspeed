/**
 * The topic Graph page (redesign Phase 5): static renders of both right
 * panels over a fixture ProgressPayload, and keyboard access to the map's
 * topics (Tab-focusable, focus shows the tooltip, Enter/Space select).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { GraphBody } from "../src/components/graph/graph-body.tsx";
import { WherePanel } from "../src/components/graph/where-panel.tsx";
import { TopicPanel } from "../src/components/graph/topic-panel.tsx";
import { TopicMap } from "../src/components/graph/topic-map.tsx";
import { fixture } from "./graph-fixture.ts";

const noop = () => {};
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("Where you're at (nothing selected)", () => {
	const data = fixture();
	const html = renderToStaticMarkup(
		<WherePanel data={data} examId="ex-1" onExamChange={noop} onSelectTopic={noop} onPractice={noop} practicing={false} />,
	);

	it("shows the exam picker, the countdown, its date and files", () => {
		assert.ok(html.includes('data-testid="exam-picker"'));
		assert.ok(html.includes("Midterm 1"));
		assert.ok(html.includes("9 days"));
		assert.ok(html.includes("Thu Nov 5 · 2 files"));
	});

	it("one readiness block per exam topic, and the four counts", () => {
		const bar = html.slice(html.indexOf('data-testid="readiness"'));
		assert.equal(count(bar.slice(0, bar.indexOf("</div>")), "<span"), 3);
		assert.ok(html.includes("not tested"));
		assert.ok(html.includes("shaky"));
	});

	it("Work on next lists the exam's items with status lines and reasons", () => {
		assert.equal(count(html, 'data-testid="work-on-next-row"'), 3);
		assert.ok(html.includes("4/7 right"));
		assert.ok(html.includes("3/7 right · overconfident"));
		assert.ok(html.includes("You felt sure on most of your misses"));
		assert.ok(html.includes("Not tested yet"));
		assert.ok(html.includes("Practice these 3"));
	});

	it("with no exams: the class-wide view (no picker)", () => {
		const none = renderToStaticMarkup(
			<WherePanel data={{ ...data, exams: [] }} examId={null} onExamChange={noop} onSelectTopic={noop} onPractice={noop} practicing={false} />,
		);
		assert.ok(!none.includes('data-testid="exam-picker"'));
		assert.ok(none.includes("Where you&#x27;re at"));
		assert.equal(count(none, 'data-testid="work-on-next-row"'), 1);
		assert.ok(none.includes("Practice these 1"));
	});
});

describe("Topic selected", () => {
	const data = fixture();
	const mini = data.topics.find((t) => t.id === "t-mini")!;
	const html = renderToStaticMarkup(
		<TopicPanel
			topic={mini}
			topics={data.topics}
			links={data.topicLinks}
			facts={data.facts}
			onClose={noop}
			onSelectTopic={noop}
			onPractice={noop}
			practicing={false}
		/>,
	);

	it("names the topic in the title font with its takeaway", () => {
		assert.ok(/class="[^"]*font-title[^"]*"[^>]*>Minibatch noise</.test(html));
		assert.ok(html.includes("3 of 7 right. On 4 of the misses you picked 4 or 5, so you felt sure."));
	});

	it("Needs first and Leads to chips", () => {
		const needs = html.slice(html.indexOf('data-testid="needs-first"'), html.indexOf('data-testid="leads-to"'));
		assert.ok(needs.includes("Variance") && needs.includes("Derivatives"));
		assert.ok(html.slice(html.indexOf('data-testid="leads-to"')).includes("Momentum"));
	});

	it("the first four facts, Show all, and math as KaTeX", () => {
		assert.ok(html.includes("Facts in this topic · 6"));
		assert.equal(count(html, 'data-testid="fact-row"'), 4);
		assert.ok(html.includes("Show all 6"));
		assert.ok(html.includes('class="katex"'), "1/B renders through KaTeX");
		assert.ok(html.includes("Practice this topic"));
	});
});

describe("GraphBody picks the panel", () => {
	const data = fixture();
	it("nothing selected → Where you're at; a topic → its panel", () => {
		const where = renderToStaticMarkup(<GraphBody data={data} query="" practicing={false} onPractice={noop} />);
		assert.ok(where.includes('data-testid="where-panel"'));
		assert.equal(count(where, 'data-testid="topic-node"'), 5);
		const picked = renderToStaticMarkup(<GraphBody data={data} query="" practicing={false} onPractice={noop} initialSelected="t-var" />);
		assert.ok(picked.includes('data-testid="topic-panel"'));
	});

	it("topics off the picked exam fade on the map", () => {
		const html = renderToStaticMarkup(<GraphBody data={data} query="" practicing={false} onPractice={noop} />);
		const node = (id: string) => html.slice(html.indexOf(`data-topic="${id}"`), html.indexOf(`data-topic="${id}"`) + 400);
		assert.ok(node("t-attn").includes('opacity="0.22"'), "Attention is not on Midterm 1");
		assert.ok(node("t-var").includes('opacity="1"'));
	});
});

// ─── keyboard (createRoot over linkedom) ────────────────────────────────────

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	SVGElement: dom.window.SVGElement,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
});

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = undefined;
	host = undefined;
});

function fire(el: Element, type: string, init: Record<string, unknown> = {}) {
	const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
	for (const [k, v] of Object.entries(init)) Object.defineProperty(event, k, { value: v });
	el.dispatchEvent(event);
}

describe("keyboard access to topics", () => {
	it("topics are tab stops in map order; focus shows the tooltip; Enter and Space select", async () => {
		const data = fixture();
		const picked: (string | null)[] = [];
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () =>
			root!.render(<TopicMap topics={data.topics} links={data.topicLinks} focus={null} selectedId={null} onSelect={(id) => picked.push(id)} />),
		);
		const nodes = [...host.querySelectorAll('[data-testid="topic-node"]')];
		assert.equal(nodes.length, 5);
		for (const n of nodes) assert.equal(n.getAttribute("tabindex"), "0");
		assert.equal(nodes[0]!.getAttribute("role"), "button");
		// Left to right: the foundations come first, Momentum/Attention last.
		assert.deepEqual(
			nodes.map((n) => n.getAttribute("data-topic")).slice(0, 2).sort(),
			["t-deriv", "t-var"],
		);
		const mini = host.querySelector('[data-topic="t-mini"]')!;
		assert.match(mini.getAttribute("aria-label")!, /Minibatch noise, 3 of 7 right, overconfident, 6 facts/);

		await act(async () => fire(mini, "focusin"));
		const tip = host.querySelector('[data-testid="topic-tooltip"]');
		assert.ok(tip, "focus opens the tooltip");
		assert.ok(tip!.textContent!.includes("Needs"));
		assert.ok(tip!.textContent!.includes("Click for facts and practice"));

		await act(async () => fire(mini, "keydown", { key: "Enter" }));
		await act(async () => fire(mini, "keydown", { key: " " }));
		assert.deepEqual(picked, ["t-mini", "t-mini"]);

		await act(async () => fire(mini, "focusout"));
		assert.equal(host.querySelector('[data-testid="topic-tooltip"]'), null, "blur hides it");
	});
});
