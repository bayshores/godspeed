/**
 * The teacher's screens: the panel (head, the Activity list: Recent and
 * Background jobs; what it shows and how wide it is) and the teacher name
 * setting. The agent's screen in the panel has its own file
 * (terminal-panel.test.tsx).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { AgentAction } from "../../src/shared/core/events.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
	// The panel measures its content; linkedom has no layout.
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});
// The start pair asks for the agent folder; these tests never answer.
globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;

const { TeacherPanel, agentLine, teacherHead } = await import("../../src/frontend/components/teacher/teacher-panel.tsx");
const { PANEL_WIDTH, panelLayout, panelBody } = await import("../../src/frontend/components/teacher/dock-model.ts");
const { ActivityList, TeacherActivity } = await import("../../src/frontend/components/teacher/teacher-activity.tsx");
const { PanelHead } = await import("../../src/frontend/components/teacher/panel-head.tsx");
const { TeacherChats } = await import("../../src/frontend/components/teacher/teacher-chats.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";
import type { TerminalFacts } from "../../src/frontend/components/terminal/terminal-model.ts";
const { DEFAULT_TEACHER_NAME } = await import("../../src/shared/core/settings.ts");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { MemoryRouter } = await import("react-router");
const noEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
/** The panel listens for server events, as in the window. */
const inEvents = (node: React.ReactNode) => <ServerEventsProvider connect={noEvents as never}>{node}</ServerEventsProvider>;

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	host?.remove();
	host = root = null;
});
function mount(node: React.ReactNode): HTMLElement {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	act(() => root!.render(inEvents(node)));
	return host;
}

const ACTIONS: AgentAction[] = [
	{ id: "a2", at: "2026-10-28T23:11:00.000Z", agent: "Claude Code", label: "Adding Lab 4", spaceId: "cls_29", target: { kind: "deadline", id: "d4" }, page: "/" },
	{ id: "a1", at: "2026-10-28T22:52:00.000Z", agent: "Claude Code", label: "Reading notes", spaceId: null, target: null, page: "javascript:alert(1)" },
];
const names = (id: string | null) => (id === "cls_29" ? "CSE 29" : null);

const IDLE = { connected: false, turnsRunning: 0 };
const TEACHING = { ...IDLE, connected: true, name: "Claude Code" };

type PanelProps = React.ComponentProps<typeof TeacherPanel>;
/** The panel as a browser has it: Activity alone. */
const panel = (over: Partial<PanelProps> = {}) => (
	<TeacherPanel
		name="Ada"
		agent={TEACHING}
		view="activity"
		list={false}
		onList={() => {}}
		focus={false}
		state="open"
		onBeside={() => {}}
		{...over}
	/>
);

