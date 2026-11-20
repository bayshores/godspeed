/**
 * Home: ticking a deadline done and undoing it (the shared read), the
 * card (open and ticked done), the week's columns (picking, late, done,
 * "+N more"), Later, the whole page in each of its states, and a space's
 * fact grid on Progress.
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
	MutationObserver: dom.window.MutationObserver,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
});

const { MemoryRouter } = await import("react-router");
const { NextCard } = await import("../../src/frontend/components/home-page/next-card.tsx");
const { HomeBody } = await import("../../src/frontend/components/home-page/home-body.tsx");
const { homeLists } = await import("../../src/frontend/components/home-page/home-page-model.ts");
const { SpaceFacts } = await import("../../src/frontend/components/overview/space-facts.tsx");
const { OpenDeadlinesProvider, useOpenDeadlines } = await import("../../src/frontend/components/use-open-deadlines.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { PeekSheet } = await import("../../src/frontend/components/strip/peek-sheet.tsx");
const { MAIN_KEY } = await import("../../src/frontend/components/overview/styles.ts");

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
				<MemoryRouter>
					<PeekSheet>{null}</PeekSheet>
				</MemoryRouter>
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

// ─── The card ───────────────────────────────────────────────────────────────

describe("The card", () => {
	function card(props: Partial<React.ComponentProps<typeof NextCard>> = {}) {
		return renderToStaticMarkup(
			<MemoryRouter initialEntries={["/"]}>
				<NextCard deadline={OPEN[3]!} progress={progressFor("mid", { ready: 0.4, date: "2026-11-05" })} color={2} nowMs={NOW} busyOn={null} onStart={() => {}} onDone={() => {}} onUndo={() => {}} {...props} />
			</MemoryRouter>,
		);
	}
	const html = card();

	it("the deadline's name as the title opening the deadline's page, then its space and when, and how ready", () => {
		assert.match(tag(html, "today-card-open"), /href="\/space\/deadline\/mid"/);
		assert.match(section(html, "today-card-open", "</a>"), />Midterm 2$/);
		assert.ok(html.indexOf("Midterm 2") < html.indexOf("CSE 21, Thursday Nov 5 at 7:00 PM"), "nothing above the title");
		assert.match(tag(html, "today-card-ready"), /bg-highlight/);
		assert.match(section(html, "today-card-ready", "</span>"), />40% ready$/);
		assert.ok(html.includes("background:var(--lh-space-2)"), "the tile in the space's color");
		assert.match(html, /w-\[112px\][^>]*>.*text-\[42px\][^>]*>8<\/span><span[^>]*>days<\/span>/, "the days left over their unit");
		assert.match(tag(html, "today-card"), /overflow-hidden/, "the tile is cut to the card's corners");
		assert.ok(html.includes('data-teacher-target="deadline:mid"'));
	});

	it("an overdue one counts how late it is, never a bare word", () => {
		const late = card({ deadline: OPEN[0]!, progress: undefined });
		assert.match(late, />16<\/span><span[^>]*>hours late<\/span>/);
	});

	it("holds the page's one main button, beside a quiet Mark done, each as wide as its label", () => {
		assert.ok(tag(html, "today-start").includes("lh-btn-main"));
		assert.ok(tag(html, "today-start").includes(`class="lh-btn ${MAIN_KEY}"`), "the Progress page's main key");
		assert.match(section(html, "today-start", "</button>"), />Study$/);
		assert.ok(tag(html, "today-done").includes("lh-btn-quiet"));
		assert.ok(!html.includes("w-full justify-center"));
	});

	it("homework is worked on; the main key shows it works while its lesson starts", () => {
		const hw = card({ deadline: OPEN[2]!, progress: progressFor("hw5", { problems: { done: 2, total: 7 } }), busyOn: "homework hw5" });
		assert.match(section(hw, "today-start", "</button>"), />Work on it<\/span>/);
		assert.match(tag(hw, "today-start"), /disabled=""[^>]*aria-busy="true"|aria-busy="true"[^>]*disabled=""/);
		assert.match(hw, /data-testid="today-start"[^>]*>.*braille-spinner/s);
		assert.match(section(hw, "today-card-ready", "</span>"), />2 of 7 problems done$/);
	});

	it("one ticked done: struck through, the Done stamp, Undo and no main key", async () => {
		const undone: string[] = [];
		const el = await mount(
			<MemoryRouter initialEntries={["/"]}>
				<NextCard deadline={{ ...OPEN[2]!, done: true, doneAt: new Date(NOW).toISOString() }} progress={undefined} color={3} nowMs={NOW} busyOn={null} onStart={() => {}} onDone={() => {}} onUndo={(x) => undone.push(x.id)} />
			</MemoryRouter>,
		);
		assert.ok(el.querySelector("h2")!.className.includes("line-through"));
		assert.ok(el.textContent!.includes("Done"));
		assert.equal(el.querySelector('[data-testid="today-start"]'), null);
		assert.equal(el.querySelector('[data-testid="today-done"]'), null);
		await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="today-undo"]')!.click());
		assert.deepEqual(undone, ["hw5"]);
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
		topics: [],
		files: Array.from({ length: over.files ?? 1 }, () => ({})),
		facts: Array.from({ length: over.facts ?? 1 }, () => ({})),
		lessons: answers.length ? [{ chatId: "l", title: "l", kind: "study", updatedAt: "", answers, right: answers.length, answered: answers.length, score: 1 }] : [],
		deadlines: over.deadlines ?? [],
	} as unknown as ProgressPayload;
}

const LA = space("spc_la", "Linear Algebra", { color: 2 });
const OS = space("spc_os", "Operating Systems", { color: 5 });

function page(props: Partial<React.ComponentProps<typeof HomeBody>> = {}): string {
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={["/"]}>
			<HomeBody
				nowMs={NOW}
				ready
				spaces={[LA, OS]}
				lists={homeLists([], [], NOW)}
				deadlineProgress={new Map()}
				spacesProgress={new Map([["spc_la", spaceProgress({ counts: [9, 3, 0, 6] })], ["spc_os", spaceProgress({ counts: [4, 1, 0, 12] })]])}
				noSpaceProgress={null}
				progressErrors={new Map()}
								newFiles={new Map()}
				busyOn={null}
				lessonError={null}
				onStart={() => {}}
				onDone={() => {}}
				onUndo={() => {}}
				onRetry={() => {}}
				onAddSpace={() => {}}
				onAddDeadline={() => {}}
				onOpenSpace={() => {}}
				onStudyTopic={() => {}}
				{...props}
			/>
		</MemoryRouter>,
	);
}

/** How many times `needle` is in `html`. */
const count = (html: string, needle: string) => html.split(needle).length - 1;
const LA_OPEN = [d("q2", "Quiz 2", "2026-10-30", undefined, { kind: "quiz", spaceId: "spc_la", spaceName: "Linear Algebra" }), d("hw4", "Homework 4", "2026-11-01", undefined, { spaceId: "spc_os", spaceName: "Operating Systems" }), d("fin", "Final", "2026-12-08", undefined, { kind: "exam", spaceId: "spc_la", spaceName: "Linear Algebra" })];

