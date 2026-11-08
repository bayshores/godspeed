/**
 * The start page: the topic box ("Start from facts", the white Study
 * button, Enter starts), the "Suggested for <class>" rows (Continue / Next
 * up / Work on next with their buttons and meta), the Study for each
 * deadline (Continue studying while its session is unfinished) and what
 * every Study start sends.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { DeadlineProgress, FileCoverage, LessonProgress, TopicProgress } from "../../src/shared/core/index.ts";
import type { Suggestion } from "../../src/frontend/components/home/suggestions-model.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
	requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
	cancelIdleCallback: (id: number) => clearTimeout(id),
});

const { TopicBox, isStartKey } = await import("../../src/frontend/components/home/topic-box.tsx");
const { SuggestionList } = await import("../../src/frontend/components/home/suggestions.tsx");
const { DeadlineStarts } = await import("../../src/frontend/components/home/deadline-starts.tsx");
const { useLessonStart } = await import("../../src/frontend/components/home/use-lesson-start.ts");
const { takeStartFiles } = await import("../../src/frontend/components/lesson/start-files.ts");
const NO_FILES = { files: [], error: null, add: () => {}, remove: () => {}, clear: () => {}, restore: () => {} };
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");

// ─── fixture ────────────────────────────────────────────────────────────────

const LESSON: LessonProgress = {
	chatId: "c1",
	title: "HW4 methods: expected value",
	kind: "teach",
	updatedAt: "2026-10-27T12:00:00Z",
	answers: [],
	right: 0,
	answered: 0,
	score: null,
};
const FILE: FileCoverage = { fileId: "f4", name: "Rosen 6.2 — Probability theory.pdf", facts: 22, inLessons: 0, share: 0 };

function topic(id: string, name: string, status: TopicProgress["status"], right: number, answered: number): TopicProgress {
	return {
		id,
		name,
		members: [],
		answered,
		right,
		wrong: answered - right,
		dontKnow: 0,
		rate: answered ? right / answered : null,
		status,
		color: "var(--lh-ramp-1)",
		overconfident: false,
		answers: [],
		column: 0,
	};
}
const WEAK = topic("t1", "Conditional probability", "weak", 2, 6);
const UNTESTED = topic("t2", "Linearity of expectation", "untested", 0, 0);

const SUGGESTIONS: Suggestion[] = [
	{ kind: "continue", lesson: LESSON },
	{ kind: "next-up", file: FILE },
	{ kind: "work-on-next", item: { topicId: "t1", name: WEAK.name, status: "weak", reason: "" }, topic: WEAK },
	{ kind: "work-on-next", item: { topicId: "t2", name: UNTESTED.name, status: "untested", reason: "" }, topic: UNTESTED },
];

function list(props: Partial<React.ComponentProps<typeof SuggestionList>> = {}) {
	return renderToStaticMarkup(
		<SuggestionList
			classLabel="CSE 21"
			suggestions={SUGGESTIONS}
			step={{ position: 1, total: 11 }}
			busy={false}
			onStudyFile={() => {}}
			onStudyTopic={() => {}}
			{...props}
		/>,
	);
}

function box(props: Partial<React.ComponentProps<typeof TopicBox>> = {}) {
	return renderToStaticMarkup(
		<TopicBox
			text=""
			onText={() => {}}
			onStart={() => {}}
			busy={false}
			picks={0}
			canPick
			onOpenPicker={() => {}}
			onClearPicks={() => {}}
			attachments={NO_FILES}
			{...props}
		/>,
	);
}

/** The whole <li> carrying `testid`. */
function row(html: string, testid: string): string {
	const start = html.indexOf(`data-testid="${testid}"`);
	assert.ok(start >= 0, `expected ${testid}`);
	return html.slice(start, html.indexOf("</li>", start));
}

// ─── static ─────────────────────────────────────────────────────────────────

