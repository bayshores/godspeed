import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deskCalls, deskHead, deskMark, deskReading, deskRows, deskStack, heldBack, nothingWritten, replyArrived, titleEcho } from "../../src/frontend/components/lesson/wait-model.ts";
import { NO_LESSON_WORK, type DeskFile, type LessonWork, type LhViewMessage } from "../../src/shared/core/index.ts";

type DeskStep = LessonWork["steps"][number];

/** The lesson while the teacher works: the desk's sentence, rows and stack, the title echo and the landing. */

const live = (over: Partial<LessonWork> = {}): LessonWork => ({ ...NO_LESSON_WORK, live: true, taken: true, cause: "first", ...over });
const step = (id: string, text: string, over: Partial<DeskStep> = {}): DeskStep => ({ id, at: "2026-11-23T22:20:33.000Z", text, call: null, reads: null, ...over });
const file = (name: string, kind: DeskFile["kind"] = "pdf"): DeskFile => ({ name, path: `/files/${name}`, kind });
const user = (text: string, extra: LhViewMessage["parts"] = []): LhViewMessage => ({ id: `u:${text}`, role: "user", parts: [{ type: "text", text }, ...extra] });
const teacher = (...parts: LhViewMessage["parts"]): LhViewMessage => ({ id: "a1", role: "assistant", parts });
const card = (files: number): LhViewMessage => ({ id: "c", role: "user", parts: [{ type: "data-space-context", data: { spaceId: "s", name: "S", description: "", files: Array.from({ length: files }, (_, i) => ({ name: `f${i}`, kind: "study", path: null })) } }] });

describe("deskHead", () => {
	it("says what the teacher does, by why the turn runs", () => {
		const said = (cause: LessonWork["cause"]) => deskHead({ name: "Claude", waiting: false, work: live({ cause }) });
		assert.equal(said("first"), "Claude is getting your first step ready.");
		assert.equal(said("answer"), "Claude is reading your answer.");
		assert.equal(said("problem"), "Claude is checking your work.");
		assert.equal(said("ask"), "Claude is answering your question.");
		assert.equal(said("next"), "Claude is writing the next step.");
		assert.equal(said("job"), "Claude is writing the next step.");
		assert.equal(said("retry"), "Claude is trying again.");
		assert.equal(said("open_problem"), "Claude is getting the problem ready.");
	});

	it("waits while no agent runs or none took the turn, and says nothing before the server's first word", () => {
		assert.equal(deskHead({ name: "Claude", waiting: true, work: NO_LESSON_WORK }), "Waiting for Claude to start.");
		assert.equal(deskHead({ name: "Claude", waiting: false, work: live({ taken: false }) }), "Waiting for Claude to start.");
		assert.equal(deskHead({ name: "Claude", waiting: false, work: NO_LESSON_WORK }), null);
	});
});

describe("replyArrived", () => {
	it("is true once the reply ends in words or the agent's reasoning", () => {
		assert.equal(replyArrived(undefined), false);
		assert.equal(replyArrived(teacher({ type: "tool-read", state: "output-available" })), false);
		assert.equal(replyArrived(teacher({ type: "text", text: " " })), false);
		assert.equal(replyArrived(teacher({ type: "text", text: "Here is the idea." })), true);
		assert.equal(replyArrived(teacher({ type: "reasoning", text: "" })), true);
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

describe("deskReading and deskCalls", () => {
	it("is the place read last, and the calls the steps stand for", () => {
		const reads = { ...file("PA4.pdf"), from: null, to: null, page: 2 };
		const work = live({ steps: [step("1", "Reading PA4.pdf, page 2", { reads, call: "c1" }), step("2", "Searching the web for “malloc”")] });
		assert.deepEqual(deskReading(work), reads);
		assert.deepEqual([...deskCalls(work)], ["c1"]);
		assert.equal(deskReading(live()), null);
	});
});

describe("deskStack", () => {
	const files = ["a.pdf", "b.md", "c.pdf", "d.pdf", "e.pdf", "f.pdf"].map((name) => file(name));
	it("lays five files at most, in the server's order", () => {
		assert.deepEqual(
			deskStack(files, null).map((f) => f.name),
			["a.pdf", "b.md", "c.pdf", "d.pdf", "e.pdf"],
		);
	});

	it("brings the file being read to the front, and one from outside joins in front", () => {
		const reading = (name: string) => ({ ...file(name), from: null, to: null, page: null });
		assert.deepEqual(
			deskStack(files.slice(0, 3), reading("c.pdf")).map((f) => f.name),
			["c.pdf", "a.pdf", "b.md"],
		);
		assert.deepEqual(
			deskStack(files.slice(0, 5), reading("z.pdf")).map((f) => f.name),
			["z.pdf", "a.pdf", "b.md", "c.pdf", "d.pdf"],
		);
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

describe("heldBack", () => {
	it("keeps the messages as they stood while a reply lands, so the desk and the reply never stack", () => {
		const before = [user("Hi"), teacher({ type: "tool-read", state: "output-available" })];
		const after = [user("Hi"), teacher({ type: "tool-read", state: "output-available" }, { type: "text", text: "Here." })];
		const held = heldBack(after, deskMark(before));
		assert.equal(held.length, 2);
		assert.deepEqual(held[1]!.parts, before[1]!.parts);
		assert.equal(heldBack([user("Hi"), teacher({ type: "text", text: "Here." })], deskMark([user("Hi")])).length, 1, "a new message stays out");
		assert.ok(heldBack(before, deskMark(before))[1] === before[1], "nothing new: the same message");
	});

	it("keeps out the words a reply writes into a text part that was already there, empty", () => {
		const quiz = { type: "tool-quiz", state: "output-available", toolCallId: "q" };
		const before = [user("Hi"), teacher(quiz, { type: "text", text: "" })];
		const after = [user("Hi"), teacher(quiz, { type: "text", text: "Your pick holds." })];
		assert.deepEqual(deskMark(before), { count: 2, parts: 2, text: 0 });
		assert.equal(heldBack(after, deskMark(before))[1]!.parts[1]!.text, "");
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