/** A progress payload with an unfinished lesson and a weak topic to work on. */
function nextProgress(over: { lesson?: boolean; topic?: boolean } = {}): ProgressPayload {
	const { lesson = true, topic = true } = over;
	return {
		...spaceProgress(),
		lessons: lesson ? [{ chatId: "l1", title: "Pointers and arrays", kind: "study", updatedAt: "2026-10-28T10:00:00", unfinished: true, step: { done: 2, total: 3 }, answers: [], right: 0, answered: 0, score: null }] : [],
		topics: [{ id: "t1", name: "Master Theorem", rate: 0.3 }],
		overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 1, untested: 0 }, workOnNext: topic ? [{ topicId: "t1", name: "Master Theorem", status: "weak", reason: "" }] : [] },
	} as unknown as ProgressPayload;
}

describe("Home, under the deadlines: Unfinished and Work on next", () => {
	const order = (html: string, ...ids: string[]) => ids.map((id) => html.indexOf(`data-testid="${id}"`));

	it("both blocks sit after the deadlines and before the spaces, one key in each head", () => {
		const html = page({ spacesProgress: new Map([["spc_la", nextProgress()]]) });
		const at = order(html, "today-deadlines", "today-unfinished", "today-work-on-next", "today-spaces");
		assert.ok(at.every((i) => i >= 0));
		assert.deepEqual(at, [...at].sort((a, b) => a - b));
		const unfinished = section(html, "today-unfinished", "</section>");
		assert.match(tag(unfinished, "today-unfinished-row"), /href="\/chat\/l1"/);
		assert.ok(unfinished.includes("Pointers and arrays") && unfinished.includes("2 of 3") && unfinished.includes("Continue"));
		const work = section(html, "today-work-on-next", "</section>");
		assert.ok(work.includes("Master Theorem") && work.includes("weak") && work.includes("Study"));
		assert.match(tag(unfinished, "today-unfinished-key"), /href="\/chat\/l1"/);
		assert.ok(unfinished.indexOf("today-unfinished-key") < unfinished.indexOf("today-unfinished-row"), "the key is in the head, above the rows");
		assert.equal(count(work, 'data-testid="today-topic-key"'), 1);
		assert.ok(work.indexOf("today-topic-key") < work.indexOf("today-topic-row"));
	});

	it("one block alone", () => {
		const html = page({ spacesProgress: new Map([["spc_la", nextProgress({ topic: false })]]) });
		assert.ok(html.includes('data-testid="today-unfinished"'));
		assert.ok(!html.includes('data-testid="today-work-on-next"'));
		const topics = page({ spacesProgress: new Map([["spc_la", nextProgress({ lesson: false })]]) });
		assert.ok(topics.includes('data-testid="today-work-on-next"'));
		assert.ok(!topics.includes('data-testid="today-unfinished"'));
	});

	it("neither block with nothing unfinished and nothing to work on", () => {
		const html = page({ spacesProgress: new Map([["spc_la", nextProgress({ lesson: false, topic: false })]]) });
		assert.ok(!html.includes("today-unfinished") && !html.includes("today-work-on-next"));
	});

	it("a lesson row opens its space; a topic row starts a lesson on that topic in its space", async () => {
		const opened: string[] = [];
		const started: string[][] = [];
		const el = await mount(
			<MemoryRouter initialEntries={["/"]}>
				<HomeBody
					nowMs={NOW}
					ready
					spaces={[LA]}
					lists={homeLists([], [], NOW)}
					deadlineProgress={new Map()}
					spacesProgress={new Map([["spc_la", nextProgress()]])}
					noSpaceProgress={null}
					progressErrors={new Map()}
					newFiles={new Map()}
					busyOn={null}
					lessonError={null}
					onStart={() => {}}
					onDone={() => {}}
					onUndo={() => {}}
					onRetry={() => {}}
					onAddSpace={() => {}}
					onAddDeadline={() => {}}
					onOpenSpace={(id) => opened.push(id)}
					onStudyTopic={(spaceId, topicId) => started.push([spaceId, topicId])}
				/>
			</MemoryRouter>,
		);
		await act(async () => el.querySelector<HTMLElement>('[data-testid="today-unfinished-row"]')!.click());
		await act(async () => el.querySelector<HTMLElement>('[data-testid="today-topic-row"]')!.click());
		assert.deepEqual(opened, ["spc_la"]);
		assert.deepEqual(started, [["spc_la", "t1"]]);
	});
});

