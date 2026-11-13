/**
 * The teacher's screens: the panel (head, the Talk and Activity tabs:
 * Now, Recent, Background jobs) and the teacher name setting.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { mathBoxView, stubCodeMirrorDom } from "../math-box-dom.ts";
import type { AgentAction } from "../../src/shared/core/events.ts";

const dom = parseHTML("<html><body></body></html>");
stubCodeMirrorDom(dom);
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
// The Talk thread scrolls to its end.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const { HalleyPanel, agentLine } = await import("../../src/frontend/components/halley/halley-panel.tsx");
const { dockPush, dockWidth } = await import("../../src/frontend/components/halley/dock-model.ts");
const { draftWithAsk, startsTurn } = await import("../../src/frontend/components/halley/talk-model.ts");
const { askTeacher, useAskTeacher } = await import("../../src/frontend/components/halley/ask-teacher.ts");
const { waitingNotice } = await import("../../src/frontend/components/agent-status.tsx");
const { ActivityList, TeacherActivity } = await import("../../src/frontend/components/halley/teacher-activity.tsx");
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

describe("the panel", () => {
	const panel = (over: Partial<React.ComponentProps<typeof HalleyPanel>> = {}) => (
		<HalleyPanel
			name="Halley"
			agent={{ connected: true, teaching: true, name: "Claude Code", backupConnected: false, backupAnswering: false, pendingWork: 0, claimedLessons: [] }}
			onClose={() => {}}
			recent={ACTIONS}
			onPick={() => {}}
			{...over}
		/>
	);

	// The Talk tab opens the chat on mount; most tests don't need it to answer.
	const talkCalls: string[] = [];
	let talkChat: unknown = null;
	globalThis.fetch = ((url: string, init?: RequestInit) => {
		talkCalls.push(`${init?.method ?? "GET"} ${url}${typeof init?.body === "string" ? ` ${init.body}` : ""}`);
		if (url === "/api/talk" && init?.method === "POST" && talkChat) return Promise.resolve(new Response(JSON.stringify(talkChat)));
		return new Promise(() => {});
	}) as typeof fetch;
	const settle = () =>
		act(async () => {
			for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
		});
	const talkText = async (el: HTMLElement) => (await mathBoxView(el, `Message Halley`)).state.doc.toString();

	it("opens on Talk, which opens the chat; Activity is the other tab, the teacher's Activity list", () => {
		talkCalls.length = 0;
		const el = mount(panel());
		assert.equal(el.querySelector("[data-testid='halley-tab-talk']")?.getAttribute("aria-selected"), "true");
		assert.deepEqual(talkCalls, ["POST /api/talk"]);
		assert.equal(el.querySelector("[data-testid='halley-activity']"), null);
		act(() => (el.querySelector("[data-testid='halley-tab-activity']") as HTMLElement).click());
		assert.equal(el.querySelector("[data-testid='halley-tab-activity']")?.getAttribute("aria-selected"), "true");
		// Outside the app shell there is no teacher state: the list says what will show there.
		assert.ok(el.querySelector("[data-testid='halley-activity'] [data-testid='halley-activity-empty']"));
	});
	it("head: the name, the teacher's status and a Close button (Follow is the top bar's chip)", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="halley-panel-name"[^>]*>Halley</);
		assert.match(html, /data-testid="halley-panel-agent"[^>]*>Teaching, idle</);
		assert.match(html, /data-testid="halley-close"[^>]*>[\s\S]*Close</);
		assert.doesNotMatch(html, /role="switch"/);
		const closes: number[] = [];
		const el = mount(panel({ onClose: () => closes.push(1) }));
		act(() => (el.querySelector("[data-testid='halley-close']") as HTMLElement).click());
		assert.deepEqual(closes, [1]);
	});
	it("docks on the right edge as a solid panel with no blur", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="halley-panel"[^>]*class="[^"]*fixed top-12 right-0 bottom-0[^"]*border-l-2[^"]*border-line[^"]*bg-panel/);
		assert.doesNotMatch(html, /lh-popup|rounded|blur/);
	});
	it("Talk reads like a script: the speaker's name above each turn, no bubbles, Send in the box", async () => {
		talkChat = {
			id: "chat_talk",
			turnInFlight: false,
			messages: [
				{ id: "u1", role: "user", content: [{ type: "text", text: "add the CSE 21 midterm on Nov 6 at 7pm" }], timestamp: 1 },
				{ id: "u2", role: "user", content: [{ type: "text", text: "and the final" }], timestamp: 2 },
			],
		};
		const el = mount(panel());
		await settle();
		const who = [...el.querySelectorAll("[data-testid='talk-who']")].map((n) => n.textContent);
		assert.deepEqual(who, ["You"], "the second message of a turn has no name of its own");
		assert.equal(el.querySelector("[data-testid='talk-you']")?.className.includes("bg-"), false, "no bubbles");
		assert.ok(el.querySelector("[data-testid='talk-send']"));
		talkChat = null;
	});
	it("Clear chat sits on the tab row, and only once there is something to clear", async () => {
		talkChat = { id: "chat_talk", turnInFlight: false, messages: [] };
		const empty = mount(panel());
		await settle();
		assert.equal(empty.querySelector("[data-testid='talk-clear']"), null);
		act(() => root?.unmount());
		talkChat = { id: "chat_talk", turnInFlight: false, messages: [{ id: "u1", role: "user", content: "add my midterm", timestamp: 1 }] };
		const el = mount(panel());
		await settle();
		const clear = el.querySelector("[data-testid='talk-clear']")!;
		assert.equal(clear.textContent, "Clear chat");
		assert.ok(clear.closest("[role='tablist']") === null && clear.parentElement?.previousElementSibling?.getAttribute("role") === "tablist", "beside the tabs, not inside the thread");
		act(() => (el.querySelector("[data-testid='halley-tab-activity']") as HTMLElement).click());
		assert.equal(el.querySelector("[data-testid='talk-clear']"), null, "Talk only");
		talkChat = null;
	});
	it("with no agent connected the thread says so in the teacher's words, with the button that opens one", async () => {
		talkChat = { id: "chat_talk", turnInFlight: false, messages: [] };
		const idle = { connected: false, teaching: false, backupConnected: false, backupAnswering: false, pendingWork: 0, claimedLessons: [] };
		const el = mount(panel({ agent: idle }));
		await settle();
		assert.match(el.querySelector("[data-testid='halley-panel-agent']")?.textContent ?? "", /^Not connected$/);
		assert.match(el.querySelector("[data-testid='no-agent']")?.textContent ?? "", /I'm not connected yet\. Open Claude Code and I'll start\./);
		assert.equal(el.querySelector("[data-testid='no-agent-open']")?.textContent, "Open Claude Code");
		assert.ok(el.querySelector("[data-testid='talk-empty']"), "the prompt stays below it");
		act(() => root?.unmount());
		assert.equal(mount(panel()).querySelector("[data-testid='no-agent']"), null, "gone while an agent teaches");
		talkChat = null;
	});
	it("Talk takes pictures and PDFs like the lesson box, and shows them under your message", async () => {
		talkChat = {
			id: "chat_talk",
			turnInFlight: false,
			messages: [
				{
					id: "u1",
					role: "user",
					content: [
						{ type: "text", text: "here is the syllabus" },
						{ type: "image", data: "QUJD", mimeType: "image/png" },
						{ type: "text", text: "[Attached PDF] syllabus.pdf\nPath: /data/chats/chat_talk/abc-syllabus.pdf\nRead it with the pdf tool when you need its content." },
					],
					timestamp: 1,
				},
				{ id: "u2", role: "user", content: [{ type: "image", data: "REVG", mimeType: "image/png" }], timestamp: 2 },
			],
		};
		const el = mount(panel());
		await settle();
		const rows = [...el.querySelectorAll("[data-testid='talk-row']")];
		assert.equal(rows.length, 2);
		assert.equal(rows[0]!.querySelector("[data-testid='talk-you']")?.textContent, "here is the syllabus");
		assert.ok(rows[0]!.querySelector("[data-testid='message-image']"));
		assert.equal(rows[0]!.querySelector("[data-testid='message-pdf']")?.textContent, "syllabus.pdf");
		assert.ok(!el.textContent!.includes("[Attached PDF]"), "the note never shows as text");
		assert.equal(rows[1]!.querySelector("[data-testid='talk-you']"), null, "a message with only files has no empty line");
		assert.ok(rows[1]!.querySelector("[data-testid='message-image']"));
		const box = el.querySelector("[data-testid='talk-box']")!;
		const button = box.querySelector("[data-testid='attach-button']");
		assert.equal(button?.textContent, "Add pictures or PDFs");
		assert.equal(box.querySelector("[data-testid='attachment-input']")?.getAttribute("accept"), "image/png,image/jpeg,image/gif,image/webp,application/pdf");
		assert.ok(box.innerHTML.indexOf('data-testid="talk-send"') < box.innerHTML.indexOf('data-testid="attach-button"'), "under the box that holds Send");
		talkChat = null;
	});
	it("a turn starts when the speaker changes; a change row is the teacher's", () => {
		const rows = [
			{ kind: "you" as const, id: "1", text: "a", files: [] },
			{ kind: "you" as const, id: "2", text: "b", files: [] },
			{ kind: "change" as const, id: "3", change: { label: "Adding HW 5", page: "/" } },
			{ kind: "teacher" as const, id: "4", text: "c" },
		];
		assert.deepEqual(rows.map((_, i) => startsTurn(rows, i)), [true, false, true, false]);
	});
	it("a message asked from elsewhere is sent in Talk once, or left in the box while the teacher replies", async () => {
		talkCalls.length = 0;
		talkChat = { id: "chat_talk", turnInFlight: false, messages: [] };
		const asked: number[] = [];
		mount(panel({ ask: { id: 1, text: "Check my CSE 21 files against the syllabus" }, onAsked: (id) => asked.push(id) }));
		await settle();
		assert.equal(talkCalls.filter((c) => c.startsWith("POST /api/chat ") && c.includes("Check my CSE 21 files")).length, 1);
		assert.deepEqual(asked, [1]);
		act(() => root?.unmount());
		talkChat = { id: "chat_talk", turnInFlight: true, messages: [] };
		const busy = mount(panel({ ask: { id: 2, text: "Check again" }, onAsked: (id) => asked.push(id) }));
		await settle();
		assert.equal(await talkText(busy), "Check again");
		assert.deepEqual(asked, [1, 2]);
		talkChat = null;
	});
	it("Talk keeps its unsent text like the lesson box, and its waiting files while the tab is closed", async () => {
		const store = new Map<string, string>();
		const g = globalThis as Record<string, unknown>;
		g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
		g.FileReader = class {
			result: string | null = null;
			onload: (() => void) | null = null;
			readAsDataURL() {
				this.result = "data:image/png;base64,QUJD";
				setTimeout(() => this.onload?.(), 0);
			}
		};
		try {
			talkChat = { id: "chat_talk", turnInFlight: false, messages: [] };
			const el = mount(panel());
			await settle();
			const view = await mathBoxView(el, "Message Halley");
			await act(async () => view.dispatch({ changes: { from: 0, insert: "add my lab" } }));
			await act(async () => {
				const paste = new window.Event("paste", { bubbles: true });
				Object.defineProperty(paste, "clipboardData", { value: { files: [new File(["x"], "lab.png", { type: "image/png" })] } });
				el.querySelector("[data-testid='talk-box']")!.dispatchEvent(paste);
			});
			await settle();
			assert.ok(el.querySelector("[data-testid='draft-image']"));
			assert.match(store.get("lh:lesson-draft:chat_talk") ?? "", /"composer":"add my lab"/);

			act(() => (el.querySelector("[data-testid='halley-tab-activity']") as HTMLElement).click());
			act(() => (el.querySelector("[data-testid='halley-tab-talk']") as HTMLElement).click());
			await settle();
			assert.equal(await talkText(el), "add my lab");
			assert.ok(el.querySelector("[data-testid='draft-image']"), "the picture still waits");
			act(() => (el.querySelector("[aria-label='Remove lab.png']") as HTMLElement).click());
		} finally {
			delete g.localStorage;
			delete g.FileReader;
			talkChat = null;
		}
	});
	it("a message asked while the teacher replies waits after the learner's own text, never over it", async () => {
		assert.equal(draftWithAsk("", "Check again"), "Check again");
		assert.equal(draftWithAsk("  ", "Check again"), "Check again");
		assert.equal(draftWithAsk("my note\n", "Check again"), "my note\n\nCheck again");
		const store = new Map([["lh:lesson-draft:chat_talk", JSON.stringify({ composer: "my note", questions: {}, problems: {} })]]);
		const g = globalThis as Record<string, unknown>;
		g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) };
		try {
			talkChat = { id: "chat_talk", turnInFlight: true, messages: [] };
			const el = mount(panel({ ask: { id: 3, text: "Check again" } }));
			await settle();
			assert.equal(await talkText(el), "my note\n\nCheck again");
		} finally {
			delete g.localStorage;
			talkChat = null;
		}
	});
	it("a failed Talk reply offers Try again, which sends the last message again, as in the lesson", async () => {
		talkCalls.length = 0;
		talkChat = { id: "chat_talk", turnInFlight: false, turnError: "The model is overloaded", messages: [{ id: "u1", role: "user", content: "add my midterm", timestamp: 1 }] };
		const el = mount(panel());
		await settle();
		assert.match(el.querySelector("[data-testid='talk-failed']")?.textContent ?? "", /The model is overloaded/);
		await act(async () => (el.querySelector("[data-testid='talk-retry']") as HTMLElement).click());
		await settle();
		assert.equal(talkCalls.filter((c) => c.startsWith("POST /api/chat ") && c.includes("add my midterm")).length, 1);
		talkChat = null;
	});
	it("Esc in Talk stops a running reply on the server and leaves the panel open", async () => {
		talkCalls.length = 0;
		talkChat = { id: "chat_talk", turnInFlight: true, messages: [{ id: "u1", role: "user", content: "add my midterm", timestamp: 1 }] };
		const el = mount(panel());
		await settle();
		const closes: string[] = [];
		const onDocKey = () => closes.push("panel");
		document.addEventListener("keydown", onDocKey);
		try {
			// On the Stop bar (a text field's keys take React's input polyfill here).
			const field = el.querySelector("[data-testid='talk-stop']") as HTMLElement;
			const esc = new window.Event("keydown", { bubbles: true });
			Object.defineProperty(esc, "key", { value: "Escape" });
			await act(async () => field.dispatchEvent(esc));
			await settle();
			assert.ok(talkCalls.includes('POST /api/activity/abort {"kind":"turn","id":"chat_talk"}'));
			assert.deepEqual(closes, [], "the panel's Esc never sees it");
			assert.ok(el.querySelector("[data-testid='talk-send']"), "Stop is Send again");
		} finally {
			document.removeEventListener("keydown", onDocKey);
			talkChat = null;
		}
	});
	it("the status line says Not connected with no agent, and shows the waiting notice while work waits", () => {
		const idle = { connected: false, teaching: false, backupConnected: false, backupAnswering: false, pendingWork: 0, claimedLessons: [] };
		assert.equal(agentLine(idle), "Not connected");
		assert.equal(agentLine(null), null, "nothing until the first read");
		assert.equal(agentLine({ ...idle, connected: true, teaching: true }), "Teaching, idle");
		assert.equal(agentLine({ ...idle, connected: true, teaching: true }, { text: "Reading a PDF", working: true }), "Reading a PDF");
		assert.equal(agentLine({ ...idle, connected: true, name: "Codex" }), "Codex connected, not teaching");
		assert.equal(agentLine({ ...idle, connected: true, name: "Codex", pendingWork: 1 }), waitingNotice("Codex"));
		assert.equal(agentLine({ ...idle, connected: true, teaching: true, backupAnswering: true }), "Catching up on my notes. My backup is answering for a minute.");
		assert.ok(renderToStaticMarkup(panel({ agent: { ...idle, pendingWork: 2 } })).includes(waitingNotice()));
	});
	it("a Talk message no agent has taken says it waits once, in the head", async () => {
		talkChat = { id: "chat_talk", turnInFlight: true, messages: [{ id: "u1", role: "user", content: "add my midterm", timestamp: 1 }] };
		const el = mount(panel({ agent: { connected: false, teaching: false, backupConnected: false, backupAnswering: false, pendingWork: 1, claimedLessons: [] } }));
		await settle();
		assert.ok(el.querySelector("[data-testid='talk-you']"), "the thread is open");
		assert.equal(el.textContent!.split("Waiting for your agent").length - 1, 1);
		talkChat = null;
	});
	it("is 400 wide, and the whole window when narrow", () => {
		assert.equal(dockWidth(1440), 400);
		assert.equal(dockWidth(600), 600);
	});
	it("pushes the page left by its width", () => {
		assert.equal(dockPush(1440, 1184), 400);
		assert.equal(dockPush(600, 600), 0, "the whole window: no push");
		assert.equal(dockPush(1000, 1000), 400);
		assert.equal(dockPush(800, 544), 0, "a page too narrow to push is covered instead");
	});
	it("askTeacher reaches the panel's listener with the text", () => {
		const heard: string[] = [];
		function Listener() {
			useAskTeacher((t) => heard.push(t));
			return null;
		}
		mount(<Listener />);
		askTeacher("Check my files");
		askTeacher("   ");
		assert.deepEqual(heard, ["Check my files"]);
	});
});

describe("the teacher's Activity", () => {
	const EMPTY = { jobs: [], extractions: [] };
	const list = (over: Partial<React.ComponentProps<typeof ActivityList>> = {}) => (
		<ActivityList
			name="Halley"
			doing={{ text: "Reading syllabus.pdf", count: "2 of 5", working: true }}
			follow={{ on: false, set: () => {} }}
			recent={ACTIONS}
			onPick={() => {}}
			spaceNameOf={names}
			feed={EMPTY}
			waiting={null}
			{...over}
		/>
	);

	it("without the teacher's state (outside the app shell) it shows the empty line", () => {
		assert.match(renderToStaticMarkup(<TeacherActivity />), /data-testid="halley-activity-empty"[^>]*>Nothing yet\. What Teacher reads and builds shows here\.</);
	});
	it("scrolls inside its parent, with no padding of its own", () => {
		assert.match(renderToStaticMarkup(list()), /data-testid="halley-activity" class="flex min-h-0 flex-1 flex-col gap-3\.5 overflow-y-auto"/);
	});
	it("the now box: what it is doing, its count and Follow; hidden while idle", () => {
		const el = mount(list());
		const now = el.querySelector("[data-testid='halley-now']")!;
		assert.equal(now.textContent, "Reading syllabus.pdf2 of 5Follow");
		assert.equal(now.className.includes("bg-highlight"), true);
		act(() => root?.unmount());
		assert.equal(mount(list({ doing: { text: "Idle", working: false } })).querySelector("[data-testid='halley-now']"), null);
	});
	it("Follow turns following on and off, and reads Following while on", () => {
		const set: boolean[] = [];
		const el = mount(list({ follow: { on: false, set: (on) => set.push(on) } }));
		const button = el.querySelector("[data-testid='activity-follow']") as HTMLElement;
		assert.equal(button.getAttribute("aria-pressed"), "false");
		act(() => button.click());
		assert.deepEqual(set, [true]);
		act(() => root?.unmount());
		const on = mount(list({ follow: { on: true, set: () => {} } })).querySelector("[data-testid='activity-follow']");
		assert.equal(on?.textContent, "Following");
		assert.equal(on?.getAttribute("aria-pressed"), "true");
		act(() => root?.unmount());
		assert.equal(mount(list({ follow: null })).querySelector("[data-testid='activity-follow']"), null);
	});
	it("with nothing in it, says what will show there", () => {
		const el = mount(list({ doing: { text: "Idle", working: false }, recent: [] }));
		assert.equal(el.querySelector("[data-testid='halley-activity-empty']")?.textContent, "Nothing yet. What Halley reads and builds shows here.");
		act(() => root?.unmount());
		assert.equal(mount(list()).querySelector("[data-testid='halley-activity-empty']"), null);
		act(() => root?.unmount());
		assert.equal(mount(list({ doing: null, recent: [], waiting: waitingNotice() })).querySelector("[data-testid='halley-activity-empty']"), null, "the waiting line is something");
	});
	it("Recent hides when there is nothing yet", () => {
		assert.equal(mount(list({ recent: [] })).querySelector("[data-testid='halley-recent']"), null);
	});
	it("Recent: label, space, how long ago, and an arrow only where it can go", () => {
		const el = mount(list());
		assert.match(el.textContent ?? "", /Recent/);
		const rows = [...el.querySelectorAll("[data-testid='halley-recent-row']")];
		assert.equal(rows.length, 2);
		assert.match(rows[0]!.textContent ?? "", /Added Lab 4CSE 29/);
		assert.match(rows[0]!.querySelector("[data-testid='halley-recent-time']")?.textContent ?? "", /^(Oct 2[89]|\d+ (min|hours?|days)|yesterday)$/);
		assert.ok(rows[0]!.querySelector("svg"), "arrow");
		assert.equal(rows[1]!.querySelector("svg"), null);
		assert.equal(rows[1]!.hasAttribute("disabled"), true, "a page that isn't the app's is never followed");
	});
	it("Recent lists every row the server sent, scrolling inside the tab", () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ ...ACTIONS[0]!, id: `a${i}` }));
		const el = mount(list({ recent: many }));
		assert.equal(el.querySelectorAll("[data-testid='halley-recent-row']").length, 12);
		assert.match(el.querySelector("[data-testid='halley-activity']")?.className ?? "", /overflow-y-auto/);
	});
	it("clicking a Recent row goes there", () => {
		const picked: string[] = [];
		const el = mount(list({ onPick: (a) => picked.push(a.id) }));
		act(() => (el.querySelector("[data-testid='halley-recent-row']") as HTMLElement).click());
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
		assert.equal(el.querySelector("[data-testid='activity-blob-detail']"), null);
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
