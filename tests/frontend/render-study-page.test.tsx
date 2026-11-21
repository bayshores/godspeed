/**
 * The Study page: the topic box ("Start from facts", the filled Study
 * button, Enter starts), the "Suggested for <space>" rows (Continue / Next
 * up / Work on next with their buttons and line), the Study for each
 * deadline (Continue studying while its session is unfinished) and what
 * every Study start sends.
 */
import React, { act, useEffect } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { DeadlineProgress, FileCoverage, LessonProgress, TopicProgress } from "../../src/shared/core/index.ts";
import type { Suggestion } from "../../src/frontend/components/study-page/suggestions-model.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
});

const { TopicBox, isStartKey } = await import("../../src/frontend/components/study-page/topic-box.tsx");
const { SuggestionList } = await import("../../src/frontend/components/study-page/suggestions.tsx");
const { DeadlineRows } = await import("../../src/frontend/components/study-page/deadline-rows.tsx");
const { useLessonStart } = await import("../../src/frontend/components/study-page/use-lesson-start.ts");
const { takeStartFiles } = await import("../../src/frontend/components/lesson/start-files.ts");
const NO_FILES = { files: [], error: null, add: () => {}, remove: () => {}, clear: () => {}, restore: () => {} };
const { MemoryRouter, useLocation } = await import("react-router");

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
	step: { done: 1, total: 11 },
	unfinished: true,
};
const FILE: FileCoverage = { fileId: "f4", name: "Rosen 6.2 — Probability theory.pdf", displayName: "Rosen 6.2 — Probability theory", facts: 22, inLessons: 0, share: 0 };

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
		<MemoryRouter initialEntries={["/new"]}>
			<SuggestionList
				spaceLabel="CSE 21"
				suggestions={SUGGESTIONS}
				busyOn={null}
				onStudyFile={() => {}}
				onStudyTopic={() => {}}
				onStudyPath={() => {}}
				{...props}
			/>
		</MemoryRouter>,
	);
}

function box(props: Partial<React.ComponentProps<typeof TopicBox>> = {}) {
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={["/new"]}>
			<TopicBox
				text=""
				onText={() => {}}
				onStart={() => {}}
				busyOn={null}
				picks={0}
				canPick
				onOpenPicker={() => {}}
				onClearPicks={() => {}}
				attachments={NO_FILES}
				{...props}
			/>
		</MemoryRouter>,
	);
}

/** The whole <li> carrying `testid`. */
function row(html: string, testid: string): string {
	const start = html.indexOf(`data-testid="${testid}"`);
	assert.ok(start >= 0, `expected ${testid}`);
	return html.slice(start, html.indexOf("</li>", start));
}

// ─── static ─────────────────────────────────────────────────────────────────

describe("Study page: the topic box", () => {
	it("the box: the placeholder, Start from facts and the filled Study", () => {
		const html = box();
		assert.ok(html.includes('placeholder="A topic, a homework method, or a question you&#x27;re stuck on"'));
		assert.ok(html.includes('aria-label="What do you want to study?"'));
		assert.ok(html.includes("Start from facts"));
		assert.match(html, /data-testid="home-start"[^>]*class="lh-btn lh-btn-main[^"]*"[^>]*>Study</);
		assert.doesNotMatch(html, /facts-picks-clear/);
	});

	it("picked facts: the count and Clear", () => {
		const html = box({ picks: 3 });
		assert.match(html, /data-testid="facts-picks-chip"[^>]*>3 facts picked</);
		assert.match(box({ picks: 1 }), />1 fact picked</);
		assert.match(html, /data-testid="facts-picks-clear"[^>]*>Clear</);
		assert.match(html, /data-testid="home-start" aria-disabled="false"/, "picks alone can start Study");
		assert.match(box(), /data-testid="home-start" aria-disabled="true"/);
	});

	it("no facts in the space: Start from facts is disabled", () => {
		assert.match(box({ canPick: false }), /data-testid="facts-picks-chip"[^>]*disabled/);
	});

	it("takes pictures and PDFs like the lesson box: Add pictures or PDFs beside Study and the files above the topic", () => {
		const empty = box();
		assert.match(empty, /data-testid="attach-button"[^>]*>Add pictures or PDFs</);
		assert.ok(empty.indexOf('data-testid="attach-button"') < empty.indexOf('data-testid="home-start"'), "beside Study, before it");
		assert.doesNotMatch(empty, /attachment-tray/);
		const html = box({ attachments: { ...NO_FILES, files: [{ id: "f1", attachment: { name: "hw4.png", mimeType: "image/png", data: "QUJD" } }] } });
		assert.ok(html.indexOf('data-testid="attachment-tray"') < html.indexOf("<textarea"), "the files wait above the topic");
		assert.match(html, /hw4\.png<\/span><button[^>]*aria-label="Remove hw4\.png"[^>]*>Remove</);
	});
});

