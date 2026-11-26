import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deskCalls, deskHead, deskMark, deskPaper, deskRows, nothingWritten, titleEcho, wroteSince } from "../../src/frontend/components/lesson/wait-model.ts";
import { NO_LESSON_WORK, type LessonWork, type LhViewMessage } from "../../src/shared/core/index.ts";

type DeskStep = LessonWork["steps"][number];

/** The lesson while the teacher works: the desk's sentence, rows and stack, the title echo and the landing. */

const live = (over: Partial<LessonWork> = {}): LessonWork => ({ ...NO_LESSON_WORK, live: true, cause: "first", ...over });
const step = (id: string, text: string, over: Partial<DeskStep> = {}): DeskStep => ({ id, at: "2026-11-23T22:20:33.000Z", text, call: null, reads: null, ...over });
type DeskFile = LessonWork["files"][number];
const file = (name: string, kind: DeskFile["kind"] = "pdf"): DeskFile => ({ name, path: `/files/${name}`, kind });
const user = (text: string, extra: LhViewMessage["parts"] = []): LhViewMessage => ({ id: `u:${text}`, role: "user", parts: [{ type: "text", text }, ...extra] });
const teacher = (...parts: LhViewMessage["parts"]): LhViewMessage => ({ id: "a1", role: "assistant", parts });
const card = (files: number): LhViewMessage => ({ id: "c", role: "user", parts: [{ type: "data-space-context", data: { spaceId: "s", name: "S", description: "", files: Array.from({ length: files }, (_, i) => ({ name: `f${i}`, kind: "study", path: null })) } }] });

describe("deskHead", () => {
	it("says what the teacher does, by why the turn runs", () => {
		const said = (cause: LessonWork["cause"]) => deskHead("Claude", live({ cause }));
		assert.equal(said("first"), "Claude is getting your first step ready.");
		assert.equal(said("answer"), "Claude is reading your answer.");
		assert.equal(said("problem"), "Claude is checking your work.");
		assert.equal(said("ask"), "Claude is answering your question.");
		assert.equal(said("next"), "Claude is writing the next step.");
		assert.equal(said("job"), "Claude is writing the next step.");
		assert.equal(said("retry"), "Claude is trying again.");
		assert.equal(said("open_problem"), "Claude is getting the problem ready.");
	});

	it("says nothing before the server's first word", () => {
		assert.equal(deskHead("Claude", NO_LESSON_WORK), null);
	});

	it("does not name the teacher in a talk chat, whose panel head already does", () => {
		assert.equal(deskHead("Claude", live({ cause: "talk" })), "Reading your message.");
		assert.equal(deskHead("Claude", live({ cause: "talk", steps: [step("s1", "Looking through your notes")] })), "Working on it.");
		assert.equal(deskHead("Claude", { ...NO_LESSON_WORK, cause: "talk" }), null, "still nothing before the server's first word");
	});
});

describe("wroteSince", () => {
	const quiz = { type: "tool-quiz", toolCallId: "q", state: "output-available", input: {}, output: { kind: "quiz" } };

	it("sees the teacher's words written since the turn began, not before it, not the learner's, not a blank", () => {
		const start = [user("Hi"), teacher({ type: "text", text: "Old words." }), user("Go on")];
		const mark = deskMark(start);
		assert.equal(wroteSince(start, mark), false);
		assert.equal(wroteSince([...start, teacher({ type: "tool-read", state: "output-available" })], mark), false, "a step is no words");
		assert.equal(wroteSince([...start, teacher({ type: "text", text: " " })], mark), false);
		assert.equal(wroteSince([...start, teacher({ type: "text", text: "Here" })], mark), true);
		assert.equal(wroteSince([...start, user("And?")], mark), false);
	});

	it("sees the agent's thinking, even empty", () => {
		const start = [user("Hi")];
		assert.equal(wroteSince([...start, teacher({ type: "reasoning", text: "" })], deskMark(start)), true);
	});

	it("sees a reply that grows the message an answered question is in, from where it stood", () => {
		const asked = [user("Hi"), teacher({ type: "text", text: "Try this." }, quiz)];
		const mark = deskMark(asked);
		assert.equal(wroteSince(asked, mark), false, "the question's own lead is older");
		assert.equal(wroteSince([user("Hi"), teacher({ type: "text", text: "Try this." }, quiz, { type: "step-start" }, { type: "text", text: "Right." })], mark), true);
		const growing = [user("Hi"), teacher({ type: "text", text: "Lead" })];
		assert.equal(wroteSince(growing, deskMark(growing)), false, "a text that grows: only what is new");
		assert.equal(wroteSince([user("Hi"), teacher({ type: "text", text: "Lead and more" })], deskMark(growing)), true);
	});
});

