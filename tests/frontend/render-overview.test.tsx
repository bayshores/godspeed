/**
 * The Progress tab: the page body rendered from a fixture ProgressPayload:
 * the side column (the next deadline with its blocks, words and keys, the
 * unfinished lessons, the path, Most needed), the wide one (the teacher's
 * note, the finished lessons, Show all, the lesson menu from either column), the
 * confidence chart (target lines, red where a sure level falls short,
 * takeaway, sure-but-wrong links into the lesson), the space's path, the
 * no-space variant, and the clicks.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ariaKeyShortcuts, bindingForAction, IS_MAC, keyHintText } from "../../src/shared/core/index.ts";
import type { AnswerOutcome, AnswerRef, CalibrationLevel, DeadlineProgress, FileCoverage, LessonProgress, PathProgress, PathTopicProgress, ProgressPayload } from "../../src/shared/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
// linkedom's document has no "oninput"; without it React would watch text
// fields an old-IE way.
(dom.document as unknown as { oninput: null }).oninput = null;
Object.assign(globalThis, {
	window: dom.window,
	document: dom.document,
	Element: dom.window.Element,
	HTMLElement: dom.window.HTMLElement,
	Node: dom.window.Node,
	CustomEvent: dom.window.CustomEvent,
	IS_REACT_ACT_ENVIRONMENT: true,
	self: globalThis,
	requestAnimationFrame: (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0),
	cancelAnimationFrame: (id: number) => clearTimeout(id),
	getComputedStyle: () => ({ getPropertyValue: () => "" }),
	ResizeObserver: class {
		observe() {}
		unobserve() {}
		disconnect() {}
	},
});
Object.assign(dom.window, { innerWidth: 1280, innerHeight: 800 });
// linkedom's input has no select(); the rename field calls it on mount.
(dom.window.HTMLElement.prototype as unknown as { select: () => void }).select = () => {};

// Loaded once the DOM above is in place, so React sees text fields' input events.
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { OverviewBody } = await import("../../src/frontend/components/overview/overview-body.tsx");
const { SpaceOverview } = await import("../../src/frontend/components/overview/space-overview.tsx");
const { SpaceProvider } = await import("../../src/frontend/components/space-context.tsx");
const { ServerEventsProvider } = await import("../../src/frontend/components/server-events.tsx");
const { TeacherContext } = await import("../../src/frontend/components/teacher/teacher-context.ts");
type TeacherApi = import("../../src/frontend/components/teacher/teacher-context.ts").TeacherApi;

// ─── fixture ────────────────────────────────────────────────────────────────

function file(id: string, name: string, facts: number, inLessons: number): FileCoverage {
	return { fileId: id, name, displayName: name.replace(/\.[^.]+$/, ""), facts, inLessons, share: facts === 0 ? null : inLessons / facts };
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
	spaceId: "cls_1",
	today: "2026-10-27",
	topicsAt: null,
	grouping: false,
	minFactsForTopics: 4,
	topics: [],
	topicLinks: [],
	facts: [],
	files: FILES,
	nextUp: FILES[3]!,
	fileWork: [],
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

const quietEvents = () => ({ onEvent() {}, onOpen() {}, close() {} });

/** A teacher the page can hand lines to; `lines` collects them. */
const teacherOf = (canAsk: boolean, lines: string[] = []) => ({ name: "Quigley", canAsk, ask: (line: string) => void lines.push(line) }) as unknown as TeacherApi;

function body(props: Partial<Props> = {}, teacher: TeacherApi | null = null) {
	return (
		<TeacherContext.Provider value={teacher}>
		<MemoryRouter initialEntries={["/space"]}>
			<ServerEventsProvider connect={quietEvents as never}>
				<OverviewBody
					hasSpace
					color="var(--lh-space-1)"
					data={{ ...PAYLOAD, deadlines: DEADLINES, facts: FACTS }}
					nowMs={NOW}
					busyOn={null}
					startError={null}
					onStudy={() => {}}
					onStudyPath={() => {}}
					onStudyDeadline={() => {}}
					onWorkDeadline={() => {}}
					onAddDeadline={() => {}}
					{...props}
				/>
			</ServerEventsProvider>
		</MemoryRouter>
		</TeacherContext.Provider>
	);
}

const render = (props: Partial<Props> = {}, teacher: TeacherApi | null = null) => renderToStaticMarkup(body(props, teacher));

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

