/**
 * The teacher's screens: the face (one svg, every
 * mood, plain black eyes), the panel (head, the Talk and Activity tabs:
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

const { TeacherSprite } = await import("../../src/frontend/components/halley/teacher-sprite.tsx");
const { HALLEY_MOODS } = await import("../../src/frontend/components/halley/mood.ts");
const { HalleyPanel, agentLine } = await import("../../src/frontend/components/halley/halley-panel.tsx");
const { dockPush, dockWidth } = await import("../../src/frontend/components/halley/dock-model.ts");
const { draftWithAsk, startsTurn } = await import("../../src/frontend/components/halley/talk-model.ts");
const { askTeacher, useAskTeacher } = await import("../../src/frontend/components/halley/ask-teacher.ts");
const { waitingNotice } = await import("../../src/frontend/components/agent-status.tsx");
const { ActivitySection } = await import("../../src/frontend/components/activity-dock.tsx");
const { DEFAULT_TEACHER_NAME, sanitizeTeacherName, sanitizeUserSettings, TEACHER_NAME_MAX } = await import("../../src/shared/core/settings.ts");
const { parseGeneralSettingsBody } = await import("../../src/backend/server/settings-body.ts");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
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
	{ id: "a2", at: "2026-10-28T23:11:00.000Z", agent: "Claude Code", label: "Adding Lab 4", classId: "cls_29", target: { kind: "deadline", id: "d4" }, page: "/" },
	{ id: "a1", at: "2026-10-28T22:52:00.000Z", agent: "Claude Code", label: "Reading notes", classId: null, target: null, page: "javascript:alert(1)" },
];
const names = (id: string | null) => (id === "cls_29" ? "CSE 29" : null);

describe("the mascot", () => {
	it("a pixel picture on a 10×13 grid, with a face for every mood", () => {
		const html = renderToStaticMarkup(<TeacherSprite mood="thinking" />);
		assert.match(html, /viewBox="0 0 10 13"/);
		assert.match(html, /shape-rendering="crispEdges"/);
		assert.match(html, /fill="#F2F4FF"/, "the white body");
		assert.match(html, /fill="#2A3270"/, "the cap");
		const faces = Object.fromEntries(HALLEY_MOODS.map((m) => [m, /data-face="(\w+)"/.exec(renderToStaticMarkup(<TeacherSprite mood={m} />))?.[1]]));
		assert.deepEqual(faces, { idle: "idle", talking: "reading", thinking: "thinking", happy: "happy", oops: "oops", shocked: "oops", dizzy: "oops", sleepy: "blink" });
	});
	it("only the idle face blinks", () => {
		assert.match(renderToStaticMarkup(<TeacherSprite mood="idle" />), /lh-sprite-blink/);
		assert.doesNotMatch(renderToStaticMarkup(<TeacherSprite mood="happy" />), /lh-sprite-blink/);
	});
});

describe("the panel", () => {
	const panel = (over: Partial<React.ComponentProps<typeof HalleyPanel>> = {}) => (
		<HalleyPanel
			name="Halley"
			agent={{ connected: true, teaching: true, name: "Claude Code", backupConnected: false, backupAnswering: false, pendingWork: 0, claimedLessons: [] }}
			onClose={() => {}}
			doing={{ text: "Reading syllabus.pdf", count: "2 of 5", working: true }}
			recent={ACTIONS}
			onPick={() => {}}
			classNameOf={names}
			jobs={<div data-testid="jobs-slot" />}
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
	const onActivity = (over: Parameters<typeof panel>[0] = {}) => {
		const el = mount(panel(over));
		act(() => (el.querySelector("[data-testid='halley-tab-activity']") as HTMLElement).click());
		return el;
	};

	it("opens on Talk, which opens the chat; Activity is the other tab", () => {
		talkCalls.length = 0;
		const el = mount(panel());
		assert.equal(el.querySelector("[data-testid='halley-tab-talk']")?.getAttribute("aria-selected"), "true");
		assert.deepEqual(talkCalls, ["POST /api/talk"]);
		assert.equal(el.querySelector("[data-testid='halley-recent']"), null);
		act(() => (el.querySelector("[data-testid='halley-tab-activity']") as HTMLElement).click());
		assert.equal(el.querySelector("[data-testid='halley-tab-activity']")?.getAttribute("aria-selected"), "true");
		assert.ok(el.querySelector("[data-testid='halley-recent']"));
	});
	it("in a lesson, Talk hides: the lesson's own box talks to the teacher", () => {
		talkCalls.length = 0;
		const el = mount(panel({ inLesson: true }));
		assert.equal(el.querySelector("[data-testid='halley-tab-talk']"), null);
		assert.equal(el.querySelector("[role='tablist']"), null);
		assert.ok(el.querySelector("[data-testid='halley-recent']"), "Activity shows");
		assert.deepEqual(talkCalls, [], "no Talk chat opens");
	});
	it("head: the name, the agent and a close button (Follow is the top bar's chip)", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="halley-panel-name"[^>]*>Halley</);
		assert.match(html, /data-testid="halley-panel-agent"[^>]*>Claude Code</);
		assert.doesNotMatch(html, /role="switch"/);
		const closes: number[] = [];
		const el = mount(panel({ onClose: () => closes.push(1) }));
		act(() => (el.querySelector("[data-testid='halley-close']") as HTMLElement).click());
		assert.deepEqual(closes, [1]);
	});
	it("docks on the right edge as a solid panel with no blur", () => {
		const html = renderToStaticMarkup(panel());
		assert.match(html, /data-testid="halley-panel"[^>]*class="[^"]*fixed top-12 right-0 bottom-0[^"]*border-l[^"]*bg-panel/);
		assert.doesNotMatch(html, /lh-popup|rounded|blur/);
	});
	it("Talk reads like a script: the speaker's name once per turn, no bubbles, a white Send bar", async () => {
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
		assert.deepEqual(who, ["You", ""]);
		assert.equal(el.querySelector("[data-testid='talk-you']")?.className.includes("bg-"), false, "no bubbles");
		assert.ok(el.querySelector("[data-testid='talk-send']"));
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
		assert.ok(box.innerHTML.indexOf('data-testid="attach-button"') < box.innerHTML.indexOf('data-testid="talk-send"'), "beside Send, before it");
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
	it("the agent line is empty with no agent, and shows the waiting notice while work waits", () => {
		const idle = { connected: false, teaching: false, backupConnected: false, backupAnswering: false, pendingWork: 0, claimedLessons: [] };
		assert.equal(agentLine(idle), null);
		assert.equal(agentLine(null), null);
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
	it("Now shows what it is doing, and hides while it is idle", () => {
		assert.match(onActivity().querySelector("[data-testid='halley-now']")?.textContent ?? "", /^Reading syllabus\.pdf2 of 5$/);
		act(() => root?.unmount());
		assert.equal(onActivity({ doing: { text: "Idle", working: false } }).querySelector("[data-testid='halley-now']"), null);
	});
	it("with nothing in it, Activity says what will show there", () => {
		const el = onActivity({ doing: { text: "Idle", working: false }, recent: [], jobs: undefined });
		assert.equal(el.querySelector("[data-testid='halley-activity-empty']")?.textContent, "Nothing yet. What Halley reads and builds shows here.");
		act(() => root?.unmount());
		assert.equal(onActivity().querySelector("[data-testid='halley-activity-empty']"), null);
	});
	it("Recent hides when there is nothing yet", () => {
		assert.equal(onActivity({ recent: [] }).querySelector("[data-testid='halley-recent']"), null);
	});
	it("Recent: time, label, class, and an arrow only where it can go", () => {
		const el = onActivity();
		const rows = [...el.querySelectorAll("[data-testid='halley-recent-row']")];
		assert.equal(rows.length, 2);
		assert.match(rows[0]!.textContent ?? "", /Added Lab 4CSE 29/);
		assert.match(rows[0]!.querySelector(".font-mono")?.textContent ?? "", /^\d{1,2}:\d{2} (AM|PM)$/);
		assert.ok(rows[0]!.querySelector("svg"), "arrow");
		assert.equal(rows[1]!.hasAttribute("disabled"), true, "a page that isn't the app's is never followed");
	});
	it("Recent shows at most 8 rows", () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ ...ACTIONS[0]!, id: `a${i}` }));
		const el = onActivity({ recent: many });
		assert.equal(el.querySelectorAll("[data-testid='halley-recent-row']").length, 8);
	});
	it("clicking a Recent row goes there", () => {
		const picked: string[] = [];
		const el = onActivity({ onPick: (a) => picked.push(a.id) });
		act(() => (el.querySelector("[data-testid='halley-recent-row']") as HTMLElement).click());
		assert.deepEqual(picked, ["a2"]);
	});
	it("Background jobs live in the panel", () => {
		assert.ok(onActivity().querySelector("[data-testid='jobs-slot']"));
		const jobs = renderToStaticMarkup(<ActivitySection feed={{ jobs: [], extractions: [], failed: [{ id: "j1", kind: "pdf", chatId: "c1", title: "06_Counting.pdf", error: "The PDF could not be read", at: "2026-10-28T16:00:00Z" }] }} />);
		assert.match(jobs, /Background jobs/);
		assert.match(jobs, /data-testid="activity-failed"/);
		assert.match(jobs, /Failed: The PDF could not be read/);
	});
	it("is 400 wide, as wide as a wider Your turn panel to cover it, and the whole window when narrow", () => {
		assert.equal(dockWidth(1440, null), 400);
		assert.equal(dockWidth(1440, 520), 520);
		assert.equal(dockWidth(1440, 340), 400);
		assert.equal(dockWidth(600, null), 600);
		assert.equal(dockWidth(1000, 1000), 400, "a stacked Your turn panel (narrow window) isn't covered");
	});
	it("pushes the page left by the part not over the Your turn panel", () => {
		assert.equal(dockPush(1440, 1184, null), 400);
		assert.equal(dockPush(1440, 1184, 520), 0, "a wider Your turn panel is covered, no push");
		assert.equal(dockPush(1440, 1184, 340), 60);
		assert.equal(dockPush(600, 600, null), 0, "the whole window: no push");
		assert.equal(dockPush(1000, 1000, null), 400);
		assert.equal(dockPush(800, 544, null), 0, "a page too narrow to push is covered instead");
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
	it("PUT general: a string is cleaned, '' clears it, anything else is refused", () => {
		const ok = parseGeneralSettingsBody({ teacherName: "  Nova\n" });
		assert.ok(ok.ok && ok.settings.teacherName === "Nova");
		const cleared = parseGeneralSettingsBody({ teacherName: "" });
		assert.ok(cleared.ok && !("teacherName" in cleared.settings));
		const bad = parseGeneralSettingsBody({ teacherName: 7 });
		assert.ok(!bad.ok && /teacherName/.test(bad.error));
	});
});
