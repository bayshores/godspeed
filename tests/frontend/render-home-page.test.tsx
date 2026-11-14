/**
 * Today: ticking a deadline done and undoing it (the shared read), the
 * card, a row under "Due this week" (count block, words, Mark done, its
 * button), a row stamped Done, a row under Later, the whole page in each
 * of its states, and a space's fact grid on Progress.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { DeadlineProgress, FactProgress, ProgressPayload, SpaceSummary } from "../../src/shared/core/index.ts";
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
});

const { MemoryRouter } = await import("react-router");
const { TodayRow, DoneRow, LaterRow } = await import("../../src/frontend/components/home-page/today-row.tsx");
const { NextCard } = await import("../../src/frontend/components/home-page/next-card.tsx");
const { TodayBody } = await import("../../src/frontend/components/home-page/today-body.tsx");
const { todayLists } = await import("../../src/frontend/components/home-page/home-page-model.ts");
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
		assert.ok(notice() === null);
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
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={["/"]}>
			<TodayRow deadline={OPEN[2]!} progress={undefined} color={3} nowMs={NOW} busy={false} onStart={() => {}} onDone={() => {}} {...props} />
		</MemoryRouter>,
	);
}

describe("A row under Due this week", () => {
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
		assert.ok(html.includes('data-teacher-target="deadline:hw5"'));
	});

	it("homework: its name, how far it is, and Work on it", () => {
		const html = todayRow({ progress: progressFor("hw5", { problems: { done: 2, total: 7 } }) });
		assert.match(section(html, "today-open", "</a>"), />HW 5$/);
		assert.ok(html.includes("CSE 29, due Friday. 2 of 7 problems done"));
		assert.match(section(html, "today-start", "</button>"), />Work on it$/);
		assert.ok(!tag(html, "today-start").includes("lh-btn-main"), "the card holds the main button");
	});

	it("a test: Study for it and Start; an unfinished session continues", () => {
		const topics = [1, 2, 3].map((n) => ({ id: `t${n}`, name: `t${n}`, rate: null }));
		const html = todayRow({ deadline: OPEN[3]!, progress: progressFor("mid", { topics }) });
		assert.match(section(html, "today-open", "</a>"), />Study for Midterm 2$/);
		assert.ok(html.includes("CSE 21, the test is on Thursday at 7:00 PM"));
		assert.match(section(html, "today-start", "</button>"), /Start$/);
		const cont = todayRow({ deadline: OPEN[3]!, progress: progressFor("mid", { topics, continueStudy: { chatId: "c", done: 1, total: 3 } }) });
		assert.match(section(cont, "today-open", "</a>"), />Continue studying for Midterm 2$/);
		assert.match(section(cont, "today-start", "</button>"), /Continue$/);
	});

	it("a click passes the deadline; the button waits while a lesson starts", async () => {
		const started: string[] = [];
		const done: string[] = [];
		const el = await mount(
			<MemoryRouter initialEntries={["/"]}>
				<ul><TodayRow deadline={OPEN[1]!} progress={undefined} color={1} nowMs={NOW} busy={false} onStart={(x) => started.push(x.id)} onDone={(x) => done.push(x.id)} /></ul>
			</MemoryRouter>,
		);
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
		const el = await mount(
			<MemoryRouter initialEntries={["/"]}>
				<ul><DoneRow deadline={OPEN[2]!} onUndo={(x) => undone.push(x.id)} /></ul>
			</MemoryRouter>,
		);
		assert.equal(el.querySelector('[data-testid="today-done-row-hw5"]')!.textContent, "DoneHW 5CSE 29Undo");
		await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="today-undo"]')!.click());
		assert.deepEqual(undone, ["hw5"]);
	});
});

describe("A row under Later", () => {
	const html = renderToStaticMarkup(
		<MemoryRouter initialEntries={["/"]}>
			<LaterRow deadline={OPEN[4]!} progress={progressFor("far", { ready: 0.19 })} nowMs={NOW} />
		</MemoryRouter>,
	);

	it("the whole row opens the deadline's page", () => {
		const row = section(html, "later-row-far", "</li>");
		assert.match(row, /<a[^>]*href="\/space\/deadline\/far"/);
		assert.ok(!row.includes("<button"));
		assert.ok(html.includes('data-teacher-target="deadline:far"'));
	});

	it("a plain row: its name, the space and the day, the days left as a chip, how ready; no block", () => {
		assert.ok(!html.includes("--lh-space-"));
		assert.ok(html.includes(">Project<"));
		assert.ok(html.includes(">CSE 21, Tuesday Dec 1<"));
		assert.match(html, /bg-highlight[^"]*font-count">34 days</);
		assert.ok(html.includes(">19% ready<"));
	});
});

// ─── The card ───────────────────────────────────────────────────────────────

describe("The card", () => {
	const html = renderToStaticMarkup(
		<MemoryRouter initialEntries={["/"]}>
			<NextCard deadline={OPEN[3]!} progress={progressFor("mid", { ready: 0.4, date: "2026-11-05" })} color={2} nowMs={NOW} busy={false} onStart={() => {}} onDone={() => {}} />
		</MemoryRouter>,
	);

	it("its space, the action as the title opening the deadline's page, when and how ready", () => {
		assert.match(tag(html, "today-card-open"), /href="\/space\/deadline\/mid"/);
		assert.match(section(html, "today-card-open", "</a>"), />Study for Midterm 2$/);
		assert.ok(html.includes(">CSE 21<"));
		assert.ok(html.includes("The test is on Thursday at 7:00 PM."));
		assert.match(tag(html, "today-card-ready"), /bg-highlight/);
		assert.match(section(html, "today-card-ready", "</span>"), />40% ready$/);
		assert.ok(html.includes("background:var(--lh-space-2)"), "the big block in the space's color");
		assert.match(html, /text-\[92px\][^>]*>8<\/span>/, "the days left, large");
		assert.ok(html.includes('data-teacher-target="deadline:mid"'));
	});

	it("holds the page's one main button, beside a quiet Mark done", () => {
		assert.ok(tag(html, "today-start").includes("lh-btn-main"));
		assert.match(section(html, "today-start", "</button>"), />Start$/);
		assert.ok(tag(html, "today-done").includes("lh-btn-quiet"));
	});
});

// ─── The whole page ─────────────────────────────────────────────────────────

const space = (id: string, name: string, over: Partial<SpaceSummary> = {}): SpaceSummary => ({
	id,
	name,
	description: "",
	createdAt: "",
	updatedAt: "",
	closed: false,
	fileCount: 3,
	color: 1,
	filesLeft: 0,
	...over,
});

function spaceProgress(over: { counts?: [number, number, number, number]; files?: number; facts?: number; answeredAt?: Date[]; deadlines?: DeadlineProgress[] } = {}): ProgressPayload {
	const [strong, shaky, weak, untested] = over.counts ?? [0, 0, 0, 0];
	const answers = (over.answeredAt ?? []).map((t, i) => ({ chatId: "l", toolCallId: `q${i}`, outcome: "right" as const, answeredAt: t.toISOString() }));
	return {
		overall: { topicIds: [], counts: { strong, shaky, weak, untested }, workOnNext: [] },
		files: Array.from({ length: over.files ?? 1 }, () => ({})),
		facts: Array.from({ length: over.facts ?? 1 }, () => ({})),
		lessons: answers.length ? [{ chatId: "l", title: "l", kind: "study", updatedAt: "", answers, right: answers.length, answered: answers.length, score: 1 }] : [],
		deadlines: over.deadlines ?? [],
	} as unknown as ProgressPayload;
}

const LA = space("spc_la", "Linear Algebra", { color: 2 });
const OS = space("spc_os", "Operating Systems", { color: 5 });

function page(props: Partial<React.ComponentProps<typeof TodayBody>> = {}): string {
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={["/"]}>
			<TodayBody
				nowMs={NOW}
				ready
				spaces={[LA, OS]}
				lists={todayLists([], [], NOW)}
				deadlineProgress={new Map()}
				spacesProgress={new Map([["spc_la", spaceProgress({ counts: [9, 3, 0, 6] })], ["spc_os", spaceProgress({ counts: [4, 1, 0, 12] })]])}
				worker="Teacher"
				newFiles={new Map()}
				busy={false}
				lessonError={null}
				onStart={() => {}}
				onDone={() => {}}
				onUndo={() => {}}
				onRetry={() => {}}
				onAddSpace={() => {}}
				onAddDeadline={() => {}}
				onOpenSpace={() => {}}
				{...props}
			/>
		</MemoryRouter>,
	);
}

/** How many times `needle` is in `html`. */
const count = (html: string, needle: string) => html.split(needle).length - 1;
const LA_OPEN = [d("q2", "Quiz 2", "2026-10-30", undefined, { kind: "quiz", spaceId: "spc_la", spaceName: "Linear Algebra" }), d("hw4", "Homework 4", "2026-11-01", undefined, { spaceId: "spc_os", spaceName: "Operating Systems" }), d("fin", "Final", "2026-12-08", undefined, { kind: "exam", spaceId: "spc_la", spaceName: "Linear Algebra" })];

