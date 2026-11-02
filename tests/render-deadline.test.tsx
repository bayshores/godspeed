/**
 * A deadline's page body: the name, when and countdown with the ready ring,
 * the topic strip and its counts, Material (series slots with missing
 * numbers, loose files, the read and course-info lines, Add files and
 * Check with the syllabus) and the path with Start, plus the done, past,
 * due-today, no-files and nothing-to-plan states.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import type { DeadlineProgress } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, self: globalThis });

const { DeadlineBody } = await import("../src/components/deadline/deadline-body.tsx");
const { deadlineMaterial } = await import("../src/components/deadline/deadline-model.ts");
const { planDays } = await import("../src/core/deadline-plan.ts");

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
		files: [{ id: "d1", name: "Day1.pdf" }, { id: "d3", name: "Day3.pdf" }, { id: "syl", name: "syllabus.txt" }],
		topicIds: TOPICS.map((t) => t.id),
		counts: { strong: 1, shaky: 1, weak: 1, untested: 1 },
		workOnNext: [],
		ready: 0.38,
		topics: TOPICS,
		...over,
	};
}

const RECORD_FILES = [
	{ id: "d1", name: "Day1.pdf", kind: "study" as const, status: "ready" as const },
	{ id: "d3", name: "Day3.pdf", kind: "study" as const, status: "extracting" as const },
	{ id: "syl", name: "syllabus.txt", kind: "info" as const, status: "ready" as const },
];

function render(d: DeadlineProgress = deadline(), over: Partial<React.ComponentProps<typeof DeadlineBody>> = {}) {
	const material = deadlineMaterial(RECORD_FILES, d.files.map((f) => f.id), [{ fileId: "d1", facts: 12 }]);
	return renderToStaticMarkup(
		<DeadlineBody
			deadline={d}
			topics={[{ id: "t1", right: 2, answered: 5 }, { id: "t3", right: 3, answered: 5 }]}
			material={material}
			plan={planDays("2026-11-02", d.date, d.topics)}
			nowMs={NOW}
			busy={false}
			startError={null}
			onStart={() => {}}
			onEditClass={() => {}}
			onCheckSyllabus={() => {}}
			{...over}
		/>,
	);
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the deadline page", () => {
	it("head: name, kind and when, the countdown, and the ready ring", () => {
		const html = render();
		assert.match(html, /data-testid="deadline-name"[^>]*>Midterm</);
		assert.match(html, /Exam<\/span>.*Fri Nov 6, 7:00 PM/);
		assert.match(html, /data-testid="deadline-ring".*>38%</);
	});
	it("one strip segment per topic and counts for the statuses it has", () => {
		const html = render();
		assert.equal(count(html, 'data-testid="deadline-topic"'), 4);
		assert.match(html, /deadline-count-untested.*>1<\/span> not tested/);
	});
	it("material: slots per number, the gap marked missing, the reading and course info lines", () => {
		const html = render();
		assert.deepEqual([...html.matchAll(/data-testid="deadline-slot" data-state="(\w+)"/g)].map((m) => m[1]), ["ready", "missing", "reading"]);
		assert.match(html, /\w+ \d+ looks missing, 1 still being read\./);
		assert.match(html, /1 of 2 study files read, 12 facts so far\./);
		assert.match(html, /1 course info file: the teacher can read it, but it makes no facts\./);
		assert.match(html, /data-testid="deadline-add-files"[^>]*href="\/class\/files"|href="\/class\/files"[^>]*data-testid="deadline-add-files"/);
		assert.match(html, /data-testid="deadline-check-syllabus"/);
	});
	it("path: weakest first from today, the deadline day last, Start today", () => {
		const html = render();
		assert.equal(count(html, 'data-testid="deadline-day"'), 3);
		assert.match(html, />Today<.*Inclusion–exclusion.*2 of 5 right/);
		assert.match(html, /data-testid="deadline-day-due".*Midterm · 7:00 PM/);
		assert.match(html, /data-testid="deadline-start".*Start today/);
		assert.ok(!html.includes("Permutations</span><span"), "strong topics stay off the path");
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
		assert.match(render(deadline({ done: true })), />Done</);
		assert.match(render(deadline({ date: "2026-11-01", daysUntil: -1 })), /Was due/);
		assert.ok(!render(deadline({ done: true })).includes("deadline-path-note"), "the header already says it");
	});
	it("no covered files: all study files with a pointer to Edit class, and no plan", () => {
		const html = render(deadline({ files: [], topics: [], topicIds: [], ready: null, counts: { strong: 0, shaky: 0, weak: 0, untested: 0 } }));
		assert.match(html, /data-testid="deadline-no-files"/);
		assert.match(html, /A plan shows up once it names its files\./);
		assert.equal(count(html, "Edit class"), 1, "one pointer to Edit class");
		assert.match(html, /data-testid="deadline-ring".*>–<.*Not measured yet/);
		assert.ok(!html.includes('data-testid="deadline-topics"'));
	});
	it("every topic strong: practice them all", () => {
		const strong = TOPICS.map((t) => ({ ...t, rate: 0.95 }));
		const html = render(deadline({ topics: strong }));
		assert.match(html, /Every topic is strong/);
		assert.match(html, /data-testid="deadline-start".*Practice all its topics/);
	});
	it("material loading shows a plain box; a failed start says so", () => {
		const html = render(deadline(), { material: null, startError: "Couldn't start practice. Try again." });
		assert.ok(!html.includes("deadline-material-summary"));
		assert.match(html, /data-testid="deadline-start-error"/);
	});
});