describe("the panel", () => {
	it("in a browser it is the Activity list alone, and its chip drops nothing", () => {
		const el = mount(panel());
		assert.ok(el.querySelector("[data-testid='activity-list'] [data-testid='activity-empty']"), "outside the app shell the list says what will show there");
		assert.ok(el.querySelector("[aria-expanded]") === null);
		assert.ok(el.querySelector("[data-testid='no-agent']") === null, "an agent is connected: no start pair");
		assert.ok(el.querySelector("[role='tablist'], [role='tab']") === null, "no tabs");
	});
	it("in a browser with no agent connected, the start pair sits above Activity", () => {
		const el = mount(panel({ agent: IDLE }));
		const start = el.querySelector("[data-testid='no-agent']");
		const list = el.querySelector("[data-testid='activity-list']");
		assert.ok(start !== null && list !== null);
		assert.ok(start.nextElementSibling === list, "the start pair, then the list");
		assert.equal(el.querySelector("[data-testid='open-agent']")?.textContent, "Start Claude Code");
	});
	it("head: the teacher's status alone, in the screen's font; the strip names the panel and closes it", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="teacher-panel-agent"[^>]*class="[^"]*font-mono[^"]*"[^>]*>(<[^>]*>)*Ada is on</);
		assert.doesNotMatch(html, /teacher-panel-name|teacher-panel-close|role="switch"/);
	});
	it("runs from the top bar to the window's bottom, sliding out of the strip, made of the bar's sheet, with no blur", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /^<div data-state="open" style="right:0;--lh-hang-r:0px" class="lh-hang fixed top-\(--lh-bar-h\) z-\[41\] lh-dock bottom-0"><section[^>]*data-testid="teacher-panel"/);
		const section = /<section[^>]*>/.exec(html)![0];
		assert.match(section, /class="lh-popup lh-hang-body /);
		assert.match(section, new RegExp(`width:${PANEL_WIDTH.initial}px;height:100%`));
		assert.doesNotMatch(section, /border-l|bg-panel|blur/);
	});
	it("the status line says what the teacher does, else that it is on while its terminal agent is connected, else ready; never off", () => {
		assert.equal(agentLine(null, "Ada"), null, "nothing until the first read");
		assert.equal(agentLine(IDLE, "Ada"), "Ready", "lessons and jobs need no terminal");
		assert.equal(agentLine({ ...IDLE, connected: true, name: "Codex" }, "Ada"), "Ada is on", "the teacher's name, never the program's");
		assert.equal(agentLine({ ...IDLE, connected: true }, "Ada", { text: "Reading a PDF", working: true }), "Reading a PDF");
	});
	it("is as wide as the learner left it, pushing the page while it keeps 480 px", () => {
		const docked = (w: number, wanted: number) => panelLayout(w, w, wanted);
		assert.deepEqual(docked(1440, 440), { width: 440, push: 440 });
		assert.deepEqual(docked(1440, 900), { width: 900, push: 900 });
		assert.deepEqual(docked(1100, 900), { width: 620, push: 620 }, "narrower than asked: the page keeps 480");
		assert.deepEqual(docked(840, 440), { width: 360, push: 360 }, "down to its narrowest");
		for (let w = 640; w <= 2000; w += 10) {
			for (const wanted of [PANEL_WIDTH.min, PANEL_WIDTH.initial, PANEL_WIDTH.max]) {
				const { width, push } = docked(w, wanted);
				assert.ok(push === 0 || (push === width && w - push >= 480 && width >= PANEL_WIDTH.min), `${w}, ${wanted}`);
			}
		}
	});
	it("covers a page with no room for its narrowest; a narrow window gets it across all its room", () => {
		const docked = (w: number, wanted: number) => panelLayout(w, w, wanted);
		assert.deepEqual(docked(800, 440), { width: 440, push: 0 });
		assert.deepEqual(docked(700, 900), { width: 700, push: 0 });
		assert.deepEqual(docked(600, 440), { width: 600, push: 0 });
	});
	it("takes the room left of the strip: the page's part of it can be narrower than the room", () => {
		assert.deepEqual(panelLayout(1400, 1400, 620), { width: 620, push: 620 });
		assert.deepEqual(panelLayout(1400, 900, 620), { width: 420, push: 420 }, "the page keeps 480");
		assert.deepEqual(panelLayout(1400, 700, 900), { width: 900, push: 0 }, "no room for even the narrowest: it covers the page");
	});
	it("the head says the terminal's line while it starts or needs the learner, else the status line", () => {
		const T0 = 1_000_000;
		const facts = (over: Partial<TerminalFacts> = {}, prompt: "menu" | null = null): TerminalFacts => ({
			term: { id: "t1", agent: "claude", startedAt: T0, ended: null, prompt, url: false },
			checkedIn: true,
			outsideHere: false,
			now: T0 + 1000,
			...over,
		});
		const doing = { text: "Reading notes", working: true };
		assert.deepEqual(teacherHead({ agent: IDLE, name: "Ada", doing: null, facts: null }), { status: "Ready", lit: false, working: false });
		assert.deepEqual(teacherHead({ agent: TEACHING, name: "Ada", doing, facts: null }), { status: "Reading notes", lit: false, working: true }, "the square breathes while the line is the work it does");
		assert.deepEqual(teacherHead({ agent: TEACHING, name: "Ada", doing, facts: facts({ checkedIn: false }) }), { status: "Ada is starting.", lit: false, working: false });
		assert.deepEqual(teacherHead({ agent: TEACHING, name: "Ada", doing, facts: facts({}, "menu") }), { status: "Ada is asking you something.", lit: true, working: false });
		assert.deepEqual(teacherHead({ agent: TEACHING, name: "Ada", doing: null, facts: null }), { status: "Ada is on", lit: false, working: false });
	});
	it("is the screen in the desktop app (Activity hangs from its key), Activity in a browser, lessons too", () => {
		assert.equal(panelBody(true, false), "terminal");
		assert.equal(panelBody(false, false), "activity");
		assert.equal(panelBody(true, true), "popped", "its screen in a window of its own: Activity stays");
		assert.equal(panelBody(false, true), "activity", "no screens in a browser, whatever is said of a window");
	});
	it("never dims the page, and has a left edge to drag and no other, unless it takes the whole window", () => {
		const wasWidth = window.innerWidth;
		try {
			Object.assign(window, { innerWidth: 800 });
			const over = mount(panel());
			assert.ok(over.querySelector("[data-testid='teacher-panel-scrim']") === null);
			assert.deepEqual([...over.querySelectorAll("[data-testid^='resize-teacher']")].map((grip) => grip.getAttribute("data-testid")), ["resize-teacher"]);
			assert.ok(over.querySelector("[data-whole]") === null);
			Object.assign(window, { innerWidth: 600 });
			const whole = mount(panel());
			assert.ok(whole.querySelector("[data-testid^='resize-teacher']") === null, "the whole window: nothing to drag");
			assert.ok(whole.querySelector("[data-teacher-panel][data-whole]") !== null);
		} finally {
			Object.assign(window, { innerWidth: wasWidth });
		}
	});
});

