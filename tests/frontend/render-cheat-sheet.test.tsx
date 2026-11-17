/**
 * The cheat sheet's screens: the studio's status (the paper), the
 * older-sheet notice, the sheet's chat (its rules, the learner's messages
 * with what they pointed at, the agent's answers with "Made version N" and
 * saved rules, the working and failed lines; a terminal line sent with the
 * part pointed at, a refused one passed on, Stop, Try again, removing a rule),
 * the canvas (each version's pages as labeled artboards, the narrow layout,
 * the toolbar with Point at the sheet), the lesson top
 * bar's Cheat sheet button, and the sheet beside a session (which sheet,
 * the picker, No cheat sheet yet with Make one).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { parseHTML } from "linkedom";
import { stubCodeMirrorDom } from "../math-box-dom.ts";
import { newCheatSheet } from "../cheat-sheet-fixture.ts";
import { SELECT } from "../../src/frontend/components/ui/field.ts";
import { type CheatSheetView, type SpaceSheetsView, type SheetCard, type SheetVersion } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
stubCodeMirrorDom(dom);
const store = new Map<string, string>();
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
	ResizeObserver: class {
		observe() {}
		disconnect() {}
	},
	localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
});
// The chat scrolls to its end.
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

const { OlderSheet, emptyChatLine, sheetPaper, versionLabel } = await import("../../src/frontend/components/cheat-sheet/studio-states.tsx");
const { SheetChat, pointedLabel } = await import("../../src/frontend/components/cheat-sheet/sheet-chat.tsx");
const { SheetCanvas } = await import("../../src/frontend/components/cheat-sheet/sheet-canvas.tsx");
const { SheetDock } = await import("../../src/frontend/components/cheat-sheet/sheet-dock.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
// The window's events: a test sends one by name.
const listeners = new Map<string, (data: string) => void>();
const noEvents = () => ({ onEvent: (name: string, cb: (data: string) => void) => void listeners.set(name, cb), onOpen() {}, close() {} });
const sendEvent = (name: string, payload: unknown) => act(async () => listeners.get(name)?.(JSON.stringify(payload)));
const inEvents = (node: React.ReactNode) => <ServerEventsProvider connect={noEvents as never}>{node}</ServerEventsProvider>;

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(() => {
	act(() => root?.unmount());
	host?.remove();
	host = root = null;
	store.clear();
});
function mount(node: React.ReactNode): HTMLElement {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	act(() => root!.render(<MemoryRouter initialEntries={["/chat/ses_1"]}>{inEvents(node)}</MemoryRouter>));
	return host;
}
const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const click = (el: Element | null) => act(() => (el as HTMLElement).click());

const A4 = { widthPt: 595.28, heightPt: 841.89 };
const versions: SheetVersion[] = [
	{ n: 1, prompt: "A4", at: "2026-11-03T10:00:00.000Z", pages: [A4] },
	{ n: 2, prompt: "double sided, and a flowchart", at: "2026-11-03T11:00:00.000Z", pages: [A4, A4] },
];

const view = (over: Partial<CheatSheetView> = {}): CheatSheetView => ({
	spaceName: "CSE 21",
	deadlineName: "Midterm",
	date: "2026-11-04",
	sheet: newCheatSheet("ddl_1", "t"),
	running: null,
	error: null,
	...over,
});

describe("the studio's status", () => {
	it("names the newest version's paper", () => {
		assert.equal(sheetPaper(view()), "Not made yet");
		assert.equal(sheetPaper(view({ sheet: { ...newCheatSheet("ddl_1", "t"), versions } })), "A4, front and back");
	});

	it("says an older sheet can't be shown, with one button to make it again", () => {
		assert.match(renderToStaticMarkup(<OlderSheet onRemake={() => {}} />), /made by an older godspeed.*data-testid="cheat-sheet-remake"[^>]*>Make it again/);
	});

	it("labels each version by what made it, and an empty chat by whether there is a sheet", () => {
		assert.match(versionLabel(versions[1]!, true), /^Current, double sided, and a flowchart$/);
		assert.match(versionLabel({ ...versions[1]!, fromFolder: true }, false), /^Nov 3, .*, From the working folder$/);
		assert.match(emptyChatLine("Claude Code", false), /^Tell Claude Code in the terminal what you want on it.*Claude Code reads the rules in your space info files/);
		assert.match(emptyChatLine("Claude Code", true), /^Ask Claude Code in the terminal .*point at a part that confuses you/);
	});
});

const chatView = view({
	sheet: {
		...newCheatSheet("ddl_1", "t"),
		versions,
		rules: [{ text: "American spelling", at: "t" }],
		messages: [
			{ id: "m1", role: "you", text: "this card is confusing", at: "t", region: { n: 2, page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, files: [{ name: "Version 2, Back.png", file: "abc-Version 2, Back.png" }, { name: "notes.pdf", file: "def-notes.pdf" }] },
			{ id: "m2", role: "agent", text: "I split **card 8** into two routes: $n!$ and $\\binom{n}{k}$.", at: "t", version: 2, rules: ["American spelling"] },
			{ id: "m3", role: "you", text: "according to the cheat sheet that's what I did", at: "t" },
		],
	},
});

describe("the sheet's chat", () => {
	const render = (v: CheatSheetView, over: Partial<React.ComponentProps<typeof SheetChat>> = {}) =>
		renderToStaticMarkup(
			inEvents(<SheetChat view={v} spaceId="cls_1" deadlineId="ddl_1" act={async () => null} agentName="Claude Code" agentGone={false} pointed={null} onClearPointed={() => {}} empty="Say what you want on it." {...over} />),
		);

	it("shows the sheet's rules, the learner's messages with what they pointed at and their files, and the agent's answers", () => {
		const html = render(chatView, { onShowVersion: () => {} });
		assert.match(html, /This sheet&#x27;s rules \(1\).*American spelling.*Saved by Claude Code.*aria-label="Remove rule: American spelling"/);
		assert.match(html, /data-testid="sheet-you"[^>]*>this card is confusing/);
		assert.match(html, /data-testid="sheet-pointed"[^>]*>.*Pointed at the back of version 2/);
		assert.match(html, /data-testid="sheet-picture" src="\/api\/spaces\/cls_1\/deadlines\/ddl_1\/cheat-sheet\/files\/abc-Version%202%2C%20Back\.png"/);
		assert.match(html, /data-testid="sheet-file".*notes\.pdf/);
		assert.match(html, /data-testid="sheet-agent".*<strong[^>]*>card 8<\/strong>/);
		assert.match(html, /data-testid="sheet-made"[^>]*>.*Made version 2, the sheet now.*Show/);
		assert.match(html, /Saved a rule for this sheet: .*American spelling/);
		assert.doesNotMatch(html, /sheet-send|math-box/, "the learner writes in the terminal");
		assert.match(render(view()),/data-testid="sheet-chat-empty"[^>]*>Say what you want on it\./);
		assert.doesNotMatch(render(view(), { empty: undefined }), /sheet-chat-empty/, "the studio says it on the canvas instead");
	});

	it("says the agent is on a message or waiting for one, why one failed with Try again, and shows Stop while it works", () => {
		const working = render({ ...chatView, running: { messageId: "m3" } });
		assert.match(working, /according to the cheat sheet.*Claude Code is on it/);
		assert.match(working, /Claude Code is on it<\/span><button[^>]*data-testid="sheet-stop"[^>]*>Stop</, "Stop beside the working line");
		assert.match(render({ ...chatView, running: { messageId: "m3" } }, { agentGone: true }), />Waiting</);
		const failed = render({ ...chatView, error: { messageId: "m3", text: "the agent never answered" } });
		assert.match(failed, /according to the cheat sheet.*Claude Code couldn&#x27;t finish that\..*the agent never answered.*Try again/);
	});

	it("names the part pointed at", () => {
		assert.equal(pointedLabel({ n: 2, page: 1, x: 0, y: 0, w: 1, h: 1 }, 2), "the front of version 2");
		assert.equal(pointedLabel({ n: 3, page: 3, x: 0, y: 0, w: 1, h: 1 }, 4), "page 3 of version 3");
		const pointed = { region: { n: 2, page: 2, x: 0, y: 0, w: 1, h: 1 }, picture: { name: "p.png", mimeType: "image/png", data: "QUJD" } };
		const html = render(chatView, { pointed });
		assert.match(html, /data-testid="sheet-pointed-chip".*src="data:image\/png;base64,QUJD".*Pointing at the back of version 2/);
	});

	it("a line from the terminal is sent with the part pointed at first; a refused one goes on to the agent", async () => {
		const posted: Record<string, unknown>[] = [];
		const confirmed: { url: string; body: unknown }[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string, init?: RequestInit) => {
			confirmed.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
			return Response.json({});
		}) as typeof fetch;
		let answer: string | null = "The teacher is still answering your last message about this sheet.";
		let cleared = 0;
		const pointed = { region: { n: 2, page: 2, x: 0.1, y: 0.2, w: 0.3, h: 0.1 }, picture: { name: "Version 2, Back.png", mimeType: "image/png", data: "QUJD" } };
		const act_ = async (body: Record<string, unknown>) => {
			posted.push(body);
			return answer;
		};
		try {
			const el = mount(<SheetChat view={chatView} spaceId="cls_1" deadlineId="ddl_1" act={act_} agentName="Claude Code" agentGone={false} pointed={pointed} onClearPointed={() => cleared++} empty="" />);
			await settle();
			assert.deepEqual(confirmed.at(-1), { url: "/api/talk-page", body: { page: "cheat sheet", path: null, space: null } }, "the page says it takes lines");
			const picture = { name: "graph.png", mimeType: "image/png", data: "R1JB" };
			await sendEvent("terminal-line", { id: 7, text: "that's what I did ", attachments: [picture] });
			await settle();
			assert.deepEqual(posted[0], { action: "ask", text: "that's what I did", attachments: [pointed.picture, picture], region: pointed.region });
			assert.match(el.innerHTML, /role="alert"[^>]*>The teacher is still answering/);
			assert.deepEqual(confirmed.at(-1), { url: "/api/terminal-lines/7", body: { sent: false } });
			assert.equal(cleared, 0);
			answer = null;
			await sendEvent("terminal-line", { id: 8, text: "again", attachments: [] });
			await settle();
			assert.deepEqual(confirmed.at(-1), { url: "/api/terminal-lines/8", body: { sent: true } });
			assert.equal(cleared, 1, "the part pointed at went with it");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("while the agent works on the sheet a line goes on to the agent", async () => {
		const posted: Record<string, unknown>[] = [];
		const confirmed: unknown[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = (async (_url: string, init?: RequestInit) => (confirmed.push(init?.body ? JSON.parse(String(init.body)) : null), Response.json({}))) as typeof fetch;
		try {
			mount(<SheetChat view={{ ...chatView, running: { messageId: "m3" } }} spaceId="cls_1" deadlineId="ddl_1" act={async (b) => (posted.push(b), null)} agentName="Claude Code" agentGone={false} pointed={null} onClearPointed={() => {}} empty="" />);
			await settle();
			await sendEvent("terminal-line", { id: 9, text: "hurry", attachments: [] });
			await settle();
			assert.equal(posted.length, 0);
			assert.deepEqual(confirmed.at(-1), { sent: false });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("removes rules and shows a version", async () => {
		const posted: Record<string, unknown>[] = [];
		const shown: number[] = [];
		const el = mount(
			<SheetChat view={chatView} spaceId="cls_1" deadlineId="ddl_1" act={async (b) => (posted.push(b), null)} agentName="Claude Code" agentGone={false} pointed={null} onClearPointed={() => {}} onShowVersion={(n) => shown.push(n)} empty="" />,
		);
		await click(el.querySelector("[aria-label='Remove rule: American spelling']"));
		await click(el.querySelector("[data-testid='sheet-made']"));
		assert.deepEqual(posted.at(-1), { action: "remove-rule", text: "American spelling" });
		assert.deepEqual(shown, [2]);
	});

	it("Stop and Try again post their actions", async () => {
		const posted: Record<string, unknown>[] = [];
		const act_ = async (body: Record<string, unknown>) => (posted.push(body), null);
		const props = { spaceId: "cls_1", deadlineId: "ddl_2", act: act_, agentName: "Claude Code", agentGone: false, pointed: null, onClearPointed: () => {}, empty: "" };
		const el = mount(<SheetChat view={{ ...chatView, running: { messageId: "m3" } }} {...props} />);
		await click(el.querySelector("[data-testid='sheet-stop']"));
		act(() => root!.render(inEvents(<SheetChat view={{ ...chatView, error: { messageId: "m3", text: "x" } }} {...props} />)));
		await click(el.querySelector("[data-testid='sheet-retry']"));
		assert.deepEqual(posted, [{ action: "stop" }, { action: "retry" }]);
	});
});

describe("the canvas", () => {
	const html = renderToStaticMarkup(<SheetCanvas versions={versions} pdfUrl={(n) => `/pdf/${n}`} labelFor={(v, newest) => `${newest ? "Current" : "Earlier"}, ${v.prompt}`} onPoint={() => {}} />);

	it("puts every version's pages on the canvas at their size, newest first, each labeled", () => {
		const pages = html.match(/data-testid="cheat-sheet-page"[^>]*style="[^"]*"/g)!;
		assert.equal(pages.length, 3);
		assert.match(pages[0]!, /left:0;top:0;width:793\.7\d*px;height:1122\.5\d*px/);
		assert.match(pages[1]!, /left:841\.7\d*px/);
		const labels = [...html.matchAll(/data-testid="cheat-sheet-version"[^>]*>([^<]*)</g)].map((m) => m[1]);
		assert.deepEqual(labels, ["Current, double sided, and a flowchart", "Earlier, A4"]);
		assert.match(html, />Front<\/p>.*>Back<\/p>.*>Page 1<\/p>/);
	});

	it("has zoom out, the zoom (back to 100%), zoom in, Zoom to fit and Point at the sheet, all clickable", () => {
		const bar = /data-testid="cheat-sheet-zoom"[\s\S]*$/.exec(html)![0];
		assert.deepEqual([...bar.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]), ["Zoom out", "Zoom to 100%", "Zoom in", "Zoom to fit"]);
		assert.match(bar, />100%</);
		assert.match(bar, /data-testid="cheat-sheet-point" aria-pressed="false"[^>]*>.*Point at the sheet/);
		assert.doesNotMatch(renderToStaticMarkup(<SheetCanvas versions={versions} pdfUrl={(n) => `/pdf/${n}`} labelFor={() => ""} />), /cheat-sheet-point/, "only where a message can take it");
	});

	it("beside a session, puts a version's pages one under another", () => {
		const narrow = renderToStaticMarkup(<SheetCanvas versions={[versions[1]!]} pdfUrl={(n) => `/pdf/${n}`} labelFor={() => "Current"} narrow />);
		const pages = narrow.match(/data-testid="cheat-sheet-page"[^>]*style="[^"]*"/g)!;
		assert.match(pages[1]!, /left:0;top:1170\.5\d*px/);
	});
});

describe("the cheat sheet beside a session", () => {
	const sheetCard = (deadlineId: string, name: string, version: SheetVersion | null, past = false): SheetCard => ({ deadlineId, name, kind: "exam", date: "2026-11-20", past, status: version ? "made" : "none", version });
	function serve(cards: SheetCard[], views: Record<string, CheatSheetView>) {
		const asked: string[] = [];
		(globalThis as Record<string, unknown>).fetch = async (url: string) => {
			asked.push(url);
			if (url.endsWith("/cheat-sheets")) return Response.json({ spaceName: "CSE 21", cards } satisfies SpaceSheetsView);
			const id = /deadlines\/([^/]+)\/cheat-sheet$/.exec(url)?.[1];
			return id && views[id] ? Response.json(views[id]) : new Response("{}", { status: 404 });
		};
		return asked;
	}
	const dock = (over: Partial<React.ComponentProps<typeof SheetDock>> = {}) => (
		<SheetDock spaceId="cls_1" sessionDeadlineId="ddl_mid" picked={undefined} onPick={() => {}} onClose={() => {}} {...over} />
	);

	it("shows the session's deadline's sheet without a chat, a picker when there are several, and the studio links", async () => {
		const picks: string[] = [];
		const asked = serve([sheetCard("ddl_quiz", "Quiz 3", versions[0]!), sheetCard("ddl_mid", "Midterm", versions[1]!)], { ddl_mid: view({ sheet: { ...newCheatSheet("ddl_mid", "t"), versions } }) });
		const el = mount(dock({ onPick: (id) => picks.push(id) }));
		await settle();
		assert.ok(asked.some((u) => u.endsWith("/deadlines/ddl_mid/cheat-sheet")), "the session's own deadline");
		const pick = el.querySelector<HTMLSelectElement>("[data-testid='sheet-dock-pick']")!;
		assert.deepEqual([...pick.querySelectorAll("option")].map((o) => o.textContent), ["Cheat sheet for Quiz 3", "Cheat sheet for Midterm"]);
		assert.equal(pick.className, SELECT, "drawn like every dropdown");
		assert.ok(el.querySelector("[data-testid='cheat-sheet-canvas']"));
		assert.ok(el.querySelector("[data-testid='sheet-chat']") === null);
		assert.match(el.querySelector("[data-testid='sheet-dock-studio']")!.textContent!, /Open full size/);
		assert.match(el.querySelector("[data-testid='sheet-dock-studio']")!.getAttribute("href")!, /\/space\/deadline\/ddl_mid\/cheat-sheet$/);
		assert.match(el.querySelector("[data-testid='sheet-dock-point']")!.getAttribute("href")!, /\/space\/deadline\/ddl_mid\/cheat-sheet$/);
		assert.match(el.querySelector("[data-testid='sheet-dock-close']")!.textContent!, /Close/);
		assert.ok(el.querySelector("[data-testid='cheat-sheet-zoom']"), "the zoom foot");
		await act(async () => (Object.entries(pick).find(([k]) => k.startsWith("__reactProps"))![1] as unknown as { onChange: (e: unknown) => void }).onChange({ target: { value: "ddl_quiz" } }));
		assert.deepEqual(picks, ["ddl_quiz"]);
	});

	it("says No cheat sheet yet with Make one, which leads to the studio for the session's deadline", async () => {
		const asked = serve([sheetCard("ddl_mid", "Midterm", null)], { ddl_mid: view() });
		const el = mount(dock());
		await settle();
		assert.match(el.querySelector("[data-testid='sheet-dock-none']")!.textContent!, /No cheat sheet yet\.Make one/);
		assert.match(el.querySelector("[data-testid='sheet-dock-make']")!.getAttribute("href")!, /\/space\/deadline\/ddl_mid\/cheat-sheet$/);
		assert.ok(el.querySelector("[data-testid='cheat-sheet-canvas']") === null);
		assert.ok(asked.every((u) => !u.endsWith("/deadlines/ddl_mid/cheat-sheet")), "nothing to load until the studio");
	});

	it("tells a space without deadlines to add one", async () => {
		serve([], {});
		const el = mount(dock({ sessionDeadlineId: undefined }));
		await settle();
		assert.match(el.querySelector("[data-testid='sheet-dock-none']")!.textContent!, /Add a deadline to this space to make one\./);
	});
});
