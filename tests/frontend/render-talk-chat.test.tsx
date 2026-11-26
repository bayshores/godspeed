/**
 * The teacher panel's chat: a new chat's "Try asking" and its Send, the writing row giving way on a
 * page with its own box, a chat's thread, the Chats list and the panel's head keys. The shared
 * thread is also drawn by the cheat sheet's chat (render-cheat-sheet.test.tsx).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { parseHTML } from "linkedom";
import { mathBoxView, stubCodeMirrorDom } from "../math-box-dom.ts";
import type { TalkChat } from "../../src/shared/core/index.ts";

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
	// The thread measures its scrolling room; linkedom has no layout.
	getComputedStyle: () => ({ paddingTop: "0", paddingBottom: "0" }),
	localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
});
(dom.window.Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
(dom.window.Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};

const { TalkChatView } = await import("../../src/frontend/components/teacher/talk-chat.tsx");
const { TeacherThread } = await import("../../src/frontend/components/teacher/teacher-thread.tsx");
const { PanelChats } = await import("../../src/frontend/components/teacher/panel-chats.tsx");
const { PanelHead } = await import("../../src/frontend/components/teacher/panel-head.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
import type { TeacherApi } from "../../src/frontend/components/teacher/teacher-context.ts";

const noEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

type Sent = { url: string; method: string; body: Record<string, unknown> | null };
let sent: Sent[] = [];
/** What POST /api/chats answers: a chat id, or a failure. */
let makeChat: "ok" | "fails" = "ok";
const MODELS = [
	{ id: "sonnet", name: "Sonnet 5.5", default: true },
	{ id: "opus", name: "Opus", default: false },
];
/** The read of the one chat that exists. */
const readChat = {
	messages: [
		{ id: "m1", role: "user", content: "What is a limit?", timestamp: 1 },
		{
			id: "m2",
			role: "assistant",
			content: [{ type: "text", text: "A limit is where a function heads." }],
			api: "faux",
			provider: "faux",
			model: "faux",
			usage: {},
			stopReason: "stop",
			timestamp: 2,
		},
	],
	turnInFlight: false,
	earlier: [
		{ role: "user", text: "Hello from before" },
		{ role: "assistant", text: "Welcome back." },
	],
};

const realFetch = globalThis.fetch;
beforeEach(() => {
	sent = [];
	makeChat = "ok";
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		sent.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
		if (url === "/api/agent/models") return Response.json({ agent: "claude", models: MODELS });
		if (url === "/api/chats" && init?.method === "POST") return makeChat === "ok" ? Response.json({ id: "chat_new" }) : new Response("down", { status: 500 });
		if (url === "/api/chats/chat_1") return Response.json(readChat);
		return Response.json({});
	}) as typeof fetch;
});

let host: HTMLElement | null = null;
let root: Root | null = null;
afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	host = root = null;
	globalThis.fetch = realFetch;
	store.clear();
});