describe("Today, as a whole page", () => {
	it("waits in one block until everything is in", () => {
		const html = page({ ready: false });
		assert.ok(html.includes('data-testid="home-loading"'));
		assert.ok(!html.includes('data-testid="today-week"'));
	});

	it("with deadlines: the week line, the card, the rest due this week, the spaces, then Later, with one main button", () => {
		const html = page({ lists: todayLists(LA_OPEN, [{ ...OPEN[2]!, done: true, doneAt: new Date(NOW).toISOString() }], NOW) });
		const order = ["today-week", "today-card", "today-list", "today-spaces", "later-list"].map((id) => html.indexOf(`data-testid="${id}"`));
		assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!)), `sections in order: ${order.join(", ")}`);
		assert.equal(count(html, "lh-btn-main"), 1);
		assert.match(section(html, "today-card", "</h2>"), /Study for Quiz 2/);
		assert.ok(html.includes('data-testid="today-row-hw4"'));
		assert.ok(html.includes('data-testid="today-done-row-hw5"'));
		assert.ok(html.includes('data-testid="later-row-fin"'));
		for (const title of ["Due this week", "Your spaces", "Later"]) assert.ok(html.includes(`>${title}</h2>`), title);
		assert.ok(!html.includes(">This week<"), "the week is a quiet line under the title, not a section");
		assert.equal(count(html, "border-line"), 2, "the card and the Due this week frame, nothing else");
	});

	it("no spaces: the sentence and Add a space, nothing else", () => {
		const html = page({ spaces: [], spacesProgress: new Map() });
		assert.match(section(html, "today-empty", "</p>"), /No spaces yet\. Add one, then add its deadlines\./);
		assert.ok(tag(html, "today-add-space").includes("lh-btn-main"));
		for (const id of ["today-week", "today-spaces", "home-add-deadline"]) assert.ok(!html.includes(`data-testid="${id}"`), id);
	});

	it("spaces but no deadlines: no card, the sentence, this week, the spaces and Add a deadline", () => {
		const html = page();
		assert.ok(!html.includes('data-testid="today-card"'));
		assert.match(section(html, "today-empty", "</p>"), /No deadlines yet\. Your agent can add them from your files\./);
		assert.ok(!html.includes(">Due this week<"));
		assert.ok(!html.includes(">Later<"));
		assert.ok(html.includes('data-testid="home-add-deadline"'));
		assert.equal(count(html, "lh-btn-main"), 0);
	});

	it("nothing due this week: the sentence, and Later holds the rest", () => {
		const html = page({ lists: todayLists([LA_OPEN[2]!], [], NOW) });
		assert.match(section(html, "today-empty", "</p>"), /Nothing is due in the next 7 days\./);
		assert.ok(html.includes('data-testid="later-row-fin"'));
	});

	it("deadlines that failed to load keep Try again, this week and the spaces", () => {
		const html = page({ lists: null });
		assert.ok(html.includes("Couldn&#x27;t load your deadlines."));
		assert.ok(html.includes('data-testid="today-week"'));
		assert.ok(html.includes('data-testid="today-spaces"'));
		assert.ok(!html.includes('data-testid="home-add-deadline"'));
	});

	it("a week with no answers, and one with answers in two spaces", () => {
		assert.match(section(page(), "today-week-line", "</p>"), /No studying yet this week\.$/);
		const progress = new Map([
			["spc_la", spaceProgress({ answeredAt: [new Date(2026, 9, 26, 10), new Date(2026, 9, 28, 9)] })],
			["spc_os", spaceProgress({ answeredAt: [new Date(2026, 9, 28, 20)] })],
		]);
		const html = page({ spacesProgress: progress });
		assert.match(section(html, "today-week-line", "</p>"), /You studied 2 days this week and answered 3 questions\.$/);
		assert.match(html, /role="img" aria-label="You studied on Monday and Wednesday\."/);
		assert.ok(html.indexOf('data-testid="today-week"') < html.indexOf('data-testid="today-empty"'), "under Today's title");
		assert.equal(count(html, "data-studied"), 2);
	});
});

