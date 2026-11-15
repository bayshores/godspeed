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
const { TERMINAL_DOCK_WIDTH, TERMINAL_PUSH_MIN, dockLayout, panelBody, panelStarts, shownScreen } = await import("../../src/frontend/components/teacher/dock-model.ts");
const { fitFontSize } = await import("../../src/frontend/components/terminal/terminal-model.ts");
const { waitingNotice } = await import("../../src/frontend/components/agent-status.tsx");
const { ActivityList, TeacherActivity } = await import("../../src/frontend/components/teacher/teacher-activity.tsx");
const { DEFAULT_TEACHER_NAME, sanitizeTeacherName, sanitizeUserSettings, TEACHER_NAME_MAX } = await import("../../src/shared/core/settings.ts");
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

const IDLE = { connected: false, teaching: false, helperHere: false, helperCovering: false, pendingWork: 0, pendingTurns: 0, claimedLessons: [] };
const TEACHING = { ...IDLE, connected: true, teaching: true, name: "Claude Code" };

type PanelProps = React.ComponentProps<typeof TeacherPanel>;
/** The panel as a browser has it: Activity alone. */
const panel = (over: Partial<PanelProps> = {}) => (
	<TeacherPanel
		name="Ada"
		agent={TEACHING}
		view="activity"
		listable
		list={false}
		onList={() => {}}
		overLesson={false}
		screen="teacher"
		onScreen={() => {}}
		focus={false}
		onClose={() => {}}
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
	it("head: the name, the teacher's status and a Close button (Follow is the top bar's chip)", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="teacher-panel-name"[^>]*>Ada</);
		assert.match(html, /data-testid="teacher-panel-agent"[^>]*>(<[^>]*>)*Teaching, idle</);
		assert.match(html, /data-testid="teacher-panel-close"[^>]*>[\s\S]*Close</);
		assert.doesNotMatch(html, /role="switch"/);
		const closes: number[] = [];
		const el = mount(panel({ onClose: () => closes.push(1) }));
		act(() => (el.querySelector("[data-testid='teacher-panel-close']") as HTMLElement).click());
		assert.deepEqual(closes, [1]);
	});
	it("docks on the right edge as a solid panel with no blur", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="teacher-panel"[^>]*class="[^"]*fixed top-12 right-0 bottom-0[^"]*border-l-2[^"]*border-line[^"]*bg-panel/);
		assert.doesNotMatch(/<section[^>]*>/.exec(html)![0], /lh-popup|rounded|blur/);
	});
	it("the status line says Not connected with no agent, and shows the waiting notice once while work waits", () => {
		assert.equal(agentLine(IDLE), "Not connected");
		assert.equal(agentLine(null), null, "nothing until the first read");
		assert.equal(agentLine({ ...IDLE, connected: true, teaching: true }), "Teaching, idle");
		assert.equal(agentLine({ ...IDLE, connected: true, teaching: true }, { text: "Reading a PDF", working: true }), "Reading a PDF");
		assert.equal(agentLine({ ...IDLE, connected: true, name: "Codex" }), "Codex connected, not teaching");
		assert.equal(agentLine({ ...IDLE, connected: true, name: "Codex", pendingWork: 1 }), waitingNotice("Codex"));
		assert.equal(agentLine({ ...IDLE, connected: true, teaching: true, helperCovering: true }), "Tidying my memory.");
		const html = renderToStaticMarkup(panel({ agent: { ...IDLE, pendingWork: 2 } }));
		assert.equal(html.split(`>${waitingNotice()}<`).length - 1, 1, "in the head, not again in Activity");
	});
	it("Activity and a screen not shown yet: 400 wide, pushing the page while it keeps 480 px; the whole window when narrow", () => {
		assert.deepEqual(dockLayout(1440, 1440, "activity", false, false), { width: 400, push: 400, wide: false });
		assert.deepEqual(dockLayout(1000, 1000, "activity", false, false), { width: 400, push: 400, wide: false });
		assert.deepEqual(dockLayout(800, 800, "activity", false, false), { width: 400, push: 0, wide: false }, "a page too narrow to push is covered instead");
		assert.deepEqual(dockLayout(600, 600, "activity", false, false), { width: 600, push: 0, wide: false }, "the whole window: no push");
		assert.deepEqual(dockLayout(1440, 1440, "terminal", false, false), { width: 400, push: 400, wide: false }, "before a start: a sentence and the start keys");
		assert.deepEqual(dockLayout(1100, 1100, "terminal", false, false), { width: 400, push: 400, wide: false });
		assert.deepEqual(dockLayout(1440, 1440, "activity", true, false), { width: 400, push: 400, wide: false }, "a running screen does not widen Activity");
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
	it("Terminal: the whole screen at 14 px where the page keeps 480 px", () => {
		assert.equal(fitFontSize(TERMINAL_DOCK_WIDTH - 62, 10_000), 14, "the screen's box: the width less the card's margins and padding and the border");
		assert.deepEqual(dockLayout(1440, 1440, "terminal", true, false), { width: TERMINAL_DOCK_WIDTH, push: TERMINAL_DOCK_WIDTH, wide: true });
	});
	it("Terminal: narrower, still pushing, while the screen keeps 12 px", () => {
		assert.equal(fitFontSize(TERMINAL_PUSH_MIN - 62, 10_000), 12);
		assert.deepEqual(dockLayout(1200, 1200, "terminal", true, false), { width: 720, push: 720, wide: true });
		assert.equal(fitFontSize(720 - 62, 10_000), 13);
		assert.deepEqual(dockLayout(480 + TERMINAL_PUSH_MIN, 480 + TERMINAL_PUSH_MIN, "terminal", true, false).push, TERMINAL_PUSH_MIN);
	});
	it("Terminal: below 12 px it covers the page at full width and keeps the narrow push, so swapping to the screen never widens the page", () => {
		assert.deepEqual(dockLayout(1100, 1100, "terminal", true, false), { width: TERMINAL_DOCK_WIDTH, push: 400, wide: true });
		assert.deepEqual(dockLayout(800, 800, "terminal", true, false), { width: TERMINAL_DOCK_WIDTH, push: 0, wide: true }, "the font fit does the rest");
		assert.deepEqual(dockLayout(600, 600, "terminal", true, false), { width: 600, push: 0, wide: true });
		for (let w = 640; w <= 2000; w += 10) {
			const { push } = dockLayout(w, w, "terminal", true, false);
			assert.ok(push === 0 || w - push >= 480, `${w}: the page never under 480`);
			assert.ok(push <= 400 || fitFontSize(push - 62, 10_000) >= 12, `${w}: a pushing screen keeps 12 px`);
		}
	});
	it("covers a lesson instead of pushing it (the lesson draws its own top bar)", () => {
		assert.deepEqual(dockLayout(1800, 1800, "terminal", true, true), { width: TERMINAL_DOCK_WIDTH, push: 0, wide: true });
		assert.equal(dockLayout(1800, 1800, "terminal", false, true).push, 0);
	});
	it("is the screen in the desktop app (Activity hangs from its chip), Activity in a browser, and over a lesson the screen or nothing", () => {
		assert.equal(panelBody(false, true), "terminal");
		assert.equal(panelBody(false, false), "activity");
		assert.equal(panelBody(true, true), "terminal");
		assert.equal(panelBody(true, false), null);
	});
	it("dims the page only where it covers it, and the dimming takes no clicks", () => {
		const wasWidth = window.innerWidth;
		try {
			Object.assign(window, { innerWidth: 800 });
			const scrim = mount(panel()).querySelector<HTMLElement>("[data-testid='teacher-panel-scrim']");
			assert.ok(scrim !== null, "800 wide: the panel covers the page");
			assert.equal(scrim.style.right, "400px", "the page beside the panel");
			assert.ok(scrim.classList.contains("pointer-events-none"));
			Object.assign(window, { innerWidth: 1440 });
			assert.ok(mount(panel()).querySelector("[data-testid='teacher-panel-scrim']") === null, "1440 wide: it pushes the page");
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
			onPick={() => {}}
			spaceNameOf={names}
			feed={EMPTY}
			waiting={null}
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
		assert.ok(mount(list({ recent: [], waiting: waitingNotice() })).querySelector("[data-testid='activity-empty']") === null, "the waiting line is something");
	});
	it("Recent hides when there is nothing yet", () => {
		assert.ok(mount(list({ recent: [] })).querySelector("[data-testid='activity-recent']") === null);
	});
	it("Recent: label, space, how long ago, and an arrow only where it can go", () => {
		const el = mount(list());
		assert.match(el.textContent ?? "", /Recent/);
		const rows = [...el.querySelectorAll("[data-testid='activity-recent-row']")];
		assert.equal(rows.length, 2);
		assert.match(rows[0]!.textContent ?? "", /Added Lab 4CSE 29/);
		assert.match(rows[0]!.querySelector("[data-testid='activity-recent-time']")?.textContent ?? "", /^(Oct 2[89]|\d+ (min|hours?|days)|yesterday)$/);
		assert.ok(rows[0]!.querySelector("svg"), "arrow");
		assert.ok(rows[1]!.querySelector("svg") === null);
		assert.equal(rows[1]!.hasAttribute("disabled"), true, "a page that isn't the app's is never followed");
	});
	it("Recent lists every row the server sent, scrolling inside the list", () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ ...ACTIONS[0]!, id: `a${i}` }));
		const el = mount(list({ recent: many }));
		assert.equal(el.querySelectorAll("[data-testid='activity-recent-row']").length, 12);
		assert.match(el.querySelector("[data-testid='activity-list']")?.className ?? "", /overflow-y-auto/);
	});
	it("clicking a Recent row goes there", () => {
		const picked: string[] = [];
		const el = mount(list({ onPick: (a) => picked.push(a.id) }));
		act(() => (el.querySelector("[data-testid='activity-recent-row']") as HTMLElement).click());
		assert.deepEqual(picked, ["a2"]);
	});
	it("Running in the background sits above Recent, with failed jobs and the waiting line", () => {
		const failed = [{ id: "j1", kind: "pdf" as const, chatId: "c1", title: "06_Counting.pdf", error: "The PDF could not be read", at: "2026-10-28T16:00:00Z" }];
		const html = renderToStaticMarkup(list({ feed: { ...EMPTY, failed }, waiting: waitingNotice("Codex") }));
		assert.match(html, /Running in the background/);
		assert.match(html, /data-testid="activity-failed"/);
		assert.match(html, /Failed: The PDF could not be read/);
		assert.match(html, /data-testid="activity-waiting"[^>]*>Waiting for your agent\. Tell Codex to start teaching\.</);
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
	it("is one clean line, at most 40 characters", () => {
		assert.equal(sanitizeTeacherName("  Comet\n\tthe\u0000 Great  "), "Comet the Great");
		assert.equal(sanitizeTeacherName("x".repeat(100)).length, TEACHER_NAME_MAX);
		assert.equal(sanitizeTeacherName("   "), "");
		assert.equal(sanitizeTeacherName("a‮b"), "a b", "no direction tricks");
	});
	it("the stored record keeps a clean name and drops an empty one", () => {
		assert.equal(sanitizeUserSettings({ general: { teacherName: " Nova " } })?.general?.teacherName, "Nova");
		assert.equal(sanitizeUserSettings({ general: { teacherName: "  " } })?.general?.teacherName, undefined);
		assert.equal(sanitizeUserSettings({ general: { teacherName: 5 } })?.general?.teacherName, undefined);
	});
});
