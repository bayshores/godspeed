/**
 * The Graph page: the level columns, the right side's panes (the next
 * deadline, work on next, the picked topic, the picked fact) over a
 * fixture ProgressPayload, keyboard access to topics, and the screen's
 * load failure.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { GraphBody } from "../../src/frontend/components/graph/graph-body.tsx";
import { DeadlinePane, WorkOnNextPane } from "../../src/frontend/components/graph/side-panes.tsx";
import { TopicPane } from "../../src/frontend/components/graph/topic-pane.tsx";
import { FactPane, type FactSources } from "../../src/frontend/components/graph/fact-pane.tsx";
import { LevelColumns } from "../../src/frontend/components/graph/level-columns.tsx";
import { GraphTopBar } from "../../src/frontend/components/graph/graph-top-bar.tsx";
import { GraphScreen } from "../../src/frontend/components/graph/graph-screen.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { fixture } from "../graph-fixture.ts";

const noop = () => {};
const count = (html: string, needle: string) => html.split(needle).length - 1;
const body = (over: Partial<React.ComponentProps<typeof GraphBody>> = {}) => (
	<GraphBody data={fixture()} query="" sources={null} studying={false} studyError={null} onStudy={noop} onStudyDeadline={noop} onPractice={noop} {...over} />
);

describe("the level columns", () => {
	const data = fixture();
	const html = renderToStaticMarkup(body());

	it("one pane per level, named from start to advanced, each topic a row with a square per fact", () => {
		assert.equal(count(html, 'data-testid="level"'), 3);
		assert.match(html, />level 1, start here</);
		assert.match(html, />level 2</);
		assert.match(html, />level 3, advanced</);
		assert.equal(count(html, 'data-testid="topic-row"'), 5);
		const mini = html.slice(html.indexOf('aria-label="Minibatch noise'));
		assert.match(mini, /^aria-label="Minibatch noise, 3\/7 right, overconfident, 6 facts"/);
		assert.ok(!html.includes("<svg"), "no map");
	});

	it("topics off the picked deadline dim", () => {
		const row = (name: string) => html.slice(html.lastIndexOf("<button", html.indexOf(`aria-label="${name},`)), html.indexOf(`aria-label="${name},`));
		assert.match(row("Attention"), /data-dim="true"/, "Attention is not on Midterm 1");
		assert.doesNotMatch(row("Variance"), /data-dim/);
	});

	it("a picked topic: its row pressed, what it needs marked ←, what it leads to →, the rest dim", () => {
		const picked = renderToStaticMarkup(
			<LevelColumns topics={data.topics} links={data.topicLinks} facts={data.facts} inClass focus={null} selectedId="t-mini" onSelect={noop} />,
		);
		assert.match(picked, /aria-pressed="true"[^>]*aria-label="Minibatch noise/);
		assert.match(picked, /aria-label="Variance, [^"]*, needed first"/);
		assert.match(picked, /aria-label="Derivatives, [^"]*, needed first"/);
		assert.match(picked, /aria-label="Momentum, [^"]*, comes next"/);
		assert.equal(count(picked, 'data-testid="topic-mark"'), 3);
		assert.match(picked.slice(picked.lastIndexOf("<button", picked.indexOf('aria-label="Attention,'))), /^<button[^>]*data-dim="true"/);
	});

	it("a search dims the topics it doesn't match", () => {
		const searched = renderToStaticMarkup(body({ query: "momentum" }));
		assert.equal(count(searched, 'data-dim="true"'), 4);
	});

	it("an empty class graph points to the Files page; No class doesn't", () => {
		const empty = { ...fixture(), topics: [], topicLinks: [] };
		const inClass = renderToStaticMarkup(body({ data: { ...empty, classId: "cls_a" } }));
		assert.match(inClass, /Start a lesson or <a[^>]*href="\/class\/files"[^>]*>add files<\/a> to build your graph\./);
		const noClass = renderToStaticMarkup(body({ data: { ...empty, classId: null } }));
		assert.ok(noClass.includes("Start a lesson or add files to build your graph."));
		assert.ok(!noClass.includes("/class/files"));
	});
});

describe("the right side", () => {
	const data = fixture();
	const deadline = data.deadlines[0]!;

	it("the next deadline sits on top: when, its date and files, readiness, and Study", () => {
		const html = renderToStaticMarkup(
			<DeadlinePane deadlines={data.deadlines} deadline={deadline} topics={data.topics} onChange={noop} onStudy={noop} studying={false} studyError={null} />,
		);
		assert.match(html, />next</);
		assert.ok(html.includes("Midterm 1"));
		assert.ok(html.includes("in 9 days"));
		assert.ok(html.includes("Thu Nov 5, covers 2 files"));
		const bar = html.slice(html.indexOf('data-testid="readiness"'));
		assert.equal(count(bar.slice(0, bar.indexOf("</div>")), "<span"), 3);
		assert.match(html, /data-testid="deadline-ready"[^>]*>0 of 3 ready</);
		assert.match(html, /data-testid="study-deadline"[^>]*class="lh-btn lh-btn-main[\s\S]*?>study</);
	});

	it("work on next: the counts, the deadline's topics with status lines and reasons, and Study these", () => {
		const html = renderToStaticMarkup(<WorkOnNextPane scope={deadline} topics={data.topics} onSelectTopic={noop} onStudy={noop} studying={false} studyError={null} />);
		assert.equal(count(html, 'data-testid="work-on-next-row"'), 3);
		assert.ok(html.includes("4/7 right"));
		assert.ok(html.includes("3/7 right, overconfident"));
		assert.ok(html.includes("You felt sure on most of your misses"));
		assert.ok(html.includes("not tested"));
		assert.ok(html.includes("study these 3"));
	});

	it("nothing picked: the deadline pane and work on next; a topic picked: the deadline stays and the topic shows under it", () => {
		const none = renderToStaticMarkup(body());
		assert.ok(none.includes('data-testid="deadline-pane"') && none.includes('data-testid="work-on-next-pane"'));
		const picked = renderToStaticMarkup(body({ initialSelected: "t-var" }));
		assert.ok(picked.includes('data-testid="deadline-pane"'), "the deadline stays");
		assert.ok(picked.includes('data-testid="topic-pane"'));
		assert.ok(!picked.includes('data-testid="work-on-next-pane"'));
	});

	it("a done deadline, or one with no files, is not offered: work on next covers the class", () => {
		const [d] = data.deadlines;
		for (const deadlines of [[{ ...d!, done: true }], [{ ...d!, files: [] }]]) {
			const html = renderToStaticMarkup(body({ data: { ...data, deadlines } }));
			assert.ok(!html.includes('data-testid="deadline-pane"'));
			assert.equal(count(html, 'data-testid="work-on-next-row"'), 1);
		}
	});

	it("a Study start that failed says so under the button", () => {
		const html = renderToStaticMarkup(<WorkOnNextPane scope={deadline} topics={data.topics} onSelectTopic={noop} onStudy={noop} studying={false} studyError="Couldn't start the lesson. Try again." />);
		assert.match(html.slice(html.indexOf('data-testid="study-these"')), /data-testid="study-start-error"[^>]*>Couldn&#x27;t start the lesson\. Try again\.</);
	});
});

describe("the picked topic", () => {
	const data = fixture();
	const mini = data.topics.find((t) => t.id === "t-mini")!;
	const html = renderToStaticMarkup(
		<TopicPane topic={mini} topics={data.topics} links={data.topicLinks} facts={data.facts} onClose={noop} onSelectTopic={noop} onOpenFact={noop} onStudy={noop} studying={false} studyError={null} />,
	);

	it("names the topic in the pane, with its score and takeaway", () => {
		assert.match(html, /<h2[^>]*>Minibatch noise</);
		assert.match(html, /data-testid="topic-score"[^>]*>3\/7 right, overconfident</);
		assert.ok(html.includes("3 of 7 right. On 4 of the misses you picked 4 or 5, so you felt sure."));
	});

	it("needs first and leads to as bracket buttons", () => {
		const needs = html.slice(html.indexOf('data-testid="needs-first"'), html.indexOf('data-testid="leads-to"'));
		assert.ok(needs.includes("Variance") && needs.includes("Derivatives"));
		assert.match(needs, /class="lh-btn max-w-full"/);
		assert.ok(html.slice(html.indexOf('data-testid="leads-to"')).includes("Momentum"));
	});

	it("the first four facts with marks, show all, math as KaTeX, and Study", () => {
		assert.equal(count(html, 'data-testid="fact-row"'), 4);
		assert.ok(html.includes("show all 6"));
		assert.ok(html.includes('class="katex"'), "1/B renders through KaTeX");
		assert.match(html, /aria-label="Last answer wrong"/);
		assert.match(html, /data-testid="study-topic"[\s\S]*?study Minibatch noise/);
		assert.ok(!html.includes("lucide"), "no icons from the old look");
	});
});

describe("the picked fact", () => {
	const data = fixture();
	const f6 = data.facts.find((f) => f.id === "f6")!;
	const sources: FactSources = {
		chains: [
			{ premises: ["f3", "f4"], conclusion: "f6" },
			{ premises: ["f6"], conclusion: "f9" },
		],
		fileSources: { src_a: "/Users/me/cse/lecture 5.pdf" },
		sessions: { "chat-1": "Study: Minibatch noise" },
	};
	const pane = (over: Partial<React.ComponentProps<typeof FactPane>> = {}) =>
		renderToStaticMarkup(<FactPane fact={f6} topicName="Minibatch noise" facts={data.facts} sources={sources} onBack={noop} onOpenFact={noop} onPractice={noop} studying={false} studyError={null} {...over} />);

	it("what it says, its answers, where it came from, what it builds on and leads to, and Practice", () => {
		const html = pane();
		assert.match(html, /data-testid="fact-pane-back"[\s\S]*?Minibatch noise/);
		assert.match(html, /data-testid="fact-statement" class="lh-prose"/);
		assert.match(html, /1 of 2 right, last /);
		assert.match(html, /from the lesson Study: Minibatch noise/);
		assert.match(html, /data-testid="fact-source-open"[^>]*href="\/chat\/chat-1"/);
		const builds = html.slice(html.indexOf('data-testid="builds-on"'), html.indexOf('data-testid="fact-leads-to"'));
		assert.ok(builds.includes("Variance adds") && builds.includes("Variance scales"));
		assert.ok(html.slice(html.indexOf('data-testid="fact-leads-to"')).includes("Batch size and learning rate"));
		assert.match(html, /data-testid="practice-fact"[\s\S]*?practice this fact/);
	});

	it("a fact from a class file names the file", () => {
		const html = pane({ fact: { ...f6, born: "src_a" } });
		assert.match(html, /from lecture 5\.pdf/);
	});

	it("before the graph loads: no source or links, the rest shows", () => {
		const html = pane({ sources: null });
		assert.ok(!html.includes("fact-source") && !html.includes("builds-on"));
		assert.ok(html.includes("practice this fact"));
	});
});

describe("the top bar", () => {
	it("Add files opens the Files page in a class; No class picks files right there", () => {
		const inClass = renderToStaticMarkup(<GraphTopBar hasFacts={false} query="" onQuery={noop} onOpenChains={noop} importNotes={null} />);
		assert.match(inClass, /<a data-testid="add-notes"[^>]*href="\/class\/files"[^>]*>.*Add files<\/a>/);
		assert.ok(!inClass.includes("import-notes"));
		const noClass = renderToStaticMarkup(<GraphTopBar hasFacts={false} query="" onQuery={noop} onOpenChains={noop} importNotes={{ importing: false, onImportFiles: noop }} />);
		assert.ok(noClass.includes('data-testid="import-notes"'));
		assert.ok(!noClass.includes("add-notes"));
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

describe("picking in the page", () => {
	it("a topic row picks the topic; a fact opens it; Escape closes the fact, then the topic", async () => {
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		await act(async () => root!.render(body()));
		const q = (id: string) => host!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
		const rows = [...host.querySelectorAll<HTMLButtonElement>('[data-testid="topic-row"]')];
		for (const r of rows) assert.equal(r.tagName, "BUTTON", "each topic is a tab stop");
		await act(async () => rows.find((r) => r.getAttribute("aria-label")!.startsWith("Minibatch noise"))!.click());
		assert.ok(q("topic-pane"));
		await act(async () => q("fact-row")!.click());
		assert.ok(q("fact-pane"));
		await act(async () => fire(dom.window as unknown as Element, "keydown", { key: "Escape" }));
		assert.ok(q("topic-pane") && !q("fact-pane"), "back to the topic");
		await act(async () => fire(dom.window as unknown as Element, "keydown", { key: "Escape" }));
		assert.ok(q("work-on-next-pane") && !q("topic-pane"));
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
			root!.render(<DeadlinePane deadlines={[data.deadlines[0]!, long]} deadline={data.deadlines[0]!} topics={data.topics} onChange={noop} onStudy={noop} studying={false} studyError={null} />),
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