describe("Study page: suggestions", () => {
	it("the label names the space; no space: just Suggested", () => {
		assert.ok(list().includes(">Suggested for CSE 21</h2>"));
		assert.ok(list({ spaceLabel: null }).includes(">Suggested</h2>"));
	});

	it("nothing to suggest: nothing renders", () => {
		assert.equal(list({ suggestions: [] }), "");
	});

	it("rows in order: Continue, Next up, Work on next ×2", () => {
		const kinds = [...list().matchAll(/data-testid="home-suggestion-([a-z-]+)"/g)].map((m) => m[1]);
		assert.deepEqual(kinds, ["continue", "next-up", "work-on-next", "work-on-next"]);
	});

	it("Continue: the lesson, its step, Open links to the lesson", () => {
		const html = row(list(), "home-suggestion-continue");
		assert.ok(html.includes("HW4 methods: expected value"));
		assert.ok(html.includes(">Continue, step 1 of 11</span>"));
		assert.match(html, /<a[^>]*href="\/chat\/c1"[^>]*data-testid="home-continue"|data-testid="home-continue"[^>]*href="\/chat\/c1"/);
	});

	it("Continue on a lesson with problems: its problems as blocks, as Home and Progress draw them", () => {
		const listed: Suggestion[] = [{ kind: "continue", lesson: { ...LESSON, problems: { done: 2, total: 5 } } }];
		const html = row(list({ suggestions: listed }), "home-suggestion-continue");
		assert.ok(html.includes(">Continue, 2 of 5 problems done</span>"));
		assert.equal(html.split('data-testid="step-blocks"')[1]!.split("</span></span>")[0]!.split("<span").length - 1, 5);
	});

	it("Continue with no step shown yet: no step", () => {
		const fresh: Suggestion[] = [{ kind: "continue", lesson: { ...LESSON, step: { done: 0, total: 11 } } }];
		assert.ok(row(list({ suggestions: fresh }), "home-suggestion-continue").includes(">Continue</span>"));
	});

	it("Next up: the file name without its extension, the fact count, Study", () => {
		const html = row(list(), "home-suggestion-next-up");
		assert.ok(html.includes("Rosen 6.2 — Probability theory<"));
		assert.doesNotMatch(html, /\.pdf/);
		assert.ok(html.includes(">Next up, 22 facts</span>"));
		assert.match(html, /data-testid="home-study-file"[^>]*>Study</);
	});

	it("Work on next: how many right of how many answered, or not tested", () => {
		const html = list();
		const weak = row(html, "home-suggestion-work-on-next");
		assert.ok(weak.includes("Conditional probability"));
		assert.ok(weak.includes(">Work on next, 2 of 6 right</span>"));
		const untested = row(html.slice(html.indexOf("Conditional probability")), "home-suggestion-work-on-next");
		assert.ok(untested.includes("Linearity of expectation"));
		assert.ok(untested.includes(">Work on next, not tested</span>"));
	});
});

// ─── clicks ─────────────────────────────────────────────────────────────────