describe("the teacher's Activity", () => {
	const EMPTY = { jobs: [], extractions: [] };
	const list = (over: Partial<React.ComponentProps<typeof ActivityList>> = {}) => (
		<ActivityList
			name="Ada"
			recent={ACTIONS}
			spaceNameOf={names}
			feed={EMPTY}
			graph={null}
			{...over}
		/>
	);

	it("without the teacher's state (outside the app shell) it shows the empty line", () => {
		assert.match(renderToStaticMarkup(<TeacherActivity />), /data-testid="activity-empty"[^>]*>Nothing yet\. What Teacher reads and builds shows here\.</);
	});
	it("scrolls inside its parent, with no padding of its own", () => {
		assert.match(renderToStaticMarkup(list()), /data-testid="activity-list" class="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto"/);
	});
	it("holds no now box and no Follow: those sit beside the teacher's name", () => {
		const html = renderToStaticMarkup(list());
		assert.doesNotMatch(html, /activity-now|activity-follow|Follow/);
	});
	it("with nothing in it, says what will show there", () => {
		const el = mount(list({ recent: [] }));
		assert.equal(el.querySelector("[data-testid='activity-empty']")?.textContent, "Nothing yet. What Ada reads and builds shows here.");
		act(() => root?.unmount());
		assert.ok(mount(list()).querySelector("[data-testid='activity-empty']") === null);
	});
	it("the open space's graph costs come last: who paid, each stage's tokens, the latest runs; never a dollar figure", () => {
		const tokens = { inputTokens: 1500, outputTokens: 45, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 };
		const stage = { runs: 1, unpricedRuns: 0, subscriptionRuns: 1, subscriptionProviders: ["Your agent"], tokens };
		const costs = { stages: { extraction: stage, audit: { runs: 0, unpricedRuns: 1, tokens: { ...tokens, inputTokens: undefined, outputTokens: undefined } } }, runs: [{ startedAt: Date.now() - 12 * 60_000, title: "/notes/Graphing quiz prep.md", tokens, merged: { nodes: 1 } }] };
		const el = mount(list({ recent: [], graph: { costs: costs as never, space: "Lab Algebra" } }));
		assert.ok(el.querySelector("[data-testid='activity-empty']") === null, "costs are something");
		assert.equal(
			el.querySelector("[data-testid='graph-costs']")?.textContent,
			"Graph costs, Lab AlgebraOn your agent's plan. Nothing is billed per use. 1 run unpriced.Building facts1.5k in, 45 outChecking facts– in, – outGraphing quiz prep.md1 merged12 min",
		);
		assert.ok(!el.textContent?.includes("$"));
		act(() => root?.unmount());
		assert.ok(mount(list()).querySelector("[data-testid='graph-costs']") === null);
	});
	it("Recent hides when there is nothing yet", () => {
		assert.ok(mount(list({ recent: [] })).querySelector("[data-testid='activity-recent']") === null);
	});
	it("Recent is a log: label, space and how long ago, with nothing to click", () => {
		const el = mount(list());
		assert.match(el.textContent ?? "", /Recent/);
		const rows = [...el.querySelectorAll("[data-testid='activity-recent-row']")];
		assert.equal(rows.length, 2);
		assert.match(rows[0]!.textContent ?? "", /Added Lab 4CSE 29/);
		assert.match(rows[0]!.querySelector("[data-testid='activity-recent-time']")?.textContent ?? "", /^(Oct 2[89]|\d+ (min|hours?|days)|yesterday)$/);
		assert.ok(el.querySelector("[data-testid='activity-recent'] button, [data-testid='activity-recent'] svg") === null);
	});
	it("Recent lists every change the server sent, scrolling inside the list", () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ ...ACTIONS[0]!, id: `a${i}`, label: `Adding Lab ${i}` }));
		const el = mount(list({ recent: many }));
		assert.equal(el.querySelectorAll("[data-testid='activity-recent-row']").length, 12);
		assert.match(el.querySelector("[data-testid='activity-list']")?.className ?? "", /overflow-y-auto/);
	});
	it("changes that read the same, one after another, are one row with a count and the newest time; no line divides the rows", () => {
		const same = Array.from({ length: 4 }, (_, i) => ({ ...ACTIONS[0]!, id: `a${i}`, at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString() }));
		const el = mount(list({ recent: [...same, ACTIONS[1]!, same[0]!] }));
		const rows = [...el.querySelectorAll("[data-testid='activity-recent-row']")];
		assert.equal(rows.length, 3, "a run of four, another change, then the first again");
		assert.match(rows[0]!.textContent ?? "", /^Added Lab 44 timesCSE 291 hour$/);
		assert.doesNotMatch(rows[2]!.textContent ?? "", /times/);
		assert.doesNotMatch(el.innerHTML, /border-/);
	});
	it("Running in the background sits above Recent, with failed jobs", () => {
		const failed = [{ id: "j1", kind: "pdf" as const, chatId: "c1", title: "06_Counting.pdf", error: "The PDF could not be read", at: "2026-10-28T16:00:00Z" }];
		const html = renderToStaticMarkup(list({ feed: { ...EMPTY, failed } }));
		assert.match(html, /Running in the background/);
		assert.match(html, /data-testid="activity-failed"/);
		assert.match(html, /Failed: The PDF could not be read/);
		assert.ok(html.indexOf("Running in the background") < html.indexOf(">Recent<"));
	});
	it("clicking a job opens its detail: what it is doing, cost, context and its lesson", () => {
		const job = { id: "j1", kind: "demo" as const, chatId: "c1", toolCallId: "t1", status: "running" as const, activity: "building sandbox…", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), title: "Chain-rule demo", contextLimit: null };
		// The detail links to the lesson.
		const el = mount(<MemoryRouter>{list({ feed: { jobs: [job], extractions: [] } })}</MemoryRouter>);
		assert.ok(el.querySelector("[data-testid='activity-blob-detail']") === null);
		act(() => (el.querySelector("[data-testid='activity-blob-job'] button[aria-expanded]") as HTMLElement).click());
		const detail = el.querySelector("[data-testid='activity-blob-detail']")!;
		assert.match(detail.textContent ?? "", /building sandbox…/);
		assert.equal(detail.querySelector("[data-testid='activity-blob-cost']")?.textContent, "–");
		assert.equal(detail.querySelector("[data-testid='activity-blob-context']")?.textContent, "–");
		assert.equal(detail.querySelector("a")?.getAttribute("href"), "/chat/c1");
	});
});

