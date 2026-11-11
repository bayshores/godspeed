/**
 * The Progress tab: the page body rendered from a fixture ProgressPayload:
 * the teacher's note, the next deadline (its words, bar and button), Most
 * needed, Pick up where you left off, How lessons went (one square per
 * answer, score, lesson links), the confidence chart (target lines, red
 * where a sure level falls short, takeaway, sure-but-wrong links into the
 * lesson), the no-class variant, the clicks, and the head's signature.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { AnswerOutcome, AnswerRef, CalibrationLevel, DeadlineProgress, FileCoverage, LessonProgress, ProgressPayload } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	IS_REACT_ACT_ENVIRONMENT: true,
	// next/link's prefetch-on-view reads these once mounted.
	self: globalThis,
	requestIdleCallback: (cb: () => void) => setTimeout(cb, 0),
	cancelIdleCallback: (id: number) => clearTimeout(id),
});

const { OverviewBody } = await import("../../src/frontend/components/overview/overview-body.tsx");
const { HeadSignature } = await import("../../src/frontend/components/overview/head-signature.tsx");

// ─── fixture ────────────────────────────────────────────────────────────────

function file(id: string, name: string, facts: number, inLessons: number): FileCoverage {
	return { fileId: id, name, facts, inLessons, share: facts === 0 ? null : inLessons / facts };
}

function answers(chatId: string, outcomes: string): AnswerRef[] {
	const map: Record<string, AnswerOutcome> = { r: "right", w: "wrong", d: "dontKnow" };
	return [...outcomes].map((c, i) => ({ chatId, toolCallId: `${chatId}-q${i}`, outcome: map[c]!, answeredAt: "2026-10-27T12:00:00Z" }));
}

function lesson(chatId: string, title: string, outcomes: string): LessonProgress {
	const a = answers(chatId, outcomes);
	const right = a.filter((x) => x.outcome === "right").length;
	return { chatId, title, kind: "teach", updatedAt: "2026-10-27T12:00:00Z", answers: a, right, answered: a.length, score: a.length ? right / a.length : null };
}

function level(n: 1 | 2 | 3 | 4 | 5, right: number, answered: number): CalibrationLevel {
	return { level: n, target: n * 20, right, answered, rate: answered === 0 ? null : right / answered };
}

const FILES = [
	file("f1", "Lecture 1 — Intro.pdf", 14, 12),
	file("f2", "Lecture 2 — Sets.pdf", 20, 10),
	file("f3", "Lecture 3 — Expectation.pdf", 18, 12),
	file("f4", "Lecture 4 — Convexity.pdf", 22, 0),
	file("f5", "Lecture 5 — New.pdf", 0, 0),
];

const PAYLOAD = {
	classId: "cls_1",
	today: "2026-10-27",
	topicsAt: null,
	grouping: false,
	topics: [],
	topicLinks: [],
	facts: [],
	files: FILES,
	nextUp: FILES[3]!,
	lessons: [
		lesson("c1", "Gradient descent", "rrrrrrrrrwwwd"),
		lesson("c2", "Bayesian knowledge tracing", "rrrrrwwwwdd"),
		lesson("c3", "Just started", ""),
	],
	calibration: {
		levels: [level(1, 2, 4), level(2, 6, 11), level(3, 8, 13), level(4, 7, 12), level(5, 5, 6)],
		sureButWrong: [
			{ chatId: "c1", lessonTitle: "Gradient descent", messageId: "m7", toolCallId: "t7", question: "Why momentum damps **zigzag** at $\\frac{1}{N}$", level: 4, answeredAt: "2026-10-27T12:00:00Z" },
		],
	},
	deadlines: [],
	overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [] },
	totals: { answered: 24, right: 14, wrong: 7, dontKnow: 3, rate: 14 / 24 },
} satisfies ProgressPayload;

/** Local noon on the fixture's day (the page compares against the window's clock). */
const NOW = new Date(2026, 9, 27, 12, 0).getTime();

function deadline(id: string, name: string, date: string, extra: Partial<DeadlineProgress> = {}): DeadlineProgress {
	return {
		id,
		kind: "homework",
		name,
		date,
		done: false,
		daysUntil: 0,
		files: [{ id: "f1", name: "Lecture 1 — Intro.pdf" }],
		topicIds: ["t1", "t2"],
		counts: { strong: 0, shaky: 0, weak: 0, untested: 0 },
		workOnNext: [],
		ready: 0.38,
		topics: [
			{ id: "t1", name: "Convexity", rate: 0.1 },
			{ id: "t2", name: "Sets", rate: 0.66 },
		],
		...extra,
	};
}