describe("Home: the topic box", () => {
	it("the box: the placeholder, Start from facts and the white Study", () => {
		const html = box();
		assert.ok(html.includes("A topic, a homework method, or a question you&#x27;re stuck on…"));
		assert.ok(html.includes('aria-label="What do you want to study?"'));
		assert.ok(html.includes("Start from facts"));
		assert.match(html, /data-testid="home-start"[^>]*class="[^"]*bg-ink[^"]*text-background[^"]*"[^>]*>Study</);
		assert.doesNotMatch(html, /facts-picks-clear/);
	});

	it("picked facts: the count and a clear button", () => {
		const html = box({ picks: 3 });
		assert.match(html, /<span class="font-mono tabular-nums">3<\/span> facts picked/);
		assert.ok(html.includes('data-testid="facts-picks-clear"'));
		assert.match(html, /data-testid="home-start" aria-disabled="false"/, "picks alone can start Study");
		assert.match(box(), /data-testid="home-start" aria-disabled="true"/);
	});

	it("no facts in the class: Start from facts is disabled", () => {
		assert.match(box({ canPick: false }), /data-testid="facts-picks-chip"[^>]*disabled/);
	});

	it("takes pictures and PDFs like the lesson box: a picture button beside Study and the files above the topic", () => {
		const empty = box();
		assert.match(empty, /aria-label="Add pictures or PDFs"/);
		assert.ok(empty.indexOf('data-testid="attach-button"') < empty.indexOf('data-testid="home-start"'), "beside Study, before it");
		assert.doesNotMatch(empty, /attachment-tray/);
		const html = box({ attachments: { ...NO_FILES, files: [{ id: "f1", attachment: { name: "hw4.png", mimeType: "image/png", data: "QUJD" } }] } });
		assert.ok(html.indexOf('data-testid="attachment-tray"') < html.indexOf("<textarea"), "the files wait above the topic");
		assert.match(html, /aria-label="Remove hw4\.png"/);
	});
});

describe("Home: suggestions", () => {
	it("the label names the class; no class: just Suggested", () => {
		assert.ok(list().includes(">Suggested for CSE 21</h2>"));
		assert.ok(list({ classLabel: null }).includes(">Suggested</h2>"));
	});

	it("nothing to suggest: nothing renders", () => {
		assert.equal(list({ suggestions: [] }), "");
	});

	it("rows in order: Continue, Next up, Work on next ×2", () => {
		const kinds = [...list().matchAll(/data-testid="home-suggestion-([a-z-]+)"/g)].map((m) => m[1]);
		assert.deepEqual(kinds, ["continue", "next-up", "work-on-next", "work-on-next"]);
	});

	it("Continue: white dot, the lesson, step N / M in mono, Open links to the lesson", () => {
		const html = row(list(), "home-suggestion-continue");
		assert.ok(html.includes(">Continue</span>"));
		assert.ok(html.includes("HW4 methods: expected value"));
		assert.match(html, /rounded-full bg-ink-max/);
		assert.match(html, /step <span class="font-mono tabular-nums">1 \/ 11<\/span>/);
		assert.match(html, /<a[^>]*href="\/chat\/c1"[^>]*data-testid="home-continue"|data-testid="home-continue"[^>]*href="\/chat\/c1"/);
	});

	it("Continue before its step is read: no meta", () => {
		assert.doesNotMatch(row(list({ step: null }), "home-suggestion-continue"), /step /);
	});

	it("Next up: no dot, the file name without its extension, the fact count, Study", () => {
		const html = row(list(), "home-suggestion-next-up");
		assert.ok(html.includes("Rosen 6.2 — Probability theory<"));
		assert.doesNotMatch(html, /\.pdf/);
		assert.doesNotMatch(html, /rounded-full/);
		assert.match(html, /<span class="font-mono tabular-nums">22<\/span> facts/);
		assert.match(html, /data-testid="home-study-file"[^>]*>Study</);
	});

	it("Work on next: the status color dot, right / answered, or untested on the gray dot", () => {
		const html = list();
		const weak = html.slice(html.indexOf("Conditional probability") - 600, html.indexOf("Linearity of expectation"));
		assert.match(weak, /background:var\(--lh-ramp-1\)/);
		assert.match(weak, /<span class="font-mono tabular-nums">2 \/ 6<\/span>/);
		const untested = row(html.slice(html.indexOf("Conditional probability")), "home-suggestion-work-on-next");
		assert.ok(untested.includes("Linearity of expectation"));
		assert.match(untested, /bg-ans-dontknow/);
		assert.ok(untested.includes(">not tested</span>"));
	});
});