describe("the teacher name setting", () => {
	it("defaults to Teacher", () => {
		assert.equal(DEFAULT_TEACHER_NAME, "Teacher");
	});
});

describe("Follow in the panel's head", () => {
	const api = (over: Partial<TeacherApi>): TeacherApi => ({
		name: "Ada",
		follow: true,
		setFollow: () => {},
		panelOpen: false,
		setPanelOpen: () => {},
		showTerminal: () => {},
		canAsk: false,
		ask: () => {},
		asking: null,
		recent: [],
		doing: { working: true, text: "Adding Lab 4" } as TeacherApi["doing"],
		setLesson: () => {},
		go: () => {},
		slip: null,
		offer: null,
		held: false,
		spaceNameOf: () => null,
		...over,
	});
	const html = (over: Partial<TeacherApi>) =>
		renderToStaticMarkup(
			<TeacherContext.Provider value={api(over)}>
				<PanelHead status="Idle" lit={false} working={false} list={{ open: false, onOpen: () => {} }} putBack={null} />
			</TeacherContext.Provider>,
		);
	it("says Following while it is on, and Follow once stopped, working or not", () => {
		assert.match(html({}), /data-testid="follow-stop"[^>]*aria-pressed="true"[^>]*>Following</);
		assert.match(html({ follow: false, doing: null }), /data-testid="follow-start"[^>]*aria-pressed="false"[^>]*>Follow</);
	});
});