const DEADLINES = [
	deadline("d2", "Midterm 2", "2026-11-05", { kind: "exam", time: "19:00", ready: 0.72 }),
	deadline("d1", "HW 5", "2026-10-29", { time: "23:59", problems: { done: 2, total: 7 } }),
	deadline("d0", "Old quiz", "2026-10-20"),
	deadline("dx", "Done one", "2026-10-28", { done: true }),
];

const FACTS = [true, true, false, false, false].map((inLessons, i) => ({
	id: `p${i}`,
	name: `fact ${i}`,
	statement: "",
	topicId: "t1",
	born: null,
	inLessons,
	answers: [],
}));

type Props = React.ComponentProps<typeof OverviewBody>;

function body(props: Partial<Props> = {}) {
	return (
		<OverviewBody
			hasClass
			color="var(--lh-class-1)"
			data={{ ...PAYLOAD, deadlines: DEADLINES, facts: FACTS }}
			nowMs={NOW}
			busy={false}
			startError={null}
			onStudy={() => {}}
			onStartDeadline={() => {}}
			onAddDeadline={() => {}}
			{...props}
		/>
	);
}

const render = (props: Partial<Props> = {}) => renderToStaticMarkup(body(props));

/** The opening tag of the element carrying `testid`. */
function tag(html: string, testid: string): string {
	const m = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
	assert.ok(m, `expected ${testid}`);
	return m[0];
}