const studyKey = keyHintText(bindingForAction("new-session"), IS_MAC);
const studyKeyRe = studyKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

// ─── order ──────────────────────────────────────────────────────────────────

describe("Progress, top to bottom", () => {
	it("the side column (next deadline, Most needed), then the wide one (note, Lessons, Facts, confidence)", () => {
		const html = render({ note: { text: "Strong on sets.", at: "2026-10-26T12:00:00" } });
		const at = ["progress-side", "next-deadline", "most-needed", "teacher-note", "lesson-record", "space-facts", "overview-confidence"].map((id) => html.indexOf(`data-testid="${id}"`));
		assert.ok(at.every((i) => i >= 0), "every part shows");
		assert.deepEqual(at, [...at].sort((a, b) => a - b));
	});

	it("loading: only the Lessons heading, so Study something new is still there", () => {
		const html = render({ data: null });
		for (const id of ["progress-side", "next-deadline", "most-needed", "lesson-row", "space-facts", "overview-confidence"]) assert.ok(!html.includes(id));
		assert.match(text(section(html, "lesson-record")), new RegExp(`> Lessons Study something new ${studyKeyRe}\\s*$`));
		assert.match(tag(html, "study-something-new"), /href="\/new"/);
		assert.ok(tag(html, "study-something-new").includes(`aria-keyshortcuts="${ariaKeyShortcuts(bindingForAction("new-session"), IS_MAC)}"`));
	});

	it("no space: lessons and confidence only, under the spaces to switch to", () => {
		const html = render({ hasSpace: false, pickSpace: <p>pick one</p> });
		assert.ok(html.indexOf("pick one") < html.indexOf('data-testid="lesson-record"'));
		for (const id of ["progress-side", "next-deadline", "most-needed", "space-facts"]) assert.ok(!html.includes(id), `${id} is left out`);
		for (const id of ["lesson-record", "overview-confidence"]) assert.ok(html.includes(`data-testid="${id}"`));
	});

	it("no space but an unfinished lesson: the side column holds only it", () => {
		const loose = { ...lesson("u9", "Loose start", ""), unfinished: true as const };
		const html = render({ hasSpace: false, data: { ...PAYLOAD, lessons: [loose] } });
		assert.match(text(section(html, "progress-side", "</section>")), /Unfinished Continue Loose start More/);
		for (const id of ["next-deadline", "space-path", "most-needed"]) assert.ok(!html.includes(id));
	});

	it("no lessons, no answers: No lessons yet, and no chart", () => {
		const empty = { ...PAYLOAD, deadlines: DEADLINES, lessons: [], calibration: { levels: PAYLOAD.calibration.levels.map((l) => level(l.level, 0, 0)), sureButWrong: [] } };
		const html = render({ data: empty });
		assert.match(text(section(html, "lesson-record")), new RegExp(`Lessons Study something new ${studyKeyRe} No lessons yet\\.\\s*$`));
		assert.ok(!html.includes("overview-confidence"));
		assert.ok(html.includes('data-testid="next-deadline"'));
	});
});

// ─── a new space ────────────────────────────────────────────────────────────

