/**
 * A deadline's page body: the time left, when, the name and how far it is,
 * the topic strip and its counts, What's on it (days by week, the
 * days before it that it doesn't cover with Add and Leave out, the source,
 * Add files and Ask) and the path with Study, plus the done, past,
 * due-today, nothing-linked and nothing-to-plan states; a homework's
 * Problems sheet; an interview, What it's like, and a deadline's mocks.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { parseHTML } from "linkedom";
import type { DeadlineProgress } from "../../src/shared/core/index.ts";
import { SELECT, SELECT_ARROW } from "../../src/frontend/components/ui/field.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, self: globalThis });

const { DeadlineBody } = await import("../../src/frontend/components/deadline/deadline-body.tsx");
const { deadlineMaterial } = await import("../../src/frontend/components/deadline/deadline-model.ts");
const { planDays } = await import("../../src/shared/core/deadline-plan.ts");

const NOW = Date.parse("2026-11-02T10:00:00");

const TOPICS = [
	{ id: "t1", name: "Inclusion–exclusion", rate: 0.4 },
	{ id: "t2", name: "Stars and bars", rate: null },
	{ id: "t3", name: "Pigeonhole", rate: 0.6 },
	{ id: "t4", name: "Permutations", rate: 0.9 },
];

function deadline(over: Partial<DeadlineProgress> = {}): DeadlineProgress {
	return {
		id: "mid",
		kind: "exam",
		name: "Midterm",
		date: "2026-11-06",
		time: "19:00",
		done: false,
		daysUntil: 4,
		files: [{ id: "d1", name: "2026-10-26 Day1.pdf" }, { id: "d3", name: "2026-10-28 Day3.pdf" }, { id: "syl", name: "syllabus.txt" }],
		topicIds: TOPICS.map((t) => t.id),
		counts: { strong: 1, shaky: 1, weak: 1, untested: 1 },
		workOnNext: [],
		ready: 0.38,
		topics: TOPICS,
		...over,
	};
}

const RECORD_FILES = [
	{ id: "d1", name: "2026-10-26 Counting (lecture slides).pdf", kind: "study" as const, status: "ready" as const },
	{ id: "d2", name: "2026-10-27 Pigeonhole (lecture slides).pdf", kind: "study" as const, status: "ready" as const },
	{ id: "d3", name: "2026-10-28 Stars and bars (lecture slides).pdf", kind: "study" as const, status: "extracting" as const },
	{ id: "syl", name: "syllabus.txt", kind: "info" as const, status: "ready" as const },
];

function render(d: DeadlineProgress = deadline(), over: Partial<React.ComponentProps<typeof DeadlineBody>> = {}, leftOut: string[] = []) {
	const saved = { id: d.id, kind: d.kind, date: d.date, fileIds: d.files.map((f) => f.id), ...(leftOut.length ? { leftOutIds: leftOut } : {}) };
	const material = deadlineMaterial(RECORD_FILES, saved, [saved], [{ fileId: "d1", facts: 12 }]);
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={["/space/deadline/d1"]}>
			<DeadlineBody
				deadline={d}
				color="var(--lh-space-1)"
				topics={[{ id: "t1", right: 2, answered: 5 }, { id: "t3", right: 3, answered: 5 }]}
				material={material}
				plan={planDays("2026-11-02", d.date, d.topics)}
				nowMs={NOW}
				busy={false}
				startError={null}
				onStart={() => {}}
				onEdit={() => {}}
				source="Midterm practice exam.pdf"
				teacherName="marco"
				saving={false}
				onAsk={() => {}}
				onAskGuide={() => {}}
				onAdd={() => {}}
				onLeaveOut={() => {}}
				onCheatSheet={() => {}}
				{...over}
			/>
		</MemoryRouter>,
	);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the deadline page", () => {
	it("head: the days left on the space's color, kind and when, the name, how ready, and its two buttons", () => {
		const html = render();
		assert.match(html, /background:var\(--lh-space-1\)[^>]*><span[^>]*>4<\/span><span[^>]*>days</);
		assert.match(html, /data-testid="deadline-when"[^>]*>Exam, Friday Nov 6, 7:00 PM</);
		assert.match(html, /data-testid="deadline-name"[^>]*>Midterm</);
		assert.match(html, /data-testid="deadline-progress".*width:38%.*>38% ready</);
		assert.match(html, /data-testid="deadline-cheat-sheet"[^>]*>Cheat sheet<\/button>/);
		assert.match(html, /data-testid="deadline-edit"[^>]*>Edit deadline<\/button>/);
	});
	it("a homework's head counts its problems", () => {
		const html = render(deadline({ kind: "homework", problems: { done: 2, total: 8 } }));
		assert.match(html, /data-testid="deadline-when"[^>]*>Homework, Friday Nov 6, 7:00 PM</);
		assert.match(html, /data-testid="deadline-progress".*width:25%.*>2 of 8 problems done</);
	});
	it("one strip segment per topic and counts for the statuses it has", () => {
		const html = render();
		assert.equal(count(html, 'data-testid="deadline-topic"'), 4);
		assert.match(html, /deadline-count-untested.*<\/span>1 not tested</);
	});
	it("what's on it: days by week, the source, the day before it that's missing with Add and Leave out", () => {
		const html = render();
		assert.equal(count(html, 'data-testid="deadline-week"'), 1);
		assert.deepEqual([...html.matchAll(/data-testid="deadline-day-row" data-state="(\w+)"/g)].map((m) => m[1]), ["ready", "reading", "info", "open"]);
		assert.match(html, /2 days, 3 files, 1 still being read\. From <span[^>]*>Midterm practice exam\.pdf</);
		assert.match(html, /data-testid="deadline-edit-files"[^>]*>Pick files</);
		assert.match(html, /syllabus\.txt<\/span><span[^>]*>space info, no facts</);
		assert.match(html, /Not on it, but before the exam/);
		assert.match(html, /Pigeonhole/);
		assert.match(html, />Add<\/button>.*>Leave out<\/button>/);
		assert.ok(!html.includes("Leave all out"), "one day needs no Leave all out");
		assert.match(html, /data-testid="deadline-add-files"[^>]*href="\/space\/files"|href="\/space\/files"[^>]*data-testid="deadline-add-files"/);
		assert.match(html, /Ask marco to check/);
	});
	it("once every day before it is on it or left out, it says so, and left-out days can be shown", () => {
		const html = render(deadline(), {}, ["d2"]);
		assert.ok(!html.includes('data-testid="deadline-not-included"'));
		assert.match(html, /Every day before the exam is on it or left out\./);
		assert.match(html, /1 left out, Show/);
	});
	it("path: weakest first from today, the deadline day last, Study", () => {
		const html = render();
		assert.equal(count(html, 'data-testid="deadline-day"'), 3);
		assert.match(html, />Today<.*Inclusion–exclusion.*2 of 5 right/);
		assert.match(html, /data-testid="deadline-day-due".*Midterm, 7:00 PM/);
		assert.match(html, /data-testid="deadline-start"[^>]*lh-btn-main.*>Study</);
		assert.ok(!html.includes('title="Permutations"'), "strong topics stay off the path");
	});
	it("a homework's Study is not the main button: Work on is", () => {
		assert.doesNotMatch(render(deadline({ kind: "homework" })), /data-testid="deadline-start"[^>]*lh-btn-main/);
	});
	it("an unfinished session from this deadline: Continue studying with its topics done", () => {
		const html = render(deadline({ continueStudy: { chatId: "chat_1", done: 1, total: 4 } }));
		assert.match(html, /data-testid="deadline-start".*>Continue studying, 1 of 4 topics</);
	});
	it("due today puts everything on today", () => {
		const html = render(deadline({ date: "2026-11-02", daysUntil: 0, time: "23:00" }));
		assert.equal(count(html, 'data-testid="deadline-day"'), 1);
		assert.match(html, /Due today/);
	});
	it("done or past: no plan and no Start", () => {
		for (const d of [deadline({ done: true }), deadline({ date: "2026-11-01", daysUntil: -1 })]) {
			const html = render(d);
			assert.ok(!html.includes('data-testid="deadline-start"'));
			assert.ok(!html.includes('data-testid="deadline-day"'));
		}
		assert.match(render(deadline({ done: true })), /<header[^>]*><span[^>]*><span[^>]*>Done</);
		assert.match(render(deadline({ date: "2026-11-01", daysUntil: -1 })), /<header[^>]*><span[^>]*>was due</);
		assert.ok(!render(deadline({ done: true })).includes("deadline-path-note"), "the head already says it");
	});
	it("nothing linked: no file dump, Ask the teacher or pick files, and no plan", () => {
		const html = render(deadline({ files: [], topics: [], topicIds: [], ready: null, counts: { strong: 0, shaky: 0, weak: 0, untested: 0 } }));
		assert.match(html, /data-testid="deadline-no-files"/);
		assert.match(html, /Nothing is linked yet\. marco can work it out from your files/);
		assert.match(html, /data-testid="deadline-ask"[^>]*lh-btn-main[^>]*>Ask marco<\/button>.*>Pick files</);
		assert.ok(!html.includes('data-testid="deadline-day-row"'), "no list of every file");
		assert.match(html, /A plan shows up once it knows what&#x27;s on it\./);
		assert.match(html, /data-testid="deadline-progress"[^>]*><span[^>]*>Not measured yet</);
		assert.ok(!html.includes('data-testid="deadline-topics"'));
	});
	it("every topic strong: study them all", () => {
		const strong = TOPICS.map((t) => ({ ...t, rate: 0.95 }));
		const html = render(deadline({ topics: strong }));
		assert.match(html, /Every topic is strong/);
		assert.match(html, /Study them to keep it that way\.[^]*data-testid="deadline-start".*>Study</);
	});
	it("material loading shows a plain box; a failed start says so", () => {
		const html = render(deadline(), { material: null, startError: "Couldn't start the lesson. Try again." });
		assert.ok(!html.includes("deadline-material-summary"));
		assert.match(html, /data-testid="deadline-start-error"/);
	});
});

// ─── Homework ───────────────────────────────────────────────────────────────

const { HomeworkCard } = await import("../../src/frontend/components/deadline/homework-card.tsx");

const HW_PROBLEMS = [
	{ number: "1", title: "Gradient of a quadratic", text: "…", done: true },
	{ number: "2", title: "Fixed step", text: "…", done: false },
	{ number: "3", title: "Momentum", text: "…", done: false },
];

function homework(problems = HW_PROBLEMS, over: Partial<React.ComponentProps<typeof HomeworkCard>> = {}) {
	return renderToStaticMarkup(
		<MemoryRouter initialEntries={["/space/deadline/d1"]}>
			<HomeworkCard
				deadline={deadline({ id: "hw4", kind: "homework", name: "HW 4" })}
				problems={problems}
				files={[{ id: "a", name: "hw4.pdf" }]}
				assignmentId="a"
				busy={false}
				saving={false}
				onWork={() => {}}
				onPickAssignment={() => {}}
				onMarkDone={() => {}}
				{...over}
			/>
		</MemoryRouter>,
	);
}

describe("a homework's Problems sheet", () => {
	it("lists the problems, marks the done ones and the next one, and offers Work on and Mark done", () => {
		const html = homework();
		assert.match(html, />Problems</);
		assert.match(html, /data-testid="homework-work"[^>]*lh-btn-main.*>Work on HW 4</);
		assert.match(html, /data-testid="homework-mark-done"[^>]*>Mark done</);
		assert.deepEqual([...html.matchAll(/data-testid="homework-problem"( data-done="true")?( data-next="true")?/g)].map((m) => (m[1] ? "done" : m[2] ? "next" : "")), ["done", "next", ""]);
		assert.match(html, />Gradient of a quadratic<\/span><span[^>]*>right</);
		assert.match(html, /Assignment file.*<option value="a" selected="">hw4.pdf<\/option>/);
		assert.ok(!html.includes("homework-assignment-open"), "a browser can't open the file");
		assert.match(homework(HW_PROBLEMS, { onOpenAssignment: () => {} }), /data-testid="homework-assignment-open"[^>]*>Open</);
	});

	it("its Assignment file dropdown is drawn like the cheat sheet dock's, with the pixel arrow", () => {
		const { document } = parseHTML(homework());
		const select = document.querySelector("[data-testid='homework-assignment']")!;
		assert.equal(select.getAttribute("class"), SELECT);
		assert.ok(select.nextElementSibling?.getAttribute("class")?.includes(SELECT_ARROW));
	});

	it("with no problems says how they get listed; a done deadline offers Mark not done", () => {
		assert.match(homework([], { assignmentId: undefined }), /Pick its assignment file/);
		const done = homework(HW_PROBLEMS, { deadline: deadline({ id: "hw4", kind: "homework", name: "HW 4", done: true }) });
		assert.match(done, />Mark not done</);
		assert.ok(!done.includes('data-testid="homework-work"') && !done.includes("data-next"));
	});

	it("shows in the page's homework slot", () => {
		assert.match(render(deadline(), { homework: <p>slot</p> }), /<p>slot<\/p>/);
	});
});

// ─── Interviews, What it's like, mocks ──────────────────────────────────────

const { AboutSheet } = await import("../../src/frontend/components/deadline/about-sheet.tsx");
const { PathMocks } = await import("../../src/frontend/components/deadline/path-mocks.tsx");
type Summary = React.ComponentProps<typeof PathMocks>["mocks"];

const about = (state: React.ComponentProps<typeof AboutSheet>["about"]) => <AboutSheet about={state} teacherName="marco" onAsk={() => {}} onRetry={() => {}} />;

const MOCKS: NonNullable<Summary> = [
	{ id: "mock_2", deadlineId: "mid", n: 2, state: "graded", format: { questions: 5 }, createdAt: "2026-11-01T09:00:00.000Z", endedAt: "2026-11-01T10:00:00.000Z", solved: 4, working: false },
	{ id: "mock_1", deadlineId: "mid", n: 1, state: "graded", format: { questions: 5, minutes: 45 }, createdAt: "2026-10-30T09:00:00.000Z", endedAt: "2026-10-30T09:40:00.000Z", solved: 2, working: false },
];

function mocks(over: Partial<React.ComponentProps<typeof PathMocks>> = {}) {
	return (
		<PathMocks spaceId="spc_1" mocks={MOCKS} failed={false} done={false} offReason={null} nowMs={NOW} onRetry={() => {}} onWrite={async () => null} onRemove={async () => null} {...over} />
	);
}

const interview = (over: Partial<DeadlineProgress> = {}) =>
	deadline({ id: "onsite", kind: "interview", name: "Onsite interview", files: [], topics: [], topicIds: [], ready: null, counts: { strong: 0, shaky: 0, weak: 0, untested: 0 }, ...over });

describe("an interview's page", () => {
	it("has no cheat sheet, puts What it's like first, and has no What's on it until files are linked", () => {
		const html = render(interview(), { about: about({ state: "ready", text: "Two rounds of **45 minutes**." }) });
		assert.match(html, /data-testid="deadline-when"[^>]*>Interview, Friday Nov 6, 7:00 PM</);
		assert.ok(!html.includes('data-testid="deadline-cheat-sheet"'));
		assert.ok(!html.includes('data-testid="deadline-material"'));
		assert.match(html, /data-testid="deadline-about".*>What it&#x27;s like<.*Two rounds of .*45 minutes.*data-testid="deadline-about-ask"[^>]*lh-btn-quiet[^>]*>Ask marco to rewrite</);
		assert.ok(html.indexOf("deadline-about") < html.indexOf("deadline-path"), "left column first");
	});
	it("with nothing to plan from, says so and offers to ask for a study guide", () => {
		const html = render(interview());
		assert.match(html, /data-testid="deadline-path-note"[^>]*>Nothing is planned yet\. A plan needs study files, and the posting only tells marco about the interview\.</);
		assert.match(html, /data-testid="deadline-ask-guide"[^>]*>.*Ask marco for a study guide</);
		assert.doesNotMatch(html, /data-testid="deadline-ask-guide"[^>]*lh-btn-main/);
	});
	it("with files linked, What's on it shows but checks no class days before it", () => {
		const html = render(interview({ files: [{ id: "d1", name: "2026-10-26 Day1.pdf" }] }));
		assert.match(html, /data-testid="deadline-material"/);
		assert.ok(!html.includes("deadline-all-accounted"));
		assert.ok(!html.includes("deadline-not-included"));
	});
	it("once a study guide has facts, Path plans it like an exam", () => {
		const html = render(interview({ files: [{ id: "d1", name: "Study guide.md" }], topics: TOPICS, topicIds: TOPICS.map((t) => t.id) }));
		assert.ok(!html.includes("deadline-ask-guide"));
		assert.match(html, /data-testid="deadline-start"[^>]*lh-btn-main/);
	});
});

describe("What it's like", () => {
	it("holds its place while it loads, and offers Try again when it couldn't be read", () => {
		assert.match(renderToStaticMarkup(about({ state: "loading" })), /<div class="h-24 w-full bg-tone" aria-hidden="true">/);
		const failed = renderToStaticMarkup(about({ state: "failed" }));
		assert.match(failed, /role="alert".*Couldn&#x27;t load what it&#x27;s like\..*data-testid="deadline-about-retry"/);
		assert.match(failed, /Ask marco to rewrite/);
	});
	it("shows only on a deadline that has one", () => {
		assert.ok(!render(deadline()).includes("deadline-about"));
	});
});

describe("a deadline's mocks", () => {
	it("Take a mock sits under Study, quiet, then every mock newest first with how it went", () => {
		const html = render(deadline(), { mocks: mocks() });
		assert.match(html, /data-testid="deadline-start"[^>]*lh-btn-main[^]*data-testid="deadline-mocks"/);
		assert.match(html, /data-testid="deadline-mock-take"[^>]*>Take a mock</);
		assert.doesNotMatch(html, /data-testid="deadline-mock-take"[^>]*lh-btn-main/);
		assert.deepEqual([...html.matchAll(/data-testid="deadline-mock-(mock_\d)"/g)].map((m) => m[1]), ["mock_2", "mock_1"]);
		assert.match(html, /href="\/space\/mock\/spc_1\/mock_2".*>Mock 2<.*>Nov 1<.*data-testid="deadline-mock-line"[^>]*>4 of 5 right<.*<svg/);
		assert.match(html, /aria-label="Remove Mock 2"/);
	});
	it("is off with its reason when there is nothing to write one from", () => {
		const html = renderToStaticMarkup(mocks({ mocks: [], offReason: "A mock is written from this deadline's study files or from what it's like, and it has neither yet." }));
		assert.match(html, /data-testid="deadline-mock-take"[^>]*disabled=""/);
		assert.match(html, /data-testid="deadline-mock-off"[^>]*>A mock is written from this deadline&#x27;s study files/);
		assert.ok(!html.includes("deadline-mock-list"), "no list before the first mock");
	});
	it("an open mock is continued, paused ones say their time left", () => {
		const paused = { id: "mock_3", deadlineId: "mid", n: 3, state: "paused" as const, format: { questions: 5, minutes: 45 }, createdAt: "2026-11-02T09:00:00.000Z", paused: { at: "2026-11-02T09:20:00.000Z", left: 31 * 60 + 9 }, working: false };
		const html = renderToStaticMarkup(<MemoryRouter>{mocks({ mocks: [paused, ...MOCKS], offReason: "unused" })}</MemoryRouter>);
		assert.match(html, /data-testid="deadline-mock-continue"[^>]*href="\/space\/mock\/spc_1\/mock_3"[^>]*>Continue Mock 3</);
		assert.ok(!html.includes("deadline-mock-take") && !html.includes("deadline-mock-off"));
		assert.match(html, />Paused, 31:09 left</);
	});
	it("a done deadline takes no new mock but keeps its list; one still loading waits; one that failed offers Try again", () => {
		const done = renderToStaticMarkup(<MemoryRouter>{mocks({ done: true })}</MemoryRouter>);
		assert.ok(!done.includes("deadline-mock-take"));
		assert.match(done, /data-testid="deadline-mock-list"/);
		assert.match(renderToStaticMarkup(mocks({ mocks: null })), /data-testid="deadline-mock-take"[^>]*disabled=""/);
		assert.match(renderToStaticMarkup(mocks({ mocks: null, failed: true })), /role="alert".*Couldn&#x27;t load the mocks\..*data-testid="deadline-mocks-retry"/);
	});
	it("homework has no mocks slot filled, so none show", () => {
		assert.ok(!render(deadline({ kind: "homework" })).includes("deadline-mocks"));
	});
});