describe("Home, as a whole page", () => {
	const DONE_HW5 = { ...OPEN[2]!, done: true, doneAt: new Date(NOW).toISOString() };

	it("waits in one block until everything is in", () => {
		const html = page({ ready: false });
		assert.ok(html.includes('data-testid="home-loading"'));
		assert.ok(!html.includes('data-testid="today-studied"'));
	});

	it("with deadlines: the app's name and days studied, the card, the week with Later, then the spaces, with one main key", () => {
		const html = page({ lists: homeLists(LA_OPEN, [DONE_HW5], NOW) });
		const order = ["today-title", "today-studied", "today-card", "today-deadlines", "week-columns", "week-later", "today-spaces"].map((id) => html.indexOf(`data-testid="${id}"`));
		assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1]!)), `sections in order: ${order.join(", ")}`);
		assert.match(section(html, "today-title", "</h1>"), />godspeed$/);
		assert.equal(count(html, "lh-btn-main"), 1);
		assert.match(section(html, "today-card", "</h2>"), /Quiz 2/);
		assert.ok(section(html, "week-day-2026-11-01", "</section>").includes('data-testid="week-item-hw4"'));
		assert.ok(section(html, "week-day-2026-10-28", "</section>").includes('data-testid="week-item-hw5"'), "done today sits in today's column");
		assert.ok(section(html, "week-later", "</section>").includes('data-testid="week-item-fin"'));
		assert.ok(!html.includes('data-testid="today-later"'), "no Later card");
		for (const title of ["Deadlines", "Your spaces"]) assert.ok(html.includes(`>${title}</h2>`), title);
		assert.match(section(html, "home-add-deadline", "</button>"), /Add$/);
		assert.match(tag(html, "home-add-deadline"), /aria-label="Add a deadline"/);
		assert.ok(!/<button[^>]*class="[^"]*lh-btn[^"]*[ "]w-full/.test(html) && !/<button[^>]*class="(?:[^"]* )?w-full[^"]*lh-btn/.test(html), "no key wider than its label");
	});

	it("the week: seven columns from today, today's head filled and named for a screen reader, a block per deadline", () => {
		const html = page({ lists: homeLists([OPEN[0]!, ...LA_OPEN], [DONE_HW5], NOW) });
		assert.equal(count(html, 'data-testid="week-day-'), 7);
		const today = section(html, "week-day-2026-10-28", "</section>");
		assert.match(today, /<h3 class="[^"]*bg-highlight[^"]*"><span aria-hidden="true">Wed<span class="font-count"> 28<\/span><\/span><span class="sr-only">Wednesday, today<\/span>/);
		assert.ok(today.indexOf("week-item-late") < today.indexOf("week-item-hw5"), "late first, done last");
		assert.match(section(today, "week-item-late", "</button>"), />late<\/span>/);
		assert.match(tag(today, "week-item-late"), /aria-label="HW 4, CSE 21, was due Tue Oct 27, late"/);
		assert.match(tag(today, "week-item-hw5"), /aria-label="HW 5, CSE 29, due Friday, done"/);
		assert.ok(section(today, "week-item-hw5", "</button>").includes("line-through"));
		const fri = section(html, "week-day-2026-10-30", "</section>");
		assert.match(tag(fri, "week-item-q2"), /background:var\(--lh-space-2\)/);
		assert.ok(fri.includes('data-teacher-target="deadline:q2"'));
		assert.ok(!section(html, "week-day-2026-10-29", "</section>").includes("week-item-"), "an empty day is an empty well");
		assert.ok(!/class="grid[^"]*items-start/.test(html), "every column as tall as the fullest");
	});

	it("no spaces: the sentence and Add a space, nothing else", () => {
		const html = page({ spaces: [], spacesProgress: new Map() });
		assert.match(section(html, "today-empty", "</p>"), /None yet\. A space holds one subject&#x27;s files, deadlines and lessons\./);
		assert.ok(tag(html, "today-add-space").includes("lh-btn-main"));
		for (const id of ["today-studied", "today-spaces", "home-add-deadline"]) assert.ok(!html.includes(`data-testid="${id}"`), id);
	});

	it("spaces but no deadlines: no card and no week, the sentence, the spaces and Add a deadline", () => {
		const html = page();
		assert.ok(!html.includes('data-testid="today-card"'));
		assert.ok(!html.includes('data-testid="week-columns"'));
		assert.match(section(html, "today-empty", "</p>"), /None yet\. Teacher can add them from your files\./);
		assert.ok(html.includes('data-testid="home-add-deadline"'));
		assert.equal(count(html, "lh-btn-main"), 0);
	});

	it("nothing due this week: seven empty days and Later, no sentence", () => {
		const html = page({ lists: homeLists([LA_OPEN[2]!], [], NOW) });
		assert.ok(!html.includes('data-testid="today-empty"'));
		assert.equal(count(html, 'data-testid="week-day-'), 7);
		assert.ok(section(html, "week-later", "</section>").includes('data-testid="week-item-fin"'));
	});

	it("deadlines that failed to load keep Try again, the days studied and the spaces", () => {
		const html = page({ lists: null });
		assert.ok(html.includes("Couldn&#x27;t load your deadlines."));
		assert.ok(html.includes('data-testid="today-studied"'));
		assert.ok(html.includes('data-testid="today-spaces"'));
		assert.ok(!html.includes('data-testid="home-add-deadline"'));
	});

	it("the last 7 days with no answers, and with answers in two spaces, beside the date", () => {
		assert.match(section(page(), "today-studied", "</p>"), /No studying in the last 7 days\.$/);
		const progress = new Map([
			["spc_la", spaceProgress({ answeredAt: [new Date(2026, 9, 22, 10), new Date(2026, 9, 28, 9)] })],
			["spc_os", spaceProgress({ answeredAt: [new Date(2026, 9, 28, 20)] })],
		]);
		const html = page({ spacesProgress: progress });
		assert.match(section(html, "today-studied", "</p>"), /You studied 2 of the last 7 days and answered 3 questions\.$/);
		assert.ok(section(html, "today-title", "</header>").includes('data-testid="today-studied"'), "in the head, beside the app's name");
	});

	it("answers only in a lesson with no space count", () => {
		const html = page({ noSpaceProgress: spaceProgress({ answeredAt: [new Date(2026, 9, 27, 10), new Date(2026, 9, 27, 11)] }) });
		assert.match(section(html, "today-studied", "</p>"), /You studied 1 of the last 7 days and answered 2 questions\.$/);
	});
});

