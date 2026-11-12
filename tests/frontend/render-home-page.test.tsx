/**
 * Today's rows: ticking a deadline done and undoing it (the shared read),
 * a row under Today (count block, words, Mark done, the one main button),
 * a row stamped Done, a row under Later, and a space's fact grid on
 * Progress.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { DeadlineProgress, FactProgress } from "../../src/shared/core/index.ts";
import type { OpenDeadline } from "../../src/frontend/components/deadlines-model.ts";

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

const { TodayRow, DoneRow, LaterRow } = await import("../../src/frontend/components/home-page/today-row.tsx");
const { SpaceFacts } = await import("../../src/frontend/components/overview/space-facts.tsx");
const { OpenDeadlinesProvider, useOpenDeadlines } = await import("../../src/frontend/components/use-open-deadlines.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { NoticeStack } = await import("../../src/frontend/components/notice-stack.tsx");

// Wed Oct 28 2026, 4:12 PM local.
const NOW = new Date(2026, 9, 28, 16, 12).getTime();

function d(id: string, name: string, date: string, time?: string, extra: Partial<OpenDeadline> = {}): OpenDeadline {
	return { id, kind: "homework", name, date, ...(time ? { time } : {}), fileIds: [], done: false, spaceId: "c21", spaceName: "CSE 21", ...extra };
}

const OPEN = [
	d("late", "HW 4", "2026-10-27", "23:59"),
	d("quiz", "Reading quiz", "2026-10-28", "17:00", { kind: "quiz" }),
	d("hw5", "HW 5", "2026-10-30", undefined, { spaceId: "c29", spaceName: "CSE 29" }),
	d("mid", "Midterm 2", "2026-11-05", "19:00", { kind: "exam" }),
	d("far", "Project", "2026-12-01", "12:00", { kind: "project" }),
];

/** The opening tag of the element carrying `testid`. */
function tag(html: string, testid: string): string {
	const m = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
	assert.ok(m, `expected ${testid}`);
	return m[0];
}

/** From `testid` up to the first `close`. */
function section(html: string, testid: string, close: string): string {
	const start = html.indexOf(`data-testid="${testid}"`);
	assert.ok(start >= 0, `expected ${testid}`);
	return html.slice(start, html.indexOf(close, start));
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = null;
	host = null;
});
async function mount(node: React.ReactNode): Promise<HTMLElement> {
	host = document.createElement("div");
	document.body.appendChild(host);
	root = createRoot(host);
	await act(async () => root!.render(node));
	return host;
}

describe("Ticking a deadline done", () => {
	const writes: { url: string; body: unknown }[] = [];
	let saveFails = false;
	let reads = 0;
	const original = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = original;
		writes.length = 0;
		saveFails = false;
		reads = 0;
		document.body.innerHTML = "";
	});

	const DONE = { ...OPEN[0]!, done: true, doneAt: new Date().toISOString() };
	let seen!: { open: string[]; done: string[] };
	let tick!: () => void;
	let untick!: () => void;

	async function mountProvider() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PUT") {
				writes.push({ url: String(input), body: JSON.parse(String(init.body)) });
				return saveFails ? Response.json({ error: "boom" }, { status: 500 }) : Response.json({ ok: true });
			}
			reads++;
			return Response.json({ deadlines: [OPEN[1]], doneToday: [DONE] });
		}) as typeof fetch;
		function Harness() {
			const { deadlines, doneToday, markDone, undo } = useOpenDeadlines();
			seen = { open: (deadlines ?? []).map((x) => x.id), done: doneToday.map((x) => x.id) };
			tick = () => markDone(deadlines![0]!);
			untick = () => undo(doneToday[0]!);
			return null;
		}
		const connect = () => ({ onEvent() {}, onOpen() {}, close() {} });
		await mount(
			<ServerEventsProvider connect={connect as never}>
				<NoticeStack>{null}</NoticeStack>
				<OpenDeadlinesProvider>
					<Harness />
				</OpenDeadlinesProvider>
			</ServerEventsProvider>,
		);
		await settle();
	}
	const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 10))));
	const notice = () => document.querySelector<HTMLElement>('[data-testid="done-notice"]');

	it("reads the open deadlines and the ones done today", async () => {
		await mountProvider();
		assert.deepEqual(seen, { open: ["quiz"], done: ["late"] });
	});

	it("Mark done and Undo save it and read the lists again, with no notice", async () => {
		await mountProvider();
		tick();
		await settle();
		untick();
		await settle();
		assert.deepEqual(writes, [
			{ url: "/api/spaces/c21/deadlines/quiz", body: { done: true } },
			{ url: "/api/spaces/c21/deadlines/late", body: { done: false } },
		]);
		assert.equal(reads, 3);
		assert.equal(notice(), null);
	});

	it("a save that fails says so", async () => {
		saveFails = true;
		await mountProvider();
		tick();
		await settle();
		assert.equal(notice()!.textContent, "Couldn't mark it done. Try again.");
		assert.equal(notice()!.getAttribute("role"), "alert");
		assert.equal(notice()!.parentElement!.id, "lh-notices", "it stacks with the update and restart notices");
		untick();
		await settle();
		assert.equal(notice()!.textContent, "Couldn't undo that. Try again.");
	});
});

// ─── A row under Today ──────────────────────────────────────────────────────

function progressFor(id: string, extra: Partial<DeadlineProgress>): DeadlineProgress {
	return {
		id,
		kind: "homework",
		name: id,
		date: "2026-10-30",
		done: false,
		daysUntil: 2,
		files: [],
		topicIds: [],
		counts: { strong: 0, shaky: 0, weak: 0, untested: 0 },
		workOnNext: [],
		ready: null,
		topics: [],
		...extra,
	};
}

