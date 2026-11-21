/**
 * The Graph page: the picture with its topic and fact panels as a slip
 * under it over a fixture ProgressPayload, picking and closing by mouse and Escape, Find,
 * the empty space, the foot line (counts) and the top bar's words (Find,
 * Add files), the
 * opening reveal, and the screen's load failure.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { GraphBody } from "../../src/frontend/components/graph/graph-body.tsx";
import { findMatches } from "../../src/frontend/components/graph/derive.ts";
import { TopicPane } from "../../src/frontend/components/graph/topic-pane.tsx";
import { FactPane, type FactSources } from "../../src/frontend/components/graph/fact-pane.tsx";
import { GraphFoot } from "../../src/frontend/components/graph/graph-foot.tsx";
import { GraphBar } from "../../src/frontend/components/graph/graph-bar.tsx";
import { useBarFind } from "../../src/frontend/components/use-bar-find.ts";
import { BarHost } from "../bar-host.tsx";
import { kbdEventForAction } from "../../src/shared/core/index.ts";
import { GraphScreen } from "../../src/frontend/components/graph/graph-screen.tsx";
import { Constellation } from "../../src/frontend/components/graph/constellation.tsx";
import type { Aim, Flight } from "../../src/frontend/components/graph/constellation-camera.ts";
import type { InView } from "../../src/frontend/components/graph/use-in-view.ts";
import { FAINT } from "../../src/frontend/components/graph/styles.ts";
import { ServerEventsProvider } from "../../src/frontend/components/server-events.tsx";
import { SpaceProvider } from "../../src/frontend/components/space-context.tsx";
import { MemoryRouter } from "react-router";
import { answers, fixture, unsorted } from "../graph-fixture.ts";
import { DEFAULT_TEACHER_NAME } from "../../src/shared/core/index.ts";
import { REVEAL_MS } from "../../src/frontend/components/graph/constellation-reveal.ts";

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
// Find selects its field on opening; linkedom has no select().
(dom.window.HTMLElement.prototype as unknown as { select: () => void }).select = () => {};

const noop = () => {};
const NO_BLEED = { left: 0, right: 0, top: 0, bottom: 0 };
const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
const inRouter = (tree: React.ReactNode) => (
	<MemoryRouter initialEntries={["/graph"]}>
		<ServerEventsProvider connect={quietEvents as never}>{tree}</ServerEventsProvider>
	</MemoryRouter>
);
const count = (html: string, needle: string) => html.split(needle).length - 1;
const body = (over: Partial<React.ComponentProps<typeof GraphBody>> = {}) =>
	inRouter(<GraphBody data={fixture()} matches={null} sources={null} note={null} studying={false} studyError={null} onStudy={noop} onStudyFact={noop} onInView={noop} aim={null} onFly={noop} {...over} />);

describe("the picture", () => {
	const html = renderToStaticMarkup(body());

	it("one picture with a button per topic, and nothing else on the page", () => {
		assert.equal(count(html, 'data-testid="graph-picture"'), 1);
		assert.equal(count(html, 'data-testid="graph-topic"'), 5);
		assert.ok(!html.includes('data-testid="graph-panel"'), "no panel until a topic is picked");
		for (const gone of ["deadline-pane", "work-on-next", "study-these", "level-columns", "cell-key", "Midterm 1"]) assert.ok(!html.includes(gone), gone);
	});

	it("a picked topic opens its panel as a slip under the picture", () => {
		const picked = renderToStaticMarkup(body({ initialSelected: "t-var" }));
		assert.equal(count(picked, 'data-testid="graph-picture"'), 1);
		assert.match(picked, /data-testid="graph-picture"[\s\S]*data-testid="graph-panel"[^>]*>[\s\S]*data-testid="topic-pane"/);
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
		inRouter(<TopicPane topic={mini} topics={data.topics} links={data.topicLinks} facts={data.facts} stacked={false} onClose={noop} onSelectTopic={noop} onOpenFact={noop} onStudy={noop} studying={false} studyError={null} />),
	);

	it("names the topic, with Close, its fact count and score, and the sure-miss note", () => {
		assert.match(html, /<h2[^>]*>Minibatch noise</);
		assert.match(html, /data-testid="topic-pane-close"[^>]*aria-label="Close"/);
		assert.match(html, /data-testid="topic-score"[^>]*>6 facts, 3 of 7 right</);
		assert.match(html, /data-testid="topic-note"[^>]*>On 4 of the misses you picked 4 or 5, so you felt sure\.</);
	});

	it("needs first and leads to as chips, not keys", () => {
		const needs = html.slice(html.indexOf('data-testid="needs-first"'), html.indexOf('data-testid="leads-to"'));
		assert.ok(needs.includes(">Needs first<"));
		assert.ok(needs.includes("Variance") && needs.includes("Derivatives"));
		assert.match(needs, /data-testid="topic-link"[^>]*class="lh-link-chip /);
		assert.ok(!needs.includes("lh-btn"));
		assert.ok(html.slice(html.indexOf('data-testid="leads-to"')).includes("Momentum"));
	});

	it("a topic with no links leaves both groups out", () => {
		const alone = renderToStaticMarkup(
			inRouter(<TopicPane topic={mini} topics={data.topics} links={[]} facts={data.facts} stacked={false} onClose={noop} onSelectTopic={noop} onOpenFact={noop} onStudy={noop} studying={false} studyError={null} />),
		);
		assert.ok(!alone.includes("needs-first") && !alone.includes("leads-to"));
	});

	it("every fact is its moon, weakest first, named for a screen reader", () => {
		assert.equal(count(html, 'data-testid="fact-moon"'), 6);
		const labels = [...html.matchAll(/data-testid="fact-moon" aria-label="([^"]*)"/g)].map((m) => m[1]);
		assert.equal(labels[0], "Minibatch gradient is unbiased, 0 of 1 right");
		assert.ok(labels.includes("Noise can help escape flat regions, In a lesson, not answered"));
	});

	it("Study is the one main key, outside the part that scrolls", () => {
		const scroller = html.slice(html.indexOf("overflow-y-auto"), html.indexOf('data-testid="study-topic"'));
		assert.ok(scroller.includes('data-testid="fact-moon"'), "the moons scroll");
		assert.match(html, /data-testid="study-topic"[^>]*class="lh-btn lh-btn-main"[^>]*>Study</);
		assert.equal(count(html, "lh-btn-main"), 1);
	});
});

describe("the picked fact", () => {
	const data = fixture();
	const f6 = data.facts.find((f) => f.id === "f6")!;
	const mini = data.topics.find((t) => t.id === "t-mini")!;
	const sources: FactSources = {
		chains: [
			{ premises: ["f3", "f4"], conclusion: "f6" },
			{ premises: ["f6"], conclusion: "f9" },
		],
		fileSources: { src_a: "lecture 5.pdf", src_b: "notes/week 2.md" },
		sessions: { "chat-1": "Study: Minibatch noise" },
	};
	const props = (over: Partial<React.ComponentProps<typeof FactPane>> = {}): React.ComponentProps<typeof FactPane> => ({
		fact: f6,
		topic: mini,
		facts: data.facts,
		sources,
		stacked: false,
		onBack: noop,
		onClose: noop,
		onOpenFact: noop,
		onStudy: noop,
		studying: false,
		studyError: null,
		...over,
	});
	const pane = (over: Partial<React.ComponentProps<typeof FactPane>> = {}) => renderToStaticMarkup(inRouter(<FactPane {...props(over)} />));

	it("the topic's tab and Close, its moon and answers, its name and what it says, its lesson, what it builds on and leads to, and Study", () => {
		const html = pane();
		assert.match(html, /data-testid="fact-pane-back"[\s\S]*?Minibatch noise/);
		assert.match(html, /data-testid="fact-pane-close"[^>]*aria-label="Close"/);
		assert.match(html, /<h2[^>]*>[\s\S]*?class="katex"/, "the name's math renders through KaTeX");
		assert.ok(html.includes('data-testid="fact-statement"'));
		assert.match(html, /data-testid="fact-answers"[^>]*>1 of 2 right, last /);
		assert.match(html, /data-testid="fact-source-open"[^>]*href="\/chat\/chat-1"[\s\S]*?>Study: Minibatch noise</);
		assert.ok(!html.includes("From "), "no line saying where it came from: the key names it");
		const builds = html.slice(html.indexOf('data-testid="builds-on"'), html.indexOf('data-testid="fact-leads-to"'));
		assert.ok(builds.includes("Variance adds") && builds.includes("Variance scales"));
		assert.ok(html.slice(html.indexOf('data-testid="fact-leads-to"')).includes("Batch size and learning rate"));
		assert.match(html, /data-testid="study-fact"[^>]*class="lh-btn lh-btn-main"[^>]*>Study</);
	});

	it("a statement that only says the name again shows once", () => {
		const html = pane({ fact: { ...f6, statement: `${f6.name}.` } });
		assert.ok(!html.includes('data-testid="fact-statement"'));
	});

	it("a fact never asked says so", () => {
		assert.match(pane({ fact: { ...f6, answers: [] } }), /data-testid="fact-answers"[^>]*>Not asked yet</);
	});

	it("the topic's tab goes back to the topic; a fact opened with no topic has none", async () => {
		let back = 0;
		const { q } = await mount(inRouter(<FactPane {...props({ onBack: () => back++ })} />));
		await act(async () => q("fact-pane-back")!.click());
		assert.equal(back, 1);
		assert.ok(!pane({ topic: null }).includes("fact-pane-back"));
	});

	it("a long list of links folds behind one chip that opens the rest", async () => {
		const many: FactSources = { ...sources, chains: ["f1", "f2", "f3", "f4", "f5", "f7", "f8"].map((id) => ({ premises: ["f6"], conclusion: id })) };
		const { q } = await mount(inRouter(<FactPane {...props({ sources: many })} />));
		const leads = () => q("fact-leads-to")!.querySelectorAll("[data-testid=fact-link]").length;
		assert.equal(leads(), 4);
		assert.equal(q("links-more")!.textContent, "3 more");
		await act(async () => q("links-more")!.click());
		assert.equal(leads(), 7);
		assert.equal(q("links-more"), null);
	});

	it("one link more than fit is shown, not folded", () => {
		const five: FactSources = { ...sources, chains: ["f1", "f2", "f3", "f4", "f5"].map((id) => ({ premises: ["f6"], conclusion: id })) };
		const html = pane({ sources: five });
		assert.equal(count(html, 'data-testid="fact-link"'), 5);
		assert.ok(!html.includes("links-more"));
	});

	// A source only names its file: the space's record finds the file, the server its full path.
	async function fromSpaceFile(born: "src_a" | "src_b", path: string | null) {
		const shown: string[] = [];
		const opened: string[] = [];
		Object.assign(dom.window, { lh: { platform: "darwin", showInFolder: async (p: string) => void shown.push(p), openPath: async (p: string) => void opened.push(p) } });
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: string) => {
			if (url === "/api/spaces/sp1")
				return Response.json({ space: { id: "sp1", files: [{ id: "f1", name: "lecture 5.pdf", sourceId: "src_a" }, { id: "f2", name: "week 2.md", sourceId: "src_b" }] }, folder: null });
			if (url === "/api/spaces/sp1/files/f1" || url === "/api/spaces/sp1/files/f2") return path ? Response.json({ path }) : Response.json({ error: "gone" }, { status: 404 });
			return Response.json({ error: "none" }, { status: 404 });
		}) as typeof fetch;
		const { q } = await mount(
			inRouter(
				<SpaceProvider initialActive="sp1" initialSpaces={[]}>
					<FactPane {...props({ fact: { ...f6, born }, topic: null })} />
				</SpaceProvider>,
			),
		);
		await until(() => q("fact-source-open"), "the file's key");
		return {
			q,
			shown,
			opened,
			click: () => act(async () => q("fact-source-open")!.click()),
			done: () => {
				globalThis.fetch = original;
				delete (dom.window as { lh?: unknown }).lh;
			},
		};
	}

	it("a PDF's key is named after it and opens it at its full path", async () => {
		const page = await fromSpaceFile("src_a", "/Users/me/cse/lecture 5.pdf");
		try {
			assert.equal(page.q("fact-source-open")!.textContent, "lecture 5.pdf");
			await page.click();
			await until(() => page.opened.length, "the file opened");
			assert.deepEqual(page.opened, ["/Users/me/cse/lecture 5.pdf"]);
			assert.deepEqual(page.shown, []);
			assert.equal(page.q("fact-source-error"), null);
		} finally {
			page.done();
		}
	});

	it("any other file's key shows it in the file browser at its full path", async () => {
		const page = await fromSpaceFile("src_b", "/Users/me/cse/notes/week 2.md");
		try {
			assert.equal(page.q("fact-source-open")!.textContent, "week 2.md");
			assert.equal(page.q("fact-source-open")!.getAttribute("title"), "Show week 2.md in Finder");
			await page.click();
			await until(() => page.shown.length, "the file shown");
			assert.deepEqual(page.shown, ["/Users/me/cse/notes/week 2.md"]);
			assert.deepEqual(page.opened, []);
		} finally {
			page.done();
		}
	});

	it("a file that is not on this computer says so", async () => {
		const page = await fromSpaceFile("src_b", null);
		try {
			await page.click();
			await until(() => page.q("fact-source-error"), "the error line");
			assert.equal(page.q("fact-source-error")!.textContent, "Can't find this file on your computer.");
			assert.deepEqual(page.shown, []);
		} finally {
			page.done();
		}
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

	it("stacked for a narrow room: one column, the moon beside the name", () => {
		const html = pane({ stacked: true });
		assert.match(html, /data-testid="fact-pane"[^>]*class="[^"]*flex-col/);
		assert.ok(html.indexOf("<svg") < html.indexOf("<h2"), "the moon comes before the name");
	});
});

describe("the foot line", () => {
	const foot = (over: Partial<React.ComponentProps<typeof GraphFoot>> = {}) =>
		renderToStaticMarkup(inRouter(<GraphFoot hasFacts topicCount={16} factCount={248} matches={null} onOpenChains={noop} inView={null} onWholeSpace={noop} {...over} />));
	const text = (html: string) => html.replace(/<[^>]*>/g, "");

	it("the counts, with the fact count a button; a count of one is singular; no words of the page in it", () => {
		const html = foot();
		assert.match(text(html), /16topics/);
		assert.match(html, /data-testid="open-chain-table"[^>]*>[\s\S]*?248[\s\S]*?facts</);
		assert.match(text(foot({ topicCount: 1, factCount: 1 })), /1topic1fact/);
		for (const gone of ["graph-find", "graph-costs", "import-notes", "Add files", "Costs"]) assert.ok(!html.includes(gone), gone);
	});

	it("before any topic it counts only facts, and zoomed in keeps them beside Whole space", () => {
		assert.equal(text(foot({ topicCount: 0, factCount: 12 })), "12facts");
		assert.equal(text(foot({ topicCount: 0, factCount: 12, inView: { topics: 0, facts: 0, lit: 0, name: null } })), "12factsWhole space");
	});

	it("with no facts there are no counts", () => {
		const bare = foot({ hasFacts: false });
		assert.ok(!bare.includes("open-chain-table") && text(bare) === "");
	});

	it("while something is typed it says what matches, in one status", () => {
		const html = foot({ matches: { topics: new Set(["a"]), facts: new Set(["x", "y"]) } });
		assert.match(html, /role="status" data-testid="graph-find-status"/);
		assert.match(text(html), /1topic2facts/);
		assert.ok(!html.includes("open-chain-table"), "the counts of the whole space wait");
		assert.match(foot({ matches: { topics: new Set(), facts: new Set() } }), /data-testid="graph-no-match"[^>]*>Nothing matches</);
	});
});

describe("the graph's words in the top bar", () => {
	const bar = (over: Partial<React.ComponentProps<typeof GraphBar>> = {}) => {
		function Words() {
			const find = useBarFind(true);
			return <GraphBar hasFacts find={find} importNotes={null} {...over} />;
		}
		return <BarHost><Words /></BarHost>;
	};
	const words = (q: (id: string) => HTMLElement | null) => [...q("bar-actions")!.children].map((el) => el.getAttribute("data-testid")).filter(Boolean);

	it("Find, then Add files in the graph with no space; neither in the foot", async () => {
		const { q } = await mount(bar({ importNotes: { importing: false, onImportFiles: noop } }));
		assert.deepEqual(words(q), ["graph-find", "import-notes"]);
		assert.equal(q("import-notes")!.textContent, "Add files");
	});

	it("a space has no Add files here (its Files tab has it)", async () => {
		const { q } = await mount(bar());
		assert.ok(q("import-notes") === null);
	});

	it("Add files says Adding… while it works and is off", async () => {
		const { q } = await mount(bar({ importNotes: { importing: true, onImportFiles: noop } }));
		assert.equal(q("import-notes")!.textContent, "Adding…");
		assert.equal(q("import-notes")!.hasAttribute("disabled"), true);
	});

	it("no facts: no magnifying glass", async () => {
		const { q } = await mount(bar({ hasFacts: false }));
		assert.deepEqual(words(q), []);
	});

	it("the magnifying glass is named Find a topic or fact and shows the find key", async () => {
		const { q } = await mount(bar());
		assert.equal(q("graph-find")!.getAttribute("aria-label"), "Find a topic or fact");
		assert.match(q("graph-find")!.textContent!, /F$/);
		assert.ok(q("graph-find")!.querySelector("kbd"));
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
	return event;
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

/** Lets the page run until `found` holds, for things that load or fly. */
async function until(found: () => unknown, what: string) {
	for (let tries = 0; tries < 200; tries++) {
		if (found()) return;
		await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
	}
	assert.fail(`never showed: ${what}`);
}

