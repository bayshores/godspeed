/**
 * The Class Overview (redesign plan, Phase 4): the page body rendered from a
 * fixture ProgressPayload — coverage blocks (width by facts, fill by share,
 * unstudied white, file links), Next up, How lessons went (one block per
 * answer, score, lesson links), the confidence chart (target lines, red
 * where a sure level falls short, takeaway, sure-but-wrong links into the
 * lesson), the No-class variant, and the "Learn this" click.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import type { AnswerOutcome, AnswerRef, CalibrationLevel, FileCoverage, LessonProgress, ProgressPayload } from "../src/core/index.ts";

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
	exams: [],
	overall: { topicIds: [], counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, workOnNext: [] },
	totals: { answered: 24, right: 14, wrong: 7, dontKnow: 3, rate: 14 / 24 },
} satisfies ProgressPayload;

function render(props: Partial<React.ComponentProps<typeof OverviewBody>> = {}) {
	return renderToStaticMarkup(
		<OverviewBody name="ML Foundations" description="Optimization and learning theory" hasClass data={PAYLOAD} busy={false} onLearn={() => {}} {...props} />,
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
	it("the class name is the CMU title; the description sits under it", () => {
		const html = render();
		assert.match(tag(html, "overview-name"), /font-title/);
		assert.ok(html.includes(">ML Foundations</h1>"));
		assert.ok(html.includes("Optimization and learning theory"));
	});

	it("no description: no empty line", () => {
		assert.doesNotMatch(render({ description: "" }), /<p class="text-base/);
	});
});

// ─── coverage ───────────────────────────────────────────────────────────────

describe("Coverage", () => {
	it("one block per study file, in order, each linking to the file on the Files page", () => {
		const html = render();
		const ids = [...html.matchAll(/data-testid="coverage-file-(f\d)"/g)].map((m) => m[1]);
		assert.deepEqual(ids, ["f1", "f2", "f3", "f4", "f5"]);
		assert.match(tag(html, "coverage-file-f3"), /href="\/class\/files#file-f3"/);
	});

	it("width follows the fact count (a file with no facts yet keeps a sliver)", () => {
		const html = render();
		assert.match(tag(html, "coverage-file-f4"), /flex:22 1 0/);
		assert.match(tag(html, "coverage-file-f1"), /flex:14 1 0/);
		assert.match(tag(html, "coverage-file-f5"), /flex:1 1 0/);
	});

	it("a studied file is dark with a fill for the share that came up; an unstudied one is white", () => {
		const html = render();
		const f3 = section(html, "coverage-file-f3", "</a>");
		assert.match(f3, /bg-tone-2/);
		assert.match(f3, /data-testid="coverage-fill"[^>]*style="height:67%"/);
		assert.match(tag(html, "coverage-file-f3"), /data-studied="true"/);
		const f4 = section(html, "coverage-file-f4", "</a>");
		assert.match(f4, /bg-ink/);
		assert.doesNotMatch(f4, /coverage-fill/);
		assert.doesNotMatch(tag(html, "coverage-file-f4"), /data-studied/);
	});

	it("the summary counts studied files: 3 of 5 files studied", () => {
		const html = render();
		assert.match(html, /data-testid="coverage-studied"[^>]*>3<\/span>/);
		assert.ok(html.includes("of 5 files studied"));
	});

	it("Next up names the earliest unstudied file (no extension) with its fact count and Learn this", () => {
		const next = section(render(), "overview-next-up", "</button>");
		assert.ok(next.includes("Lecture 4 — Convexity<"));
		assert.ok(!next.includes(".pdf"));
		assert.match(next, />22<\/span> facts · earliest gap/);
		assert.match(next, /data-testid="overview-learn-this"/);
	});

	it("no Next up when every file is studied", () => {
		assert.ok(!render({ data: { ...PAYLOAD, nextUp: null } }).includes("overview-next-up"));
	});

	it("No class: the same page without the coverage card", () => {
		const html = render({ hasClass: false, name: "No class", description: "" });
		assert.ok(!html.includes("overview-coverage"));
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
		for (const id of ["overview-coverage", "overview-lessons", "overview-confidence"]) assert.ok(!html.includes(id));
	});

	it("no lessons, no answers, no study files: no cards", () => {
		const empty = {
			...PAYLOAD,
			files: [],
			nextUp: null,
			lessons: [],
			calibration: { levels: PAYLOAD.calibration.levels.map((l) => level(l.level, 0, 0)), sureButWrong: [] },
		};
		const html = render({ data: empty });
		for (const id of ["overview-coverage", "overview-lessons", "overview-confidence"]) assert.ok(!html.includes(id));
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

describe("Learn this", () => {
	it("starts a lesson on the Next-up file", async () => {
		const learned: FileCoverage[] = [];
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => {
			root!.render(<OverviewBody name="ML Foundations" description="" hasClass data={PAYLOAD} busy={false} onLearn={(f) => learned.push(f)} />);
		});
		const button = host.querySelector('[data-testid="overview-learn-this"]') as HTMLButtonElement;
		await act(async () => {
			button.click();
		});
		assert.deepEqual(learned.map((f) => f.fileId), ["f4"]);
	});

	it("is disabled while a lesson is starting", () => {
		assert.match(tag(render({ busy: true }), "overview-learn-this"), /disabled=""/);
	});
});
