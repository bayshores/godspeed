/**
 * The Graph page: the picture with its docked topic and fact panels over a
 * fixture ProgressPayload, picking and closing by mouse and Escape, search,
 * the empty space, the top bar, and the screen's load failure.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { GraphBody } from "../../src/frontend/components/graph/graph-body.tsx";
import { searchMatches } from "../../src/frontend/components/graph/derive.ts";
import { TopicPane } from "../../src/frontend/components/graph/topic-pane.tsx";
import { FactPane, type FactSources } from "../../src/frontend/components/graph/fact-pane.tsx";
import { GraphTopBar } from "../../src/frontend/components/graph/graph-top-bar.tsx";
import { GraphScreen } from "../../src/frontend/components/graph/graph-screen.tsx";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { MemoryRouter } from "react-router";
import { fixture } from "../graph-fixture.ts";

// The picture measures names, so the static renders need a DOM too.
const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	SVGElement: dom.window.SVGElement,
	CustomEvent: dom.window.CustomEvent,
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
// The picture lays out again once the page's font is in.
Object.assign(dom.document, { fonts: { ready: Promise.resolve() } });
// linkedom has no focus: remember what was last focused. Nodes are only
// compared with ===, since a failed assert.equal on one prints the whole tree.
let focused: Element | null = null;
(dom.window.HTMLElement.prototype as unknown as { focus: () => void }).focus = function (this: Element) {
	focused = this;
};
Object.defineProperty(dom.document, "activeElement", { get: () => (focused?.isConnected ? focused : dom.document.body) });

const noop = () => {};
const inRouter = (tree: React.ReactNode) => <MemoryRouter initialEntries={["/graph"]}>{tree}</MemoryRouter>;
const count = (html: string, needle: string) => html.split(needle).length - 1;
const body = (over: Partial<React.ComponentProps<typeof GraphBody>> = {}) =>
	inRouter(<GraphBody data={fixture()} matches={null} sources={null} studying={false} studyError={null} onStudy={noop} onStudyFact={noop} {...over} />);

describe("the picture", () => {
	const html = renderToStaticMarkup(body());

	it("one picture with a button per topic, and nothing else on the page", () => {
		assert.equal(count(html, 'data-testid="graph-picture"'), 1);
		assert.equal(count(html, 'data-testid="graph-topic"'), 5);
		assert.ok(!html.includes('data-testid="graph-panel"'), "no panel until a topic is picked");
		for (const gone of ["deadline-pane", "work-on-next", "study-these", "level-columns", "cell-key", "Midterm 1"]) assert.ok(!html.includes(gone), gone);
	});

	it("a picked topic docks its panel beside the picture", () => {
		const picked = renderToStaticMarkup(body({ initialSelected: "t-var" }));
		assert.equal(count(picked, 'data-testid="graph-picture"'), 1);
		assert.match(picked, /data-testid="graph-panel"[\s\S]*data-testid="topic-pane"/);
	});

	it("a search dims the topics it doesn't light", () => {
		const data = fixture();
		const searched = renderToStaticMarkup(body({ matches: searchMatches("momentum", data.topics, data.facts) }));
		assert.equal(count(searched, 'data-dim="true"'), 4);
	});

	it("an empty space graph points to the Files page; No space doesn't", () => {
		const empty = { ...fixture(), topics: [], topicLinks: [] };
		const inSpace = renderToStaticMarkup(body({ data: { ...empty, spaceId: "cls_a" } }));
		assert.match(inSpace, /Start a lesson or <a[^>]*href="\/space\/files"[^>]*>add files<\/a> to build your graph\./);
		assert.ok(!inSpace.includes("graph-picture"));
		const noSpace = renderToStaticMarkup(body({ data: { ...empty, spaceId: null } }));
		assert.ok(noSpace.includes("Start a lesson or add files to build your graph."));
		assert.ok(!noSpace.includes("/space/files"));
	});
});

describe("the picked topic", () => {
	const data = fixture();
	const mini = data.topics.find((t) => t.id === "t-mini")!;
	const html = renderToStaticMarkup(
		<TopicPane topic={mini} topics={data.topics} links={data.topicLinks} facts={data.facts} onClose={noop} onSelectTopic={noop} onOpenFact={noop} onStudy={noop} studying={false} studyError={null} />,
	);

	it("names the topic, with Close, its fact count and score, and the sure-miss note", () => {
		assert.match(html, /<h2[^>]*>Minibatch noise</);
		assert.match(html, /data-testid="topic-pane-close"[\s\S]*?Close</);
		assert.match(html, /data-testid="topic-score"[^>]*>6 facts, 3 of 7 right</);
		assert.match(html, /data-testid="topic-note"[^>]*>On 4 of the misses you picked 4 or 5, so you felt sure\.</);
	});

	it("needs first and leads to as small outlined buttons", () => {
		const needs = html.slice(html.indexOf('data-testid="needs-first"'), html.indexOf('data-testid="leads-to"'));
		assert.ok(needs.includes(">Needs first<"));
		assert.ok(needs.includes("Variance") && needs.includes("Derivatives"));
		assert.match(needs, /data-testid="topic-chip"[^>]*class="lh-btn h-auto/);
		assert.ok(html.slice(html.indexOf('data-testid="leads-to"')).includes("Momentum"));
	});

	it("Facts: the first four with their squares, Show all, math as KaTeX", () => {
		assert.ok(html.includes(">Facts<"));
		assert.equal(count(html, 'data-testid="fact-row"'), 4);
		assert.ok(html.includes("Show all 6"));
		assert.ok(html.includes('class="katex"'), "1/B renders through KaTeX");
		assert.match(html, /role="img" aria-label="0 of 1 right"/);
	});

	it("Study is the one main key, outside the part that scrolls", () => {
		const scroller = html.slice(html.indexOf("overflow-y-auto"), html.indexOf('data-testid="study-topic"'));
		assert.ok(scroller.includes('data-testid="fact-row"'), "the facts scroll");
		assert.match(html, /data-testid="study-topic"[^>]*class="lh-btn lh-btn-main[^"]*"><span[^>]*>Study</);
		assert.equal(count(html, "lh-btn-main"), 1);
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
		renderToStaticMarkup(inRouter(<FactPane fact={f6} topicName="Minibatch noise" facts={data.facts} sources={sources} onBack={noop} onClose={noop} onOpenFact={noop} onStudy={noop} studying={false} studyError={null} {...over} />));

	it("back and Close, what it says, its answers, where it came from, what it builds on and leads to, and Study", () => {
		const html = pane();
		assert.match(html, /data-testid="fact-pane-back"[\s\S]*?Minibatch noise/);
		assert.match(html, /data-testid="fact-pane-close"[\s\S]*?Close</);
		assert.ok(html.includes('data-testid="fact-statement"'));
		assert.match(html, /1 of 2 right, last /);
		assert.match(html, /From the lesson Study: Minibatch noise/);
		assert.match(html, /data-testid="fact-source-open"[^>]*href="\/chat\/chat-1"/);
		const builds = html.slice(html.indexOf('data-testid="builds-on"'), html.indexOf('data-testid="fact-leads-to"'));
		assert.ok(builds.includes("Variance adds") && builds.includes("Variance scales"));
		assert.ok(html.slice(html.indexOf('data-testid="fact-leads-to"')).includes("Batch size and learning rate"));
		assert.match(html, /data-testid="study-fact"[^>]*class="lh-btn lh-btn-main[^"]*"><span[^>]*>Study</);
	});

	it("a fact from a space file names the file", () => {
		const html = pane({ fact: { ...f6, born: "src_a" } });
		assert.match(html, /From lecture 5\.pdf/);
	});

	it("before the graph loads: no source or links, the rest shows", () => {
		const html = pane({ sources: null });
		assert.ok(!html.includes("fact-source") && !html.includes("builds-on"));
		assert.ok(html.includes('data-testid="study-fact"'));
	});

	it("a Study start that failed says so under the key", () => {
		const html = pane({ studyError: "Couldn't start the lesson. Try again." });
		assert.match(html.slice(html.indexOf('data-testid="study-fact"')), /data-testid="study-start-error"[^>]*>Couldn&#x27;t start the lesson\. Try again\.</);
	});
});

describe("the top bar", () => {
	const bar = (over: Partial<React.ComponentProps<typeof GraphTopBar>>) =>
		renderToStaticMarkup(inRouter(<GraphTopBar hasFacts query="" onQuery={noop} nothingMatches={false} onOpenChains={noop} costs={null} importNotes={null} {...over} />));

	it("a space has no Add files here (its Files tab has it); No space picks files right there", () => {
		const inSpace = bar({ hasFacts: false });
		assert.ok(!inSpace.includes("import-notes") && !inSpace.includes("Add files"));
		assert.ok(bar({ hasFacts: false, importNotes: { importing: false, onImportFiles: noop } }).includes('data-testid="import-notes"'));
	});

	it("search, then All facts and Graph costs as quiet words, once there are facts and a run", () => {
		const tokens = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
		const stage = { runs: 1, unpricedRuns: 0, tokens };
		const costs = { stages: { extraction: stage, audit: stage }, runs: [{ startedAt: 1, title: "Lecture 1", tokens }] };
		const html = bar({ costs });
		assert.match(html, /data-testid="graph-search"[^>]*placeholder="Search topics and facts"/);
		assert.match(html, /data-testid="open-chain-table"[^>]*class="lh-btn lh-btn-quiet[^"]*">All facts</);
		assert.match(html, /data-testid="graph-costs"[^>]*class="lh-btn lh-btn-quiet[^"]*">Graph costs</);
		assert.ok(html.indexOf("open-chain-table") < html.indexOf("graph-costs"), "All facts first");
		assert.ok(!bar({ costs: { ...costs, runs: [] } }).includes("graph-costs"), "no runs: no costs to show");
		assert.ok(!bar({ hasFacts: false }).includes("graph-search"));
	});

	it("a search that lights nothing says so once", () => {
		assert.ok(!bar({}).includes("Nothing matches"));
		assert.equal(count(bar({ query: "zzz", nothingMatches: true }), "Nothing matches"), 1);
	});
});

// ─── picking (createRoot over linkedom) ─────────────────────────────────────

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

async function mount(tree: React.ReactNode) {
	host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	await act(async () => root!.render(tree));
	const q = (id: string) => host!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
	const topic = (id: string) => host!.querySelector<HTMLButtonElement>(`[data-testid="graph-topic"][data-topic-id="${id}"]`)!;
	return { q, topic };
}

const escape = () => act(async () => fire(dom.window as unknown as Element, "keydown", { key: "Escape" }));

describe("picking in the page", () => {
	it("a topic opens its panel; a fact row opens the fact; Escape closes the fact, then the topic", async () => {
		const { q, topic } = await mount(body());
		assert.equal(topic("t-mini").tagName, "BUTTON", "each topic is a button");
		await act(async () => topic("t-mini").click());
		assert.ok(q("topic-pane"));
		await act(async () => q("fact-row")!.click());
		assert.ok(q("fact-pane") && !q("topic-pane"));
		await escape();
		assert.ok(q("topic-pane") && !q("fact-pane"), "back to the topic");
		await escape();
		assert.ok(!q("topic-pane") && !q("graph-panel"));
		assert.ok(q("graph-picture"));
	});

	it("a click on the picked topic, or its Close, closes it", async () => {
		const { q, topic } = await mount(body());
		await act(async () => topic("t-var").click());
		await act(async () => topic("t-var").click());
		assert.ok(!q("topic-pane"));
		await act(async () => topic("t-var").click());
		await act(async () => q("topic-pane-close")!.click());
		assert.ok(!q("topic-pane"));
	});

	it("a fact's Close closes the fact and its topic", async () => {
		const { q } = await mount(body({ initialSelected: "t-mini" }));
		await act(async () => q("fact-row")!.click());
		await act(async () => q("fact-pane-close")!.click());
		assert.ok(!q("fact-pane") && !q("topic-pane"));
	});

	it("a graph change keeps the pick; a topic that is gone closes its panel", async () => {
		const data = fixture();
		const { q } = await mount(body({ initialSelected: "t-mini" }));
		await act(async () => root!.render(body({ data: { ...data, facts: data.facts.slice(0, -1) } })));
		assert.ok(q("topic-pane"), "still picked after a change");
		await act(async () => root!.render(body({ data: { ...data, topics: data.topics.filter((t) => t.id !== "t-mini") } })));
		assert.ok(!q("topic-pane"));
	});

	it("with little room, the panel takes the picture's place", async () => {
		const box = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "clientWidth");
		Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
		try {
			const { q, topic } = await mount(body());
			assert.ok(q("graph-picture"), "nothing picked: the picture");
			await act(async () => topic("t-var").click());
			assert.ok(q("topic-pane") && !q("graph-picture"));
			await escape();
			assert.ok(q("graph-picture") && !q("topic-pane"));
		} finally {
			if (box) Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", box);
			else delete (dom.window.HTMLElement.prototype as { clientWidth?: number }).clientWidth;
		}
	});
});

describe("keyboard focus", () => {
	const active = () => document.activeElement;

	it("beside the picture: the picked topic keeps focus, and arrows still move", async () => {
		const { q, topic } = await mount(body());
		topic("t-mini").focus();
		await act(async () => topic("t-mini").click()); // Enter or Space on a button clicks it
		assert.ok(q("topic-pane"));
		assert.ok(active() === topic("t-mini"), "the same button, not a new one");
		await act(async () => fire(topic("t-mini"), "keydown", { key: "ArrowRight" }));
		assert.equal(active()?.getAttribute("data-testid"), "graph-topic");
		assert.ok(active() !== topic("t-mini"));
	});

	it("closing from inside the panel puts focus back on the topic; Escape on a fact lands on the topic's Close", async () => {
		const { q, topic } = await mount(body());
		await act(async () => topic("t-mini").click());
		q("fact-row")!.focus();
		await act(async () => q("fact-row")!.click());
		await escape();
		assert.ok(active() === q("topic-pane-close"));
		await act(async () => q("topic-pane-close")!.click());
		assert.ok(!q("topic-pane"));
		assert.ok(active() === topic("t-mini"));
	});

	it("with little room: the panel's Close takes focus, and closing gives it back to the topic", async () => {
		const box = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "clientWidth");
		Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 900 });
		try {
			const { q, topic } = await mount(body());
			topic("t-var").focus();
			await act(async () => topic("t-var").click());
			assert.ok(!q("graph-picture"));
			assert.ok(active() === q("topic-pane-close"));
			await escape();
			assert.ok(q("graph-picture"));
			assert.ok(active() === topic("t-var"));
		} finally {
			if (box) Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", box);
			else delete (dom.window.HTMLElement.prototype as { clientWidth?: number }).clientWidth;
		}
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
		const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
		try {
			host = document.createElement("div");
			document.body.append(host);
			root = createRoot(host);
			await act(async () =>
				root!.render(
					<MemoryRouter initialEntries={["/graph"]}>
						<ServerEventsProvider connect={quietEvents as never}>
							<GraphScreen />
						</ServerEventsProvider>
					</MemoryRouter>,
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