/** Two frames: the camera applies a wheel on one and renders on the next. */
const frames = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const escape = () => act(async () => fire(dom.window as unknown as Element, "keydown", { key: "Escape" }));

describe("picking in the page", () => {
	it("a topic opens its panel; a fact's moon opens the fact; Escape closes the fact, then the topic", async () => {
		const { q, topic } = await mount(body());
		assert.equal(topic("t-mini").tagName, "BUTTON", "each topic is a button");
		await act(async () => topic("t-mini").click());
		assert.ok(q("topic-pane"));
		await act(async () => q("fact-moon")!.click());
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
		await act(async () => q("fact-moon")!.click());
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

	it("in a room too low or too narrow for both, the panel takes the picture's place", async () => {
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

/** The page as the screen builds it: the picture and its panels over the foot line, sharing one Find, whose words are in the bar's places, and the camera's view. */
function Page({
	data: given,
	onChains = noop,
	sources = null,
	importNotes = null,
}: {
	data?: ReturnType<typeof fixture>;
	onChains?: () => void;
	sources?: FactSources | null;
	importNotes?: React.ComponentProps<typeof GraphBar>["importNotes"];
}) {
	// One payload for the page's life, as the screen holds one: a new one on every render would re-fit the picture and end a flight.
	const [own] = React.useState(fixture);
	const data = given ?? own;
	const hasFacts = data.facts.length > 0;
	const find = useBarFind(hasFacts);
	const [inView, setInView] = React.useState<InView | null>(null);
	const [aim, setAim] = React.useState<Aim | null>(null);
	const fly = React.useCallback((to: Flight) => setAim((a) => ({ ...to, seq: (a?.seq ?? 0) + 1 })), []);
	const matches = findMatches(find.query, data.topics, data.facts);
	const finding = matches !== null;
	React.useEffect(() => {
		if (finding) fly({ to: "whole" });
	}, [finding, fly]);
	return inRouter(
		<BarHost>
			<GraphBar hasFacts={hasFacts} find={find} importNotes={importNotes} />
			<GraphBody data={data} matches={matches} sources={sources} note={null} studying={false} studyError={null} onStudy={noop} onStudyFact={noop} onInView={setInView} aim={aim} onFly={fly} />
			<GraphFoot
				hasFacts={hasFacts}
				topicCount={data.topics.length}
				factCount={data.facts.length}
				matches={matches}
				onOpenChains={onChains}
				inView={inView}
				onWholeSpace={() => fly({ to: "whole" })}
			/>
		</BarHost>,
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

describe("finding from the top bar", () => {
	const footText = (q: (id: string) => HTMLElement | null) => q("graph-foot")!.textContent!;
	const box = (q: (id: string) => HTMLElement | null) => q("graph-find-field")!.querySelector("input")!;
	const sendFind = () => act(async () => window.dispatchEvent(new dom.window.CustomEvent(kbdEventForAction("find"))));

	it("the magnifying glass opens a field in the bar; typing dims what doesn't match and the foot counts what does", async () => {
		const { q } = await mount(<Page />);
		assert.ok(!q("graph-find-field"));
		assert.match(footText(q), /5topics12facts/);
		await act(async () => q("graph-find")!.click());
		assert.ok(q("graph-find-field")!.closest("[data-testid='bar-actions']"), "the field is in the bar");
		assert.ok(!q("graph-find") && !q("graph-foot")!.querySelector("input"), "no typing line in the foot");
		assert.equal(box(q).getAttribute("aria-label"), "Find a topic or fact");
		await typeInto(box(q), "momentum");
		assert.equal(count(host!.innerHTML, 'data-dim="true"'), 4);
		assert.match(footText(q), /1topic1fact/);
		assert.ok(!q("bar-actions")!.textContent!.includes("1 topic"), "the count is said once, in the foot");
	});

	it("a word nothing matches says so once, and Escape or Close clears it and closes", async () => {
		const { q } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		await typeInto(box(q), "zzz");
		assert.equal(q("graph-no-match")!.textContent, "Nothing matches");
		await act(async () => fire(box(q), "keydown", { key: "Escape" }));
		assert.ok(!q("graph-find-field") && !q("graph-no-match"));
		assert.ok(q("open-chain-table") && q("graph-find"));
		assert.equal(count(host!.innerHTML, 'data-dim="true"'), 0, "Find is cleared");
		await act(async () => q("graph-find")!.click());
		assert.equal(box(q).value, "", "reopened empty");
		await typeInto(box(q), "momentum");
		const close = host!.querySelector<HTMLElement>("[aria-label='Close Find']")!;
		await act(async () => close.click());
		assert.ok(!q("graph-find-field") && q("open-chain-table"));
		assert.equal(count(host!.innerHTML, 'data-dim="true"'), 0);
	});

	it("opening Find takes the place of Add files", async () => {
		const { q } = await mount(<Page importNotes={{ importing: false, onImportFiles: noop }} />);
		await act(async () => q("graph-find")!.click());
		assert.ok(!q("import-notes"));
		await act(async () => fire(box(q), "keydown", { key: "Escape" }));
		assert.ok(q("import-notes"));
	});

	it("the find shortcut opens the field and focuses it; with no facts it does nothing", async () => {
		const { q } = await mount(<Page />);
		await sendFind();
		assert.ok(q("graph-find-field"));
		assert.ok(document.activeElement === box(q));
		await act(async () => root!.unmount());
		host!.remove();
		const empty = await mount(<Page data={{ ...fixture(), facts: [] }} />);
		await sendFind();
		assert.ok(!empty.q("graph-find-field") && !empty.q("graph-find"));
	});

	it("the find shortcut does nothing while a menu or dialog is on top", async () => {
		const { q } = await mount(<Page />);
		const menu = document.createElement("div");
		menu.setAttribute("role", "dialog");
		document.body.append(menu);
		await sendFind();
		menu.remove();
		assert.ok(!q("graph-find-field"));
	});

	it("Escape in the field clears it first, then closes the fact, then the topic", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		await act(async () => q("fact-moon")!.click());
		await act(async () => q("graph-find")!.click());
		await typeInto(box(q), "momentum");
		await act(async () => fire(box(q), "keydown", { key: "Escape" }));
		assert.ok(!q("graph-find-field"));
		assert.ok(q("fact-pane"), "the field took the Escape, the fact stays");
		await escape();
		assert.ok(q("topic-pane") && !q("fact-pane"));
		await escape();
		assert.ok(!q("topic-pane") && !q("graph-panel"));
	});

	it("Escape and Close hand focus back to where it was", async () => {
		const { q } = await mount(<Page />);
		const before = q("open-chain-table")!;
		before.focus();
		await act(async () => q("graph-find")!.click());
		assert.ok(document.activeElement === box(q), "the field takes focus");
		await act(async () => fire(box(q), "keydown", { key: "Escape" }));
		assert.ok(document.activeElement === before, "after Escape");
	});

	it("the match counts and Nothing matches sit in one status that stays while finding", async () => {
		const { q } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		await typeInto(box(q), "momentum");
		const status = q("graph-find-status")!;
		assert.equal(status.getAttribute("role"), "status");
		await typeInto(box(q), "zzz");
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

});

describe("before any topic", () => {
	const NOTE = "Quigley sorts these 12 facts into topics next.";
	const waiting = (over: Partial<React.ComponentProps<typeof GraphBody>> = {}) => body({ data: unsorted(), note: NOTE, ...over });
	/** The loose squares' centres, read from their drawn paths. */
	const squares = () =>
		[...host!.querySelectorAll("[data-testid=graph-loose] path")].flatMap((p) => [...p.getAttribute("d")!.matchAll(/M([\d.-]+) ([\d.-]+)h([\d.]+)/g)].map((m) => ({ x: +m[1]! + +m[3]! / 2, y: +m[2]! + +m[3]! / 2 })));
	const picture = () => host!.querySelector<HTMLElement>("[data-testid=graph-picture]")!;

	it("the facts are loose squares with the line under them, and no topic or Ungrouped anywhere", () => {
		const html = renderToStaticMarkup(waiting());
		assert.ok(html.includes('data-testid="graph-loose"'));
		assert.equal(count(html, NOTE), 1);
		assert.ok(!html.includes('data-testid="graph-topic"') && !html.includes("Ungrouped"));
		assert.ok(!renderToStaticMarkup(waiting({ note: null })).includes("graph-sorts-next"), "no line, nothing said");
	});

	it("a square opens its fact alone: no back key, no topic panel, and Escape closes it", async () => {
		const { q } = await mount(waiting());
		const [at] = squares();
		assert.ok(at, "a square is drawn");
		await act(async () => void fire(picture(), "click", { clientX: at.x, clientY: at.y, detail: 1 }));
		assert.ok(q("fact-pane") && !q("topic-pane") && !q("fact-pane-back"));
		await escape();
		assert.ok(!q("fact-pane") && !q("graph-panel"));
	});

	it("when the topics arrive each fact travels from its square to its place while the names ink in; with reduced motion all is simply there", async () => {
		/** Each drawn fact's centre, from the picture's square paths, sorted. */
		const centres = (root: ParentNode | string) => {
			const ds = typeof root === "string" ? [...root.matchAll(/<path d="(M[^"]*)"/g)].map((m) => m[1]!) : [...root.querySelectorAll("[data-testid=graph-picture] svg g[fill]:not([fill=none]) > path")].map((p) => p.getAttribute("d")!);
			return ds
				.flatMap((d) => [...d.matchAll(/M([\d.-]+) ([\d.-]+)h([\d.]+)v/g)].map((m) => `${(+m[1]! + +m[3]! / 2).toFixed(0)},${(+m[2]! + +m[3]! / 2).toFixed(0)}`))
				.sort();
		};
		await mount(waiting());
		// The tab's own opening is over before the topics come.
		await act(async () => new Promise((resolve) => setTimeout(resolve, REVEAL_MS + 20)));
		const squaresWere = centres(host!);
		assert.equal(squaresWere.length, 12);
		await act(async () => root!.render(body({ data: fixture() })));
		assert.deepEqual(centres(host!), squaresWere, "each fact starts where its square was");
		assert.ok(host!.querySelector("[data-testid=graph-topic].lh-reveal"), "the names ink in");
		assert.ok(!host!.querySelector("[data-testid=graph-picture] svg .lh-reveal"), "the facts travel instead of inking in");
		assert.ok(!host!.querySelector("[data-testid=graph-sorts-next]"));
		await act(async () => new Promise((resolve) => setTimeout(resolve, 500)));
		reducedMotion.matches = true;
		try {
			const settled = centres(renderToStaticMarkup(body({ data: fixture() })));
			assert.deepEqual(centres(host!), settled, "each fact lands in its place");
			assert.notDeepEqual(settled, squaresWere);
			await act(async () => root!.unmount());
			host!.remove();
			await mount(waiting());
			await act(async () => root!.render(body({ data: fixture() })));
			assert.deepEqual(centres(host!), settled, "with reduced motion they are there at once");
			assert.ok(!host!.querySelector(".lh-reveal"));
		} finally {
			reducedMotion.matches = false;
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
		q("fact-moon")!.focus();
		await act(async () => q("fact-moon")!.click());
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

	it("Whole space, once it is gone, hands focus back to the picture's Tab stop", async () => {
		const original = globalThis.fetch;
		globalThis.fetch = (async (url: string) => (url.startsWith("/api/progress") ? Response.json(fixture()) : Response.json({ error: "none" }, { status: 404 }))) as typeof fetch;
		reducedMotion.matches = true;
		try {
			const { q, topic } = await mount(
				<MemoryRouter initialEntries={["/graph"]}>
					<ServerEventsProvider connect={quietEvents as never}>
						<GraphScreen />
					</ServerEventsProvider>
				</MemoryRouter>,
			);
			await until(() => topic("t-mini"), "the graph");
			await act(async () => topic("t-mini").click());
			await until(() => q("graph-whole-space"), "Whole space");
			q("graph-whole-space")!.focus();
			await act(async () => q("graph-whole-space")!.click());
			const stop = host!.querySelector('[data-testid="graph-topic"][tabindex="0"]');
			assert.ok(stop, "the picture has one Tab stop");
			assert.ok(document.activeElement === stop, "focus is on it");
		} finally {
			reducedMotion.matches = false;
			globalThis.fetch = original;
		}
	});
});

describe("the graph screen before any topic", () => {
	it("the line names the teacher and counts the facts; while a grouping run goes the work frame says it, so the line is gone", async () => {
		const original = globalThis.fetch;
		reducedMotion.matches = true;
		try {
			for (const grouping of [false, true]) {
				globalThis.fetch = (async (url: string) => (url.startsWith("/api/progress") ? Response.json({ ...unsorted(), grouping }) : Response.json({ error: "none" }, { status: 404 }))) as typeof fetch;
				const { q } = await mount(
					<MemoryRouter initialEntries={["/graph"]}>
						<ServerEventsProvider connect={quietEvents as never}>
							<GraphScreen />
						</ServerEventsProvider>
					</MemoryRouter>,
				);
				await until(() => q("graph-loose"), "the loose facts");
				assert.equal(q("graph-sorts-next")?.textContent ?? null, grouping ? null : `${DEFAULT_TEACHER_NAME} sorts these 12 facts into topics next.`);
				assert.equal(q("graph-foot")!.textContent, "12facts");
				await act(async () => root!.unmount());
				host!.remove();
			}
		} finally {
			reducedMotion.matches = false;
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
				note={null}
				links={data.topicLinks}
				facts={data.facts}
				chains={null}
				width={1192}
				height={60}
				bleed={NO_BLEED}
				reveal={null}
				pickedId={null}
				pickedFactId={null}
				focus={null}
				factMatches={null}
				onPick={noop}
				onPickFact={noop}
				onInView={noop}
				camera={{ current: { shot: null, back: null, done: 0 } }}
				aim={null}
			/>,
		);
		const names = html.match(/<button[^>]*data-testid="graph-topic"[^>]*>/g) ?? [];
		assert.ok(names.length > 0);
		for (const name of names) assert.match(name, /opacity:0;pointer-events:none/);
	});
});

describe("zooming the picture", () => {
	// A flight is a jump with reduced motion, so a pick or a close lands before the test looks.
	beforeEach(() => {
		reducedMotion.matches = true;
	});
	afterEach(() => {
		reducedMotion.matches = false;
	});

	const zoom = () => document.querySelector('[data-testid="graph-picture"]')?.getAttribute("data-zoom") ?? null;
	const isNear = () => document.querySelector('[data-testid="graph-picture"]')?.getAttribute("data-near") === "true";
	/** The topics drawn as figures. */
	const figures = () => [...document.querySelectorAll("[data-figure]")].map((n) => n.getAttribute("data-figure")!);
	/** One wheel event over the picture, then the frame its zoom waits for. The test DOM has no layout, so the pointer is measured from the picture's corner. */
	async function wheel(deltaY: number, at: { clientX: number; clientY: number } = { clientX: 600, clientY: 100 }, on: Element = document.querySelector('[data-testid="graph-picture"]')!) {
		let event!: Event;
		await act(async () => {
			event = fire(on, "wheel", { deltaY, deltaMode: 0, ctrlKey: false, ...at });
			await frames();
		});
		return event;
	}
	const footText = (q: (id: string) => HTMLElement | null) => q("graph-foot")!.textContent!;

	it("a click on a topic opens its panel and the picture is near on it, drawn as its figure", async () => {
		const { q, topic } = await mount(<Page />);
		assert.ok(zoom() === null && !isNear() && figures().length === 0, "at rest: whole picture, no figures");
		await act(async () => topic("t-mini").click());
		assert.ok(q("topic-pane"));
		assert.ok(zoom() !== null && isNear());
		assert.ok(figures().includes("t-mini"));
	});

	it("a topic named in the panel's Leads to is picked and drawn as its figure", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		const chip = [...q("leads-to")!.querySelectorAll<HTMLElement>('[data-testid="topic-link"]')].find((c) => c.textContent!.includes("Momentum"))!;
		await act(async () => chip.click());
		assert.match(q("topic-pane")!.querySelector("h2")!.textContent!, /Momentum/);
		assert.ok(isNear());
		assert.ok(figures().includes("t-mom"));
	});

	it("Close flies back to the whole picture, and the foot shows the space's counts again", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		await act(async () => q("topic-pane-close")!.click());
		assert.ok(!q("topic-pane"));
		assert.ok(zoom() === null && !isNear());
		assert.equal(figures().length, 0);
		assert.match(footText(q), /5topics12facts/);
		assert.ok(!q("graph-whole-space"));
	});

	it("zoomed in on one topic, the foot names it and counts its lit facts, with Whole space beside", async () => {
		const { q, topic } = await mount(<Page />);
		assert.ok(!q("graph-whole-space") && !q("graph-in-view"), "no Whole space at the whole picture");
		await act(async () => topic("t-mini").click());
		assert.equal(q("graph-in-view")!.textContent, "Minibatch noise1of6lit");
		assert.equal(q("graph-whole-space")!.textContent, "Whole space");
		assert.ok(!q("open-chain-table"), "the counts are what is in view, so the fact count is not a button");
	});

	it("zoomed out to several topics, the foot counts topics and facts in view", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		await wheel(400);
		assert.ok(zoom() !== null, "still zoomed in");
		const [, topics, facts] = q("graph-in-view")!.textContent!.match(/^(\d+)topics(\d+)facts$/) ?? [];
		assert.ok(topics !== undefined, `counts, not a topic's name: ${q("graph-in-view")!.textContent}`);
		assert.ok(Number(topics) > 1 && Number(facts) > 6, `${topics} topics, ${facts} facts`);
		assert.ok(q("graph-whole-space"));
	});

	it("Whole space flies out to the whole picture and leaves the panel open", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		await act(async () => q("graph-whole-space")!.click());
		assert.ok(zoom() === null && !isNear());
		assert.ok(q("topic-pane"), "the panel stays");
		assert.ok(!q("graph-whole-space"));
		assert.match(footText(q), /5topics12facts/);
	});

	it("Escape closes the fact, then the topic, then flies a hand-zoomed view out to the whole space", async () => {
		const { q, topic } = await mount(<Page />);
		await wheel(-150);
		assert.ok(zoom() !== null, "zoomed by hand");
		await act(async () => topic("t-mini").click());
		await act(async () => q("fact-moon")!.click());
		assert.ok(q("fact-pane"));
		await escape();
		assert.ok(q("topic-pane") && !q("fact-pane"), "the fact first");
		await escape();
		assert.ok(!q("graph-panel"), "then the topic");
		assert.ok(zoom() !== null && !isNear(), "closing flies back to the hand-zoomed view");
		await escape();
		assert.ok(zoom() === null, "then the whole space");
		assert.ok(q("graph-picture") && !q("graph-whole-space"));
	});

	it("typing in Find flies to the whole space and keeps the panel", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		assert.ok(zoom() !== null);
		await act(async () => q("graph-find")!.click());
		await typeInto(q("graph-find-field")!.querySelector("input")!, "momentum");
		assert.ok(zoom() === null && !isNear());
		assert.ok(q("topic-pane"));
		assert.equal(figures().length, 0);
	});

	it("a wheel over the picture zooms toward the pointer and does not scroll the page", async () => {
		const { q } = await mount(<Page />);
		const event = await wheel(-300);
		assert.ok(event.defaultPrevented, "the page is not scrolled");
		assert.ok(zoom() !== null);
		assert.ok(q("graph-whole-space"));
	});

	it("a wheel the other way zooms back out to the whole picture", async () => {
		await mount(<Page />);
		await wheel(-300);
		await wheel(1500);
		assert.ok(zoom() === null);
	});

	it("a wheel outside the picture is left to the page", async () => {
		const { q } = await mount(<Page />);
		const event = await wheel(-300, undefined, q("graph-foot")!);
		assert.ok(!event.defaultPrevented);
		assert.ok(zoom() === null);
	});

	it("a space of one topic flies to it and draws its figure", async () => {
		const data = fixture();
		const mini = data.topics.find((t) => t.id === "t-mini")!;
		const { q, topic } = await mount(<Page data={{ ...data, topics: [mini], topicLinks: [], facts: data.facts.filter((f) => f.topicId === "t-mini") }} />);
		await act(async () => topic("t-mini").click());
		assert.ok(q("topic-pane") && isNear());
		assert.deepEqual(figures(), ["t-mini"]);
		assert.equal(q("graph-in-view")!.textContent, "Minibatch noise1of6lit");
	});

	it("a space with no facts still draws, picks and zooms, with no figure", async () => {
		const { q, topic } = await mount(<Page data={{ ...fixture(), facts: [] }} />);
		await act(async () => topic("t-mini").click());
		assert.ok(q("topic-pane"));
		await wheel(-300);
		assert.equal(document.querySelectorAll("[data-figure] path").length, 0);
		await act(async () => q("topic-pane-close")!.click());
		assert.ok(q("graph-picture"));
	});
});

describe("the camera's small behaviours", () => {
	beforeEach(() => {
		reducedMotion.matches = true;
	});
	afterEach(() => {
		reducedMotion.matches = false;
	});

	const picture = () => document.querySelector<HTMLElement>('[data-testid="graph-picture"]')!;
	const wheelIn = () =>
		act(async () => {
			fire(picture(), "wheel", { deltaY: -400, deltaMode: 0, ctrlKey: false, clientX: 600, clientY: 100 });
			await frames();
		});
	const constellation = ({ onPick = noop, onPickFact = noop, bleed = NO_BLEED, onInView = noop, aim = null }: { onPick?: (id: string | null) => void; onPickFact?: (id: string) => void; bleed?: typeof NO_BLEED; onInView?: (v: InView | null) => void; aim?: Aim | null } = {}) => {
		const data = fixture();
		return (
			<Constellation
				topics={data.topics}
				note={null}
				links={data.topicLinks}
				facts={data.facts}
				chains={null}
				width={1192}
				height={600}
				bleed={bleed}
				reveal={null}
				pickedId={null}
				pickedFactId={null}
				focus={null}
				factMatches={null}
				onPick={onPick}
				onPickFact={onPickFact}
				onInView={onInView}
				camera={{ current: { shot: null, back: null, done: 0 } }}
				aim={aim}
			/>
		);
	};

	it("at the whole picture, a bottom-row topic's name still shows when pointed at on a small-scale picture", async () => {
		const data = fixture();
		const small = (
			<Constellation
				topics={data.topics}
				note={null}
				links={data.topicLinks}
				facts={data.facts}
				chains={null}
				width={1192}
				height={60}
				bleed={NO_BLEED}
				reveal={null}
				pickedId={null}
				pickedFactId={null}
				focus={null}
				factMatches={null}
				onPick={noop}
				onPickFact={noop}
				onInView={noop}
				camera={{ current: { shot: null, back: null, done: 0 } }}
				aim={null}
			/>
		);
		await mount(small);
		const buttons = [...host!.querySelectorAll<HTMLButtonElement>('[data-testid="graph-topic"]')];
		const top = (b: HTMLElement) => parseFloat(/top:\s*([\d.]+)/.exec(b.getAttribute("style") ?? "")?.[1] ?? "0");
		const bottom = buttons.reduce((a, b) => (top(b) > top(a) ? b : a));
		assert.match(bottom.getAttribute("style")!, /opacity:\s*0/, "too small to read at rest");
		await act(async () => fire(bottom, "focusin"));
		assert.doesNotMatch(bottom.getAttribute("style")!, /opacity:\s*0/, "shown when pointed at");
	});

	it("drawing past the box zoomed in leaves the foot line's counts as they were", async () => {
		const seen: string[] = [];
		for (const bleed of [NO_BLEED, { left: 300, right: 400, top: 12, bottom: 16 }]) {
			let last: InView | null = null;
			await mount(constellation({ bleed, onInView: (v) => (last = v) }));
			await wheelIn();
			seen.push(JSON.stringify(last));
			await act(async () => root!.unmount());
			host!.remove();
			root = undefined;
		}
		assert.notEqual(seen[0], "null", "zoomed in, something is in view");
		assert.equal(seen[1], seen[0]);
	});

	// Landed on Minibatch noise, wide bleed: Derivatives' moons are drawn left of the box, Attention's name right of it.
	const WIDE = { left: 300, right: 400, top: 12, bottom: 16 };
	const onMini: Aim = { to: "topic", id: "t-mini", fact: null, seq: 1 };

	it("zoomed in, a star drawn left of the box is pointed at and clicked", async () => {
		const opened: string[] = [];
		await mount(constellation({ bleed: WIDE, aim: onMini, onPickFact: (id) => opened.push(id) }));
		const [m] = moons("t-deriv");
		assert.ok(m && m.x < 0, "a moon left of the box");
		// The layer that reaches past the box takes the pointer there.
		const reach = host!.querySelector<HTMLElement>("[data-testid=graph-hit-area]")!;
		await act(async () => void fire(reach, "pointermove", { clientX: m.x, clientY: m.y, button: 0, pointerId: 1 }));
		const tag = picture().querySelector("[data-testid=graph-name-tag]")?.textContent;
		assert.ok(fixture().facts.some((f) => f.topicId === "t-deriv" && f.name === tag), "its name tag shows");
		await act(async () => void fire(reach, "click", { clientX: m.x, clientY: m.y, detail: 1 }));
		assert.equal(fixture().facts.find((f) => f.id === opened[0])?.topicId, "t-deriv", "its fact opens");
	});

	it("zoomed in, a topic name drawn right of the box shows", async () => {
		const pastBox = () =>
			[...host!.querySelectorAll<HTMLElement>("[data-testid=graph-topic]")].filter((b) => parseFloat(b.style.left) + parseFloat(b.style.width) > 1192).map((b) => b.style.opacity !== "0");
		await mount(constellation({ bleed: WIDE, aim: onMini }));
		assert.ok(pastBox().length > 0, "a name right of the box");
		assert.ok(pastBox().some(Boolean));
	});

	it("a click right after a drag that was cancelled still works", async () => {
		const picks: (string | null)[] = [];
		await mount(constellation({ onPick: (id) => picks.push(id) }));
		await wheelIn();
		await act(async () => void fire(picture(), "click", { clientX: 2, clientY: 2, detail: 1 }));
		assert.deepEqual(picks, [null], "a plain click on empty picture reaches it");
		const at = { button: 0, clientX: 300, clientY: 100, pointerId: 1 };
		await act(async () => {
			fire(picture(), "pointerdown", at);
			fire(picture(), "pointermove", { ...at, clientX: 340 });
			fire(picture(), "pointercancel", { ...at, clientX: 340 });
		});
		await act(async () => void fire(picture(), "click", { clientX: 2, clientY: 2, detail: 1 }));
		assert.deepEqual(picks, [null, null], "the click after the cancel reaches the picture too");
	});

	it("Find dims the facts that do not match inside a found topic", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => q("graph-find")!.click());
		await typeInto(q("graph-find-field")!.querySelector("input")!, "gradient");
		await act(async () => topic("t-mini").click());
		assert.ok(host!.querySelectorAll(`[data-figure="t-mini"] path[opacity="${FAINT}"]`).length > 0);
	});

	it("Escape with focus in an unrelated control does not fly the camera", async () => {
		const { q } = await mount(
			<>
				<input data-testid="elsewhere" />
				<Page />
			</>,
		);
		await wheelIn();
		assert.ok(q("graph-whole-space"));
		q("elsewhere")!.focus();
		await act(async () => void fire(q("elsewhere")!, "keydown", { key: "Escape" }));
		assert.ok(picture().getAttribute("data-zoom") !== null, "still zoomed");
	});
});

describe("a flight with motion", () => {
	// Frames and the clock are the test's own here, so a flight is part-way exactly when the test says so.
	const real = { frame: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, now: performance.now };
	let clock = 0;
	let waiting = new Map<number, FrameRequestCallback>();
	let ids = 0;
	const step = (ms: number) =>
		act(async () => {
			clock += ms;
			const due = [...waiting.values()];
			waiting.clear();
			for (const frame of due) frame(clock);
		});
	beforeEach(() => {
		clock = 0;
		waiting = new Map();
		Object.assign(globalThis, {
			requestAnimationFrame: (frame: FrameRequestCallback) => {
				waiting.set(++ids, frame);
				return ids;
			},
			cancelAnimationFrame: (id: number) => void waiting.delete(id),
		});
		performance.now = () => clock;
	});
	afterEach(() => {
		Object.assign(globalThis, { requestAnimationFrame: real.frame, cancelAnimationFrame: real.cancel });
		performance.now = real.now;
	});
	const zoom = () => Number(host!.querySelector('[data-testid="graph-picture"]')!.getAttribute("data-zoom"));
	const drawn = () => host!.querySelector('[data-figure="t-mini"]') !== null;

	it("takes its time: the picture is whole at the pick, part-way at half time and near once the flight has run", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		assert.ok(q("graph-picture")!.getAttribute("data-zoom") === null, "not yet moved at the click");
		await step(150);
		const partWay = zoom();
		assert.ok(partWay > 1, "zoomed in at half time");
		await step(150);
		assert.ok(zoom() > partWay, "further in at the end");
		assert.ok(q("graph-picture")!.getAttribute("data-near") === "true");
		assert.ok(drawn(), "the topic's figure");
		const landed = zoom();
		await step(150);
		assert.ok(zoom() === landed, "and it stays there");
	});

	it("lands on the picked topic when the graph changes and the picture is laid out again mid-flight", async () => {
		const { q, topic } = await mount(<Page />);
		await act(async () => topic("t-mini").click());
		await step(16);
		assert.ok(q("graph-picture")!.getAttribute("data-near") === null, "the flight has not landed");
		const data = fixture();
		const more = {
			...data,
			topics: data.topics.map((t) => (t.id === "t-deriv" ? { ...t, members: [...t.members, "f13"] } : t)),
			facts: [...data.facts, { ...data.facts[0]!, id: "f13", name: "Quotient rule" }],
		};
		await act(async () => root!.render(<Page data={more} />));
		await step(16);
		assert.ok(q("graph-picture")!.getAttribute("data-near") === "true");
		assert.ok(drawn(), "the topic's figure");
		assert.match(q("graph-foot")!.textContent!, /Minibatch noise1of6lit/);
	});
});

/**
 * Where each moon is, read from what is drawn, since this DOM has no layout: the figure's
 * 2-point cells, grouped into moons by how near they sit, each moon's middle.
 */
function moons(figure = "t-mini") {
	// A moon's path is `M x y`, then each 2-point cell as `m dx dy h2v2h-2z`, relative to the cell before it.
	const cells = [...host!.querySelectorAll(`[data-figure="${figure}"] [shape-rendering="crispEdges"] path`)].flatMap((p) => {
		let [x, y] = [0, 0];
		return [...(p.getAttribute("d") ?? "").matchAll(/([Mm])(-?\d+) (-?\d+)(h2v2h-2z)?/g)].flatMap((m) => {
			[x, y] = m[1] === "M" ? [+m[2]!, +m[3]!] : [x + +m[2]!, y + +m[3]!];
			return m[4] ? [{ x, y }] : [];
		});
	});
	const out: { x: number; y: number }[] = [];
	const left = new Set(cells);
	while (left.size) {
		const [first] = left;
		const group = [first!];
		left.delete(first!);
		for (let i = 0; i < group.length; i++)
			for (const c of left) if (Math.abs(c.x - group[i]!.x) <= 4 && Math.abs(c.y - group[i]!.y) <= 4) (group.push(c), left.delete(c));
		const [x0, x1] = [Math.min(...group.map((c) => c.x)), Math.max(...group.map((c) => c.x)) + 2];
		const [y0, y1] = [Math.min(...group.map((c) => c.y)), Math.max(...group.map((c) => c.y)) + 2];
		out.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
	}
	return out.sort((a, b) => a.y - b.y || a.x - b.x);
}
describe("the picture near", () => {
	// Chains inside Minibatch noise (f5 to f10), and one from Variance into it, which is never drawn as a line of its figure.
	const sources: FactSources = {
		chains: [
			{ premises: ["f5"], conclusion: "f6" },
			{ premises: ["f6"], conclusion: "f7" },
			{ premises: ["f5"], conclusion: "f8" },
			{ premises: ["f7"], conclusion: "f9" },
			{ premises: ["f3"], conclusion: "f6" },
		],
		fileSources: {},
		sessions: {},
	};
	const factNames = fixture().facts.filter((f) => f.topicId === "t-mini").map((f) => f.name);
	const picture = () => document.querySelector<HTMLElement>('[data-testid="graph-picture"]')!;
	/** The name tags: the picture's one-line boxes. Nothing else in the picture is a sheet. */
	const tags = () => [...picture().querySelectorAll("[data-testid=graph-name-tag]")].map((n) => n.textContent!);
	const point = (at: { x: number; y: number }) => act(async () => void fire(picture(), "pointermove", { clientX: at.x, clientY: at.y, button: 0, pointerId: 1 }));
	const open = async (data?: ReturnType<typeof fixture>) => {
		const page = await mount(<Page data={data} sources={sources} />);
		await act(async () => page.topic("t-mini").click());
		await until(() => picture().getAttribute("data-near") === "true", "the near picture");
		return page;
	};

	describe("with reduced motion", () => {
		beforeEach(() => {
			reducedMotion.matches = true;
		});
		afterEach(() => {
			reducedMotion.matches = false;
		});

		it("zoomed to a topic, every fact is a moon and the picture holds no fact name", async () => {
			const { q } = await open();
			assert.equal(moons().length, factNames.length);
			assert.equal(picture().querySelectorAll("text").length, 0);
			assert.equal(host!.querySelectorAll('[data-testid="fact-name"]').length, 0);
			const shown = picture().textContent!;
			for (const name of factNames) assert.ok(!shown.includes(name), `${name} is written on the picture`);
			assert.ok(q("graph-topic"), "the topic's own name stays");
		});

		it("only the links inside a topic are lines of its figure", async () => {
			await open();
			// One ghost path holds a figure's every line; four links inside the topic make four segments, the link from Variance none.
			const ghost = host!.querySelector('[data-figure="t-mini"] path[stroke-opacity="0.16"]')!.getAttribute("d")!;
			assert.equal(ghost.split("M").length - 1, 4);
		});

		it("pointing at a moon shows its name on one tag; each moon its own; moving off shows none", async () => {
			await open();
			assert.deepEqual(tags(), [], "no tag with no pointer");
			const seen: string[] = [];
			for (const m of moons()) {
				await point(m);
				assert.equal(tags().length, 1, "exactly one tag");
				seen.push(tags()[0]!);
			}
			assert.deepEqual([...seen].sort(), [...factNames].sort(), "each fact's own name");
			await point({ x: 2, y: 2 });
			assert.deepEqual(tags(), [], "moving off the moon takes its tag away");
		});

		it("a fact whose panel is open gets no tag, the others still do", async () => {
			const { q } = await open();
			const [first] = moons();
			await point(first!);
			const name = tags()[0]!;
			await act(async () => void fire(picture(), "click", { clientX: first!.x, clientY: first!.y, detail: 1 }));
			assert.ok(q("fact-pane"), "the fact opened");
			const shown = moons();
			assert.equal(shown.length, factNames.length);
			const named: (string | undefined)[] = [];
			for (const m of shown) {
				await point(m);
				assert.ok(tags().length <= 1);
				named.push(tags()[0]);
			}
			assert.equal(named.filter((t) => t === undefined).length, 1, "one moon has no tag");
			assert.ok(!named.includes(name), "and it is the open fact's");
			assert.equal(named.filter((t) => t !== undefined && factNames.includes(t)).length, factNames.length - 1);
		});

		it("the figure shows at once, with no line drawing in", async () => {
			const data = fixture();
			await open({ ...data, facts: data.facts.map((f) => (["f5", "f6", "f7"].includes(f.id) ? { ...f, answers: answers("r") } : f)) });
			assert.ok(host!.querySelectorAll('[data-figure="t-mini"] path[stroke-width="2"]').length > 0, "a lit line is drawn");
			assert.equal(host!.querySelectorAll(".lh-reveal-line").length, 0);
			assert.equal(host!.querySelectorAll('[data-figure] [style*="--lh-at"]').length, 0);
		});
	});

	describe("the foot's lit count", () => {
		beforeEach(() => {
			reducedMotion.matches = true;
		});
		afterEach(() => {
			reducedMotion.matches = false;
		});

		for (const [lit, ids] of [
			[0, []],
			[3, ["f5", "f6", "f8"]],
			[6, ["f5", "f6", "f7", "f8", "f9", "f10"]],
		] as const)
			it(`reads ${lit} of 6 lit when ${lit} of the topic's facts were last answered right`, async () => {
				const data = fixture();
				const { q } = await open({ ...data, facts: data.facts.map((f) => (f.topicId !== "t-mini" ? f : { ...f, answers: ids.includes(f.id as never) ? answers("wr") : answers("rw") })) });
				assert.equal(q("graph-in-view")!.textContent, `Minibatch noise${lit}of6lit`);
			});
	});
});

describe("the figure with motion", () => {
	const real = { frame: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, now: performance.now };
	let clock = 0;
	let waiting = new Map<number, FrameRequestCallback>();
	let ids = 0;
	const step = (ms: number) =>
		act(async () => {
			clock += ms;
			const due = [...waiting.values()];
			waiting.clear();
			for (const frame of due) frame(clock);
		});
	beforeEach(() => {
		clock = 0;
		waiting = new Map();
		Object.assign(globalThis, {
			requestAnimationFrame: (frame: FrameRequestCallback) => {
				waiting.set(++ids, frame);
				return ids;
			},
			cancelAnimationFrame: (id: number) => void waiting.delete(id),
		});
		performance.now = () => clock;
	});
	afterEach(() => {
		Object.assign(globalThis, { requestAnimationFrame: real.frame, cancelAnimationFrame: real.cancel });
		performance.now = real.now;
	});
	const lines = () => [...host!.querySelectorAll('[data-figure="t-mini"] .lh-reveal-line')];
	const delays = () => lines().map((n) => parseFloat(/--lh-at:\s*([\d.]+)ms/.exec(n.getAttribute("style") ?? "")![1]!));
	const cells = () => [...host!.querySelectorAll('[data-figure="t-mini"] [shape-rendering="crispEdges"] path')].map((p) => p.getAttribute("d")).join("|");

	async function fly() {
		const data = fixture();
		const lit = { ...data, facts: data.facts.map((f) => (["f5", "f6", "f7", "f9"].includes(f.id) ? { ...f, answers: answers("r") } : f)) };
		const { q, topic } = await mount(<Page data={lit} sources={{ chains: [{ premises: ["f5"], conclusion: "f6" }, { premises: ["f6"], conclusion: "f7" }, { premises: ["f7"], conclusion: "f9" }], fileSources: {}, sessions: {} }} />);
		await act(async () => topic("t-mini").click());
		for (let i = 0; i < 30 && q("graph-picture")!.getAttribute("data-near") !== "true"; i++) await step(16);
		return q;
	}

	it("lit lines draw in from the basics up: a line that rests on another waits for it", async () => {
		await fly();
		const wait = delays();
		assert.equal(wait.length, 3, "the three lit lines");
		assert.ok(wait.every((ms) => ms >= 300 && ms <= 600), "after the flight, inside the drawing time");
		assert.equal(new Set(wait).size, 3, "each its own turn");
		// Lines are drawn in the order their start points rise up the picture.
		const startY = lines().map((n) => +/^M[\d.]+ ([\d.]+)/.exec(n.getAttribute("d")!)![1]!);
		const byWait = startY.map((y, i) => ({ y, ms: wait[i]! })).sort((a, b) => a.ms - b.ms);
		for (let i = 1; i < byWait.length; i++) assert.ok(byWait[i]!.y < byWait[i - 1]!.y, "a later line starts higher up");
	});

	it("facts glide into their places over a third of a second, and land where a jump would put them", async () => {
		await fly();
		const gliding = cells();
		await step(90);
		assert.notEqual(cells(), gliding, "still moving part-way");
		await step(400);
		const landed = cells();
		await step(100);
		assert.ok(cells() === landed, "at rest once it has run");
		await act(async () => root!.unmount());
		host!.remove();
		reducedMotion.matches = true;
		try {
			await fly();
			assert.ok(cells() === landed, "with reduced motion they are there at once");
		} finally {
			reducedMotion.matches = false;
		}
	});
});

describe("when the lines draw in", () => {
	const real = { frame: globalThis.requestAnimationFrame, cancel: globalThis.cancelAnimationFrame, now: performance.now };
	let clock = 0;
	let waiting = new Map<number, FrameRequestCallback>();
	let ids = 0;
	const step = (ms: number) =>
		act(async () => {
			clock += ms;
			const due = [...waiting.values()];
			waiting.clear();
			for (const frame of due) frame(clock);
		});
	beforeEach(() => {
		clock = 0;
		waiting = new Map();
		Object.assign(globalThis, {
			requestAnimationFrame: (frame: FrameRequestCallback) => {
				waiting.set(++ids, frame);
				return ids;
			},
			cancelAnimationFrame: (id: number) => void waiting.delete(id),
		});
		performance.now = () => clock;
	});
	afterEach(() => {
		Object.assign(globalThis, { requestAnimationFrame: real.frame, cancelAnimationFrame: real.cancel });
		performance.now = real.now;
		reducedMotion.matches = false;
	});

	// Lit lines in Minibatch noise (f5 to f6 to f7) and in Derivatives (f1 to f2).
	const sources: FactSources = { chains: [{ premises: ["f5"], conclusion: "f6" }, { premises: ["f6"], conclusion: "f7" }, { premises: ["f1"], conclusion: "f2" }], fileSources: {}, sessions: {} };
	const data = () => {
		const d = fixture();
		return { ...d, facts: d.facts.map((f) => (["f1", "f2", "f5", "f6", "f7"].includes(f.id) ? { ...f, answers: answers("r") } : f)) };
	};
	const picture = () => host!.querySelector<HTMLElement>('[data-testid="graph-picture"]')!;
	const isNear = () => picture().getAttribute("data-near") === "true";
	const drawing = () => [...host!.querySelectorAll("[data-figure] .lh-reveal-line")];
	/** The topics whose figure has a line drawing in. */
	const drawingIn = () => [...new Set(drawing().map((n) => n.closest("[data-figure]")!.getAttribute("data-figure")))].sort();
	const landOn = async (topic: (id: string) => HTMLButtonElement, id: string) => {
		await act(async () => topic(id).click());
		// Longer than a flight takes, so it has landed.
		for (let i = 0; i < 30; i++) await step(16);
		assert.ok(isNear() && host!.querySelector(`[data-figure="${id}"]`), `${id} drawn near`);
	};
	/** The drawing window runs on the page's real timer: let it end. */
	const windowEnds = () => until(() => drawing().length === 0, "the draw-in to end");
	const noLines = (why: string) => assert.equal(drawing().length, 0, why);
	const key = (el: Element, init: Record<string, unknown>) => act(async () => void fire(el, "keydown", init));

	it("a flight that lands on a topic draws its lit lines in, and only that topic's", async () => {
		const { topic } = await mount(<Page data={data()} sources={sources} />);
		await landOn(topic, "t-mini");
		assert.equal(drawing().length, 2, "its two lit lines");
		assert.deepEqual(drawingIn(), ["t-mini"]);
	});

	it("a later flight to another topic draws that topic's lines, and the first topic's stay still", async () => {
		const { topic } = await mount(<Page data={data()} sources={sources} />);
		await landOn(topic, "t-mini");
		await windowEnds();
		noLines("the first draw-in is over");
		await landOn(topic, "t-deriv");
		assert.deepEqual(drawingIn(), ["t-deriv"]);
	});

	it("pointing at a fact does not draw the lines in again", async () => {
		const { topic } = await mount(<Page data={data()} sources={sources} />);
		await landOn(topic, "t-mini");
		const before = drawing();
		await act(async () => void fire(picture(), "pointermove", { clientX: 2, clientY: 2, button: 0, pointerId: 1 }));
		assert.ok(drawing().length === before.length && drawing().every((n, i) => n === before[i]), "the same lines, not drawn afresh");
		await windowEnds();
		await act(async () => void fire(picture(), "pointermove", { clientX: 600, clientY: 300, button: 0, pointerId: 1 }));
		await act(async () => void fire(picture(), "pointermove", { clientX: 2, clientY: 2, button: 0, pointerId: 1 }));
		noLines("pointing after the draw-in");
	});

	it("opening a fact's panel and closing it does not draw them in again", async () => {
		const { q, topic } = await mount(<Page data={data()} sources={sources} />);
		await landOn(topic, "t-mini");
		await windowEnds();
		await act(async () => q("fact-moon")!.click());
		assert.ok(q("fact-pane"), "the fact opened");
		await step(400);
		noLines("a fact open");
		await key(document.body, { key: "Escape" });
		await step(400);
		noLines("the fact closed");
	});

	it("closing the topic's panel, and flying back out, does not draw anything", async () => {
		const { q, topic } = await mount(<Page data={data()} sources={sources} />);
		await landOn(topic, "t-mini");
		await windowEnds();
		await key(document.body, { key: "Escape" });
		for (let i = 0; i < 40; i++) await step(16);
		assert.equal(q("topic-pane"), null, "the panel is closed");
		noLines("the pick is cleared");
	});

	it("panning the picture does not draw them in again", async () => {
		const { topic } = await mount(<Page data={data()} sources={sources} />);
		await landOn(topic, "t-mini");
		await windowEnds();
		const at = { button: 0, clientX: 300, clientY: 100, pointerId: 1 };
		await act(async () => {
			fire(picture(), "pointerdown", at);
			fire(picture(), "pointermove", { ...at, clientX: 360, clientY: 130 });
		});
		await step(32);
		await act(async () => void fire(picture(), "pointerup", { ...at, clientX: 360, clientY: 130 }));
		await step(32);
		assert.ok(isNear(), "still near");
		noLines("after a pan");
	});

	it("a wheel zoom in across the near pitch does not draw them in", async () => {
		const { q } = await mount(<Page data={data()} sources={sources} />);
		for (let i = 0; i < 40 && !isNear(); i++) {
			await act(async () => void fire(picture(), "wheel", { deltaY: -400, deltaMode: 0, ctrlKey: false, clientX: 600, clientY: 100 }));
			await step(16);
			await step(16);
			noLines(`wheel ${i}`);
		}
		assert.ok(isNear(), "the wheel zoomed in to the near picture");
		assert.ok(host!.querySelector("[data-figure]"), "with figures");
		assert.ok(q("graph-whole-space"));
		noLines("near by the wheel");
	});

	it("with reduced motion nothing draws in and the facts do not glide", async () => {
		reducedMotion.matches = true;
		const { topic } = await mount(<Page data={data()} sources={sources} />);
		await act(async () => topic("t-mini").click());
		assert.ok(isNear(), "a flight is a jump");
		noLines("at the landing");
		const cells = () => [...host!.querySelectorAll('[data-figure="t-mini"] [shape-rendering="crispEdges"] path')].map((p) => p.getAttribute("d")).join("|");
		const at = cells();
		assert.ok(at.length > 0);
		for (let i = 0; i < 5; i++) await step(100);
		assert.ok(cells() === at, "the facts stay where they landed");
		noLines("after the time it would take");
	});
});
