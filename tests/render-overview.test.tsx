/**
 * The Class Overview (redesign plan, Phase 4): the page body rendered from a
 * fixture ProgressPayload — Ready for what's due (the runway's stops,
 * rings, lines, "+N later", Most needed), How lessons went (one block per
 * answer, score, lesson links), the confidence chart (target lines, red
 * where a sure level falls short, takeaway, sure-but-wrong links into the
 * lesson), the No-class variant, and the runway's clicks.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { AnswerOutcome, AnswerRef, CalibrationLevel, DeadlineProgress, FileCoverage, LessonProgress, ProgressPayload } from "../src/core/index.ts";

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

const { OverviewBody } = await import("../src/components/overview/overview-body.tsx");

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

function render(props: Partial<React.ComponentProps<typeof OverviewBody>> = {}) {
	return renderToStaticMarkup(
		<OverviewBody
			name="ML Foundations"
			description="Optimization and learning theory"
			hasClass
			classId="cls_ml"
			data={PAYLOAD}
			nowMs={NOW}
			busy={false}
			startError={null}
			onPractice={() => {}}
			onLearn={() => {}}
			{...props}
		/>,
	);
}

/** The opening tag of the element carrying `testid`. */
function tag(html: string, testid: string): string {
	const m = html.match(new RegExp(`<[^>]*data-testid="${testid}"[^>]*>`));
	assert.ok(m, `expected ${testid}`);
	return m[0];
}

/** The whole element carrying `testid` (up to its first closing </a>/</section>/</div>). */
function section(html: string, testid: string, close = "</section>"): string {
	const start = html.indexOf(`data-testid="${testid}"`);
	assert.ok(start >= 0, `expected ${testid}`);
	return html.slice(start, html.indexOf(close, start));
}

// ─── header ─────────────────────────────────────────────────────────────────

describe("Overview header", () => {
	it("a class gets the cover: CMU title, description, progress line, tagged for Halley", () => {
		const html = renderRunway();
		assert.ok(html.includes('data-testid="class-cover"'));
		assert.ok(html.includes('data-halley-target="class:cls_ml"'));
		assert.match(section(html, "class-cover-progress", "</div></header>"), /width:40%.*>40% studied</);
		assert.ok(!render().includes("class-cover-progress"), "no facts yet, no line");
		assert.ok(!html.includes("class-signature-ink"), "no signature, no background line");
		assert.ok(!html.includes("class-cover-note"), "no note, no box");
	});

	it("a cover without a signature offers 'Add a signature'", () => {
		assert.match(renderRunway(DEADLINES, { onAddSignature: () => {} }), /Add a signature/);
		assert.ok(!renderRunway(DEADLINES, { onAddSignature: () => {}, signature: { kind: "code", value: "int *p;" } }).includes("Add a signature"), "has one");
	});

	it("the signature is set behind the name in its own type and inks in as far as studied", () => {
		const math = render({ classId: "cls_ml", signature: { kind: "math", value: "\\nabla f(x) = 0" } });
		assert.match(section(math, "class-signature-ink"), /class="katex"/);
		assert.ok(!section(math, "class-signature-ink", "</header>").includes("lh-ink"), "nothing studied, no ink");
		const code = renderRunway(DEADLINES, { signature: { kind: "code", value: "int *p = &x;" } });
		const sig = section(code, "class-signature-ink", "</header>");
		assert.match(sig, /font-mono/);
		assert.match(sig, /aria-hidden="true"/);
		assert.match(sig, /class="lh-ink[^"]*" style="--ink:40%"/);
		const text = render({ classId: "cls_ml", signature: { kind: "text", value: "We the People" } });
		assert.match(section(text, "class-signature-ink"), /italic/);
	});

	it("the cover shows the description's first sentence only", () => {
		const html = render({ description: "UCSD CSE 21, taught by Miles Jones. Discrete math: counting.\nTextbook: Rosen." });
		assert.ok(html.includes(">UCSD CSE 21, taught by Miles Jones.</p>"));
		assert.ok(!html.includes("Discrete math"));
	});

	it("Halley's note sits on the cover", () => {
		const html = render({ classId: "cls_ml", note: { text: "Gradient steps are clicking. Momentum is next.", at: "2026-10-28T10:00:00.000Z" } });
		const note = section(html, "class-cover-note", "</p>");
		assert.ok(note.includes("halley-face"));
		assert.ok(note.includes("Gradient steps are clicking. Momentum is next."));
		assert.match(section(html, "class-cover-note", "</div></div>"), /Halley · after /);
		assert.doesNotMatch(render({ classId: "cls_ml", nowMs: null, note: { text: "x", at: "2026-10-28T10:00:00.000Z" } }), /Halley · /, "no clock yet, no when");
	});

	it("loading: no progress line yet", () => {
		assert.ok(!render({ classId: "cls_ml", data: null }).includes("class-cover-progress"));
	});

	it("the class name is the CMU title; the description sits under it", () => {
		const html = render();
		assert.match(tag(html, "overview-name"), /font-title/);
		assert.ok(html.includes(">ML Foundations</h1>"));
		assert.ok(html.includes("Optimization and learning theory"));
	});

	it("no description: no empty line", () => {
		assert.doesNotMatch(render({ description: "" }), /<p class="[^"]*text-base/);
	});
});