describe("deskRows", () => {
	it("is the pencil alone before the first step, then the steps with the newest current", () => {
		assert.deepEqual(deskRows(live()).rows, [{ key: "start", text: null, state: "now" }]);
		const { rows, under } = deskRows(live({ steps: [step("1", "Looking at CSE 29"), step("2", "Reading PA4.pdf, page 2")] }));
		assert.deepEqual(rows, [
			{ key: "1", text: "Looking at CSE 29", state: "done" },
			{ key: "2", text: "Reading PA4.pdf, page 2", state: "now" },
		]);
		assert.equal(under, null);
	});

	it("folds the oldest steps past what the desk holds", () => {
		const steps = Array.from({ length: 9 }, (_, i) => step(`${i}`, `Step ${i}`));
		const { rows } = deskRows(live({ steps }));
		assert.equal(rows.length, 6);
		assert.deepEqual(rows[0], { key: "done", count: 4, state: "folded" });
		assert.equal(rows.at(-1)!.state, "now");
	});

	it("with a plan, shows its items and puts the newest step under the current one", () => {
		const { rows, under } = deskRows(live({ plan: { items: ["Read", "Plan", "Write"], done: 1 }, steps: [step("1", "Reading notes.md")] }));
		assert.deepEqual(
			rows.map((row) => row.state),
			["done", "now", "next"],
		);
		assert.equal(under, "Reading notes.md");
		const all = deskRows(live({ plan: { items: ["Read"], done: 1 }, steps: [step("1", "Reading notes.md")] }));
		assert.deepEqual(all.rows.at(-1), { key: "1", text: "Reading notes.md", state: "now" }, "all done: the newest step is its own row");
	});

	it("folds a long plan's done items into one row with their count, and stops where the desk ends", () => {
		const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
		const { rows } = deskRows(live({ plan: { items, done: 3 } }));
		assert.deepEqual(rows[0], { key: "done", count: 3, state: "folded" });
		assert.deepEqual(rows.slice(1).map((row) => (row.state === "folded" ? "" : row.text)), ["d", "e", "f", "g", "h"]);
		assert.equal(deskRows(live({ plan: { items, done: 0 } })).rows.length, 6, "nothing done: the first six");
	});
});

describe("deskPaper and deskCalls", () => {
	it("is the place read last in a file with pages, and the calls the steps stand for", () => {
		const reads = { ...file("PA4.pdf"), from: null, to: null, page: 2 };
		const slides = { name: "Week 8.pptx", path: "/h/Week 8.pptx", kind: "other" as const, from: null, to: null, page: null };
		const work = live({ steps: [step("1", "Reading PA4.pdf, page 2", { reads, call: "c1" }), step("2", "Reading Week 8.pptx", { reads: slides }), step("3", "Searching the web for “malloc”")] });
		assert.deepEqual(deskPaper(work), { reading: reads, still: false });
		assert.deepEqual([...deskCalls(work)], ["c1"]);
	});

	it("before any read is the first file with pages, still, and nothing with no such file", () => {
		const slides = { name: "Week 8.pptx", path: "/h/Week 8.pptx", kind: "other" as const };
		assert.deepEqual(deskPaper(live({ files: [slides, file("a.pdf"), file("b.md")] })), { reading: { ...file("a.pdf"), from: null, to: null, page: null }, still: true });
		assert.equal(deskPaper(live({ files: [slides] })), null);
		assert.equal(deskPaper(live()), null);
	});
});

describe("titleEcho", () => {
	it("finds the learner's first message when it only repeats the title, spaces aside", () => {
		assert.equal(titleEcho([card(1), user("Limits  of\nsequences")], "Limits of sequences"), 1);
	});

	it("finds it when the title was saved cut short", () => {
		assert.equal(titleEcho([user("Limits of sequences, with every proof")], "Limits of sequences,…"), 0);
		assert.equal(titleEcho([user("Series and their limits")], "Limits of sequences,…"), -1);
	});

	it("is -1 when the first message says more, or a later message repeats the title", () => {
		assert.equal(titleEcho([user("Limits of sequences, with proofs")], "Limits of sequences"), -1);
		assert.equal(titleEcho([user("Hi"), user("Limits")], "Limits"), -1);
		assert.equal(titleEcho([user("")], ""), -1);
	});
});

describe("deskMark", () => {
	it("marks an empty text part the turn's words may grow into", () => {
		const quiz = { type: "tool-quiz", state: "output-available", toolCallId: "q" };
		const before = [user("Hi"), teacher(quiz, { type: "text", text: "" })];
		assert.deepEqual(deskMark(before), { count: 2, parts: 2, text: 0 });
		assert.equal(wroteSince([user("Hi"), teacher(quiz, { type: "text", text: "Your pick holds." })], deskMark(before)), true);
	});
});

describe("nothingWritten", () => {
	it("is true once the learner wrote and the teacher wrote no words and asked nothing", () => {
		assert.equal(nothingWritten([card(1), user("Limits")]), true);
		assert.equal(nothingWritten([user("Limits"), teacher({ type: "step-start" }, { type: "text", text: " " })]), true);
	});

	it("is false before the learner wrote, or once the teacher wrote, asked or posed a problem", () => {
		assert.equal(nothingWritten([user("Limits"), teacher({ type: "tool-problem", state: "output-available" })]), false);
		assert.equal(nothingWritten([card(1)]), false);
		assert.equal(nothingWritten([user("Limits"), teacher({ type: "text", text: "Here." })]), false);
		assert.equal(nothingWritten([user("Limits"), teacher({ type: "tool-quiz", state: "input-available" })]), false);
	});
});
