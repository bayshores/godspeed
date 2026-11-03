/**
 * The teacher's screens: the face (one svg, every
 * mood, plain black eyes), the panel (head, the Talk and Activity tabs:
 * Now, Recent, Background jobs), the Follow chip, the teacher name setting, and the
 * sidebar footer opening the panel instead of the old popup.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { AgentAction } from "../src/core/events.ts";

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
	// The Follow chip measures its content; linkedom has no layout.
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
});
// The Talk thread scrolls to its end.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const { HalleyFace } = await import("../src/components/halley/halley-face.tsx");
const { HALLEY_MOODS } = await import("../src/components/halley/mood.ts");
const { HalleyPanel, agentLine } = await import("../src/components/halley/halley-panel.tsx");
const { dockPush, dockWidth } = await import("../src/components/halley/dock-model.ts");
const { clearOfDock } = await import("../src/components/halley/geometry.ts");
const { startsTurn } = await import("../src/components/halley/talk-model.ts");
const { askTeacher, useAskTeacher } = await import("../src/components/halley/ask-teacher.ts");
const { FollowChipView } = await import("../src/components/halley/follow-chip.tsx");
const { waitingNotice } = await import("../src/components/agent-status.tsx");
const { ActivitySection } = await import("../src/components/activity-dock.tsx");
const { DEFAULT_TEACHER_NAME, sanitizeTeacherName, sanitizeUserSettings, TEACHER_NAME_MAX } = await import("../src/core/settings.ts");
const { parseGeneralSettingsBody } = await import("../src/server/settings-body.ts");
const { ServerEventsProvider } = await import("../src/components/server-events.tsx");
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

describe("the face", () => {
	it("one svg with every mood; the dot is #F2F2F2 and the eyes plain black", () => {
		const html = renderToStaticMarkup(<HalleyFace mood="idle" />);
		assert.match(html, /data-mood="idle"/);
		assert.match(html, /fill="#F2F2F2"/);
		for (const mood of HALLEY_MOODS) {
			if (mood === "talking") continue; // talking reuses the idle eyes plus the mouth
			assert.ok(html.includes(`hy-m-${mood}`), mood);
		}
		assert.doesNotMatch(html, /fill="#fff"|fill="white"/i, "no white highlights in the eyes");
	});
	it("a still copy has no motion", () => {
		assert.match(renderToStaticMarkup(<HalleyFace mood="sleepy" still />), /hy-still/);
	});
});

describe("the panel", () => {
	const panel = (over: Partial<React.ComponentProps<typeof HalleyPanel>> = {}) => (
		<HalleyPanel
			name="Halley"
			agent={{ connected: true, teaching: true, name: "Claude Code", pendingWork: 0, claimedLessons: [] }}
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
	/** Types like the learner: React's own change handler (this file loads
	 *  react-dom before the DOM exists, so input events don't reach it). */
	const typeIn = (field: HTMLTextAreaElement, value: string) => {
		const props = Object.entries(field).find(([k]) => k.startsWith("__reactProps"))?.[1] as { onChange: (e: unknown) => void };
		props.onChange({ target: { value } });
	};
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
		assert.match(html, /data-testid="halley-panel"[^>]*class="[^"]*fixed top-0 right-0 bottom-0[^"]*border-l[^"]*bg-panel/);
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
		assert.equal(button?.getAttribute("aria-label"), "Add pictures or PDFs");
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
		assert.equal((busy.querySelector("textarea") as HTMLTextAreaElement).value, "Check again");
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
			const box = () => el.querySelector("[data-testid='talk-box'] textarea") as HTMLTextAreaElement;
			await act(async () => typeIn(box(), "add my lab"));
			await act(async () => {
				const paste = new window.Event("paste", { bubbles: true });
				Object.defineProperty(paste, "clipboardData", { value: { files: [new File(["x"], "lab.png", { type: "image/png" })] } });
				box().dispatchEvent(paste);
			});
			await settle();
			assert.ok(el.querySelector("[data-testid='draft-image']"));
			assert.match(store.get("lh:lesson-draft:chat_talk") ?? "", /"composer":"add my lab"/);

			act(() => (el.querySelector("[data-testid='halley-tab-activity']") as HTMLElement).click());
			act(() => (el.querySelector("[data-testid='halley-tab-talk']") as HTMLElement).click());
			await settle();
			assert.equal(box().value, "add my lab");
			assert.ok(el.querySelector("[data-testid='draft-image']"), "the picture still waits");
			act(() => (el.querySelector("[aria-label='Remove lab.png']") as HTMLElement).click());
		} finally {
			delete g.localStorage;
			delete g.FileReader;
			talkChat = null;
		}
	});
	it("the agent line matches the footer, and shows the waiting notice while work waits", () => {
		const idle = { connected: false, teaching: false, pendingWork: 0, claimedLessons: [] };
		assert.equal(agentLine(idle), "No agent connected");
		assert.equal(agentLine(null), "No agent connected");
		assert.equal(agentLine({ ...idle, connected: true, name: "Codex" }), "Codex connected, not teaching");
		assert.equal(agentLine({ ...idle, connected: true, name: "Codex", pendingWork: 1 }), waitingNotice("Codex"));
		assert.ok(renderToStaticMarkup(panel({ agent: { ...idle, pendingWork: 2 } })).includes(waitingNotice()));
	});
	it("a Talk message no agent has taken says it waits once, in the head", async () => {
		talkChat = { id: "chat_talk", turnInFlight: true, messages: [{ id: "u1", role: "user", content: "add my midterm", timestamp: 1 }] };
		const el = mount(panel({ agent: { connected: false, teaching: false, pendingWork: 1, claimedLessons: [] } }));
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
	it("the teacher rests left of the open panel", () => {
		const area = { left: 256, top: 0, width: 1184, height: 900 };
		assert.deepEqual(clearOfDock(area, 1040), { left: 256, top: 0, width: 784, height: 900 });
		assert.equal(clearOfDock({ ...area, width: 600 }, 1040).width, 600, "already clear");
		assert.equal(clearOfDock(area, 0).width, 0);
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

describe("the Follow chip", () => {
	const reading = { text: "Reading 06_Counting.pdf", count: "3 of 12", working: true };
	it("following: dark, 'Following <name>', what it's doing, and Stop", () => {
		const follows: boolean[] = [];
		const el = mount(<FollowChipView following name="Halley" doing={reading} onFollow={(on) => follows.push(on)} offer={null} onGo={() => {}} />);
		const chip = el.querySelector("[data-testid='follow-chip']")!;
		assert.match(chip.className, /bg-ink/);
		assert.match(chip.textContent ?? "", /^Following HalleyReading 06_Counting\.pdf3 of 12Stop/);
		assert.match(chip.querySelector("[data-testid='follow-doing'] .font-mono")!.className, /tabular-nums/, "counts don't jitter");
		assert.ok(chip.querySelector("[data-working]")?.className.includes("lh-breathe"), "the dot breathes while it works");
		assert.equal(el.querySelector("[data-testid='follow-stop']")?.getAttribute("aria-label"), "Stop following Halley");
		act(() => (el.querySelector("[data-testid='follow-stop']") as HTMLElement).click());
		assert.deepEqual(follows, [false]);
	});
	it("idle: the dot is still", () => {
		const html = renderToStaticMarkup(<FollowChipView following name="Halley" doing={{ text: "Idle", working: false }} onFollow={() => {}} offer={null} onGo={() => {}} />);
		assert.match(html, />Idle</);
		assert.doesNotMatch(html, /lh-breathe/);
	});
	it("a new line lifts the old one out", () => {
		const el = mount(<FollowChipView following name="Halley" doing={reading} onFollow={() => {}} offer={null} onGo={() => {}} />);
		act(() => root!.render(inEvents(<FollowChipView following name="Halley" doing={{ text: "Adding HW 5", working: true }} onFollow={() => {}} offer={null} onGo={() => {}} />)));
		assert.equal(el.querySelector(".lh-swap-out")?.textContent, "Reading 06_Counting.pdf");
		assert.equal(el.querySelector("[data-testid='follow-doing'] .lh-swap-in")?.textContent, "Adding HW 5");
	});
	it("screen readers hear the line in a polite live region", () => {
		const html = renderToStaticMarkup(<FollowChipView following={false} name="Halley" doing={reading} onFollow={() => {}} offer={null} onGo={() => {}} />);
		assert.match(html, /aria-live="polite"[^>]*>Halley: Reading 06_Counting\.pdf</);
	});
	it("not following: a quiet 'Follow <name>' button turns it on", () => {
		const follows: boolean[] = [];
		const el = mount(<FollowChipView following={false} name="Halley" doing={reading} onFollow={(on) => follows.push(on)} offer={null} onGo={() => {}} />);
		assert.doesNotMatch(el.querySelector("[data-testid='follow-off']")!.className, /bg-ink/);
		assert.equal(el.querySelector("[data-testid='follow-start']")?.textContent, "Follow Halley");
		act(() => (el.querySelector("[data-testid='follow-start']") as HTMLElement).click());
		assert.deepEqual(follows, [true]);
	});
	it("with Follow off, a change on another page offers 'Go to'", () => {
		const offer: AgentAction = { id: "act_1", at: new Date().toISOString(), agent: "Claude Code", label: "Starting CSE 29 review", classId: null, target: null, page: "/chat/c1" };
		const went: AgentAction[] = [];
		const el = mount(<FollowChipView following={false} name="Halley" doing={reading} onFollow={() => {}} offer={offer} onGo={(a) => went.push(a)} />);
		assert.match(el.querySelector("[data-testid='follow-offer']")?.textContent ?? "", /^Starting CSE 29 reviewGo to lesson$/);
		act(() => (el.querySelector("[data-testid='follow-go']") as HTMLElement).click());
		assert.deepEqual(went, [offer]);
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
