/**
 * The Graph page: the picture with its docked topic and fact panels over a
 * fixture ProgressPayload, picking and closing by mouse and Escape, Find,
 * the empty space, the foot line (counts, Find, Costs, Add files), the
 * opening reveal, and the screen's load failure.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { GraphBody } from "../../src/frontend/components/graph/graph-body.tsx";
import { findMatches } from "../../src/frontend/components/graph/derive.ts";
import { TopicPane } from "../../src/frontend/components/graph/topic-pane.tsx";
import { FactPane, type FactSources } from "../../src/frontend/components/graph/fact-pane.tsx";
import { GraphFoot } from "../../src/frontend/components/graph/graph-foot.tsx";
import { GraphScreen } from "../../src/frontend/components/graph/graph-screen.tsx";
import { Constellation } from "../../src/frontend/components/graph/constellation.tsx";
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
// The reveal asks the media query once and reads its live value after.
const reducedMotion = { matches: false };
Object.assign(dom.window, { matchMedia: () => reducedMotion });
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

	it("Find dims the topics it doesn't light", () => {
		const data = fixture();
		const found = renderToStaticMarkup(body({ matches: findMatches("momentum", data.topics, data.facts) }));
		assert.equal(count(found, 'data-dim="true"'), 4);
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

const costsFixture = () => {
	const tokens = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
	const stage = { runs: 1, unpricedRuns: 0, tokens };
	return { stages: { extraction: stage, audit: stage }, runs: [{ startedAt: 1, title: "Lecture 1", tokens }] };
};

describe("the foot line", () => {
	const foot = (over: Partial<React.ComponentProps<typeof GraphFoot>> = {}) =>
		renderToStaticMarkup(
			inRouter(<GraphFoot hasFacts topicCount={16} factCount={248} query="" onQuery={noop} matches={null} onOpenChains={noop} costs={null} importNotes={null} {...over} />),
		);
	const text = (html: string) => html.replace(/<[^>]*>/g, "");

	it("the counts, with the fact count a button, then Find; a count of one is singular", () => {
		const html = foot();
		assert.match(text(html), /16topics/);
		assert.match(html, /data-testid="open-chain-table"[^>]*>[\s\S]*?248[\s\S]*?facts</);
		assert.ok(html.indexOf("open-chain-table") < html.indexOf("graph-find"), "counts first, Find after");
		assert.match(text(foot({ topicCount: 1, factCount: 1 })), /1topic1fact/);
	});

	it("a space has no Add files here (its Files tab has it); No space picks files right there, left of Find", () => {
		const inSpace = foot({ hasFacts: false });
		assert.ok(!inSpace.includes("import-notes") && !inSpace.includes("Add files"));
		const noSpace = foot({ importNotes: { importing: false, onImportFiles: noop } });
		assert.ok(noSpace.includes('data-testid="import-notes"') && noSpace.includes(">Add files<"));
		assert.ok(noSpace.indexOf("import-notes") < noSpace.indexOf("graph-find"), "Add files is left of Find");
		assert.ok(foot({ importNotes: { importing: true, onImportFiles: noop } }).includes("Adding…"));
	});

	it("Find and the counts need facts; Costs needs a run; the typing line is not there until Find is clicked", () => {
		const costs = costsFixture();
		const html = foot({ costs });
		assert.match(html, /data-testid="graph-costs"[^>]*class="lh-btn lh-btn-quiet[^"]*">Costs</);
		assert.ok(html.indexOf("graph-find") < html.indexOf("graph-costs"), "Find, then Costs");
		assert.ok(!foot({ costs: { ...costs, runs: [] } }).includes("graph-costs"), "no runs: no costs to show");
		const bare = foot({ hasFacts: false });
		assert.ok(!bare.includes("graph-find") && !bare.includes("open-chain-table"), "no facts: no Find, no counts");
		assert.ok(!html.includes("graph-find-box"));
	});
});

describe("the opening reveal", () => {
	it("the picture inks in when the tab opens; with reduced motion it is simply there", () => {
		try {
			assert.ok(renderToStaticMarkup(body()).includes("lh-reveal"));
			reducedMotion.matches = true;
			assert.ok(!renderToStaticMarkup(body()).includes("lh-reveal"));
		} finally {
			reducedMotion.matches = false;
		}
	});
});

// ─── picking (createRoot over linkedom) ─────────────────────────────────────

// React's old-browser path for text fields attaches a property watcher and reads the selection; linkedom has neither.
Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
Object.assign(dom.window, { getSelection: () => ({}) });

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
	// A field left watched would be read after it is gone.
	host?.querySelector("input")?.dispatchEvent(new dom.window.Event("focusout", { bubbles: true }));
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

/** The page as the screen builds it: the picture and its panels over the foot line, sharing one Find. */
function Page({ data = fixture(), costs = null, onChains = noop }: { data?: ReturnType<typeof fixture>; costs?: ReturnType<typeof costsFixture> | null; onChains?: () => void }) {
	const [query, setQuery] = React.useState("");
	const matches = findMatches(query, data.topics, data.facts);
	return inRouter(
		<>
			<GraphBody data={data} matches={matches} sources={null} studying={false} studyError={null} onStudy={noop} onStudyFact={noop} />
			<GraphFoot
				hasFacts={data.facts.length > 0}
				topicCount={data.topics.length}
				factCount={data.facts.length}
				query={query}
				onQuery={setQuery}
				matches={matches}
				onOpenChains={onChains}
				costs={costs}
				importNotes={null}
			/>
		</>,
	);
}

