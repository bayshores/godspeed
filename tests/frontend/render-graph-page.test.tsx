/**
 * The topic Graph page: static renders of both right
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
import { GraphBody } from "../../src/frontend/components/graph/graph-body.tsx";
import { WherePanel } from "../../src/frontend/components/graph/where-panel.tsx";
import { TopicPanel } from "../../src/frontend/components/graph/topic-panel.tsx";
import { TopicMap } from "../../src/frontend/components/graph/topic-map.tsx";
import { GraphTopBar } from "../../src/frontend/components/graph/graph-top-bar.tsx";
import { GraphScreen } from "../../src/frontend/components/graph/graph-screen.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { fixture } from "../graph-fixture.ts";

const noop = () => {};
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("Where you're at (nothing selected)", () => {
	const data = fixture();
	const html = renderToStaticMarkup(
		<WherePanel data={data} deadlineId="ex-1" onDeadlineChange={noop} onSelectTopic={noop} onStudy={noop} onHide={noop} slideIn={false} studying={false} studyError={null} />,
	);

	it("shows the deadline picker, the countdown, its date and files", () => {
		assert.ok(html.includes('data-testid="deadline-picker"'));
		assert.ok(html.includes("Midterm 1"));
		assert.ok(html.includes("9 days"));
		assert.ok(html.includes("Thu Nov 5 · 2 files"));
	});

	it("one readiness block per deadline topic, and the four counts", () => {
		const bar = html.slice(html.indexOf('data-testid="readiness"'));
		assert.equal(count(bar.slice(0, bar.indexOf("</div>")), "<span"), 3);
		assert.ok(html.includes("not tested"));
		assert.ok(html.includes("shaky"));
	});

	it("Work on next lists the deadline's items with status lines and reasons", () => {
		assert.equal(count(html, 'data-testid="work-on-next-row"'), 3);
		assert.ok(html.includes("4/7 right"));
		assert.ok(html.includes("3/7 right · overconfident"));
		assert.ok(html.includes("You felt sure on most of your misses"));
		assert.ok(html.includes("Not tested"));
		assert.ok(html.includes("Study these 3"));
	});

	it("with no deadlines: the class-wide view (no picker)", () => {
		const none = renderToStaticMarkup(
			<WherePanel data={{ ...data, deadlines: [] }} deadlineId={null} onDeadlineChange={noop} onSelectTopic={noop} onStudy={noop} onHide={noop} slideIn={false} studying={false} studyError={null} />,
		);
		assert.ok(!none.includes('data-testid="deadline-picker"'));
		assert.ok(none.includes("Where you&#x27;re at"));
		assert.equal(count(none, 'data-testid="work-on-next-row"'), 1);
		assert.ok(none.includes("Study these 1"));
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
			onStudy={noop}
			studying={false}
			studyError={null}
		/>,
	);

	it("names the topic in a bold title with its takeaway", () => {
		assert.ok(/class="[^"]*font-bold[^"]*"[^>]*>Minibatch noise</.test(html));
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
		assert.ok(html.includes("Study this topic"));
	});
});

describe("GraphBody picks the panel", () => {
	const data = fixture();
	it("nothing selected → Where you're at; a topic → its panel", () => {
		const where = renderToStaticMarkup(<GraphBody data={data} query="" studying={false} studyError={null} onStudy={noop} />);
		assert.ok(where.includes('data-testid="where-panel"'));
		assert.equal(count(where, 'data-testid="topic-node"'), 5);
		const picked = renderToStaticMarkup(<GraphBody data={data} query="" studying={false} studyError={null} onStudy={noop} initialSelected="t-var" />);
		assert.ok(picked.includes('data-testid="topic-panel"'));
	});

	it("a done deadline, or one with no files, is not offered: the class-wide view", () => {
		const [d] = data.deadlines;
		for (const deadlines of [[{ ...d!, done: true }], [{ ...d!, files: [] }]]) {
			const html = renderToStaticMarkup(
				<WherePanel data={{ ...data, deadlines }} deadlineId="ex-1" onDeadlineChange={noop} onSelectTopic={noop} onStudy={noop} onHide={noop} slideIn={false} studying={false} studyError={null} />,
			);
			assert.ok(!html.includes('data-testid="deadline-picker"'));
			assert.equal(count(html, 'data-testid="work-on-next-row"'), 1);
		}
	});

	it("topics off the picked deadline fade on the map", () => {
		const html = renderToStaticMarkup(<GraphBody data={data} query="" studying={false} studyError={null} onStudy={noop} />);
		const node = (id: string) => html.slice(html.indexOf(`data-topic="${id}"`), html.indexOf(`data-topic="${id}"`) + 400);
		assert.ok(node("t-attn").includes('opacity="0.22"'), "Attention is not on Midterm 1");
		assert.ok(node("t-var").includes('opacity="1"'));
	});
});

describe("adding notes and start errors", () => {
	const data = fixture();
	const empty = { ...data, topics: [], topicLinks: [] };

	it("an empty class graph points to the Files page; No class keeps import", () => {
		const inClass = renderToStaticMarkup(<GraphBody data={{ ...empty, classId: "cls_a" }} query="" studying={false} studyError={null} onStudy={noop} />);
		assert.match(inClass, /Start a lesson or <a[^>]*href="\/class\/files"[^>]*>add files<\/a> to build your graph\./);
		const noClass = renderToStaticMarkup(<GraphBody data={{ ...empty, classId: null }} query="" studying={false} studyError={null} onStudy={noop} />);
		assert.ok(noClass.includes("Start a lesson or add files to build your graph."));
		assert.ok(!noClass.includes("/class/files"));
	});

	it("the top bar's Add files opens the Files page in a class; No class picks files right there", () => {
		const inClass = renderToStaticMarkup(<GraphTopBar hasFacts={false} query="" onQuery={noop} onOpenChains={noop} importNotes={null} />);
		assert.match(inClass, /<a data-testid="add-notes"[^>]*href="\/class\/files"[^>]*>.*Add files<\/a>/);
		assert.ok(!inClass.includes("import-notes"));
		const noClass = renderToStaticMarkup(
			<GraphTopBar hasFacts={false} query="" onQuery={noop} onOpenChains={noop} importNotes={{ importing: false, onImportFiles: noop }} />,
		);
		assert.ok(noClass.includes('data-testid="import-notes"'));
		assert.ok(!noClass.includes("add-notes"));
	});

	it("a Study start that failed says so under the panel button", () => {
		const html = renderToStaticMarkup(
			<WherePanel data={data} deadlineId="ex-1" onDeadlineChange={noop} onSelectTopic={noop} onStudy={noop} onHide={noop} slideIn={false} studying={false} studyError="Couldn't start the lesson. Try again." />,
		);
		const after = html.slice(html.indexOf('data-testid="study-these"'));
		assert.match(after, /data-testid="study-start-error"[^>]*>Couldn&#x27;t start the lesson\. Try again\.</);
		assert.ok(!renderToStaticMarkup(<WherePanel data={data} deadlineId="ex-1" onDeadlineChange={noop} onSelectTopic={noop} onStudy={noop} onHide={noop} slideIn={false} studying={false} studyError={null} />).includes("study-start-error"));
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
	// next/link schedules its prefetch with self.requestIdleCallback.
	self: globalThis,
	IS_REACT_ACT_ENVIRONMENT: true,
	// The menu shell measures and places on a frame.
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
});
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });

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
			root!.render(<TopicMap topics={data.topics} links={data.topicLinks} inClass focus={null} selectedId={null} onSelect={(id) => picked.push(id)} />),
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

		const faded = () => nodes.filter((n) => n.getAttribute("opacity") === "0.22").length;
		await act(async () => fire(mini, "focusin"));
		assert.equal(host.querySelector('[data-testid="topic-tooltip"]'), null, "no floating box");
		assert.match(host.querySelector('[data-testid="topic-links-hover"]')!.textContent!, /needs/, "its arrows are labeled");
		assert.ok(mini.querySelector('[data-testid="topic-answer-strip"]'), "its last answers show under the score");
		assert.ok(faded() > 0, "topics it isn't linked to fade");

		await act(async () => fire(mini, "keydown", { key: "Enter" }));
		await act(async () => fire(mini, "keydown", { key: " " }));
		assert.deepEqual(picked, ["t-mini", "t-mini"]);

		await act(async () => fire(mini, "focusout"));
		assert.equal(host.querySelector('[data-testid="topic-answer-strip"]'), null, "blur hides the strip");
		assert.equal(faded(), 0, "and brings every topic back");
	});
});

describe("hiding Where you're at", () => {
	it("folds the panel to a strip that opens it again (sliding in)", async () => {
		const data = fixture();
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => root!.render(<GraphBody data={data} query="" studying={false} studyError={null} onStudy={noop} />));
		const q = (id: string) => host!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
		assert.doesNotMatch(q("where-panel")!.getAttribute("class")!, /lh-slide-in/, "no slide on the first paint");
		await act(async () => q("where-panel-hide")!.click());
		assert.equal(q("where-panel"), null);
		await act(async () => q("where-panel-show")!.click());
		assert.match(q("where-panel")!.getAttribute("class")!, /lh-slide-in/);
		assert.equal(q("where-panel-show"), null);
	});
});

describe("the deadline picker's menu", () => {
	it("is the class switcher's width; a long name truncates and shows in full on hover", async () => {
		const data = fixture();
		const long = { ...data.deadlines[0]!, id: "ex-2", name: "Final exam covering every lecture from week one through week ten" };
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () =>
			root!.render(
				<WherePanel
					data={{ ...data, deadlines: [data.deadlines[0]!, long] }}
					deadlineId="ex-1"
					onDeadlineChange={noop}
					onSelectTopic={noop}
					onStudy={noop}
					onHide={noop}
					slideIn={false}
					studying={false}
					studyError={null}
				/>,
			),
		);
		await act(async () => host!.querySelector<HTMLButtonElement>('[data-testid="deadline-picker"]')!.click());
		const menu = document.querySelector('[data-testid="deadline-picker-menu"]')!;
		assert.match(menu.getAttribute("class")!, /w-\[236px\]/);
		const item = [...menu.querySelectorAll('[role="menuitemradio"]')].find((el) => el.getAttribute("title") === long.name);
		assert.ok(item, "the full name is the item's title");
		assert.match(item.querySelector("span")!.getAttribute("class")!, /min-w-0 flex-1 truncate/);
	});
});

describe("the graph screen", () => {
	it("a graph that can't be read says so, and Try again reads it again", async () => {
		const original = globalThis.fetch;
		const urls: string[] = [];
		globalThis.fetch = (async (url: string) => {
			urls.push(url);
			return Response.json({ error: "boom" }, { status: 500 });
		}) as typeof fetch;
		const router = { push: noop } as unknown as React.ContextType<typeof AppRouterContext>;
		const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
		try {
			host = document.createElement("div");
			document.body.append(host);
			root = createRoot(host);
			await act(async () =>
				root!.render(
					<AppRouterContext.Provider value={router}>
						<ServerEventsProvider connect={quietEvents as never}>
							<GraphScreen />
						</ServerEventsProvider>
					</AppRouterContext.Provider>,
				),
			);
			assert.match(host.querySelector('[data-testid="load-failed"]')!.textContent!, /Couldn't load your graph\./);
			const before = urls.filter((u) => u.startsWith("/api/progress")).length;
			await act(async () => {
				host!.querySelector<HTMLButtonElement>('[data-testid="load-failed-retry"]')!.click();
				await new Promise((resolve) => setTimeout(resolve, 450)); // the refresh debounce
			});
			assert.equal(urls.filter((u) => u.startsWith("/api/progress")).length, before + 1);
		} finally {
			globalThis.fetch = original;
		}
	});
});
