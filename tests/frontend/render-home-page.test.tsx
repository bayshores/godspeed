/**
 * Home's panes: ticking a deadline done (the shared notice), due next
 * (title, study, mark done, the pixel countdown, empty states), coming up
 * (ready blocks, class, countdown), a class's fact grid and the activity
 * log.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { rampColor, type AgentAction, type DeadlineProgress, type FactProgress } from "../../src/shared/core/index.ts";
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

const { ComingUp } = await import("../../src/frontend/components/home-page/coming-up.tsx");
const { DueNext } = await import("../../src/frontend/components/home-page/due-next.tsx");
const { ClassFacts } = await import("../../src/frontend/components/home-page/class-facts.tsx");
const { ActivityPane } = await import("../../src/frontend/components/home-page/activity-pane.tsx");
const { OpenDeadlinesProvider, useOpenDeadlines } = await import("../../src/frontend/components/use-open-deadlines.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { NoticeStack } = await import("../../src/frontend/components/notice-stack.tsx");

// Wed Oct 28 2026, 4:12 PM local.
const NOW = new Date(2026, 9, 28, 16, 12).getTime();

function d(id: string, name: string, date: string, time?: string, extra: Partial<OpenDeadline> = {}): OpenDeadline {
	return { id, kind: "homework", name, date, ...(time ? { time } : {}), fileIds: [], done: false, classId: "c21", className: "CSE 21", ...extra };
}

const OPEN = [
	d("late", "HW 4", "2026-10-27", "23:59"),
	d("quiz", "Reading quiz", "2026-10-28", "17:00", { kind: "quiz" }),
	d("hw5", "HW 5", "2026-10-30", undefined, { classId: "c29", className: "CSE 29" }),
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
	const original = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = original;
		writes.length = 0;
		saveFails = false;
		document.body.innerHTML = "";
	});

	async function mountProvider() {
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PUT") {
				writes.push({ url: String(input), body: JSON.parse(String(init.body)) });
				return saveFails ? Response.json({ error: "boom" }, { status: 500 }) : Response.json({ ok: true });
			}
			return Response.json({ deadlines: [OPEN[1]] });
		}) as typeof fetch;
		let tick!: () => void;
		function Harness() {
			const { deadlines, markDone } = useOpenDeadlines();
			tick = () => markDone(deadlines![0]!);
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
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		await act(async () => {
			tick();
			await new Promise((r) => setTimeout(r, 260));
		});
	}
	const notice = () => document.querySelector<HTMLElement>('[data-testid="done-notice"]');

	it("says 'Marked done' and Undo, and Undo ticks it back", async () => {
		await mountProvider();
		assert.equal(notice()!.textContent, "Marked doneUndo");
		assert.equal(notice()!.parentElement!.id, "lh-notices", "it stacks with the update and restart notices");
		assert.equal(notice()!.getAttribute("role"), "status");
		await act(async () => {
			document.querySelector<HTMLButtonElement>('[data-testid="done-notice-undo"]')!.click();
			await new Promise((r) => setTimeout(r, 10));
		});
		assert.deepEqual(writes, [
			{ url: "/api/classes/c21/deadlines/quiz", body: { done: true } },
			{ url: "/api/classes/c21/deadlines/quiz", body: { done: false } },
		]);
		assert.equal(notice(), null);
	});

	it("a save that fails says so", async () => {
		saveFails = true;
		await mountProvider();
		assert.equal(notice()!.textContent, "Couldn't mark it done. Try again.");
		assert.equal(notice()!.getAttribute("role"), "alert");
		assert.equal(document.querySelector('[data-testid="done-notice-undo"]'), null);
	});
});

// ─── Due next ───────────────────────────────────────────────────────────────

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

function dueNext(props: Partial<React.ComponentProps<typeof DueNext>> = {}) {
	return renderToStaticMarkup(
		<DueNext
			deadline={OPEN[1]!}
			progress={null}
			leaving={false}
			hasClasses
			busy={false}
			error={null}
			fixedNow={NOW}
			onStudy={() => {}}
			onDone={() => {}}
			onNewClass={() => {}}
			{...props}
		/>,
	);
}

describe("Due next", () => {
	it("the class and name, a link to the deadline's page, tagged for the teacher", () => {
		const html = dueNext();
		assert.match(html, /cse 21 \/<\/span>/);
		assert.match(tag(html, "due-next-open"), /href="\/class\/deadline\/quiz"/);
		assert.ok(html.includes('data-halley-target="deadline:quiz"'));
	});

	it("study for it, or continue its unfinished session; mark done", () => {
		assert.match(section(dueNext(), "due-next-study", "</button>"), /study for reading quiz/);
		const cont = dueNext({ progress: progressFor("quiz", { continueStudy: { chatId: "c", done: 1, total: 3 } }) });
		assert.match(section(cont, "due-next-study", "</button>"), /continue studying for reading quiz, 1 of 3 topics/);
		assert.match(section(dueNext(), "due-next-done", "</button>"), /mark done/);
	});

	it("the last 24h is a pixel clock; earlier it's plain text", () => {
		assert.match(tag(dueNext(), "pixel-countdown"), /<svg[^>]*data-mode="fine"[^>]*aria-label="48:00.00"/);
		const far = dueNext({ deadline: OPEN[3]! });
		assert.match(far, /data-testid="pixel-countdown" data-mode="days"[^>]*>in 8 days</);
	});

	it("nothing due says how deadlines get added; no class offers a new one", () => {
		assert.match(dueNext({ deadline: null }), /No deadlines yet\. Your agent can add them from the syllabus\./);
		const none = dueNext({ deadline: null, hasClasses: false });
		assert.match(none, /No classes yet\./);
		assert.ok(none.includes('data-testid="due-next-new-class"'));
	});

	it("a click passes the deadline", async () => {
		const studied: string[] = [];
		const done: string[] = [];
		const el = await mount(<DueNext deadline={OPEN[1]!} progress={null} leaving={false} hasClasses busy={false} error={null} fixedNow={NOW} onStudy={(x) => studied.push(x.id)} onDone={(x) => done.push(x.id)} onNewClass={() => {}} />);
		await act(async () => {
			el.querySelector<HTMLButtonElement>('[data-testid="due-next-study"]')!.click();
			el.querySelector<HTMLButtonElement>('[data-testid="due-next-done"]')!.click();
		});
		assert.deepEqual([studied, done], [["quiz"], ["quiz"]]);
	});
});

// ─── Coming up ──────────────────────────────────────────────────────────────

const PROGRESS = new Map([["hw5", progressFor("hw5", { files: [{ id: "f4", name: "Lecture 4.pdf" }], ready: 0.58 })]]);

function comingUp(deadlines: OpenDeadline[] = OPEN.slice(2)) {
	return renderToStaticMarkup(<ComingUp deadlines={deadlines} progress={PROGRESS} leaving={new Set()} fixedNow={NOW} />);
}

describe("Coming up", () => {
	it("a row opens its deadline's page and is tagged for the teacher", () => {
		const row = section(comingUp(), "coming-up-row-mid", "</li>");
		assert.match(row, /href="\/class\/deadline\/mid"/);
		assert.ok(comingUp().includes('data-halley-target="deadline:mid"'));
	});

	it("ten ready blocks, 58% fills six in the ramp color; no files, no blocks", () => {
		const row = section(comingUp(), "coming-up-row-hw5", "</li>");
		assert.match(row, /aria-label="58% ready"/);
		assert.equal(row.split(`background:${rampColor(0.58)}`).length - 1, 6);
		assert.equal(row.split("background:var(--border)").length - 1, 4);
		assert.ok(!section(comingUp(), "coming-up-row-mid", "</li>").includes("coming-up-ready"));
	});

	it("the class shows only when more than one class has deadlines", () => {
		assert.ok(comingUp().includes('data-testid="coming-up-class"'));
		assert.ok(!comingUp([OPEN[3]!, OPEN[4]!]).includes('data-testid="coming-up-class"'));
	});

	it("empty: nothing else is due", () => {
		assert.match(comingUp([]), /Nothing else is due\./);
	});
});

// ─── A class's facts ────────────────────────────────────────────────────────

function fact(inLessons: boolean, ...outcomes: ("right" | "wrong")[]): FactProgress {
	return { id: "f", name: "f", statement: "", topicId: "t", born: null, inLessons, answers: outcomes.map((outcome) => ({ outcome })) as never };
}

describe("A class's facts", () => {
	const cls = { id: "c29", name: "CSE 29" };
	it("its name with the facts studied, one square per fact", () => {
		const html = renderToStaticMarkup(
			<ClassFacts cls={cls} progress={{ facts: [fact(true, "right"), fact(true), fact(false)], files: [{} as never] }} onOpenFiles={() => {}} />,
		);
		assert.match(html, /cse 29 <span[^>]*>2\/3<\/span>/);
		assert.match(html, /aria-label="2 of 3 facts studied"/);
		assert.equal(html.split('class="size-[13px]"').length - 1, 3);
	});

	it("no study files: add files, to its Files page", async () => {
		const opened: string[] = [];
		const el = await mount(<ClassFacts cls={cls} progress={{ facts: [], files: [] }} onOpenFiles={(id) => opened.push(id)} />);
		await act(async () => el.querySelector<HTMLButtonElement>('[data-testid="class-facts-add-files"]')!.click());
		assert.deepEqual(opened, ["c29"]);
	});
});

// ─── Activity ───────────────────────────────────────────────────────────────

describe("Activity", () => {
	const action = (id: string, label: string, agent: string, removed?: true): AgentAction => ({
		id,
		at: new Date(NOW - 60_000).toISOString(),
		agent,
		label,
		classId: null,
		target: null,
		page: "/",
		...(removed ? { removed } : {}),
	});

	it("a line: the time, the verb in the agent's accent, what it was about", () => {
		const html = renderToStaticMarkup(<ActivityPane actions={[action("a", "Reading Lab 6.pdf", "Claude Code")]} nowMs={NOW} onGo={() => {}} />);
		assert.match(html, />16:11<\/span><span class="[^"]*text-tint[^"]*">reading<\/span>/);
		assert.match(html, />Lab 6\.pdf</);
	});

	it("a click goes there; a removed thing can't be visited", async () => {
		const went: string[] = [];
		const el = await mount(<ActivityPane actions={[action("a", "Adding HW 5", "Claude Code"), action("b", "Removed HW 4", "Claude Code", true)]} nowMs={NOW} onGo={(a) => went.push(a.id)} />);
		const lines = el.querySelectorAll<HTMLButtonElement>('[data-testid="home-activity-line"]');
		await act(async () => lines.forEach((l) => l.click()));
		assert.deepEqual(went, ["a"]);
		assert.ok(lines[1]!.disabled);
	});

	it("empty: what will show here", () => {
		assert.match(renderToStaticMarkup(<ActivityPane actions={[]} nowMs={NOW} onGo={() => {}} />), /Nothing yet\./);
	});
});