/** Type into the Find box the way a keyboard does. React loaded before this DOM existed, so it
 *  takes its old-browser path for text fields: it watches the focused field and reads it on a key-up. */
async function typeInto(input: HTMLElement, value: string) {
	input.setAttribute("type", "text"); // linkedom gives a field with no type attribute a null type
	await act(async () => {
		input.dispatchEvent(new dom.window.Event("focusin", { bubbles: true }));
		Object.defineProperty(input, "value", { configurable: true, writable: true, value });
		input.dispatchEvent(new dom.window.Event("keyup", { bubbles: true }));
	});
}

describe("finding in the foot line", () => {
	const footText = (q: (id: string) => HTMLElement | null) => q("graph-foot")!.textContent!;

	it("Find turns the counts into a typing line; typing dims what doesn't match and counts what does", async () => {
		const { q } = await mount(<Page />);
		assert.ok(!q("graph-find-box"));
		assert.match(footText(q), /5topics12facts/);
		await act(async () => q("graph-find")!.click());
		assert.ok(q("graph-find-box"), "the typing line");
		assert.ok(!q("graph-find") && !q("open-chain-table"), "the counts are gone while typing");
		assert.equal(q("graph-find-box")!.getAttribute("aria-label"), "Find a topic or fact");
		await typeInto(q("graph-find-box")!, "momentum");
		assert.equal(count(host!.innerHTML, 'data-dim="true"'), 4);
		assert.match(footText(q), /1topic1fact/);
	});

	it("a word nothing matches says so once, and Escape or the x brings the counts back", async () => {
		const { q } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		await typeInto(q("graph-find-box")!, "zzz");
		assert.equal(q("graph-no-match")!.textContent, "Nothing matches");
		await act(async () => fire(q("graph-find-box")!, "keydown", { key: "Escape" }));
		assert.ok(!q("graph-find-box") && !q("graph-no-match"));
		assert.ok(q("open-chain-table") && q("graph-find"));
		assert.equal(count(host!.innerHTML, 'data-dim="true"'), 0, "Find is cleared");
		await act(async () => q("graph-find")!.click());
		await typeInto(q("graph-find-box")!, "momentum");
		assert.equal(q("graph-find-close")!.getAttribute("aria-label"), "Stop finding");
		await act(async () => q("graph-find-close")!.click());
		assert.ok(!q("graph-find-box") && q("open-chain-table"));
		assert.equal(count(host!.innerHTML, 'data-dim="true"'), 0);
	});

	it("leaving the typing line empty brings the counts back; leaving it with a word keeps it", async () => {
		const { q } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		await act(async () => fire(q("graph-find-box")!, "focusout"));
		assert.ok(!q("graph-find-box") && q("graph-find"));
		await act(async () => q("graph-find")!.click());
		await typeInto(q("graph-find-box")!, "momentum");
		await act(async () => fire(q("graph-find-box")!, "focusout"));
		assert.ok(q("graph-find-box"), "the word stays");
	});

	it("the find shortcut opens the typing line and focuses it; with no facts it does nothing", async () => {
		const { q } = await mount(<Page />);
		await act(async () => window.dispatchEvent(new dom.window.CustomEvent("lh:kbd-find")));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 10))); // the focus waits one frame
		assert.ok(q("graph-find-box"));
		assert.ok(document.activeElement === q("graph-find-box"));
		await act(async () => root!.unmount());
		host!.remove();
		const empty = await mount(<Page data={{ ...fixture(), facts: [] }} />);
		await act(async () => window.dispatchEvent(new dom.window.CustomEvent("lh:kbd-find")));
		assert.ok(!empty.q("graph-find-box") && !empty.q("graph-find"));
	});

	it("Escape in the typing line clears it first, then closes the fact, then the topic", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		await act(async () => q("fact-row")!.click());
		await act(async () => q("graph-find")!.click());
		await typeInto(q("graph-find-box")!, "momentum");
		await act(async () => fire(q("graph-find-box")!, "keydown", { key: "Escape" }));
		assert.ok(!q("graph-find-box"));
		assert.ok(q("fact-pane"), "the typing line took the Escape, the fact stays");
		await escape();
		assert.ok(q("topic-pane") && !q("fact-pane"));
		await escape();
		assert.ok(!q("topic-pane") && !q("graph-panel"));
	});

	it("Escape and the x hand focus back to Find", async () => {
		const { q } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		assert.ok(document.activeElement === q("graph-find-box"), "the typing line takes focus");
		await act(async () => fire(q("graph-find-box")!, "keydown", { key: "Escape" }));
		assert.ok(document.activeElement === q("graph-find"), "after Escape");
		await act(async () => q("graph-find")!.click());
		await typeInto(q("graph-find-box")!, "momentum");
		await act(async () => q("graph-find-close")!.click());
		assert.ok(document.activeElement === q("graph-find"), "after the x");
	});

	it("Tab from an empty typing line to the x keeps the line open", async () => {
		const { q } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		await act(async () => fire(q("graph-find-box")!, "focusout", { relatedTarget: q("graph-find-close") }));
		assert.ok(q("graph-find-box") && q("graph-find-close"));
	});

	it("the match counts and Nothing matches sit in one status that stays while finding", async () => {
		const { q } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		const status = q("graph-find-status")!;
		assert.equal(status.getAttribute("role"), "status");
		await typeInto(q("graph-find-box")!, "momentum");
		assert.ok(q("graph-find-status") === status, "the same element after typing");
		await typeInto(q("graph-find-box")!, "zzz");
		assert.ok(q("graph-find-status") === status && status.contains(q("graph-no-match")));
	});

	it("the fact count's name says it opens all of them", async () => {
		const { q } = await mount(<Page />);
		assert.equal(q("open-chain-table")!.getAttribute("aria-label"), "All 12 facts");
		assert.match(q("open-chain-table")!.textContent!, /12facts/);
	});

	it("the fact count opens All facts", async () => {
		let opened = 0;
		const { q } = await mount(<Page onChains={() => opened++} />);
		await act(async () => q("open-chain-table")!.click());
		assert.equal(opened, 1);
	});

	it("Costs opens its pop-up, and a second click closes it", async () => {
		const { q } = await mount(<Page costs={costsFixture()} />);
		const panel = () => document.querySelector('[data-testid="graph-costs-panel"]');
		assert.ok(!panel());
		await act(async () => q("graph-costs")!.click());
		assert.ok(panel(), "the pop-up opens");
		assert.equal(q("graph-costs")!.getAttribute("aria-expanded"), "true");
		await act(async () => q("graph-costs")!.click());
		assert.equal(q("graph-costs")!.getAttribute("aria-expanded"), "false");
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

describe("a picture too tall for its box", () => {
	it("draws smaller, and its names, too small to read, let the pointer through to the stars", () => {
		const data = fixture();
		const html = renderToStaticMarkup(
			<Constellation
				topics={data.topics}
				links={data.topicLinks}
				facts={data.facts}
				chains={null}
				width={1192}
				height={60}
				reveal={null}
				pickedId={null}
				pickedFactId={null}
				focus={null}
				factMatches={null}
				onPick={noop}
				onPickFact={noop}
			/>,
		);
		const names = html.match(/<button[^>]*data-testid="graph-topic"[^>]*>/g) ?? [];
		assert.ok(names.length > 0);
		for (const name of names) assert.match(name, /opacity:0;pointer-events:none/);
	});
});