const settle = () => act(() => new Promise((r) => setTimeout(r, 20)));
const q = (testid: string) => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
const all = (testid: string) => [...document.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
const click = async (el: Element | null) => {
	assert.ok(el, "the key shows");
	await act(async () => (el as HTMLElement).click());
	await settle();
};

/** Shows `node` on the page at `path`; again with another node, the same tree is kept. */
async function show(node: React.ReactNode, path = "/") {
	if (!root) {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
	}
	await act(async () =>
		root!.render(
			<MemoryRouter initialEntries={[path]}>
				<ServerEventsProvider connect={noEvents as never}>{node}</ServerEventsProvider>
			</MemoryRouter>,
		),
	);
	await settle();
}

type ChatProps = React.ComponentProps<typeof TalkChatView>;
const chat = (over: Partial<ChatProps> = {}) => <TalkChatView chatId={null} chat={null} onChat={() => {}} name="Ada" page={null} ask={null} focus={false} {...over} />;

/** The box's words are kept for the whole run, so a test that types leaves it empty. */
const typed = async (words: string) => {
	const box = await mathBoxView(document.body);
	await act(async () => box.dispatch({ changes: { from: 0, to: box.state.doc.length, insert: words } }));
	return box;
};
const empty = (box: Awaited<ReturnType<typeof mathBoxView>>) => act(async () => box.dispatch({ changes: { from: 0, to: box.state.doc.length, insert: "" } }));

describe("a new chat", () => {
	it("offers Try asking with lines for the page, the model key, and a Send that waits for words", async () => {
		await show(chat());
		assert.equal(q("talk-try")?.querySelector("h3")?.textContent, "Try asking");
		assert.deepEqual(
			all("talk-starter").map((row) => row.textContent),
			["Set up a space from my files", "Teach me a new topic", "Build me a path to a goal"],
		);
		assert.equal(q("talk-model")?.textContent, "Sonnet 5.5", "the agent's default model");
		const send = () => q("talk-send") as HTMLButtonElement;
		assert.equal(send().disabled, true, "nothing to send yet");
		const box = await typed("what is a limit");
		assert.equal(send().disabled, false);
		assert.match(send().className, /lh-btn-main/, "the bright key only with words in the box");
		await empty(box);
		assert.equal(send().disabled, true);
	});

	it("starts a chat with a row's line, and shows the chat once it is made", async () => {
		const shown: string[] = [];
		await show(chat({ onChat: (id) => shown.push(id) }));
		await click(all("talk-starter")[1]!);
		assert.deepEqual(sent.filter((r) => r.method === "POST").map((r) => [r.url, r.body]), [["/api/chats", { kind: "talk", text: "Teach me a new topic" }]]);
		assert.deepEqual(shown, ["chat_new"]);
	});

	it("a model picked before the chat is made goes with its first message", async () => {
		await show(chat());
		await click(q("talk-model"));
		await click(all("talk-model-choice").find((row) => row.textContent === "Opus") ?? null);
		assert.equal(q("talk-model")?.textContent, "Opus");
		await click(all("talk-starter")[0]!);
		assert.deepEqual(sent.filter((r) => r.method !== "GET").map((r) => [r.url, r.body]), [["/api/chats", { kind: "talk", text: "Set up a space from my files", model: "opus" }]]);
	});

	it("starts a chat with the box's words and clears the box; when it fails the words come back with a line saying so", async () => {
		const shown: string[] = [];
		await show(chat({ onChat: (id) => shown.push(id) }));
		const box = await typed("what is a limit");
		makeChat = "fails";
		await click(q("talk-send"));
		assert.equal(q("talk-error")?.textContent?.includes("Your message didn't go through."), true);
		assert.equal(q("talk-retry"), null, "Send is the way to try again");
		assert.equal(box.state.doc.toString(), "what is a limit", "the words are back in the box");
		assert.deepEqual(shown, []);
		makeChat = "ok";
		await click(q("talk-send"));
		assert.deepEqual(sent.filter((r) => r.method === "POST" && r.url === "/api/chats").at(-1)?.body, { kind: "talk", text: "what is a limit" });
		assert.equal(box.state.doc.toString(), "", "sent: the box is empty");
		assert.deepEqual(shown, ["chat_new"]);
	});

	it("the chat its first line makes keeps the writing row at rest, and Ideas fades in", async () => {
		function Panel() {
			const [id, setId] = React.useState<string | null>(null);
			return chat({ chatId: id, onChat: setId });
		}
		await show(<Panel />);
		await click(all("talk-starter")[0]!);
		assert.ok(q("teacher-thread"), "the chat is shown");
		assert.doesNotMatch(q("talk-writing")!.className, /lh-fade/, "the row does not fade out and in");
		assert.match(q("talk-ideas")!.className, /lh-fade/);
	});
});

describe("on a page with its own box", () => {
	it("the writing row is drawn at rest, and fades only as it swaps with the line", async () => {
		await show(chat());
		assert.doesNotMatch(q("talk-writing")!.className, /lh-fade/);
		await show(chat({ page: "lesson" }), "/chat/ses_1");
		assert.match(q("talk-gives-way")!.className, /lh-fade/);
		await show(chat());
		assert.match(q("talk-writing")!.className, /lh-fade/);
	});

	it("the lesson's page: the writing row is one line saying so, with no box and no Send", async () => {
		await show(chat({ page: "lesson" }), "/chat/ses_1");
		assert.equal(q("talk-gives-way")?.textContent, "Type in the lesson's box.");
		assert.equal(q("talk-writing"), null);
		assert.equal(q("talk-send"), null);
		assert.equal(q("math-box"), null);
		assert.equal(all("talk-starter").length, 0, "no lines to try: the page asks for itself");
	});

	it("the cheat sheet's page says so for its box", async () => {
		await show(chat({ page: "cheat sheet" }), "/space/deadline/ddl_1/cheat-sheet");
		assert.equal(q("talk-gives-way")?.textContent, "Type in the cheat sheet's box.");
		assert.equal(q("talk-send"), null);
		assert.equal(q("math-box"), null);
	});

	it("the words typed in the panel's box are kept while it gives way, and are back after", async () => {
		await show(chat());
		await typed("keep these");
		await show(chat({ page: "lesson" }), "/chat/ses_1");
		assert.equal(q("math-box"), null);
		await show(chat());
		const box = await mathBoxView(document.body);
		assert.equal(box.state.doc.toString(), "keep these");
		await empty(box);
	});
});

describe("a chat that was used", () => {
	it("draws the words carried over, then the learner's plate and the teacher's words, with Ideas and no Try asking", async () => {
		await show(chat({ chatId: "chat_1" }));
		assert.equal(q("talk-try"), null);
		const plates = all("user-message").map((el) => el.textContent);
		assert.deepEqual(plates, ["Hello from before", "What is a limit?"]);
		const words = all("thread-teacher").map((el) => el.textContent);
		assert.equal(words.length, 2);
		assert.match(words[0]!, /Welcome back\./);
		assert.match(words[1]!, /A limit is where a function heads\./);
		assert.equal(q("talk-ideas")?.textContent, "Ideas");
		assert.equal((q("talk-send") as HTMLButtonElement).disabled, true);
		assert.equal(q("talk-stop"), null, "no reply is running");
	});

	it("shows Stop once a running reply has held as long as the glide, so a reply that lands at once never shows it", async () => {
		const realFetch = globalThis.fetch;
		globalThis.fetch = (async (url: string, init?: RequestInit) => (url === "/api/chats/chat_1" ? Response.json({ ...readChat, turnInFlight: true }) : realFetch(url, init))) as typeof fetch;
		await show(chat({ chatId: "chat_1" }));
		assert.equal(q("talk-stop"), null, "not yet");
		await act(() => new Promise((r) => setTimeout(r, 340)));
		assert.ok(q("talk-stop"));
	});

	it("says a chat that can't be read, with a key that reads it again", async () => {
		globalThis.fetch = (async () => new Response("gone", { status: 404 })) as typeof fetch;
		await show(chat({ chatId: "chat_1" }));
		assert.match(document.body.textContent ?? "", /This chat couldn't be opened\./);
		assert.equal(q("talk-writing"), null, "no box over a chat that is not shown");
	});
});

describe("the thread", () => {
	const lines = [
		{ key: "a", who: "you" as const, text: "What is a limit?" },
		{ key: "b", who: "teacher" as const, text: "A limit is where a function heads." },
		{ key: "c", who: "you" as const, text: "And a slope?", over: <span data-testid="over">Page 2</span>, under: <span data-testid="under">graph.png</span> },
	];
	const thread = (props: Partial<React.ComponentProps<typeof TeacherThread>> = {}) =>
		renderToStaticMarkup(
			<MemoryRouter>
				<TeacherThread lines={lines} arrive={() => undefined} live={<p data-testid="live">Ada is working.</p>} {...props} />
			</MemoryRouter>,
		);

	it("draws the learner's lines on plates and the teacher's lines as words, oldest first", () => {
		const html = thread();
		assert.deepEqual(
			[...html.matchAll(/data-testid="(user-message|thread-teacher)"/g)].map((m) => m[1]),
			["user-message", "thread-teacher", "user-message"],
		);
		assert.match(html, /user-message"[^>]*>.*?What is a limit\?/);
		assert.match(html, /thread-teacher"[^>]*>.*?A limit is where a function heads\./);
		assert.ok(html.indexOf('data-testid="over"') < html.indexOf("And a slope?"), "what the line was about stands over its words");
		assert.ok(html.indexOf("And a slope?") < html.indexOf('data-testid="under"'), "its files stand under them");
	});

	it("puts what is live under the newest line", () => {
		const html = thread();
		assert.ok(html.indexOf('data-testid="live"') > html.indexOf("And a slope?"));
		assert.equal(html.match(/data-testid="live"/g)?.length, 1);
	});

	it("gives the newest exchange its own section, with the live part inside it", () => {
		const html = thread({ exchange: () => {} });
		const section = /<section[^>]*data-fills[^>]*>(.*?)<\/section>/.exec(html)?.[1] ?? "";
		assert.match(section, /And a slope\?/);
		assert.match(section, /data-testid="live"/);
		assert.doesNotMatch(section, /What is a limit\?/, "the earlier lines stay out of it");
	});

	it("marks the teacher's line being written", () => {
		const html = thread({ lines: [lines[0]!, { key: "w", who: "teacher", text: "Heading", writing: true }] });
		assert.match(html, /lh-streaming/);
		assert.doesNotMatch(thread(), /lh-streaming/);
	});
});

describe("the Chats list", () => {
	const row = (id: string, title: string, agent: TalkChat["agent"]): TalkChat => ({ id, title, updatedAt: "2026-11-20T10:00:00.000Z", agent, model: null, running: false });
	const api = (over: Partial<TeacherApi> = {}): TeacherApi => ({
		name: "Ada",
		follow: false,
		setFollow() {},
		panelOpen: true,
		setPanelOpen() {},
		showChat() {},
		talk: { chats: [], chatId: null },
		waiting: { lessons: [], talk: null },
		canAsk: true,
		ask() {},
		asking: null,
		recent: [],
		doing: null,
		elsewhere: false,
		setLesson() {},
		go() {},
		slip: null,
		offer: null,
		held: false,
		spaceNameOf: () => null,
		...over,
	});
	const list = (teacher: TeacherApi, onDone = () => {}) => (
		<TeacherContext.Provider value={teacher}>
			<PanelChats onDone={onDone} />
		</TeacherContext.Provider>
	);

	it("starts with New chat, and marks the chat the panel shows as open now", async () => {
		const chats = [row("c1", "Limits proof", "claude"), row("c2", "Counting", "claude")];
		await show(list(api({ talk: { chats, chatId: "c2" } })));
		assert.equal(q("teacher-chat-new")?.textContent, "New chat");
		const open = q("teacher-chat-open");
		assert.match(open?.textContent ?? "", /^Counting.*open now$/);
		assert.equal(open?.getAttribute("aria-current"), "true");
		const others = all("teacher-chat");
		assert.equal(others.length, 1);
		assert.match(others[0]!.textContent ?? "", /^Limits proof/);
		assert.doesNotMatch(others[0]!.textContent ?? "", /open now/);
	});

	it("shows an agent's name only when both agents have chats", async () => {
		const mine = [row("c1", "Limits proof", "claude"), row("c2", "Counting", "claude"), row("c3", "No agent yet", null)];
		await show(list(api({ talk: { chats: mine, chatId: null } })));
		assert.doesNotMatch(document.body.textContent ?? "", /Claude Code|Codex/, "one agent: its name says nothing");
		await show(list(api({ talk: { chats: [...mine, row("c4", "Sorting", "codex")], chatId: null } })));
		const names = [...all("teacher-chat"), ...all("teacher-chat-open")].map((el) => el.textContent ?? "");
		assert.equal(names.find((t) => t.startsWith("Limits proof"))?.includes(", Claude Code"), true);
		assert.equal(names.find((t) => t.startsWith("Sorting"))?.includes(", Codex"), true);
		assert.equal(names.find((t) => t.startsWith("No agent yet"))?.includes(", "), false, "a chat with no agent has no name");
	});

	it("a pick shows that chat and closes the list; New chat shows a new one", async () => {
		const shown: (string | null | undefined)[] = [];
		let done = 0;
		const chats = [row("c1", "Limits proof", "claude")];
		await show(list(api({ talk: { chats, chatId: null }, showChat: (id) => void shown.push(id) }), () => done++));
		await click(q("teacher-chat"));
		await click(q("teacher-chat-new"));
		assert.deepEqual(shown, ["c1", null]);
		assert.equal(done, 2);
	});

	it("says nothing but New chat before the first read of the chats", async () => {
		await show(list(api({ talk: { chats: null, chatId: null } })));
		assert.ok(q("teacher-chat-new"));
		assert.equal(all("teacher-chat").length + all("teacher-chat-open").length, 0);
	});
});

describe("the panel's head keys", () => {
	const head = (props: Partial<React.ComponentProps<typeof PanelHead>>) =>
		renderToStaticMarkup(
			<MemoryRouter>
				<PanelHead name="Ada" working={false} elsewhere={false} list={null} popOut={null} putBack={null} {...props} />
			</MemoryRouter>,
		);

	it("shows Pop out only when the shell can pop the chat out", () => {
		assert.match(head({ popOut: () => {} }), /data-testid="teacher-panel-pop-out"[^>]*>Pop out</);
		assert.doesNotMatch(head({}), /pop-out|Pop out/);
	});

	it("in the popped window the head has Put back and no other key", () => {
		const html = head({ putBack: () => {} });
		assert.match(html, /data-testid="teacher-panel-put-back"[^>]*>Put back</);
		assert.deepEqual(
			[...html.matchAll(/<button/g)].length,
			1,
			"no Chats, Follow, Activity or Pop out",
		);
		assert.doesNotMatch(html, /teacher-panel-pop-out|teacher-panel-activity|teacher-panel-chats/);
	});

	it("the panel's own head offers Pop out and Activity, and no Put back", () => {
		const html = head({ popOut: () => {}, list: { open: false, onOpen: () => {} } });
		assert.match(html, /teacher-panel-activity/);
		assert.match(html, /teacher-panel-pop-out/);
		assert.doesNotMatch(html, /put-back|Put back/);
	});
});