describe("Study page: actions", () => {
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
			<MemoryRouter initialEntries={["/new"]}>
				<SuggestionList
					spaceLabel="CSE 21"
					suggestions={SUGGESTIONS}
					busyOn={null}
					onStudyFile={(f) => learned.push(f)}
					onStudyTopic={(t) => practiced.push(t)}
					onStudyPath={() => {}}
				/>
			</MemoryRouter>,
		);
		await act(async () => (host.querySelector('[data-testid="home-study-file"]') as HTMLButtonElement).click());
		const practice = host.querySelectorAll('[data-testid="home-study-topic"]');
		await act(async () => (practice[1] as HTMLButtonElement).click());
		assert.deepEqual(learned.map((f) => f.fileId), ["f4"]);
		assert.deepEqual(practiced.map((t) => t.id), ["t2"]);
	});

	it("Coming up: the three soonest deadlines as rows with Study or Continue, Work on it for a homework, and the key to all of them; a click passes the deadline", async () => {
		const ddl = (id: string, name: string, over: Partial<DeadlineProgress> = {}) =>
			({ id, name, kind: "exam", date: "2026-11-22", daysUntil: 2, done: false, topics: [], ready: null, ...over }) as DeadlineProgress;
		const deadlines = [
			ddl("mid", "Midterm", { continueStudy: { chatId: "chat_1", done: 0, total: 4 }, ready: 0.5, topics: [{ id: "t1", name: "Slope", rate: 0.5 }] }),
			ddl("hw6", "HW6", { kind: "homework", problems: { done: 1, total: 3 } }),
			ddl("quiz", "Quiz 3"),
			ddl("final", "Final"),
		];
		const clicked: string[] = [];
		const host = await mount(
			<MemoryRouter initialEntries={["/new"]}>
				<DeadlineRows deadlines={deadlines} color="#58a" nowMs={Date.parse("2026-11-20T12:00:00")} busyOn={null} onStudy={(d) => clicked.push(d.id)} onWork={(d) => clicked.push(`work ${d.id}`)} />
			</MemoryRouter>,
		);
		const rows = [...host.querySelectorAll('[data-testid="home-deadlines"] > li')];
		assert.equal(rows.length, 3, "the fourth waits behind the key");
		assert.equal(host.querySelector('[data-testid="home-deadlines-all"]')!.textContent, "All 4");
		assert.equal(host.querySelector('[data-testid="home-deadlines-all"]')!.getAttribute("href"), "/space/deadlines");
		const buttons = [...host.querySelectorAll('[data-testid="home-deadlines"] button')] as HTMLButtonElement[];
		assert.deepEqual(buttons.map((b) => b.textContent), ["Continue", "Study", "Work on it", "Study"]);
		assert.equal(buttons[0]!.getAttribute("title"), "Continue studying for Midterm, 0 of 4 topics");
		assert.match(rows[0]!.textContent!, /50% ready/);
		assert.match(rows[1]!.textContent!, /1 of 3 problems done/);
		assert.equal(rows[1]!.querySelectorAll('[data-testid="step-blocks"] > span').length, 3);
		assert.doesNotMatch(rows[2]!.textContent!, /ready|problems/, "nothing measured, nothing drawn");
		await act(async () => buttons[0]!.click());
		await act(async () => buttons[2]!.click());
		assert.deepEqual(clicked, ["mid", "work hw6"]);
	});

	it("a start in flight: the key pressed shows it works and the others are only disabled", () => {
		const html = list({ busyOn: FILE.fileId });
		const key = (testid: string) => html.match(new RegExp(`<button[^>]*data-testid="${testid}"[^>]*>`))![0];
		assert.match(key("home-study-file"), /disabled=""/);
		assert.match(key("home-study-file"), /aria-busy="true"/);
		assert.match(key("home-study-topic"), /disabled=""/);
		assert.ok(!key("home-study-topic").includes("aria-busy"));
		assert.equal(html.split("braille-spinner").length - 1, 1, "one spinner, on the pressed key");
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
		const lesson: { current?: ReturnType<typeof useLessonStart> } = {};
		function Harness() {
			lesson.current = useLessonStart();
			const { pathname, search } = useLocation();
			useEffect(() => {
				pushed.push(pathname + search);
			}, [pathname, search]);
			return null;
		}
		globalThis.fetch = (async (_url: string, init: RequestInit) => {
			const body = JSON.parse(String(init.body));
			sent.push(body);
			// The server titles a start on topics or a deadline.
			return ok() ? Response.json({ id: "chat_1", title: body.title ?? "Study: Counting, Sets" }) : Response.json({ error: "boom" }, { status: 500 });
		}) as typeof fetch;
		await mount(
			<MemoryRouter initialEntries={["/new"]}>
				<Harness />
			</MemoryRouter>,
		);
		pushed.length = 0;
		return { lesson: () => lesson.current!, pushed, sent };
	}

	it("a start that fails says the server's reason, and a retry clears it", async () => {
		const original = globalThis.fetch;
		let ok = false;
		try {
			const { lesson, pushed } = await harness(() => ok);
			let failed: string | null | undefined;
			await act(async () => {
				failed = await lesson().start({ title: "Induction" });
			});
			assert.equal(lesson().error, "boom");
			assert.equal(failed, "boom", "the start resolves to the reason");
			assert.equal(lesson().busy, false);
			ok = true;
			await act(async () => lesson().start({ title: "Induction" }));
			assert.equal(lesson().error, null);
			assert.deepEqual(pushed, ["/chat/chat_1?prompt=Induction"]);
		} finally {
			globalThis.fetch = original;
		}
	});

	it("busyOn names the start in flight, and is null again when a start fails", async () => {
		const original = globalThis.fetch;
		try {
			let release!: () => void;
			const gate = new Promise<void>((resolve) => (release = resolve));
			const { lesson } = await harness(() => false);
			const hang = globalThis.fetch;
			globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
				await gate;
				return hang(...args);
			}) as typeof fetch;
			assert.equal(lesson().busyOn, null);
			let started!: Promise<unknown>;
			await act(async () => {
				started = Promise.resolve(lesson().studyDeadline({ id: "d1" }));
			});
			assert.equal(lesson().busyOn, "d1");
			assert.equal(lesson().busy, true);
			release();
			await act(async () => started);
			assert.equal(lesson().busyOn, null);
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

	it("studying files sends their ids in order; a lesson that goes on opens with no first message", async () => {
		const original = globalThis.fetch;
		try {
			const { lesson, sent, pushed } = await harness(() => true);
			await act(async () => lesson().studyFiles(["f_test", "f_key"]));
			assert.deepEqual(sent.at(-1), { fileIds: ["f_test", "f_key"] });
			assert.deepEqual(pushed, [`/chat/chat_1?prompt=${encodeURIComponent("Study: Counting, Sets")}`]);
			const again = await harness(() => true);
			globalThis.fetch = (async () => Response.json({ id: "chat_9", title: "Practice midterm", continued: true })) as typeof fetch;
			await act(async () => again.lesson().studyFiles(["f_test"]));
			assert.deepEqual(again.pushed, ["/chat/chat_9"]);
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

