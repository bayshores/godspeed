/**
 * A mock's own screens: ready (with or without a time limit, and when it
 * was written from what the deadline is like), being written, failed with
 * Try again and Remove, ended by its time, answered with the writing box
 * (time left and Pause only when timed), paused with its questions hidden,
 * and graded with how often it was paused. Pause saves the open answer
 * before it asks to pause.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { parseHTML } from "linkedom";
import { mathBoxView, stubCodeMirrorDom } from "../math-box-dom.ts";
import type { Mock, MockView } from "../../src/shared/core/index.ts";

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
	localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});

const { MockRun } = await import("../../src/frontend/components/mock/mock-run.tsx");
const { MockWaiting } = await import("../../src/frontend/components/mock/mock-waiting.tsx");
const { MockResults } = await import("../../src/frontend/components/mock/mock-results.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");

const NOW = Date.now();
const iso = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();

const QUESTIONS: Mock["questions"] = [
	{ id: "q1", title: "Idempotency keys", statement: "When is a retry safe?", kind: "text" },
	{ id: "q2", title: "Rate limits", statement: "Design a token bucket.", kind: "text" },
];

function view(over: Partial<Mock> = {}, rest: Partial<MockView> = {}): MockView {
	const mock: Mock = { id: "mock_0a1b2c3d", deadlineId: "ddl_onsite", n: 2, format: { questions: 2, minutes: 45 }, createdAt: iso(-10), questions: QUESTIONS, answers: {}, pauses: [], ...over };
	return { spaceId: "spc_1", deadlineId: "ddl_onsite", deadlineName: "Onsite interview", mock, working: false, ...rest };
}

const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });
const frame = (node: React.ReactNode) => (
	<MemoryRouter>
		<ServerEventsProvider connect={quietEvents as never}>{node}</ServerEventsProvider>
	</MemoryRouter>
);
const page = (node: React.ReactNode) => renderToStaticMarkup(frame(node));

describe("before and after the answering", () => {
	it("ready with a time limit: its size, that it can pause, Start the mock, and the way back to its deadline", () => {
		const html = page(<MockWaiting view={view()} state="ready" />);
		assert.match(html, />Mock 2 is ready</);
		assert.match(html, /2 questions in 45 minutes\. The time starts when you start and keeps running if you leave, unless you pause it\. Teacher stays quiet until it ends/);
		assert.match(html, /data-testid="mock-start"[^>]*lh-btn-main[^>]*>Start the mock</);
		assert.ok(!html.includes("mock-from-about"));
	});
	it("ready with no time limit, written from what it's like: why, once its deadline's files are read", async () => {
		const html = page(<MockWaiting view={view({ format: { questions: 2 }, fromAbout: true })} state="ready" />);
		assert.match(html, /2 questions, no time limit\. There is no time limit\./);
		assert.ok(!html.includes("mock-from-about"), "no guess before the files are read");
		const files = [{ id: "f_guide", name: "Study guide.md", kind: "study", status: "failed" }];
		const originalFetch = globalThis.fetch;
		const asked: string[] = [];
		globalThis.fetch = (async (url: RequestInfo | URL) => {
			asked.push(String(url));
			return Response.json({ space: { id: "spc_1", files, deadlines: [{ id: "ddl_onsite", fileIds: ["f_guide"] }] }, folder: null });
		}) as typeof fetch;
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		try {
			await act(async () => root.render(frame(<MockWaiting view={view({ format: { questions: 2 }, fromAbout: true })} state="ready" />)));
			await act(() => new Promise((r) => setTimeout(r, 10)));
			assert.deepEqual(asked, ["/api/spaces/spc_1"]);
			assert.ok(host.querySelector("[data-testid='mock-from-about']")?.textContent === "It was written from what it's like, since Study guide.md couldn't be read.");
		} finally {
			await act(async () => root.unmount());
			host.remove();
			globalThis.fetch = originalFetch;
		}
	});
	it("being written, then failed with Try again and Remove this mock", () => {
		assert.match(page(<MockWaiting view={view({ questions: [] }, { working: true })} state="writing" />), /Teacher is writing Mock 2.*2 questions in 45 minutes\. This takes a few minutes/);
		const failed = page(<MockWaiting view={view({ questions: [] }, { error: "the agent stopped" })} state="writing" />);
		assert.match(failed, /role="alert".*The mock wasn&#x27;t written.*What went wrong: the agent stopped\..*data-testid="mock-retry"[^>]*>Try again<.*data-testid="mock-remove"[^>]*>Remove this mock</);
		assert.ok(!page(<MockWaiting view={view({ startedAt: iso(-50), endedAt: iso(-5) })} state="grading" />).includes("mock-remove"), "a written mock is removed from its deadline's page");
	});
	it("ended by its time says so while it is graded", () => {
		const html = page(<MockWaiting view={view({ startedAt: iso(-45), endsAt: iso(0), endedAt: iso(0) }, { working: true })} state="grading" />);
		assert.match(html, /data-testid="mock-time-up"[^>]*>The time is up, so Mock 2 ended\.<.*Teacher is grading Mock 2/);
	});
	it("graded: how many were right, in how long, how often it was paused, and Go over it per question", () => {
		const graded = view({
			startedAt: iso(-50),
			endedAt: iso(0),
			pauses: [{ from: iso(-40), to: iso(-30) }, { from: iso(-20), to: iso(-16) }],
			answers: { q1: { text: "When the key repeats.", seconds: 600, submitted: true } },
			grades: { q1: { verdict: "right", feedback: "Yes." } },
		});
		const html = page(<MockResults view={graded} />);
		assert.match(html, /data-testid="page-back"[^>]*href="\/space\/deadline\/ddl_onsite"|href="\/space\/deadline\/ddl_onsite"[^>]*data-testid="page-back"/);
		assert.match(html, /data-testid="mock-solved"[^>]*>1 of 2 right</);
		const gone = page(<MockResults view={{ ...graded, deadlineName: null }} />);
		assert.match(gone, /data-testid="page-back"/);
		assert.ok(!gone.includes("null") && !gone.includes("Onsite interview"), "a removed deadline leaves no name line");
		assert.match(html, />in 36 of 45 minutes</);
		assert.match(html, /data-testid="mock-pauses"[^>]*>Paused 2 times, 14 minutes in total\.</);
		assert.deepEqual([...html.matchAll(/data-testid="mock-result-word"[^>]*>([^<]+)</g)].map((m) => m[1]), ["right", "left blank"]);
		assert.match(html, /Go over it with Teacher/);
		assert.ok(!html.includes("mock-study") && !html.includes("mock-another"));
	});
});

describe("answering", () => {
	it("timed: the questions, the time left, Pause and End mock over the question and the writing box", () => {
		const html = page(<MockRun view={view({ startedAt: iso(-14), endsAt: iso(31) })} />);
		assert.match(html, /data-testid="mock-questions"/);
		assert.match(html, /data-testid="mock-clock"[^>]*>(31:00|30:59) left</);
		assert.match(html, /data-testid="mock-pause"[^>]*>Pause<.*data-testid="mock-end"[^>]*>End mock</);
		assert.match(html, /Question 1: Idempotency keys/);
		assert.match(html, /data-testid="mock-text-answer".*data-testid="math-box"/);
	});
	it("no time limit: no clock and no Pause", () => {
		const html = page(<MockRun view={view({ format: { questions: 2 }, startedAt: iso(-14) })} />);
		assert.ok(!html.includes("mock-clock") && !html.includes("mock-pause"));
		assert.match(html, /data-testid="mock-end"/);
	});
	it("paused: the questions are hidden, the time left stands, Resume", () => {
		const html = page(<MockRun view={view({ startedAt: iso(-14), paused: { at: iso(-1), left: 31 * 60 + 9 } })} />);
		assert.ok(!html.includes("mock-questions") && !html.includes("Idempotency") && !html.includes("math-box"), "nothing of the questions shows");
		assert.match(html, /data-testid="mock-clock"[^>]*>31:09 left</);
		assert.match(html, /data-testid="mock-paused-word"[^>]*>Paused</);
		assert.ok(!html.includes('data-testid="mock-pause"'), "one Resume, on the paused screen");
		assert.ok(!html.includes('data-testid="mock-end"'));
		assert.match(html, />Mock 2 is paused<.*31:09 left\. The questions are hidden and nothing is saved until you resume\..*data-testid="mock-resume"[^>]*lh-btn-main[^>]*>Resume</);
	});
});

describe("pausing", () => {
	let root: Root | undefined;
	let host: HTMLElement | undefined;
	const originalFetch = globalThis.fetch;
	const posted: Array<Record<string, unknown>> = [];
	afterEach(async () => {
		await act(async () => root?.unmount());
		host?.remove();
		posted.length = 0;
		globalThis.fetch = originalFetch;
	});
	function mount(v: MockView) {
		globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
			posted.push(JSON.parse(String(init?.body)));
			return Response.json({ ok: true });
		}) as typeof fetch;
		host = document.createElement("div");
		document.body.append(host);
		root = createRoot(host);
		act(() => root!.render(<MemoryRouter>{<MockRun view={v} />}</MemoryRouter>));
		return host;
	}
	const settle = () => act(() => new Promise((r) => setTimeout(r, 10)));

	it("saves the open answer first, then pauses", async () => {
		const el = mount(view({ startedAt: iso(-14), endsAt: iso(31) }));
		const box = await mathBoxView(el);
		await act(async () => box.dispatch({ changes: { from: 0, insert: "When the key repeats" } }));
		await act(async () => el.querySelector<HTMLElement>("[data-testid='mock-pause']")!.click());
		await settle();
		assert.deepEqual(
			posted.map((p) => [p.action, p.text]),
			[
				["answer", "When the key repeats"],
				["pause", undefined],
			],
		);
	});

	it("Resume asks to resume and saves nothing", async () => {
		const el = mount(view({ startedAt: iso(-14), paused: { at: iso(-1), left: 600 } }));
		await act(async () => el.querySelector<HTMLElement>("[data-testid='mock-resume']")!.click());
		await settle();
		assert.deepEqual(posted, [{ action: "resume" }]);
	});
});
