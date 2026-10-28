/**
 * Home and the sidebar's Due soon (plan 2026-10-28, Phase 3): the Due soon
 * rows (overdue first, at most 4, the red box once overdue, the meta line,
 * the countdown, "All" to Home, hidden when nothing is open, the done
 * click), Coming up (groups, rows, covers + ready bar, the class chip, the
 * countdown column, the empty states) and a class block (facts, Next due,
 * Continue or New lesson, Open class).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { DeadlineProgress, LessonProgress } from "../src/core/index.ts";
import type { OpenDeadline } from "../src/components/deadlines-model.ts";

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

const { DueSoon } = await import("../src/components/sidebar/due-soon.tsx");
const { ComingUp } = await import("../src/components/home-page/coming-up.tsx");
const { ClassBlock } = await import("../src/components/home-page/class-block.tsx");

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

// ─── Due soon ───────────────────────────────────────────────────────────────

function dueSoon(deadlines: OpenDeadline[] | null = OPEN, leaving: Set<string> = new Set()) {
	return renderToStaticMarkup(<DueSoon deadlines={deadlines} leaving={leaving} fixedNow={NOW} onDone={() => {}} />);
}

describe("Due soon", () => {
	it("the 4 most urgent rows, overdue first", () => {
		const ids = [...dueSoon().matchAll(/data-testid="due-soon-row-([a-z0-9]+)"/g)].map((m) => m[1]);
		assert.deepEqual(ids, ["late", "quiz", "hw5", "mid"]);
	});

	it("heading and All → Home", () => {
		const html = dueSoon();
		assert.ok(html.includes(">Due soon</span>"));
		assert.match(tag(html, "due-soon-all"), /href="\/"/);
	});

	it("a row: name (14px), 'CSE 21 · 5:00 PM' (12px muted), countdown, 13px done box", () => {
		const row = section(dueSoon(), "due-soon-row-quiz", "</li>");
		assert.match(row, /text-\[14px\][^>]*>Reading quiz</);
		assert.match(row, /text-\[12px\][^"]*text-ink-2[^>]*>CSE 21 · 5:00 PM</);
		assert.match(row, /data-mode="fine"[^>]*font-mono[^>]*>48:00\.00</, "the last hour shows hundredths");
		assert.match(row, /data-testid="done-box"[^>]*style="width:13px;height:13px"/);
		assert.match(tag(dueSoon(), "due-soon-row-quiz"), /data-halley-target="deadline:quiz"/);
	});

	it("no time: the weekday in the meta line", () => {
		assert.match(section(dueSoon(), "due-soon-row-hw5", "</li>"), />CSE 29 · Fri</);
	});

	it("overdue: a red box and 'Overdue' in red", () => {
		const row = section(dueSoon(), "due-soon-row-late", "</li>");
		assert.match(row, /data-testid="done-box"[^>]*data-overdue="true"[^>]*class="[^"]*outline-ans-wrong/);
		assert.match(row, /data-mode="overdue" style="color:#EF4444"[^>]*>Overdue</);
		assert.doesNotMatch(section(dueSoon(), "due-soon-row-mid", "</li>"), /data-overdue/);
	});

	it("days away: 'in 8 days'", () => {
		assert.match(section(dueSoon(), "due-soon-row-mid", "</li>"), /data-mode="days"[^>]*>in 8 days</);
	});

	it("hidden while loading or with nothing open", () => {
		assert.equal(dueSoon(null), "");
		assert.equal(dueSoon([]), "");
	});

	it("a leaving row fades out", () => {
		assert.match(tag(dueSoon(OPEN, new Set(["quiz"])), "due-soon-row-quiz"), /data-leaving="true"[^>]*opacity-0/);
	});

	it("the done box ticks that deadline", async () => {
		const done: string[] = [];
		const el = await mount(<DueSoon deadlines={OPEN} leaving={new Set()} fixedNow={NOW} onDone={(x) => done.push(x.id)} />);
		await act(async () => (el.querySelector('[data-testid="due-soon-row-hw5"] [data-testid="done-box"]') as HTMLButtonElement).click());
		assert.deepEqual(done, ["hw5"]);
	});
});

// ─── Coming up ──────────────────────────────────────────────────────────────

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

const PROGRESS = new Map([
	["hw5", progressFor("hw5", { files: [{ id: "f4", name: "Lecture 4.pdf" }], ready: 0.58 })],
	["mid", progressFor("mid", { files: [{ id: "a", name: "a" }, { id: "b", name: "b" }], ready: null })],
]);

function comingUp(deadlines: OpenDeadline[] = OPEN, hasClasses = true) {
	return renderToStaticMarkup(
		<ComingUp deadlines={deadlines} progress={PROGRESS} leaving={new Set()} nowMs={NOW} fixedNow={NOW} hasClasses={hasClasses} onDone={() => {}} />,
	);
}

describe("Coming up", () => {
	it("head: 'Coming up' and '5 items · 1 overdue'", () => {
		const html = comingUp();
		assert.ok(html.includes(">Coming up</h2>"));
		assert.match(html, /data-testid="coming-up-summary"[^>]*>5 items · 1 overdue</);
	});

	it("groups in order, the Overdue label red", () => {
		const html = comingUp();
		const groups = [...html.matchAll(/data-testid="coming-up-group-([a-z0-9-]+)"/g)].map((m) => m[1]);
		assert.deepEqual(groups, ["overdue", "today", "2026-10-30", "2026-11-05", "later"]);
		assert.match(section(html, "coming-up-group-overdue", "</h3>"), /text-ans-wrong[^>]*>Overdue/);
		assert.match(section(html, "coming-up-group-today", "</h3>"), /text-ink-2[^>]*>Today/);
	});

	it("a row: done box, name with the kind muted, class chip, countdown and due time", () => {
		const row = section(comingUp(), "coming-up-row-quiz", "</li>");
		assert.match(row, /data-testid="done-box"[^>]*style="width:16px;height:16px"/);
		assert.match(row, /text-\[15\.5px\][^>]*font-bold[^>]*>Reading quiz<\/span><span[^>]*text-ink-2[^>]*>quiz</);
		assert.match(row, /data-testid="coming-up-class"[^>]*bg-tone-2[^>]*>CSE 21</);
		assert.match(row, /data-mode="fine"[^>]*font-mono font-bold tabular-nums text-\[16px\][^>]*>48:00\.00</);
		assert.match(row, /text-ink-3[^>]*>5:00 PM</);
		assert.match(row, /w-\[110px\]/);
	});

	it("overdue rows read 'was due Tue 11:59 PM'", () => {
		assert.match(section(comingUp(), "coming-up-row-late", "</li>"), />was due Tue 11:59 PM</);
	});

	it("a deadline with files: 'covers …', a 120px bar and '58% ready' in the ramp color", () => {
		const covers = section(comingUp(), "coming-up-row-hw5", "</li>");
		assert.match(covers, />covers Lecture 4</);
		assert.match(covers, /w-\[120px\]/);
		assert.match(covers, /width:58%;background:#E8C547/);
		assert.match(covers, /style="color:#E8C547"[^>]*>58% ready</);
	});

	it("files but nothing to be ready on yet: covers only; no files: no second line", () => {
		const mid = section(comingUp(), "coming-up-row-mid", "</li>");
		assert.match(mid, />covers 2 files</);
		assert.ok(!mid.includes("coming-up-ready"));
		assert.ok(!section(comingUp(), "coming-up-row-quiz", "</li>").includes("coming-up-covers"));
	});

	it("rows are tagged for Halley", () => {
		assert.match(tag(comingUp(), "coming-up-row-mid"), /data-halley-target="deadline:mid"/);
	});

	it("empty: how to add deadlines, or a class first", () => {
		assert.match(comingUp([]), /No deadlines coming up\. Your agent can add them from the syllabus, or you can use Add deadline\./);
		assert.match(comingUp([], false), /No classes yet\. Add one with New class in the class switcher, then add its deadlines in Edit class\./);
		assert.ok(!comingUp([]).includes("coming-up-summary"));
	});
});

// ─── class block ────────────────────────────────────────────────────────────

function lesson(chatId: string, title: string): LessonProgress {
	return { chatId, title, kind: "teach", updatedAt: "2026-10-28T12:00:00Z", answers: [], right: 0, answered: 0, score: null };
}

const FACTS = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: "", statement: "", topicId: "t", born: null, inLessons: i < 2, answers: [] }));

function block(props: Partial<React.ComponentProps<typeof ClassBlock>> = {}) {
	return renderToStaticMarkup(
		<ClassBlock
			cls={{ id: "c21", name: "CSE 21", description: "Discrete math\nSecond line" }}
			progress={{ facts: FACTS, lessons: [lesson("ch1", "Induction"), lesson("ch0", "Older")] }}
			nextDue={OPEN[1]!}
			nowMs={NOW}
			onContinue={() => {}}
			onNewLesson={() => {}}
			onOpenClass={() => {}}
			{...props}
		/>,
	);
}

describe("Class block", () => {
	it("the name in CMU and the description's first line", () => {
		const html = block();
		assert.match(html, /font-title[^>]*>CSE 21</);
		assert.ok(html.includes(">Discrete math</p>"));
		assert.ok(!html.includes("Second line"));
	});

	it("'2 of 5 facts studied' (the number mono 18 bold) with a bar", () => {
		const facts = section(block(), "class-block-facts", "</div>");
		assert.match(facts, /font-mono text-\[18px\][^>]*font-bold[^>]*>2</);
		assert.match(facts, /of <span[^>]*>5<\/span> facts studied/);
		assert.match(block(), /style="width:40%"/);
	});

	it("Next due names the soonest open deadline", () => {
		assert.match(section(block(), "class-block-next-due", "</p>"), /Next due: <span[^>]*>Reading quiz, today 5:00 PM</);
		assert.ok(!block({ nextDue: null }).includes("class-block-next-due"));
	});

	it("Continue the latest lesson (white, fills the width) and Open class (tone)", () => {
		const html = block();
		assert.match(tag(html, "class-block-continue"), /flex-1[^"]*bg-ink/);
		assert.ok(html.includes(">Continue: Induction</span>"));
		assert.match(tag(html, "class-block-open"), /bg-tone/);
		assert.ok(!html.includes("class-block-new-lesson"));
	});

	it("no lessons yet: New lesson instead of Continue", () => {
		const html = block({ progress: { facts: FACTS, lessons: [] } });
		assert.ok(html.includes('data-testid="class-block-new-lesson"'));
		assert.ok(!html.includes("class-block-continue"));
	});

	it("the buttons call back with the class (and the lesson)", async () => {
		const calls: string[] = [];
		const el = await mount(
			<ClassBlock
				cls={{ id: "c21", name: "CSE 21", description: "" }}
				progress={{ facts: FACTS, lessons: [lesson("ch1", "Induction")] }}
				nextDue={null}
				nowMs={NOW}
				onContinue={(c, chat) => calls.push(`continue ${c} ${chat}`)}
				onNewLesson={(c) => calls.push(`new ${c}`)}
				onOpenClass={(c) => calls.push(`open ${c}`)}
			/>,
		);
		await act(async () => (el.querySelector('[data-testid="class-block-continue"]') as HTMLButtonElement).click());
		await act(async () => (el.querySelector('[data-testid="class-block-open"]') as HTMLButtonElement).click());
		assert.deepEqual(calls, ["continue c21 ch1", "open c21"]);
	});
});