function todayRow(props: Partial<React.ComponentProps<typeof TodayRow>> = {}) {
	return renderToStaticMarkup(<TodayRow deadline={OPEN[2]!} progress={undefined} color={3} nowMs={NOW} busy={false} onStart={() => {}} onDone={() => {}} {...props} />);
}

describe("A row under Today", () => {
	it("the count block in the space's color, days left", () => {
		const html = todayRow();
		assert.match(html, /background:var\(--lh-space-3\)/);
		assert.match(html, />2<\/span>.*>days</);
		assert.match(todayRow({ deadline: OPEN[1]! }), />48<\/span>.*>min</);
		assert.match(todayRow({ deadline: OPEN[0]! }), />late</);
	});

	it("the title opens the deadline's page and the row is tagged for the teacher", () => {
		const html = todayRow();
		assert.match(tag(html, "today-open"), /href="\/space\/deadline\/hw5"/);
		assert.ok(html.includes('data-halley-target="deadline:hw5"'));
	});

	it("homework: its name, how far it is, and Work on it", () => {
		const html = todayRow({ progress: progressFor("hw5", { problems: { done: 2, total: 7 } }) });
		assert.match(section(html, "today-open", "</a>"), />HW 5$/);
		assert.ok(html.includes("CSE 29, due Friday. 2 of 7 problems done"));
		assert.match(section(html, "today-start", "</button>"), />Work on it$/);
		assert.ok(!tag(html, "today-start").includes("lh-btn-main"), "the outlined button");
	});

	it("a test: today's topics and Start; an unfinished session continues", () => {
		const topics = [1, 2, 3].map((n) => ({ id: `t${n}`, name: `t${n}`, rate: null }));
		const html = todayRow({ deadline: OPEN[3]!, progress: progressFor("mid", { topics }) });
		assert.match(section(html, "today-open", "</a>"), />Study 1 topic for Midterm 2$/);
		assert.ok(html.includes("CSE 21, the test is on Thursday at 7:00 PM"));
		assert.match(section(html, "today-start", "</button>"), /Start$/);
		assert.ok(tag(html, "today-start").includes("lh-btn-main"));
		const cont = todayRow({ deadline: OPEN[3]!, progress: progressFor("mid", { topics, continueStudy: { chatId: "c", done: 1, total: 3 } }) });
		assert.match(section(cont, "today-open", "</a>"), />Continue studying for Midterm 2$/);
		assert.match(section(cont, "today-start", "</button>"), /Continue$/);
	});

	it("a click passes the deadline; the main button waits while a lesson starts", async () => {
		const started: string[] = [];
		const done: string[] = [];
		const el = await mount(<ul><TodayRow deadline={OPEN[1]!} progress={undefined} color={1} nowMs={NOW} busy={false} onStart={(x) => started.push(x.id)} onDone={(x) => done.push(x.id)} /></ul>);
		await act(async () => {
			el.querySelector<HTMLButtonElement>('[data-testid="today-start"]')!.click();
			el.querySelector<HTMLButtonElement>('[data-testid="today-done"]')!.click();
		});
		assert.deepEqual([started, done], [["quiz"], ["quiz"]]);
		assert.match(tag(todayRow({ busy: true }), "today-start"), /disabled/);
	});
});

describe("A row stamped Done", () => {
	it("the stamp, its name and space, and Undo", async () => {
		const undone: string[] = [];
		const el = await mount(<ul><DoneRow deadline={OPEN[2]!} onUndo={(x) => undone.push(x.id)} /></ul>);
		assert.equal(el.querySelector('[data-testid="today-done-row-hw5"]')!.textContent, "DoneHW 5CSE 29Undo");
		await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="today-undo"]')!.click());
		assert.deepEqual(undone, ["hw5"]);
	});
});

describe("A row under Later", () => {
	const html = renderToStaticMarkup(<LaterRow deadline={OPEN[4]!} progress={progressFor("far", { ready: 0.19 })} color={2} nowMs={NOW} />);

	it("the whole row opens the deadline's page", () => {
		const row = section(html, "later-row-far", "</li>");
		assert.match(row, /<a[^>]*href="\/space\/deadline\/far"/);
		assert.ok(!row.includes("<button"));
		assert.ok(html.includes('data-halley-target="deadline:far"'));
	});

	it("a pale count block, its name, the space, the day and how ready", () => {
		assert.match(html, /color-mix\(in srgb, var\(--lh-space-2\) 57%/);
		assert.match(html, />34<\/span>.*>days</);
		assert.ok(html.includes("CSE 21, Tuesday Dec 1. 19% ready"));
	});
});

// ─── A space's facts ────────────────────────────────────────────────────────

function fact(inLessons: boolean, ...outcomes: ("right" | "wrong")[]): FactProgress {
	return { id: "f", name: "f", statement: "", topicId: "t", born: null, inLessons, answers: outcomes.map((outcome) => ({ outcome })) as never };
}

describe("A space's facts", () => {
	it("the facts studied, one square per fact, and what the colors mean", () => {
		const html = renderToStaticMarkup(<SpaceFacts progress={{ facts: [fact(true, "right"), fact(true), fact(false)], files: [{} as never] }} />);
		assert.ok(html.includes("2 of 3 studied"));
		assert.match(html, /aria-label="2 of 3 facts studied"/);
		assert.equal(html.split('size-[13px]"').length - 1, 3);
		assert.ok(html.includes('data-testid="fact-key"'));
	});

	it("no study files: Add files, to the space's Files tab", () => {
		const html = renderToStaticMarkup(<SpaceFacts progress={{ facts: [], files: [] }} />);
		assert.match(tag(html, "space-facts-add-files"), /href="\/space\/files"/);
	});
});