describe("Your spaces", () => {
	it("one row per space: its name, the topic bar with words for a screen reader, the counts, and the row opens the space", () => {
		const html = page();
		const row = section(html, "today-space-spc_la", "</li>");
		assert.match(tag(row, "today-space-open"), /^<a[^>]*href="\/space"/);
		assert.ok(row.includes(">Linear Algebra<"));
		assert.ok(row.includes('role="img" aria-label="Topics, 9 strong, 3 shaky, 6 not tested"'));
		assert.ok(row.includes(">9 strong, 3 shaky, 6 not tested<"));
		assert.ok(!row.includes("border-line"), "a plain row, not a box");
		assert.equal(count(row, "flex-grow:"), 3);
	});

	it("opening a row picks its space", async () => {
		const opened: string[] = [];
		const el = await mount(
			<MemoryRouter initialEntries={["/"]}>
				<TodayBody
					nowMs={NOW}
					ready
					spaces={[LA]}
					lists={todayLists([], [], NOW)}
					deadlineProgress={new Map()}
					spacesProgress={new Map([["spc_la", spaceProgress()]])}
					worker="Teacher"
					newFiles={new Map([["spc_la", "2 new files since Monday"]])}
					busy={false}
					lessonError={null}
					onStart={() => {}}
					onDone={() => {}}
					onUndo={() => {}}
					onRetry={() => {}}
					onAddSpace={() => {}}
					onAddDeadline={() => {}}
					onOpenSpace={(id) => opened.push(id)}
				/>
			</MemoryRouter>,
		);
		await act(async () => el.querySelector<HTMLElement>('[data-testid="today-space-files"]')!.click());
		await act(async () => el.querySelector<HTMLElement>('[data-testid="today-space-open"]')!.click());
		assert.deepEqual(opened, ["spc_la", "spc_la"]);
	});

	it("the new-files chip opens the space's Files page", () => {
		const html = page({ newFiles: new Map([["spc_os", "2 new files since Monday"]]) });
		assert.ok(!section(html, "today-space-spc_la", "</li>").includes("today-space-files"));
		const row = section(html, "today-space-spc_os", "</li>");
		assert.match(tag(row, "today-space-files"), /^<a[^>]*href="\/space\/files"/);
		assert.ok(row.includes("2 new files since Monday"));
		assert.match(tag(row, "today-space-files"), /bg-highlight/);
	});

	it("a space with no topics says so; the teacher at work is a chip beside the name", () => {
		const progress = new Map([["spc_la", spaceProgress({ files: 0, facts: 0 })], ["spc_os", spaceProgress({ files: 4, facts: 0 })]]);
		const building = { ...OS, filesLeft: 4, building: true as const };
		const html = page({ spaces: [LA, building], spacesProgress: progress });
		assert.match(section(html, "today-space-spc_la", "</li>"), />No study files yet\.</);
		const os = section(html, "today-space-spc_os", "</li>");
		assert.match(os, /data-testid="today-space-work" class="[^"]*bg-highlight[^"]*">Teacher is building it, 4 left</);
		assert.match(os, />No facts yet\. They show up once your agent reads the files\.</);
		const counted = page({ spaces: [LA, { ...OS, filesLeft: 2 }] });
		assert.match(section(counted, "today-space-spc_os", "</li>"), /data-testid="today-space-work"[^>]*>Teacher is reading new files, 2 left</);
	});

	it("one space, or six, each gets its row", () => {
		const one = page({ spaces: [LA] });
		assert.equal(count(one, 'data-testid="today-space-open"'), 1);
		const six = ["a", "b", "c", "d", "e", "f"].map((id, i) => space(`spc_${id}`, `Space ${id}`, { color: (i % 8) + 1 }));
		const many = page({ spaces: six, spacesProgress: new Map(six.map((s) => [s.id, spaceProgress({ counts: [1, 0, 0, 1] })])) });
		assert.equal(count(many, 'data-testid="today-space-open"'), 6);
	});
});

// ─── A space's facts ────────────────────────────────────────────────────────

function fact(inLessons: boolean, ...outcomes: ("right" | "wrong")[]): FactProgress {
	return { id: "f", name: "f", statement: "", topicId: "t", born: null, inLessons, answers: outcomes.map((outcome) => ({ outcome })) as never };
}

describe("A space's facts", () => {
	it("the facts studied, one square per fact, and what the colors mean", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/"]}>
				<SpaceFacts progress={{ facts: [fact(true, "right"), fact(true), fact(false)], files: [{} as never] }} />
			</MemoryRouter>,
		);
		assert.ok(html.includes("2 of 3 studied"));
		assert.match(html, /aria-label="2 of 3 facts studied"/);
		assert.equal(html.split('size-[13px]"').length - 1, 3);
		assert.ok(html.includes('data-testid="fact-key"'));
	});

	it("no study files: Add files, to the space's Files tab", () => {
		const html = renderToStaticMarkup(
			<MemoryRouter initialEntries={["/"]}>
				<SpaceFacts progress={{ facts: [], files: [] }} />
			</MemoryRouter>,
		);
		assert.match(tag(html, "space-facts-add-files"), /href="\/space\/files"/);
	});
});
