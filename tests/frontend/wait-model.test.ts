import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AgentWork } from "../../src/frontend/components/lesson/agent-at-work-model.ts";
import { deskMark, deskPaper, heldBack, nothingWritten, planLines, titleEcho, waitView } from "../../src/frontend/components/lesson/wait-model.ts";
import type { LhViewMessage } from "../../src/shared/core/index.ts";

/** The lesson while the teacher works: the desk, the title echo, the paper, the plan's rows and the landing. */

const work = (over: Partial<AgentWork> = {}): AgentWork => ({ plan: null, steps: [], reading: null, replied: false, ...over });
const user = (text: string, extra: LhViewMessage["parts"] = []): LhViewMessage => ({ id: `u:${text}`, role: "user", parts: [{ type: "text", text }, ...extra] });
const teacher = (...parts: LhViewMessage["parts"]): LhViewMessage => ({ id: "a1", role: "assistant", parts });
const card = (files: number): LhViewMessage => ({ id: "c", role: "user", parts: [{ type: "data-space-context", data: { spaceId: "s", name: "S", description: "", files: Array.from({ length: files }, (_, i) => ({ name: `f${i}`, kind: "study", path: null })) } }] });

describe("waitView", () => {
	it("shows no desk while no turn runs, or once the reply's text has landed", () => {
		assert.deepEqual(waitView({ busy: false, waitingForAgent: false, work: null }), { desk: null, split: false });
		assert.deepEqual(waitView({ busy: true, waitingForAgent: false, work: work({ replied: true }) }), { desk: null, split: false });
	});

	it("is still while no agent takes the turn and works once one does", () => {
		assert.equal(waitView({ busy: true, waitingForAgent: true, work: null }).desk, "waiting");
		assert.equal(waitView({ busy: true, waitingForAgent: false, work: null }).desk, "working");
	});

	it("splits into the plan beside the paper once there is a plan or a step", () => {
		assert.equal(waitView({ busy: true, waitingForAgent: false, work: work() }).split, false);
		assert.equal(waitView({ busy: true, waitingForAgent: false, work: work({ steps: ["opened notes.md"] }) }).split, true);
		assert.equal(waitView({ busy: true, waitingForAgent: false, work: work({ plan: { items: ["Read"], done: 0 } }) }).split, true);
	});
});

describe("titleEcho", () => {
	it("finds the learner's first message when it only repeats the title, spaces aside", () => {
		assert.equal(titleEcho([card(1), user("Limits  of\nsequences")], "Limits of sequences"), 1);
	});

	it("is -1 when the first message says more, or a later message repeats the title", () => {
		assert.equal(titleEcho([user("Limits of sequences, with proofs")], "Limits of sequences"), -1);
		assert.equal(titleEcho([user("Hi"), user("Limits")], "Limits"), -1);
		assert.equal(titleEcho([user("")], ""), -1);
	});
});

describe("deskPaper", () => {
	const files = (...list: [string, "study" | "info", string | null][]): LhViewMessage => ({
		id: "c",
		role: "user",
		parts: [{ type: "data-space-context", data: { spaceId: "s", name: "S", description: "", files: list.map(([name, kind, path]) => ({ name, kind, path })) } }],
	});
	const space = files(["Week 1.md", "study", "/h/Week 1.md"], ["Week 2.pdf", "study", "/h/Week 2.pdf"], ["Week 3.docx", "study", "/h/Week 3.docx"], ["Syllabus.md", "info", "/h/Syllabus.md"]);

	it("puts the assignment on top, else the file the lesson read last, else the newest study file it can show", () => {
		const read = teacher({ type: "tool-read", state: "output-available", toolCallId: "r", input: { path: "/h/Week 1.md" } });
		assert.equal(deskPaper([space, user("Hi"), read], { path: "/h/hw1.pdf" }).path, "/h/hw1.pdf");
		assert.equal(deskPaper([space, user("Hi"), read], null).path, "/h/Week 1.md");
		assert.equal(deskPaper([space, user("Hi")], { path: null }).path, "/h/Week 2.pdf", "not the Word file, and not space info");
	});

	it("is blank paper for a space with no file to show", () => {
		assert.equal(deskPaper([card(1)], null).path, null);
		assert.equal(deskPaper([files(["Syllabus.md", "info", "/h/Syllabus.md"])], null).path, null);
		assert.equal(deskPaper([user("Hi")], null).path, null);
	});

	it("draws one edge from one file, two from 5 and three from 20, none with no space", () => {
		const edges = (n: number) => deskPaper([card(n)], null).edges;
		assert.deepEqual([edges(0), edges(1), edges(4), edges(5), edges(19), edges(20), edges(300)], [0, 1, 1, 2, 2, 3, 3]);
		assert.equal(deskPaper([user("Hi")], null).edges, 0);
	});
});

describe("planLines", () => {
	it("shows a short plan whole: done, now and next", () => {
		assert.deepEqual(
			planLines({ items: ["Read", "Plan", "Write"], done: 1 }).map((l) => l.state),
			["done", "now", "next"],
		);
	});

	it("folds a long plan's done items into one row with their count, and stops where the desk ends", () => {
		const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
		const lines = planLines({ items, done: 3 });
		assert.deepEqual(lines[0], { key: "done", count: 3, state: "folded" });
		assert.deepEqual(lines.slice(1).map((l) => (l.state === "folded" ? "" : l.text)), ["d", "e", "f", "g", "h"]);
		assert.equal(lines[1]!.state, "now");
		assert.equal(planLines({ items, done: 0 }).length, 6, "nothing done: the first six");
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

	it("is false before the learner wrote, or once the teacher wrote or asked", () => {
		assert.equal(nothingWritten([card(1)]), false);
		assert.equal(nothingWritten([user("Limits"), teacher({ type: "text", text: "Here." })]), false);
		assert.equal(nothingWritten([user("Limits"), teacher({ type: "tool-quiz", state: "input-available" })]), false);
	});
});
