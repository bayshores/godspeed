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

const { TeacherPanel, agentLine } = await import("../../src/frontend/components/teacher/teacher-panel.tsx");
const { PANEL_HEIGHT, PANEL_WIDTH, draggedHeight, keyedHeight, panelLayout, panelBody, panelStarts, shownScreen, storedHeight } = await import("../../src/frontend/components/teacher/dock-model.ts");
const { waitingNotice } = await import("../../src/frontend/components/agent-status.tsx");
const { ActivityList, TeacherActivity } = await import("../../src/frontend/components/teacher/teacher-activity.tsx");
const { PanelHead } = await import("../../src/frontend/components/teacher/panel-head.tsx");
const { TeacherChats } = await import("../../src/frontend/components/teacher/teacher-chats.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";
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

const IDLE = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, helperWork: 0, claimedLessons: [] };
const TEACHING = { ...IDLE, connected: true, teaching: true, name: "Claude Code" };

type PanelProps = React.ComponentProps<typeof TeacherPanel>;
/** The panel as a browser has it: Activity alone. */
const panel = (over: Partial<PanelProps> = {}) => (
	<TeacherPanel
		name="Ada"
		agent={TEACHING}
		view="activity"
		list={false}
		onList={() => {}}
		screen="teacher"
		onScreen={() => {}}
		focus={false}
		state="open"
		{...over}
	/>
);