// ─── clicks ─────────────────────────────────────────────────────────────────

describe("Home: actions", () => {
	let root: Root | null = null;
	afterEach(async () => {
		await act(async () => root?.unmount());
		root = null;
		document.body.innerHTML = "";
	});

	async function mount(node: React.ReactElement): Promise<HTMLElement> {
		const host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => root!.render(node));
		return host;
	}

	it("Study calls back with the file or the topic", async () => {
		const learned: FileCoverage[] = [];
		const practiced: TopicProgress[] = [];
		const host = await mount(
			<SuggestionList
				classLabel="CSE 21"
				suggestions={SUGGESTIONS}
				step={null}
				busy={false}
				onStudyFile={(f) => learned.push(f)}
				onStudyTopic={(t) => practiced.push(t)}
			/>,
		);
		await act(async () => (host.querySelector('[data-testid="home-study-file"]') as HTMLButtonElement).click());
		const practice = host.querySelectorAll('[data-testid="home-study-topic"]');
		await act(async () => (practice[1] as HTMLButtonElement).click());
		assert.deepEqual(learned.map((f) => f.fileId), ["f4"]);
		assert.deepEqual(practiced.map((t) => t.id), ["t2"]);
	});

	it("Study for each deadline, or Continue studying for it with its topics done; a click passes the deadline", async () => {
		const ddl = (id: string, name: string, over: Partial<DeadlineProgress> = {}) => ({ id, name, ...over }) as DeadlineProgress;
		const deadlines = [ddl("mid", "Midterm", { continueStudy: { chatId: "chat_1", done: 0, total: 4 } }), ddl("quiz", "Quiz 3")];
		const clicked: string[] = [];
		const host = await mount(<DeadlineStarts deadlines={deadlines} busy={false} onStudy={(d) => clicked.push(d.id)} />);
		const buttons = [...host.querySelectorAll('[data-testid="home-study-deadline"]')] as HTMLButtonElement[];
		assert.deepEqual(buttons.map((b) => b.textContent), ["Continue studying for Midterm, 0 of 4 topics", "Study for Quiz 3"]);
		await act(async () => buttons[0]!.click());
		assert.deepEqual(clicked, ["mid"]);
	});

	it("busy: the start buttons are disabled", () => {
		const html = list({ busy: true });
		assert.match(html, /data-testid="home-study-file"[^>]*disabled/);
		assert.match(html, /data-testid="home-study-topic"[^>]*disabled/);
	});

	it("Enter starts; Shift+Enter and an IME composition's Enter don't", () => {
		assert.equal(isStartKey({ key: "Enter", shiftKey: false }), true);
		assert.equal(isStartKey({ key: "Enter", shiftKey: true }), false);
		assert.equal(isStartKey({ key: "Enter", shiftKey: false, isComposing: true }), false);
		assert.equal(isStartKey({ key: "a", shiftKey: false }), false);
	});

	/** Mounts useLessonStart; every start's request body lands in `sent`. */
	async function harness(ok: () => boolean) {
		const pushed: string[] = [];
		const sent: Record<string, unknown>[] = [];
		const router = { push: (href: string) => pushed.push(href) } as unknown as React.ContextType<typeof AppRouterContext>;
		const lesson: { current?: ReturnType<typeof useLessonStart> } = {};
		function Harness() {
			lesson.current = useLessonStart();
			return null;
		}
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			sent.push(body);
			// The server titles a start on topics or a deadline.
			return ok() ? Response.json({ id: "chat_1", title: body.title ?? "Study: Counting, Sets" }) : Response.json({ error: "boom" }, { status: 500 });
		}) as typeof fetch;
		await mount(
			<AppRouterContext.Provider value={router}>
				<Harness />
			</AppRouterContext.Provider>,
		);
		return { lesson: () => lesson.current!, pushed, sent };
	}

	it("a start that fails says so, and a retry clears it", async () => {
		const original = globalThis.fetch;
		let ok = false;
		try {
			const { lesson, pushed } = await harness(() => ok);
			await act(async () => lesson().start({ title: "Induction" }));
			assert.equal(lesson().error, "Couldn't start the lesson. Try again.");
			assert.equal(lesson().busy, false);
			ok = true;
			await act(async () => lesson().start({ title: "Induction" }));
			assert.equal(lesson().error, null);
			assert.deepEqual(pushed, ["/chat/chat_1?prompt=Induction"]);
		} finally {
			globalThis.fetch = original;
		}
	});

	it("studying topics or a deadline sends their ids, and the server's title is the first message", async () => {
		const original = globalThis.fetch;
		try {
			// Failed starts leave the hook free for the next one.
			let ok = false;
			const { lesson, sent, pushed } = await harness(() => ok);
			await act(async () => lesson().studyDeadline({ id: "d1" }));
			assert.deepEqual(sent.at(-1), { deadlineId: "d1" });
			await act(async () => lesson().start({ title: " Bayes ", picks: [{ id: "f1", name: "Bayes", statement: "P(A|B)…" }] }));
			assert.deepEqual(sent.at(-1), { title: "Bayes", graphContext: { propositions: [{ id: "f1", name: "Bayes", statement: "P(A|B)…" }] } });
			ok = true;
			await act(async () => lesson().studyTopics(["t1", "t2"]));
			assert.deepEqual(sent.at(-1), { topicIds: ["t1", "t2"] });
			assert.deepEqual(pushed, [`/chat/chat_1?prompt=${encodeURIComponent("Study: Counting, Sets")}`]);
			assert.ok(sent.every((body) => !("kind" in body)), "every new lesson is a study session");
		} finally {
			globalThis.fetch = original;
		}
	});

	it("a typed topic's files wait for the new session's first message, never in the request", async () => {
		const original = globalThis.fetch;
		try {
			const { lesson, sent } = await harness(() => true);
			const files = [{ name: "hw4.png", mimeType: "image/png", data: "QUJD" }];
			await act(async () => lesson().start({ title: "Induction", files }));
			assert.deepEqual(sent.at(-1), { title: "Induction" });
			assert.deepEqual(takeStartFiles("chat_1"), files);
			assert.deepEqual(takeStartFiles("chat_1"), [], "handed over once");
		} finally {
			globalThis.fetch = original;
		}
	});

	it("picked facts with nothing typed start too, and the server titles the session; with neither nothing starts", async () => {
		const original = globalThis.fetch;
		try {
			const { lesson, sent, pushed } = await harness(() => true);
			await act(async () => lesson().start({ title: "  " }));
			assert.deepEqual(sent, []);
			const pick = { id: "f1", name: "Bayes", statement: "P(A|B)…" };
			await act(async () => lesson().start({ title: " ", picks: [pick] }));
			assert.deepEqual(sent, [{ title: "", graphContext: { propositions: [pick] } }]);
			assert.equal(pushed.length, 1);
		} finally {
			globalThis.fetch = original;
		}
	});

	it("a deadline with an unfinished session reopens it instead of starting one", async () => {
		const original = globalThis.fetch;
		try {
			const { lesson, sent, pushed } = await harness(() => true);
			await act(async () => lesson().studyDeadline({ id: "d1", continueStudy: { chatId: "chat_9", done: 1, total: 4 } }));
			assert.deepEqual(sent, []);
			assert.deepEqual(pushed, ["/chat/chat_9"]);
		} finally {
			globalThis.fetch = original;
		}
	});
});