describe("Picking in the week", () => {
	function body(lists: ReturnType<typeof homeLists>, on: { done?: string[]; undone?: string[] } = {}) {
		return (
			<MemoryRouter initialEntries={["/"]}>
				<HomeBody
					nowMs={NOW}
					ready
					spaces={[LA, OS]}
					lists={lists}
					deadlineProgress={new Map()}
					spacesProgress={new Map()}
					noSpaceProgress={null}
					progressErrors={new Map()}
										newFiles={new Map()}
					busyOn={null}
					lessonError={null}
					onStart={() => {}}
					onDone={(x) => on.done?.push(x.id)}
					onUndo={(x) => on.undone?.push(x.id)}
					onRetry={() => {}}
					onAddSpace={() => {}}
					onAddDeadline={() => {}}
					onOpenSpace={() => {}}
					onStudyTopic={() => {}}
				/>
			</MemoryRouter>
		);
	}
	const $ = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
	const cardTitle = (el: HTMLElement) => $(el, "today-card-open")!.textContent;
	const DONE_HW5 = { ...OPEN[2]!, done: true, doneAt: new Date(NOW).toISOString() };

	it("the card shows the next thing until a block is picked; a click shows that one, pressed, and says so", async () => {
		const el = await mount(body(homeLists(LA_OPEN, [DONE_HW5], NOW)));
		assert.equal(cardTitle(el), "Quiz 2");
		assert.equal($(el, "week-item-q2")!.getAttribute("aria-pressed"), "true");
		assert.equal($(el, "today-showing")!.textContent, "", "nothing said before a pick");
		await act(async () => $(el, "week-item-hw4")!.click());
		assert.equal(cardTitle(el), "Homework 4");
		assert.equal($(el, "week-item-hw4")!.getAttribute("aria-pressed"), "true");
		assert.equal($(el, "week-item-q2")!.getAttribute("aria-pressed"), "false");
		assert.ok($(el, "week-item-hw4")!.className.includes("border-ink"));
		assert.equal($(el, "today-showing")!.textContent, "Showing Homework 4");
		assert.equal(count(el.innerHTML, "lh-btn-main"), 1);
	});

	it("a picked one ticked done today: struck through with Undo and no main key", async () => {
		const undone: string[] = [];
		const el = await mount(body(homeLists(LA_OPEN, [DONE_HW5], NOW), { undone }));
		await act(async () => $(el, "week-item-hw5")!.click());
		assert.equal(cardTitle(el), "HW 5");
		assert.equal($(el, "today-start"), null);
		await act(async () => $(el, "today-undo")!.click());
		assert.deepEqual(undone, ["hw5"]);
	});

	it("Mark done on the picked one keeps it shown, struck through, once the lists say it is done", async () => {
		const done: string[] = [];
		const el = await mount(body(homeLists(LA_OPEN, [], NOW), { done }));
		await act(async () => $(el, "week-item-hw4")!.click());
		await act(async () => $(el, "today-done")!.click());
		assert.deepEqual(done, ["hw4"]);
		const hw4Done = { ...LA_OPEN[1]!, done: true, doneAt: new Date(NOW).toISOString() };
		await act(async () => root!.render(body(homeLists([LA_OPEN[0]!, LA_OPEN[2]!], [hw4Done], NOW))));
		assert.equal(cardTitle(el), "Homework 4");
		assert.ok($(el, "today-undo"));
	});

	it("a pick that leaves the lists falls back to the next thing", async () => {
		const el = await mount(body(homeLists(LA_OPEN, [], NOW)));
		await act(async () => $(el, "week-item-hw4")!.click());
		await act(async () => root!.render(body(homeLists([LA_OPEN[0]!], [], NOW))));
		assert.equal(cardTitle(el), "Quiz 2");
		assert.equal($(el, "today-showing")!.textContent, "Showing Quiz 2");
	});

	it("a day with more than four shows three and +N more, which unfolds the whole week; Show less folds it", async () => {
		const busy = ["a", "b", "c", "e", "f"].map((id, i) => d(id, `Task ${id}`, "2026-10-30", `1${i}:00`));
		const el = await mount(body(homeLists(busy, [], NOW)));
		const fri = () => $(el, "week-day-2026-10-30")!;
		const shown = () => fri().querySelectorAll('[data-testid^="week-item-"]').length;
		assert.equal(shown(), 3);
		assert.equal($(el, "week-more")!.textContent, "+2 more");
		assert.equal($(el, "week-more")!.getAttribute("aria-expanded"), "false");
		await act(async () => $(el, "week-more")!.click());
		assert.equal(shown(), 5);
		assert.equal($(el, "week-rest")!.getAttribute("data-state"), "open");
		assert.ok($(el, "week-rest")!.className.includes("lh-collapse"), "a fold while it eases open");
		await act(async () => void $(el, "week-rest")!.dispatchEvent(new window.Event("transitionend", { bubbles: true })));
		assert.ok(!$(el, "week-rest")!.className.includes("lh-collapse"), "a plain box once open, so a resize can't cut it off");
		assert.equal($(el, "week-more")!.textContent, "Show less");
		await act(async () => $(el, "week-more")!.click());
		await act(async () => void (await new Promise((r) => setTimeout(r, 200))));
		assert.equal(shown(), 3);
		assert.equal($(el, "week-more")!.textContent, "+2 more");
	});

	it("a Later block picks into the card, with its days left and its key", async () => {
		const el = await mount(body(homeLists(LA_OPEN, [], NOW)));
		await act(async () => $(el, "week-item-fin")!.click());
		assert.equal(cardTitle(el), "Final");
		assert.equal($(el, "week-item-fin")!.getAttribute("aria-pressed"), "true");
		assert.ok($(el, "today-start"));
	});

	it("a day with four shows all four and no key", async () => {
		const four = ["a", "b", "c", "e"].map((id) => d(id, `Task ${id}`, "2026-10-30"));
		const el = await mount(body(homeLists(four, [], NOW)));
		assert.equal($(el, "week-day-2026-10-30")!.querySelectorAll('[data-testid^="week-item-"]').length, 4);
		assert.equal($(el, "week-more"), null);
	});
});