// ─── ready for what's due ───────────────────────────────────────────────────

/** Local noon on the fixture's day (the runway compares against the window's clock). */
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
	deadline("d1", "HW 5", "2026-10-29", { time: "23:59" }),
	deadline("d2", "Midterm 2", "2026-11-05", { kind: "exam", time: "19:00", ready: 0.72 }),
	deadline("d3", "Reading", "2026-11-06", { files: [], topicIds: [], topics: [], ready: null }),
	deadline("d0", "Old quiz", "2026-10-20"),
	deadline("dx", "Done one", "2026-10-30", { done: true }),
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

function renderRunway(deadlines: DeadlineProgress[] = DEADLINES, props: Partial<React.ComponentProps<typeof OverviewBody>> = {}) {
	return render({ data: { ...PAYLOAD, deadlines, facts: FACTS }, ...props });
}

describe("Ready for what's due", () => {
	it("Today first, then the open deadlines still ahead, soonest first (no overdue, no done)", () => {
		const html = renderRunway();
		const stops = [...html.matchAll(/data-testid="runway-(today|stop-[a-z0-9]+)"/g)].map((m) => m[1]);
		assert.deepEqual(stops, ["today", "stop-d1", "stop-d2", "stop-d3"]);
		assert.match(section(html, "runway-today", "</div></div></div>"), /Today<\/span><span[^>]*>Tue Oct 27</);
	});

	it("the head counts facts studied in the whole class", () => {
		const head = section(renderRunway(), "runway-facts", "</span></h2>");
		assert.match(head, />2<\/span> of <span[^>]*>5<\/span> facts studied in/);
	});

	it("rings show the ready % in mono; a deadline with no files shows an empty ring with –", () => {
		const html = renderRunway();
		assert.match(section(html, "runway-ring-d1", "</button>"), /font-mono[^>]*>38%</);
		assert.match(section(html, "runway-ring-d2", "</button>"), />72%</);
		const empty = section(html, "runway-ring-d3", "</button>");
		assert.match(empty, />–</);
		assert.doesNotMatch(empty, /runway-arc/);
		assert.match(tag(html, "runway-ring-d3"), /disabled=""/);
	});

	it("every ring is 88px; the arc uses the ramp color", () => {
		const html = renderRunway();
		for (const id of ["d1", "d2", "d3"]) assert.match(tag(html, `runway-ring-${id}`), /width:88px;height:88px/);
		assert.match(section(html, "runway-ring-d2", "</button>"), /data-testid="runway-arc"[^>]*stroke="#9BD35A"/);
	});

	it("names and meta: exams read 'Exam · Thu Nov 5', others the date", () => {
		const html = renderRunway();
		assert.ok(section(html, "runway-stop-d2", "</div></div></div>").includes("Exam · Thu Nov 5"));
		assert.ok(section(html, "runway-stop-d1", "</div></div></div>").includes(">Thu Oct 29<"));
	});

	it("lines join the stops only between them, with the days above each", () => {
		const html = renderRunway();
		const lines = [...html.matchAll(/data-testid="runway-line"/g)];
		assert.equal(lines.length, 3, "Today→d1, d1→d2, d2→d3");
		assert.ok(html.includes(">2 days<"));
		assert.ok(html.includes(">7 days<"));
		assert.ok(html.includes(">1 day<"));
		// The line leaves 10px at each mark: 6px dot + 10, 44px ring + 10.
		assert.match(html, /left:calc\(50% \+ 16px\);right:calc\(-50% \+ 54px\)/);
	});

	it("tags each stop for Halley", () => {
		assert.match(tag(renderRunway(), "runway-stop-d1"), /data-halley-target="deadline:d1"/);
	});

	it("more than 5 open deadlines: 4 rings and '+N later' to Home", () => {
		const many = ["a", "b", "c", "d", "e", "f", "g"].map((id, i) => deadline(id, `HW ${id}`, `2026-11-${String(i + 1).padStart(2, "0")}`));
		const html = renderRunway(many);
		assert.equal([...html.matchAll(/data-testid="runway-stop-/g)].length, 4);
		assert.match(section(html, "runway-later", "</a>"), /\+3 later/);
		assert.match(tag(html, "runway-later"), /href="\/"/);
	});

	it("exactly 5: all five rings, no '+N later'", () => {
		const five = ["a", "b", "c", "d", "e"].map((id, i) => deadline(id, `HW ${id}`, `2026-11-0${i + 1}`));
		const html = renderRunway(five);
		assert.equal([...html.matchAll(/data-testid="runway-stop-/g)].length, 5);
		assert.ok(!html.includes("runway-later"));
	});

	it("no open deadlines: just Today and a plain line", () => {
		const html = renderRunway([]);
		assert.ok(html.includes('data-testid="runway-today"'));
		assert.ok(!html.includes("runway-stop-"));
		assert.ok(!html.includes("runway-line"));
		assert.match(section(html, "runway-empty", "</p>"), /No deadlines yet\. Your agent can add them from the syllabus, or you can add them in Edit class\./);
		assert.ok(!html.includes("runway-most-needed"));
	});

	it("Most needed: the weakest topic and the deadlines that cover it", () => {
		const row = section(renderRunway(), "runway-most-needed", "</button>");
		assert.match(row, />Convexity</);
		assert.match(row, /on HW 5 and Midterm 2/);
		assert.match(row, /data-testid="runway-learn-this"/);
	});

	it("No class or loading: no runway", () => {
		assert.ok(!renderRunway(DEADLINES, { hasClass: false, classId: null }).includes("overview-runway"));
		assert.ok(!render({ data: null }).includes("overview-runway"));
		assert.ok(!renderRunway(DEADLINES, { nowMs: null }).includes("overview-runway"));
	});

	it("No class: the same page without the runway", () => {
		const html = render({ hasClass: false, classId: null, name: "No class", description: "" });
		assert.ok(html.includes('data-testid="overview-lessons"'));
		assert.ok(html.includes('data-testid="overview-confidence"'));
		assert.ok(html.includes(">No class</h1>"));
	});
});

// ─── how lessons went ───────────────────────────────────────────────────────

describe("How lessons went", () => {
	it("one row per lesson with answers, linking to the lesson", () => {
		const html = render();
		assert.match(tag(html, "overview-lesson-c1"), /href="\/chat\/c1"/);
		assert.match(tag(html, "overview-lesson-c2"), /href="\/chat\/c2"/);
		assert.ok(!html.includes("overview-lesson-c3"), "a lesson with no answers has no row");
	});

	it("one block per answer, in order, colored right / wrong / didn't know; the score in mono", () => {
		const row = section(render(), "overview-lesson-c1", "</a>");
		const outcomes = [...row.matchAll(/data-outcome="(\w+)" class="[^"]*\b(bg-ans-right|bg-ans-wrong|bg-ans-dontknow)\b/g)].map((m) => `${m[1]}:${m[2]}`);
		assert.equal(outcomes.length, 13);
		assert.equal(outcomes[0], "right:bg-ans-right");
		assert.equal(outcomes[9], "wrong:bg-ans-wrong");
		assert.equal(outcomes[12], "dontKnow:bg-ans-dontknow");
		assert.match(row, /font-mono[^"]*">9 \/ 13<\/span>/);
	});

	it("the takeaway names the lesson with the most misses", () => {
		assert.ok(render().includes("Bayesian knowledge tracing has the most misses."));
	});
});

// ─── confidence ─────────────────────────────────────────────────────────────

describe("Can you trust your confidence?", () => {
	it("five bars: right/answered above, a target line at level × 20 %", () => {
		const html = render();
		for (const n of [1, 2, 3, 4, 5]) assert.ok(html.includes(`data-testid="calibration-level-${n}"`));
		const l1 = section(html, "calibration-level-1", 'data-testid="calibration-level-2"');
		assert.ok(l1.includes(">2/4<"));
		assert.match(l1, /data-testid="calibration-target"[^>]*style="top:80%"/);
		assert.match(l1, /data-testid="calibration-right"[^>]*style="height:50%"/);
		const l5 = section(html, "calibration-level-5", "</section>");
		assert.match(l5, /data-testid="calibration-target"[^>]*style="top:0%"/);
	});

	it("red where a sure level (4–5) is right less often than it claims; gray otherwise", () => {
		const html = render();
		for (const n of [4, 5]) assert.match(tag(html, `calibration-level-${n}`), /data-overconfident="true"/);
		for (const n of [1, 2, 3]) assert.doesNotMatch(tag(html, `calibration-level-${n}`), /data-overconfident/);
		const l4 = section(html, "calibration-level-4", 'data-testid="calibration-level-5"');
		assert.match(l4, /calibration-right" class="[^"]*bg-ans-wrong/);
		const l2 = section(html, "calibration-level-2", 'data-testid="calibration-level-3"');
		assert.match(l2, /calibration-right" class="[^"]*bg-ink-3/);
	});

	it("the takeaway names the red levels", () => {
		assert.ok(render().includes("At 4 and 5 you&#x27;re right less often than you think."));
	});

	it("a sure-but-wrong row opens the question in its lesson, with the level picked and real LaTeX", () => {
		const html = render();
		assert.match(tag(html, "sure-but-wrong-t7"), /href="\/chat\/c1#message-m7"/);
		const row = section(html, "sure-but-wrong-t7", "</a>");
		assert.ok(row.includes("Picked 4"));
		assert.ok(row.includes('class="katex"'), "math renders through KaTeX");
		assert.ok(!row.includes("**"), "markdown markers are dropped");
	});

	it("a level with no answers shows a dash and no fill", () => {
		const data = { ...PAYLOAD, calibration: { ...PAYLOAD.calibration, levels: [level(1, 0, 0), level(2, 1, 1), level(3, 0, 0), level(4, 0, 0), level(5, 0, 0)] } };
		const l1 = section(render({ data }), "calibration-level-1", 'data-testid="calibration-level-2"');
		assert.ok(l1.includes(">–<"));
		assert.ok(!l1.includes("calibration-right"));
	});
});

// ─── loading / empty ────────────────────────────────────────────────────────

describe("loading and empty", () => {
	it("loading: the header alone", () => {
		const html = render({ data: null });
		assert.ok(html.includes(">ML Foundations</h1>"));
		for (const id of ["overview-runway", "overview-lessons", "overview-confidence"]) assert.ok(!html.includes(id));
	});

	it("no lessons, no answers: only the runway", () => {
		const empty = {
			...PAYLOAD,
			files: [],
			nextUp: null,
			lessons: [],
			calibration: { levels: PAYLOAD.calibration.levels.map((l) => level(l.level, 0, 0)), sureButWrong: [] },
		};
		const html = render({ data: empty });
		for (const id of ["overview-lessons", "overview-confidence"]) assert.ok(!html.includes(id));
		assert.ok(html.includes('data-testid="overview-runway"'));
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

describe("runway clicks", () => {
	async function mount(onPractice: (d: DeadlineProgress) => void, onLearn: (id: string) => void) {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => {
			root!.render(
				<OverviewBody
					name="ML Foundations"
					description=""
					hasClass
					data={{ ...PAYLOAD, deadlines: DEADLINES, facts: FACTS }}
					nowMs={NOW}
					busy={false}
					startError={null}
					onPractice={onPractice}
					onLearn={onLearn}
				/>,
			);
		});
		return host;
	}

	it("a ring practices that deadline's topics", async () => {
		const practiced: string[] = [];
		const el = await mount((d) => practiced.push(d.id), () => {});
		await act(async () => (el.querySelector('[data-testid="runway-ring-d2"]') as HTMLButtonElement).click());
		assert.deepEqual(practiced, ["d2"]);
	});

	it("Learn this starts a lesson on the Most needed topic", async () => {
		const learned: string[] = [];
		const el = await mount(() => {}, (id) => learned.push(id));
		await act(async () => (el.querySelector('[data-testid="runway-learn-this"]') as HTMLButtonElement).click());
		assert.deepEqual(learned, ["t1"]);
	});

	it("a practice or lesson that didn't start says so under Learn this", () => {
		const html = renderRunway(DEADLINES, { startError: "Couldn't start the lesson. Try again." });
		const after = html.slice(html.indexOf('data-testid="runway-learn-this"'));
		assert.match(after, /data-testid="runway-start-error"[^>]*>Couldn&#x27;t start the lesson\. Try again\.</);
		assert.ok(!renderRunway(DEADLINES).includes("runway-start-error"));
	});

	it("rings and Learn this are disabled while a lesson is starting", () => {
		const html = renderRunway(DEADLINES, { busy: true });
		assert.match(tag(html, "runway-learn-this"), /disabled=""/);
		assert.match(tag(html, "runway-ring-d1"), /disabled=""/);
	});
});