/** The whole element carrying `testid`, up to its first `close`. */
function section(html: string, testid: string, close = "</section>"): string {
	const start = html.indexOf(`data-testid="${testid}"`);
	assert.ok(start >= 0, `expected ${testid}`);
	return html.slice(start, html.indexOf(close, start));
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ─── order ──────────────────────────────────────────────────────────────────

describe("Progress, top to bottom", () => {
	it("note, next deadline, Most needed, Pick up where you left off, Facts, lessons, confidence", () => {
		const html = render({ note: { text: "Strong on sets.", at: "2026-10-26T12:00:00" } });
		const at = ["teacher-note", "next-deadline", "most-needed", "recent-lessons", "class-facts", "overview-lessons", "overview-confidence"].map((id) => html.indexOf(`data-testid="${id}"`));
		assert.ok(at.every((i) => i >= 0), "every part shows");
		assert.deepEqual(at, [...at].sort((a, b) => a - b));
	});

	it("loading: nothing yet", () => {
		const html = render({ data: null });
		for (const id of ["next-deadline", "most-needed", "recent-lessons", "class-facts", "overview-lessons", "overview-confidence"]) assert.ok(!html.includes(id));
	});

	it("no class: lessons and confidence only, under the classes to switch to", () => {
		const html = render({ hasClass: false, pickClass: <p>pick one</p> });
		assert.ok(html.indexOf("pick one") < html.indexOf('data-testid="recent-lessons"'));
		for (const id of ["next-deadline", "most-needed", "class-facts"]) assert.ok(!html.includes(id));
		for (const id of ["overview-lessons", "overview-confidence"]) assert.ok(html.includes(`data-testid="${id}"`));
	});

	it("no lessons, no answers: neither lesson list nor the chart", () => {
		const empty = { ...PAYLOAD, deadlines: DEADLINES, lessons: [], calibration: { levels: PAYLOAD.calibration.levels.map((l) => level(l.level, 0, 0)), sureButWrong: [] } };
		const html = render({ data: empty });
		for (const id of ["recent-lessons", "overview-lessons", "overview-confidence"]) assert.ok(!html.includes(id));
		assert.ok(html.includes('data-testid="next-deadline"'));
	});
});

// ─── the teacher's note ─────────────────────────────────────────────────────

describe("The teacher's note", () => {
	it("the note, who wrote it and when", () => {
		const html = render({ note: { text: "Strong on sets.", at: "2026-10-26T12:00:00" } });
		assert.match(text(section(html, "teacher-note")), /Strong on sets\. Teacher, after yesterday's lesson|Strong on sets\. Teacher, after yesterday&#x27;s lesson/);
	});

	it("no note: no sheet", () => {
		assert.ok(!render().includes("teacher-note"));
	});
});

// ─── the next deadline ──────────────────────────────────────────────────────

describe("The next deadline", () => {
	it("the soonest open deadline still ahead: days left, day, name, how far, and its page", () => {
		const html = section(render(), "next-deadline");
		assert.match(text(html), /2 days Thursday Oct 29 HW 5 2 of 7 problems done\./);
		assert.match(tag(html, "next-deadline-open"), /href="\/class\/deadline\/d1"/);
		assert.match(html, /width:28\.57/, "the bar is as far as the problems done");
		assert.match(html, /data-halley-target="deadline:d1"/);
	});

	it("homework is worked on, a test is studied for", () => {
		assert.match(text(section(render(), "next-deadline-start", "</button>")), /Work on HW 5/);
		const exam = render({ data: { ...PAYLOAD, deadlines: [DEADLINES[0]!] } });
		assert.match(text(section(exam, "next-deadline-start", "</button>")), /Study for Midterm 2/);
		assert.match(text(section(exam, "next-deadline")), /72% ready\./);
	});

	it("nothing to measure: says so, with no bar", () => {
		const html = section(render({ data: { ...PAYLOAD, deadlines: [deadline("d3", "Reading", "2026-11-06", { kind: "exam", topics: [], ready: null })] } }), "next-deadline");
		assert.match(text(html), /Not measured yet\./);
		assert.ok(!html.includes("lh-grow"));
	});

	it("no deadlines: one line and Add a deadline", () => {
		const html = render({ data: PAYLOAD });
		assert.match(text(section(html, "next-deadline-none")), /No deadlines yet Add a deadline/);
		assert.ok(!html.includes('data-testid="next-deadline"'));
	});

	it("only done or past ones: nothing is coming up", () => {
		const html = render({ data: { ...PAYLOAD, deadlines: DEADLINES.slice(2) } });
		assert.match(text(section(html, "next-deadline-none")), /Nothing is coming up\. Add a deadline/);
	});

	it("the button is off while a lesson is starting; a lesson that didn't start says so", () => {
		assert.match(tag(render({ busy: true }), "next-deadline-start"), /disabled=""/);
		assert.match(render({ startError: "Couldn't start the lesson. Try again." }), /data-testid="start-error"[^>]*>Couldn&#x27;t start the lesson\. Try again\.</);
		assert.ok(!render().includes("start-error"));
	});
});

// ─── most needed, recent lessons ────────────────────────────────────────────

describe("Most needed", () => {
	it("the weakest topic on the deadlines ahead and the deadlines it is on", () => {
		assert.match(text(section(render(), "most-needed")), /Most needed Convexity On HW 5 and Midterm 2 Study/);
	});

	it("no topics ahead: no list", () => {
		assert.ok(!render({ data: PAYLOAD }).includes("most-needed"));
	});
});

describe("Pick up where you left off", () => {
	it("the lessons worked on last, each with its score and age, opening the lesson", () => {
		const lessons = [
			{ ...lesson("c1", "Gradient descent", "rrw"), updatedAt: "2026-10-20T12:00:00" },
			{ ...lesson("c2", "Tracing", "rr"), updatedAt: new Date(NOW - 2 * 3_600_000).toISOString() },
			{ ...lesson("c3", "Just started", ""), updatedAt: new Date(NOW - 26 * 3_600_000).toISOString() },
			{ ...lesson("c4", "Oldest", "r"), updatedAt: "2026-10-01T12:00:00" },
		];
		const html = section(render({ data: { ...PAYLOAD, lessons } }), "recent-lessons");
		assert.match(text(html), /Tracing 2 of 2 right 2 hours ago .*Just started No answers yet yesterday .*Gradient descent 2 of 3 right Oct 20/);
		assert.ok(!html.includes("Oldest"));
		assert.match(tag(html, "recent-lesson-c2"), /href="\/chat\/c2"/);
		assert.match(html, /background:var\(--lh-class-1\)/);
	});
});

// ─── how lessons went ───────────────────────────────────────────────────────

describe("How lessons went", () => {
	it("one row per lesson with answers, linking to the lesson", () => {
		const html = section(render(), "overview-lessons");
		assert.match(tag(html, "overview-lesson-c1"), /href="\/chat\/c1"/);
		assert.match(tag(html, "overview-lesson-c2"), /href="\/chat\/c2"/);
		assert.ok(!html.includes("overview-lesson-c3"), "a lesson with no answers has no row");
	});

	it("one square per answer, in order, colored right / wrong / didn't know; the score", () => {
		const row = section(render(), "overview-lesson-c1", "</a>");
		const outcomes = [...row.matchAll(/data-outcome="(\w+)"/g)].map((m) => m[1]);
		assert.deepEqual(outcomes, [...Array(9).fill("right"), ...Array(3).fill("wrong"), "dontKnow"]);
		assert.match(row, /bg-ans-right/);
		assert.match(row, /bg-ans-wrong/);
		assert.match(row, /bg-ans-dontknow/);
		assert.match(text(row), /9 of 13/);
	});

	it("the takeaway names the lesson with the most misses", () => {
		assert.match(section(render(), "overview-lessons"), /“Bayesian knowledge tracing” has the most misses\./);
	});
});

// ─── confidence ─────────────────────────────────────────────────────────────

describe("Can you trust your confidence?", () => {
	it("five bars: right/answered above, a target line at level × 20 %", () => {
		const html = section(render(), "overview-confidence");
		for (const [n, score, top] of [[1, "2/4", 80], [2, "6/11", 60], [3, "8/13", 40], [4, "7/12", 20], [5, "5/6", 0]] as const) {
			const bar = section(html, `calibration-level-${n}`, "</div></div>");
			assert.ok(bar.includes(`>${score}<`), `level ${n} score`);
			assert.match(bar, new RegExp(`data-testid="calibration-target"[^>]*style="top:${top}%"`));
		}
		assert.match(html, /data-testid="calibration-right"[^>]*style="height:50%"/);
	});

	it("red where a sure level (4 or 5) is right less often than it claims; green otherwise", () => {
		const html = section(render(), "overview-confidence");
		for (const n of [4, 5]) {
			assert.match(tag(html, `calibration-level-${n}`), /data-overconfident="true"/);
			assert.match(section(html, `calibration-level-${n}`, "</div></div>"), /data-testid="calibration-right"[^>]*bg-ans-wrong/);
		}
		assert.doesNotMatch(tag(html, "calibration-level-2"), /data-overconfident/);
		assert.match(section(html, "calibration-level-2", "</div></div>"), /data-testid="calibration-right"[^>]*bg-ans-right/);
	});

	it("the takeaway names the red levels, beside what the bars mean", () => {
		const html = section(render(), "overview-confidence");
		assert.match(html, /At 4 and 5 you&#x27;re right less often than you think\./);
		assert.match(text(section(html, "calibration-legend", "</div>")), /How sure you were, from 1 \(guessing\) to 5 \(certain\)\. The fill is how often you were right\./);
	});

	it("a sure-but-wrong row opens the question in its lesson, with the level picked and real LaTeX", () => {
		const html = section(render(), "overview-confidence");
		assert.match(html, /Sure but wrong/);
		assert.match(tag(html, "sure-but-wrong-t7"), /href="\/chat\/c1#message-m7"/);
		const row = section(html, "sure-but-wrong-t7", "</a>");
		assert.match(text(row), /Why momentum damps zigzag at/);
		assert.match(row, /class="katex"/);
		assert.match(text(row), /Picked 4/);
	});

	it("a level with no answers shows a dash and no fill; no misses, no Sure but wrong", () => {
		const data = { ...PAYLOAD, calibration: { levels: [level(1, 0, 0), ...PAYLOAD.calibration.levels.slice(1)], sureButWrong: [] } };
		const html = section(render({ data }), "overview-confidence");
		const bar = section(html, "calibration-level-1", "</div></div>");
		assert.ok(bar.includes(">–<"));
		assert.ok(!bar.includes("calibration-right"));
		assert.ok(!html.includes("Sure but wrong"));
	});
});

// ─── clicks ─────────────────────────────────────────────────────────────────

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = null;
	host = null;
});

describe("clicks", () => {
	async function mount(props: Partial<Props>) {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => root!.render(body(props)));
		return host;
	}
	const click = (el: HTMLElement, testid: string) => act(async () => (el.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click());

	it("the next deadline's button starts it; Study starts a lesson on the Most needed topic", async () => {
		const started: string[] = [];
		const el = await mount({ onStartDeadline: (d) => started.push(d.id), onStudy: (id) => started.push(id) });
		await click(el, "next-deadline-start");
		await click(el, "most-needed-study");
		assert.deepEqual(started, ["d1", "t1"]);
	});

	it("Add a deadline, with none", async () => {
		let added = 0;
		const el = await mount({ data: PAYLOAD, onAddDeadline: () => added++ });
		await click(el, "next-deadline-add");
		assert.equal(added, 1);
	});
});

// ─── the head's signature ───────────────────────────────────────────────────

describe("The class's signature", () => {
	const sign = (share: number | null, signature = { kind: "math", value: "E[X]" } as const) => renderToStaticMarkup(<HeadSignature signature={signature} share={share} />);

	it("math in real LaTeX, inked as far as studied, with the share under it", () => {
		const html = sign(0.4);
		assert.match(html, /class="katex"/);
		assert.match(tag(html, "class-signature-ink"), /--ink:40%/);
		assert.match(tag(html, "class-studied") + text(section(html, "class-studied", "</p>")), /40% studied/);
	});

	it("nothing studied: no ink; loading: no share yet", () => {
		assert.ok(!sign(0).includes("class-signature-ink"));
		assert.match(sign(0), /0% studied/);
		const loading = sign(null);
		assert.ok(!loading.includes("class-studied") && !loading.includes("class-signature-ink"));
	});

	it("code in mono, text in the serif italic", () => {
		assert.match(sign(null, { kind: "code", value: "int *p" } as never), /font-mono[^>]*>int \*p</);
		assert.match(sign(null, { kind: "text", value: "carpe diem" } as never), /italic[^>]*>carpe diem</);
	});
});