describe("the panel", () => {
	it("in a browser it is the Activity list alone, and its chip drops nothing", () => {
		const el = mount(panel());
		assert.ok(el.querySelector("[data-testid='activity-list'] [data-testid='activity-empty']"), "outside the app shell the list says what will show there");
		assert.ok(el.querySelector("[aria-expanded]") === null);
		assert.ok(el.querySelector("[data-testid='no-agent']") === null, "an agent is here: no start pair");
		assert.ok(el.querySelector("[role='tablist'], [role='tab']") === null, "no tabs");
	});
	it("in a browser with no agent, the start pair sits above Activity", () => {
		const el = mount(panel({ agent: IDLE }));
		const start = el.querySelector("[data-testid='no-agent']");
		const list = el.querySelector("[data-testid='activity-list']");
		assert.ok(start !== null && list !== null);
		assert.ok(start.nextElementSibling === list, "the start pair, then the list");
		assert.equal(el.querySelector("[data-testid='open-agent']")?.textContent, "Start Claude Code");
	});
	it("head: the teacher's status alone, in the screen's font; the pill names the panel and closes it", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="teacher-panel-agent"[^>]*class="[^"]*font-mono[^"]*"[^>]*>(<[^>]*>)*Ready</);
		assert.doesNotMatch(html, /teacher-panel-name|teacher-panel-close|role="switch"/);
	});
	it("hangs from the top bar at the window's right edge as a window of the bar's sheet, with no blur", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /^<div data-state="open" style="right:0" class="lh-hang fixed top-\(--lh-bar-h\) z-\[41\]"><section[^>]*data-testid="teacher-panel"/);
		const section = /<section[^>]*>/.exec(html)![0];
		assert.match(section, /class="lh-popup lh-hang-body /);
		assert.match(section, new RegExp(`width:${PANEL_WIDTH.initial}px;height:${PANEL_HEIGHT.initial}px`));
		assert.doesNotMatch(section, /border-l|bg-panel|blur/);
	});
	it("the status line says the teacher is off with no agent, and shows the waiting notice once while work waits", () => {
		assert.equal(agentLine(IDLE, "Ada"), "Ada is off");
		assert.equal(agentLine(null, "Ada"), null, "nothing until the first read");
		assert.equal(agentLine({ ...IDLE, connected: true, teaching: true }, "Ada"), "Ready");
		assert.equal(agentLine({ ...IDLE, connected: true, teaching: true }, "Ada", { text: "Reading a PDF", working: true }), "Reading a PDF");
		assert.equal(agentLine({ ...IDLE, connected: true, name: "Codex" }, "Ada"), "Ada is on", "the teacher's name, never the program's");
		assert.equal(agentLine({ ...IDLE, connected: true, name: "Codex", pendingWork: 1 }, "Ada"), waitingNotice("Ada", true));
		assert.equal(agentLine({ ...IDLE, connected: true, teaching: true, helperCovering: true }, "Ada"), "Tidying my memory. A backup is answering for a minute.");
		const html = renderToStaticMarkup(panel({ agent: { ...IDLE, pendingWork: 2 } }));
		assert.equal(html.split(`>${waitingNotice("Ada", false)}<`).length - 1, 1, "in the head, not again in Activity");
	});
	const at = (width: number, height = 852) => ({ width, height });
	it("a window lies over the page at the size the learner left it, without pushing", () => {
		assert.deepEqual(panelLayout(at(1440), 1440, { width: 620, height: 460 }), { width: 620, height: 460, push: 0 });
		assert.deepEqual(panelLayout(at(800), 800, { width: 900, height: 320 }), { width: 800, height: 320, push: 0 }, "never wider than the window");
	});
	it("docked it is as wide as the learner left it, pushing the page while it keeps 480 px", () => {
		const docked = (w: number, wanted: number) => panelLayout(at(w), w, { width: wanted, height: "full" });
		assert.deepEqual(docked(1440, 440), { width: 440, height: null, push: 440 });
		assert.deepEqual(docked(1440, 900), { width: 900, height: null, push: 900 });
		assert.deepEqual(docked(1100, 900), { width: 620, height: null, push: 620 }, "narrower than asked: the page keeps 480");
		assert.deepEqual(docked(840, 440), { width: 360, height: null, push: 360 }, "down to its narrowest");
		for (let w = 640; w <= 2000; w += 10) {
			for (const wanted of [PANEL_WIDTH.min, PANEL_WIDTH.initial, PANEL_WIDTH.max]) {
				const { width, push } = docked(w, wanted);
				assert.ok(push === 0 || (push === width && w - push >= 480 && width >= PANEL_WIDTH.min), `${w}, ${wanted}`);
			}
		}
		assert.deepEqual(panelLayout(at(1440, 400), 1440, { width: 620, height: 460 }), { width: 620, height: null, push: 620 }, "a window taller than the room is docked");
	});
	it("docked it covers a page with no room for its narrowest; a narrow window gets it across its whole width", () => {
		const docked = (w: number, wanted: number) => panelLayout(at(w), w, { width: wanted, height: "full" });
		assert.deepEqual(docked(800, 440), { width: 440, height: null, push: 0 });
		assert.deepEqual(docked(700, 900), { width: 700, height: null, push: 0 });
		assert.deepEqual(docked(600, 440), { width: 600, height: null, push: 0 });
		assert.deepEqual(panelLayout(at(600), 600, { width: 440, height: 460 }), { width: 600, height: null, push: 0 }, "a window too");
	});
	it("its bottom edge drags the height, docks near the window's bottom and comes back up out of the dock", () => {
		assert.equal(draggedHeight(460, 500, 560, 852), 520);
		assert.equal(draggedHeight(460, 500, 100, 852), PANEL_HEIGHT.min, "no shorter than the screen's 10 rows");
		assert.equal(draggedHeight(460, 500, 860, 852), "full", "within 40 px of the bottom it docks");
		assert.equal(draggedHeight(852, 898, 500, 852), 454, "dragged up from the dock it is a window again");
		assert.equal(keyedHeight(460, "ArrowDown", 852), 476);
		assert.equal(keyedHeight(460, "ArrowUp", 852), 444);
		assert.equal(keyedHeight(800, "ArrowDown", 852), "full");
		assert.equal(keyedHeight(852, "ArrowUp", 852), 796, "out of the dock in one press");
		assert.equal(keyedHeight(460, "End", 852), "full");
		assert.equal(keyedHeight(460, "Home", 852), PANEL_HEIGHT.min);
		assert.equal(keyedHeight(460, "ArrowLeft", 852), null);
		assert.equal(storedHeight(null), PANEL_HEIGHT.initial);
		assert.equal(storedHeight("full"), "full");
		assert.equal(storedHeight("512"), 512);
		assert.equal(storedHeight("12"), PANEL_HEIGHT.min);
		assert.equal(storedHeight("tall"), PANEL_HEIGHT.initial);
	});
	it("shows a key that starts the teacher: the start pair before any start, Start again once it ended, and in a browser above Activity", () => {
		const ended = { id: "t1", role: "teacher" as const, agent: "claude" as const, startedAt: 0, ended: { stopped: true as const, code: null }, prompt: null, url: false };
		const p = { view: "terminal" as const, screen: "teacher" as const, terminals: true, noAgent: true, teacher: null, outside: false };
		assert.equal(panelStarts(p), true, "the start pair before any start");
		assert.equal(panelStarts({ ...p, outside: true }), false, "an agent from outside: no start key");
		assert.equal(panelStarts({ ...p, teacher: ended }), true, "Start again");
		assert.equal(panelStarts({ ...p, teacher: { ...ended, ended: null } }), false, "a live screen");
		assert.equal(panelStarts({ ...p, teacher: ended, screen: "helper" }), false, "the helper's screen starts the helper");
		assert.equal(panelStarts({ ...p, view: "activity" }), false, "the app's Activity has no start key");
		assert.equal(panelStarts({ ...p, view: "activity", terminals: false }), true, "a browser's Activity with no agent");
		assert.equal(panelStarts({ ...p, view: "activity", terminals: false, noAgent: false }), false);
		assert.equal(shownScreen("helper", false), "teacher", "no helper: the teacher's screen");
		assert.equal(shownScreen("helper", true), "helper");
	});
	it("is the screen in the desktop app (Activity hangs from its key), Activity in a browser, lessons too", () => {
		assert.equal(panelBody(true), "terminal");
		assert.equal(panelBody(false), "activity");
	});
	it("never dims the page, and has edges and a corner to drag unless it takes the whole window", () => {
		const wasWidth = window.innerWidth;
		try {
			Object.assign(window, { innerWidth: 800 });
			const over = mount(panel());
			assert.ok(over.querySelector("[data-testid='teacher-panel-scrim']") === null);
			for (const grip of ["resize-teacher", "resize-teacher-height", "resize-teacher-corner"]) assert.ok(over.querySelector(`[data-testid='${grip}']`) !== null, grip);
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
			waiting={null}
			graph={null}
			{...over}
		/>
	);

	it("without the teacher's state (outside the app shell) it shows the empty line", () => {
		assert.match(renderToStaticMarkup(<TeacherActivity />), /data-testid="activity-empty"[^>]*>Nothing yet\. What Teacher reads and builds shows here\.</);
	});
	it("scrolls inside its parent, with no padding of its own", () => {
		assert.match(renderToStaticMarkup(list()), /data-testid="activity-list" class="flex min-h-0 flex-1 flex-col gap-3\.5 overflow-y-auto"/);
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
		act(() => root?.unmount());
		assert.ok(mount(list({ recent: [], waiting: waitingNotice("Ada", false) })).querySelector("[data-testid='activity-empty']") === null, "the waiting line is something");
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
	it("Recent lists every row the server sent, scrolling inside the list", () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ ...ACTIONS[0]!, id: `a${i}` }));
		const el = mount(list({ recent: many }));
		assert.equal(el.querySelectorAll("[data-testid='activity-recent-row']").length, 12);
		assert.match(el.querySelector("[data-testid='activity-list']")?.className ?? "", /overflow-y-auto/);
	});
	it("Running in the background sits above Recent, with failed jobs and the waiting line", () => {
		const failed = [{ id: "j1", kind: "pdf" as const, chatId: "c1", title: "06_Counting.pdf", error: "The PDF could not be read", at: "2026-10-28T16:00:00Z" }];
		const html = renderToStaticMarkup(list({ feed: { ...EMPTY, failed }, waiting: waitingNotice("Ada", true) }));
		assert.match(html, /Running in the background/);
		assert.match(html, /data-testid="activity-failed"/);
		assert.match(html, /Failed: The PDF could not be read/);
		assert.match(html, /data-testid="activity-waiting"[^>]*>Waiting for Ada\. Tell it to start teaching\.</);
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
		panelStarts: false,
		setPanelOpen: () => {},
		showTerminal: () => {},
		recent: [],
		doing: { working: true, text: "Adding Lab 4" } as TeacherApi["doing"],
		setLesson: () => {},
		go: () => {},
		offer: null,
		held: false,
		spaceNameOf: () => null,
		...over,
	});
	const html = (over: Partial<TeacherApi>) =>
		renderToStaticMarkup(
			<TeacherContext.Provider value={api(over)}>
				<PanelHead title={null} status="Idle" lit={false} working={false} list={{ open: false, onOpen: () => {} }} need={null} back={null} />
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
		{ id: "0f8fad5b-d9cb-469f-a165-70867728950e", agent: "claude" as const, name: "Limits proof", at: now - 2 * 3_600_000 },
		{ id: "7c9e6679-7425-40de-944b-e07fc1f90ae7", agent: "claude" as const, name: null, at: now - 5 * 60_000 },
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