/** The week grid's column sizes, one per column. */
const gridColumns = (html: string) => html.match(/--week-cols:([^"]*)"/)![1]!.split(/ (?=minmax)/);

describe("Later, the eighth column", () => {
	it("after the seven days: its head, then blocks by date, each with its date always under the name", () => {
		const html = page({ lists: homeLists([OPEN[4]!, LA_OPEN[2]!], [], NOW) });
		const later = section(html, "week-later", "</section>");
		assert.ok(html.indexOf('data-testid="week-day-2026-11-03"') < html.indexOf('data-testid="week-later"'));
		assert.match(later, /<h3 class="[^"]*text-ink-2[^"]*"><span aria-hidden="true">Later<\/span><span class="sr-only">Later<\/span>/);
		assert.ok(later.indexOf("week-item-far") < later.indexOf("week-item-fin"), "Dec 1 before Dec 8");
		assert.match(section(later, "week-item-far", "</button>"), /<span class="w-full truncate[^"]*block">Dec 1<\/span>/);
		assert.match(tag(later, "week-item-far"), /aria-label="Project, CSE 21, due Tuesday Dec 1 at 12:00 PM"/);
		assert.ok(later.includes('data-teacher-target="deadline:far"'));
		assert.equal(gridColumns(html).length, 8);
	});

	it("an empty day takes the narrow-week share, a day with something a whole one; a block's second line is its time alone", () => {
		const html = page({ lists: homeLists([d("q", "Quiz", "2026-10-29", "08:00"), OPEN[2]!], [], NOW) });
		assert.deepEqual(gridColumns(html).slice(0, 4), ["minmax(min-content, var(--day-empty))", "minmax(0, 1fr)", "minmax(0, 1fr)", "minmax(min-content, var(--day-empty))"]);
		assert.ok(html.includes("@max-[760px]:[--day-empty:0.6fr]"));
		assert.match(section(html, "week-item-q", "</button>"), /hidden @min-\[1000px\]:block @max-\[600px\]:block">8:00 AM<\/span>/);
		assert.ok(!section(html, "week-item-hw5", "</button>").includes("@min-[1000px]:block"), "no time, no second line");
		// Under 600px the week is rows: an empty day leaves, today and a day with something stay.
		const narrow = [...html.matchAll(/<section data-testid="week-day-[^"]*" class="([^"]*)"/g)].map((m) => m[1]!.includes("@max-[600px]:hidden"));
		assert.deepEqual(narrow.slice(0, 4), [false, false, false, true], "today is empty and stays");
	});

	it("nothing after the week: seven columns and no Later", () => {
		const html = page({ lists: homeLists([OPEN[0]!], [], NOW) });
		assert.ok(!html.includes('data-testid="week-later"'));
		assert.equal(gridColumns(html).length, 7);
	});
});

describe("Your spaces", () => {
	it("one tile per space: its color square and name as its tab shows them, the topic bar with words for a screen reader, the counts, and the tile opens the space", () => {
		const html = page();
		const row = section(html, "today-space-spc_la", "</li>");
		assert.match(tag(row, "today-space-open"), /^<a[^>]*href="\/space"/);
		assert.ok(row.includes(">Linear Algebra<"));
		assert.ok(row.includes('role="img" aria-label="18 topics, 9 strong, 3 shaky, 6 not tested"'));
		assert.ok(row.includes(">18 topics, 9 strong, 3 shaky, 6 not tested<"));
		assert.match(row, /<span aria-hidden="true" class="size-2\.5 shrink-0" style="background:var\(--lh-space-2\)">/, "the space's color square");
		assert.ok(!row.includes("font-medium"), "the name in regular weight");
		assert.equal(count(row, "flex-grow:"), 3);
	});

	it("opening a row picks its space", async () => {
		const opened: string[] = [];
		const el = await mount(
			<MemoryRouter initialEntries={["/"]}>
				<HomeBody
					nowMs={NOW}
					ready
					spaces={[LA]}
					lists={homeLists([], [], NOW)}
					deadlineProgress={new Map()}
					spacesProgress={new Map([["spc_la", spaceProgress()]])}
					noSpaceProgress={null}
					progressErrors={new Map()}
										newFiles={new Map([["spc_la", "2 new files since Monday"]])}
					busyOn={null}
					lessonError={null}
						onStart={() => {}}
					onDone={() => {}}
					onUndo={() => {}}
					onRetry={() => {}}
					onAddSpace={() => {}}
					onAddDeadline={() => {}}
					onOpenSpace={(id) => opened.push(id)}
					onStudyTopic={() => {}}
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

	it("a space with no files says what to add; one whose files are being read says nothing, as the strip's peek says that", () => {
		const progress = new Map([["spc_la", spaceProgress({ files: 0, facts: 0 })], ["spc_os", spaceProgress({ files: 4, facts: 0 })]]);
		const html = page({ spaces: [LA, { ...OS, filesLeft: 4 }], spacesProgress: progress });
		assert.match(section(html, "today-space-spc_la", "</li>"), />No study files yet\.</);
		const os = section(html, "today-space-spc_os", "</li>");
		assert.ok(!os.includes("today-space-line"));
		assert.ok(!os.includes("bg-highlight"), "no chip for the teacher's work");
	});

	it("a space still loading is quiet; only a failed read says so", () => {
		const progress = new Map([["spc_la", spaceProgress({ counts: [9, 3, 0, 6] })]]);
		const loading = section(page({ spacesProgress: progress }), "today-space-spc_os", "</li>");
		assert.ok(!loading.includes("Couldn&#x27;t load"), "a new space waits for its first read");
		assert.ok(!loading.includes('role="img"'), "no bar, no counts");
		const failed = section(page({ spacesProgress: progress, progressErrors: new Map([["spc_os", "HTTP 500"]]) }), "today-space-spc_os", "</li>");
		assert.match(failed, />Couldn&#x27;t load its progress\.</);
	});

	it("one space, or six, each gets its tile", () => {
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
		assert.equal(html.split('size-3"').length - 1, 3, "one 12-point square per fact");
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