describe("Start this space", () => {
	const EMPTY = { ...PAYLOAD, files: [], nextUp: null, lessons: [], facts: [] };

	it("a space with nothing in it: one card with four tiles in place of the empty boxes", () => {
		const html = render({ data: EMPTY }, teacherOf(true));
		assert.match(text(section(html, "space-start")), /Start this space Add files Notes, readings, recordings or a syllabus\. Add a deadline An exam, homework, quiz, project or interview\. Ask Quigley for a path No syllabus\? The topics toward your goal, in order\. Study something new One lesson on any topic, right now\./);
		for (const id of ["next-deadline-none", "lesson-record", "space-facts", "progress-side"]) assert.ok(!html.includes(id), `${id} is replaced by the card`);
		assert.match(tag(html, "space-start-files"), /href="\/space\/files"/);
		assert.match(tag(html, "space-start-study"), /href="\/new"/);
		assert.match(html, /grid-cols-2/, "two columns once the page is wide");
	});

	it("no path tile when the teacher cannot be asked", () => {
		for (const teacher of [teacherOf(false), null]) {
			const html = render({ data: EMPTY }, teacher);
			assert.ok(html.includes("space-start-files") && html.includes("space-start-deadline") && html.includes("space-start-study"));
			assert.ok(!html.includes("space-start-path"));
		}
	});

	it("anything in the space brings back the usual boxes", () => {
		for (const data of [{ ...EMPTY, files: FILES }, { ...EMPTY, deadlines: DEADLINES }, { ...EMPTY, path: path(3, 0) }, { ...EMPTY, lessons: [lesson("c1", "Sets", "r")] }]) {
			assert.ok(!render({ data }, teacherOf(true)).includes('data-testid="space-start"'));
		}
	});

	it("the tiles click through", async () => {
		const lines: string[] = [];
		let added = 0;
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => root!.render(body({ data: EMPTY, onAddDeadline: () => added++ }, teacherOf(true, lines))));
		for (const id of ["space-start-deadline", "space-start-path"]) await act(async () => (host!.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click());
		assert.equal(added, 1);
		assert.deepEqual(lines, ["Build me a path to a goal"]);
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
	it("the soonest open deadline still ahead: days left, name, day, its problems as blocks and in words, and its page", () => {
		const html = section(render(), "next-deadline");
		assert.match(text(html), /2 days HW 5 Thursday Oct 29 2 of 7 problems done/);
		assert.match(tag(html, "next-deadline-open"), /href="\/space\/deadline\/d1"/);
		const blocks = section(html, "step-blocks", "</span></span>");
		assert.equal(blocks.split("bg-ink").length - 1, 2, "two of seven blocks inked");
		assert.equal(blocks.split("<span").length - 1, 7);
		assert.match(html, /data-teacher-target="deadline:d1"/);
	});

	it("a test's topics as blocks, weakest first, with how ready in words", () => {
		const html = section(render({ data: { ...PAYLOAD, deadlines: [DEADLINES[0]!] } }), "next-deadline");
		assert.deepEqual([...html.matchAll(/title="(Convexity|Sets)"/g)].map((m) => m[1]), ["Convexity", "Sets"]);
		assert.ok(!html.includes("step-blocks"));
	});

	it("homework gets Study and Work on it, a test one Study key", () => {
		const hw = section(render(), "next-deadline");
		assert.match(text(section(hw, "deadline-keys")), /Study\s*Work on it/, "the name is the card's title, not said again on its keys");
		assert.match(tag(hw, "deadline-work"), /title="Work on HW 5"/);
		assert.ok(!hw.includes("next-deadline-start"));
		const exam = render({ data: { ...PAYLOAD, deadlines: [DEADLINES[0]!] } });
		assert.match(text(section(exam, "next-deadline-start", "</button>")), /Study\s*$/);
		assert.match(text(section(exam, "next-deadline")), /72% ready/);
	});

	it("nothing measured yet: name, day and key, with no blocks and no words", () => {
		const html = section(render({ data: { ...PAYLOAD, deadlines: [deadline("d3", "Reading", "2026-11-06", { kind: "exam", topics: [], ready: null })] } }), "next-deadline");
		assert.ok(!html.includes("next-deadline-progress") && !html.includes("Not measured"));
		assert.match(text(html), /Reading Friday Nov 6 Study/);
	});

	it("no deadlines and no path: one line over the ways to add them, with no key of its own", () => {
		const html = render({ data: PAYLOAD }, teacherOf(true));
		assert.match(text(section(html, "next-deadline-none")), /No deadlines yet Add a deadline Ask Quigley for a path $/);
		assert.ok(!html.includes('data-testid="next-deadline"') && !html.includes("next-deadline-add"));
		for (const id of ["space-start-files", "space-start-study", 'data-testid="space-start"']) assert.ok(!html.includes(id), `${id} is for an empty space`);
	});

	it("no deadlines and a teacher that cannot be asked: only Add a deadline", () => {
		const html = render({ data: PAYLOAD }, teacherOf(false));
		assert.ok(html.includes("space-start-deadline") && !html.includes("space-start-path"));
	});

	it("only done or past ones: nothing is coming up", () => {
		const html = render({ data: { ...PAYLOAD, deadlines: DEADLINES.slice(2) } }, teacherOf(true));
		assert.match(text(section(html, "next-deadline-none")), /Nothing is coming up\. Add a deadline/);
		assert.ok(html.includes("next-deadline-add") && !html.includes("space-start-"));
	});

	it("the button is off while a lesson is starting; a lesson that didn't start says so", () => {
		assert.match(tag(render({ busyOn: "elsewhere" }), "deadline-work"), /disabled=""/);
		assert.match(render({ startError: "Couldn't start the lesson. Try again." }), /data-testid="start-error"[^>]*>Couldn&#x27;t start the lesson\. Try again\.</);
		assert.ok(!render().includes("start-error"));
	});
});

// ─── the path ───────────────────────────────────────────────────────────────

function pathTopic(n: number, status: PathTopicProgress["status"] = "untested"): PathTopicProgress {
	const answered = status === "untested" ? 0 : 1;
	const right = status === "strong" ? 1 : 0;
	return { id: `pth_${n}`, name: `Topic ${n}`, covers: `What topic ${n} covers.`, answered, right, wrong: answered - right, dontKnow: 0, rate: answered ? right : null, status, color: "var(--lh-ink-3)" };
}

/** A path of `count` topics, the first `strong` of them strong. */
function path(count: number, strong: number): PathProgress {
	const topics = Array.from({ length: count }, (_, i) => pathTopic(i + 1, i < strong ? "strong" : "untested"));
	return { goal: "backend developer", topics, nextId: topics[strong < count ? strong : 0]!.id };
}

describe("The path", () => {
	it("beside a deadline: under it, the goal and place, the topic Study takes with what it covers, the next three, and a grey Study", () => {
		const html = render({ data: { ...PAYLOAD, deadlines: DEADLINES, facts: FACTS, path: path(28, 3) } });
		assert.ok(html.indexOf('data-testid="next-deadline"') < html.indexOf('data-testid="space-path"'));
		assert.match(text(section(html, "space-path")), /> Path to backend developer 4 of 28 Topic 4 What topic 4 covers\. Study Topic 5 Topic 6 Topic 7 Show all 28 $/);
		assert.doesNotMatch(tag(html, "space-path-study"), /lh-btn-main/, "the deadline's key is the page's dark one");
	});

	it("with no deadline ahead it takes the deadline card's place, and the dark key", () => {
		const html = render({ data: { ...PAYLOAD, path: path(3, 0) } });
		assert.ok(!html.includes("next-deadline"));
		assert.match(text(section(html, "space-path")), /> Path to backend developer 1 of 3 Topic 1 What topic 1 covers\. Study Topic 2 Topic 3 $/, "nothing left out: no Show all");
		assert.match(tag(html, "space-path-study"), /lh-btn-main/);
		const past = render({ data: { ...PAYLOAD, deadlines: DEADLINES.slice(2), path: path(3, 0) } });
		assert.ok(!past.includes("next-deadline-none"), "only past deadlines: the path, not Nothing is coming up");
	});

	it("once every topic is strong it says so, with no place", () => {
		assert.match(text(section(render({ data: { ...PAYLOAD, path: path(2, 2) } }), "space-path")), /> Path to backend developer Every topic is strong\. Study them to keep it that way\. Topic 1 1 of 1 right/);
	});

	it("no path: no block", () => {
		assert.ok(!render().includes("space-path"));
	});

	it("a quiet key asks the teacher to change it, only where the teacher can be asked", () => {
		const data = { ...PAYLOAD, path: path(3, 0) };
		const html = render({ data }, teacherOf(true));
		assert.match(text(section(html, "path-change", "</button>")), /Ask Quigley to change it/);
		assert.match(tag(html, "path-change"), /lh-btn-quiet/);
		assert.ok(!render({ data }, teacherOf(false)).includes("path-change"));
		assert.ok(!render({ data }).includes("path-change"));
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

describe("Lessons", () => {
	const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
	const LESSONS: LessonProgress[] = [
		{ ...lesson("s1", "Big-O basics", "rrwrr"), updatedAt: hoursAgo(26) },
		{ ...lesson("u1", "Induction proofs", "r"), updatedAt: hoursAgo(1), unfinished: true, step: { done: 3, total: 5 } },
		{ ...lesson("s2", "Just looked", ""), updatedAt: "2026-10-20T12:00:00" },
		{ ...lesson("s3", "Recursion", "rw"), updatedAt: hoursAgo(30) },
		{ ...lesson("u2", "Work on Homework 4", ""), kind: "homework", updatedAt: hoursAgo(2), unfinished: true, step: { done: 2, total: 4 }, problems: { done: 2, total: 7 }, deadlineId: "d1" },
	];
	const html = () => render({ data: { ...PAYLOAD, deadlines: DEADLINES, lessons: LESSONS } });
	const rowsOf = (h: string, testid: string) => section(h, testid, "</ul>").split("<li").slice(1);

	it("the unfinished ones in the side column, the finished ones in Lessons, never both, each newest first", () => {
		const page = html();
		assert.match(text(section(page, "unfinished-lessons")), /> Unfinished Continue Induction proofs More Work on Homework 4 More $/);
		assert.match(text(section(page, "lesson-record")), new RegExp(`> Lessons Study something new ${studyKeyRe} Yesterday Big-O basics More Recursion More Oct 20 Just looked More $`));
	});

	it("an unfinished row opens its lesson and shows its steps as blocks, a homework its problems; the card's key opens the first", () => {
		const rows = rowsOf(html(), "unfinished-lessons");
		assert.equal(rows.length, 2);
		assert.match(tag(rows[0]!, "lesson-row"), /href="\/chat\/u1"/);
		assert.match(tag(rows[0]!, "lesson-row"), /data-teacher-target="lesson:u1"/);
		assert.match(tag(rows[0]!, "step-blocks"), /aria-label="Step 3 of 5"/);
		assert.match(tag(html(), "unfinished-key"), /href="\/chat\/u1"/);
		assert.match(section(html(), "unfinished-key", "</a>"), />Continue(<|$)/);
		assert.match(tag(rows[1]!, "step-blocks"), /aria-label="2 of 7 problems done"/);
	});

	it("the key says Work on it when the first unfinished lesson is homework", () => {
		const only = render({ data: { ...PAYLOAD, lessons: LESSONS.filter((l) => l.chatId !== "u1") } });
		assert.match(section(only, "unfinished-key", "</a>"), />Work on it(<|$)/);
	});

	it("a finished row: the day once where it changes, a square per answer in order, the title; no squares with no answers", () => {
		const [bigO, recursion, looked] = rowsOf(html(), "lesson-record");
		assert.deepEqual([...bigO!.matchAll(/data-outcome="(\w+)"/g)].map((m) => m[1]), ["right", "right", "wrong", "right", "right"]);
		assert.match(bigO!, /aria-label="4 of 5 right"/);
		assert.match(text(bigO!), /Yesterday Big-O basics/);
		assert.match(text(recursion!.slice(recursion!.indexOf(">") + 1)), /^\s*Recursion/, "the same day is not said again");
		assert.ok(!looked!.includes("data-outcome") && !looked!.includes("right\""), "no squares");
		assert.ok(!html().includes("lesson-row-status"), "no chips");
	});

	it("More on every row, in both columns", () => {
		const page = html();
		assert.equal(page.split('data-testid="lesson-row-menu"').length - 1, LESSONS.length);
	});

	it("Show all past 12 finished and past 3 unfinished; one hidden row is shown instead", () => {
		const finished = (n: number) => Array.from({ length: n }, (_, i) => ({ ...lesson(`s${i}`, `Lesson ${i}`, "r"), updatedAt: hoursAgo(i + 1) }));
		const fifteen = render({ data: { ...PAYLOAD, lessons: finished(15) } });
		assert.equal(fifteen.split('data-testid="lesson-row"').length - 1, 12);
		assert.match(text(section(fifteen, "lesson-show-all", "</button>")), /Show all 15/);
		const thirteen = render({ data: { ...PAYLOAD, lessons: finished(13) } });
		assert.equal(thirteen.split('data-testid="lesson-row"').length - 1, 13);
		assert.ok(!thirteen.includes("lesson-show-all"));
		const unfinished = (n: number) => finished(n).map((l) => ({ ...l, unfinished: true as const }));
		const five = render({ data: { ...PAYLOAD, lessons: unfinished(5) } });
		assert.equal(five.split('data-testid="lesson-row"').length - 1, 3);
		assert.match(text(section(five, "unfinished-show-all", "</button>")), /Show all 5/);
		assert.ok(!render({ data: { ...PAYLOAD, lessons: unfinished(4) } }).includes("unfinished-show-all"));
	});

	it("no unfinished lessons: no Unfinished sheet", () => {
		assert.ok(!render().includes("unfinished-lessons"));
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
const originalFetch = globalThis.fetch;

afterEach(async () => {
	await act(async () => root?.unmount());
	host?.remove();
	root = null;
	host = null;
	document.body.innerHTML = "";
	globalThis.fetch = originalFetch;
});

/** Answers every request with `respond`; returns what was asked. */
function serve(respond: (url: string, init?: RequestInit) => Response) {
	const asked: string[] = [];
	globalThis.fetch = (async (url: string, init?: RequestInit) => {
		asked.push(`${init?.method ?? "GET"} ${url}`);
		return respond(url, init);
	}) as typeof fetch;
	return asked;
}

describe("clicks", () => {
	async function mount(props: Partial<Props>, teacher: TeacherApi | null = null) {
		host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host);
		await act(async () => root!.render(body(props, teacher)));
		return host;
	}
	const click = (el: HTMLElement, testid: string) => act(async () => (el.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click());

	it("the next homework's keys study for it or work on it; Study starts a lesson on the Most needed topic", async () => {
		const started: string[] = [];
		const el = await mount({ onStudyDeadline: (d) => started.push(`study ${d.id}`), onWorkDeadline: (d) => started.push(`work ${d.id}`), onStudy: (id) => started.push(id) });
		await click(el, "deadline-study");
		await click(el, "deadline-work");
		await click(el, "most-needed-study");
		assert.deepEqual(started, ["study d1", "work d1", "t1"]);
	});

	it("the path's Study starts its next topic; Show all opens the rest in place", async () => {
		const started: string[] = [];
		const el = await mount({ data: { ...PAYLOAD, path: path(8, 1) }, onStudyPath: (id) => started.push(id) });
		await click(el, "space-path-study");
		assert.deepEqual(started, ["pth_2"]);
		assert.equal(el.querySelectorAll('[data-testid="space-path-rows"] li').length, 3);
		await click(el, "space-path-show-all");
		assert.equal(el.querySelectorAll('[data-testid="space-path-rows"] li').length, 7, "every other topic");
		assert.equal(el.querySelector('[data-testid="space-path-show-all"]'), null);
	});

	it("Add a deadline, with none ahead", async () => {
		let added = 0;
		const el = await mount({ data: { ...PAYLOAD, deadlines: DEADLINES.slice(2) }, onAddDeadline: () => added++ });
		await click(el, "next-deadline-add");
		assert.equal(added, 1);
	});

	it("with no deadline and no path, Add a deadline opens the Deadlines tab and the path tile asks the teacher", async () => {
		let added = 0;
		const lines: string[] = [];
		const el = await mount({ data: PAYLOAD, onAddDeadline: () => added++ }, teacherOf(true, lines));
		await click(el, "space-start-deadline");
		await click(el, "space-start-path");
		assert.equal(added, 1);
		assert.deepEqual(lines, ["Build me a path to a goal"]);
	});

	it("Ask to change the path sends the line", async () => {
		const lines: string[] = [];
		const el = await mount({ data: { ...PAYLOAD, path: path(3, 0) } }, teacherOf(true, lines));
		await click(el, "path-change");
		assert.deepEqual(lines, ["I want to change my path"]);
	});
	describe("the Lessons block", () => {
		const ROWS = [lesson("c1", "Induction", "rw"), { ...lesson("c2", "Pointers", "r"), updatedAt: "2026-10-26T12:00:00Z" }];
		const q = (el: HTMLElement, testid: string) => el.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
		const rowTitles = (el: HTMLElement) => [...el.querySelectorAll('[data-testid="lesson-row"]')].map((r) => r.getAttribute("title"));

		it("Show all opens the rest in place", async () => {
			const lessons = Array.from({ length: 15 }, (_, i) => ({ ...lesson(`s${i}`, `Lesson ${i}`, "r"), updatedAt: new Date(NOW - i * 3_600_000).toISOString() }));
			const el = await mount({ data: { ...PAYLOAD, lessons } });
			assert.equal(rowTitles(el).length, 12);
			await click(el, "lesson-show-all");
			assert.equal(rowTitles(el).length, 15);
			assert.equal(q(el, "lesson-show-all"), null);
		});

		it("More opens the lesson menu and a second click closes it", async () => {
			serve(() => Response.json({}));
			const el = await mount({ data: { ...PAYLOAD, lessons: ROWS } });
			await click(el, "lesson-row-menu");
			assert.ok(document.querySelector('[data-testid="lesson-menu"]'), "opened by More");
			await click(el, "lesson-row-menu");
			await act(async () => new Promise((r) => setTimeout(r, 400))); // the exit plays
			assert.equal(document.querySelector('[data-testid="lesson-menu"]'), null, "a second click closes it");
		});

		it("an unfinished row's More opens the same menu, and a rename shows there at once", async () => {
			serve(() => Response.json({}));
			const el = await mount({ data: { ...PAYLOAD, lessons: [...ROWS, { ...lesson("u1", "Half done", ""), unfinished: true }] } });
			await click(el.querySelector<HTMLElement>('[data-testid="unfinished-lessons"]')!, "lesson-row-menu");
			assert.ok(document.querySelector('[data-testid="lesson-menu"]'));
			await act(async () => (document.querySelector('[data-testid="ctx-rename"]') as HTMLButtonElement).click());
			assert.ok(el.querySelector('[data-testid="unfinished-lessons"] [data-testid="lesson-rename-input"]'), "renamed in place, in its own column");
		});

		async function rename(el: HTMLElement, to: string) {
			await click(el, "lesson-row-menu");
			await act(async () => (document.querySelector('[data-testid="ctx-rename"]') as HTMLButtonElement).click());
			const input = q(el, "lesson-rename-input") as HTMLInputElement;
			input.setAttribute("type", "text"); // linkedom gives a field no type; React watches text fields only
			await act(async () => {
				Object.defineProperty(input, "value", { configurable: true, writable: true, value: to });
				input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
			});
			await act(async () => input.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })));
		}

		it("a rename shows the new title at once", async () => {
			const asked = serve(() => Response.json({}));
			const el = await mount({ data: { ...PAYLOAD, lessons: ROWS } });
			await rename(el, "Strong induction");
			assert.deepEqual(rowTitles(el), ["Strong induction", "Pointers"]);
			assert.ok(asked.includes("PUT /api/chats/c1"));
			assert.equal(q(el, "lesson-rename-failed"), null);
		});

		it("a rename that fails keeps the old title and says so under the row; renaming again clears it", async () => {
			serve((_url, init) => (init?.method === "PUT" ? Response.json({ error: "boom" }, { status: 500 }) : Response.json({})));
			const el = await mount({ data: { ...PAYLOAD, lessons: ROWS } });
			await rename(el, "Strong induction");
			assert.deepEqual(rowTitles(el), ["Induction", "Pointers"]);
			const failed = q(el, "lesson-rename-failed")!;
			assert.equal(failed.textContent, "Couldn't rename the lesson.");
			assert.equal(failed.getAttribute("role"), "alert");
			await click(el, "lesson-row-menu");
			await act(async () => (document.querySelector('[data-testid="ctx-rename"]') as HTMLButtonElement).click());
			assert.equal(q(el, "lesson-rename-failed"), null);
		});

		it("a deleted lesson's row goes at once", async () => {
			serve((_url, init) => (init?.method === "DELETE" ? Response.json({ graphRevision: 2 }) : Response.json({})));
			const el = await mount({ data: { ...PAYLOAD, lessons: ROWS } });
			await click(el, "lesson-row-menu");
			await act(async () => (document.querySelector('[data-testid="ctx-delete"]') as HTMLButtonElement).click());
			await act(async () => (document.querySelector('[data-testid="delete-confirm"]') as HTMLButtonElement).click());
			assert.deepEqual(rowTitles(el), ["Pointers"]);
		});
	});

	describe("no space", () => {
		async function mountPage(lessons: LessonProgress[]) {
			serve((url) => (url.startsWith("/api/progress") ? Response.json({ ...PAYLOAD, spaceId: null, lessons }) : Response.json({})));
			host = document.createElement("div");
			document.body.appendChild(host);
			root = createRoot(host);
			await act(async () =>
				root!.render(
					<MemoryRouter initialEntries={["/space"]}>
						<ServerEventsProvider connect={quietEvents as never}>
							<SpaceProvider initialActive={null} initialSpaces={[]}>
								<SpaceOverview />
							</SpaceProvider>
						</ServerEventsProvider>
					</MemoryRouter>,
				),
			);
			return host;
		}

		it("with no lessons outside a space: the spaces to pick, then No lessons yet", async () => {
			const el = await mountPage([]);
			assert.ok(el.querySelector('[data-testid="pick-space"]'));
			assert.match(el.querySelector('[data-testid="lesson-record"]')!.textContent!, /No lessons yet\./);
		});

		it("with lessons outside a space: the lessons, no spaces to pick", async () => {
			const el = await mountPage([lesson("c1", "Loose lesson", "r")]);
			assert.equal(el.querySelector('[data-testid="pick-space"]'), null);
			assert.match(el.querySelector('[data-testid="lesson-record"]')!.textContent!, /Loose lesson/);
		});
	});
});