describe("the teacher's earlier chats", () => {
	const now = Date.now();
	const chats = [
		{ id: "0f8fad5b-d9cb-469f-a165-70867728950e", agent: "claude" as const, name: "Limits proof", at: now - 2 * 3_600_000, open: true },
		{ id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", agent: "claude" as const, name: null, at: now - 5 * 60_000, open: false },
	];
	const list = (over: Partial<React.ComponentProps<typeof TeacherChats>> = {}) => (
		<TeacherChats chats={chats} choice="claude" onChoose={() => {}} onNew={() => {}} onResume={() => {}} busy={false} {...over} />
	);
	it("New chat first, then each chat with how long ago, and no agent's name while one agent has them", () => {
		const el = mount(list());
		assert.equal(el.querySelector("[data-testid='teacher-chat-new']")?.textContent, "New chat");
		const rows = [...el.querySelectorAll("[data-testid='teacher-chat']")].map((r) => r.textContent);
		assert.deepEqual(rows, ["Limits proof2 hours", "A chat5 min"]);
	});
	it("while the teacher runs, the chat it is in says so, and pressing it goes back to it instead of starting it again", () => {
		const opened: string[] = [];
		const resumed: string[] = [];
		const el = mount(list({ onOpen: (c) => opened.push(c.id), onResume: (c) => resumed.push(c.id) }));
		const open = el.querySelector("[data-testid='teacher-chat-open']") as HTMLElement;
		assert.equal(open.textContent, "Limits proofopen now");
		act(() => open.click());
		assert.deepEqual([opened, resumed], [[chats[0]!.id], []]);
		assert.deepEqual([...el.querySelectorAll("[data-testid='teacher-chat']")].map((r) => r.textContent), ["A chat5 min"]);
	});
	it("names the agent when both have chats", () => {
		const el = mount(list({ chats: [chats[0]!, { ...chats[1]!, agent: "codex" }] }));
		assert.match(el.querySelectorAll("[data-testid='teacher-chat']")[1]?.textContent ?? "", /^A chat, Codex/);
	});
	it("a click goes back to that chat; New chat starts one", () => {
		const resumed: string[] = [];
		let fresh = 0;
		const el = mount(list({ onResume: (c) => resumed.push(c.id), onNew: () => fresh++ }));
		act(() => (el.querySelector("[data-testid='teacher-chat']") as HTMLElement).click());
		act(() => (el.querySelector("[data-testid='teacher-chat-new']") as HTMLElement).click());
		assert.deepEqual([resumed, fresh], [[chats[0]!.id], 1]);
	});
});
