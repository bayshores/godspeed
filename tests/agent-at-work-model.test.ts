/**
 * The lesson's "agent at work" view: plan, steps and the file being read,
 * from the in-flight reply's tool calls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JobRecord, LhViewMessage, LhViewPart } from "../src/core/index.ts";
import { agentWork, pageSpanOf, pdfActivity, textPages, ROWS_PER_PAGE } from "../src/components/lesson/agent-at-work-model.ts";

const tool = (name: string, input: Record<string, unknown>, toolCallId = name): LhViewPart => ({ type: `tool-${name}`, state: "output-available", toolCallId, input });
const reply = (...parts: LhViewPart[]): LhViewMessage => ({ id: "m1", role: "assistant", parts });
const job = (toolCallId: string, activity: string) => ({ toolCallId, activity }) as unknown as JobRecord;

describe("agentWork", () => {
	it("is empty for no message or a learner message", () => {
		assert.deepEqual(agentWork(undefined, []), { plan: null, steps: [], reading: null, replied: false });
		assert.equal(agentWork({ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] }, []).replied, false);
	});

	it("labels steps in plain words and tracks the file being read", () => {
		const work = agentWork(
			reply(tool("grep", { pattern: "complement", path: "notes/lecture-7.md" }), tool("read", { path: "notes/lecture-7.md", offset: 40, limit: 23 })),
			[],
		);
		assert.deepEqual(work.steps, ['searched lecture-7.md for "complement"', "read lines 40 to 62 of lecture-7.md"]);
		assert.deepEqual(work.reading, { kind: "text", path: "notes/lecture-7.md", name: "lecture-7.md", from: 40, to: 62 });
	});

	it("skips image reads as the page source", () => {
		assert.equal(agentWork(reply(tool("read", { path: "fig.png" })), []).reading, null);
	});

	it("keeps the newest plan and only the steps since it", () => {
		const work = agentWork(
			reply(
				tool("work_plan", { items: ["a", "b", "c"], done: 0 }, "p1"),
				tool("read_class", {}),
				tool("work_plan", { items: ["a", "b", "c"], done: 1 }, "p2"),
				tool("ls", { path: "Documents/CSE 21" }),
			),
			[],
		);
		assert.deepEqual(work.plan, { items: ["a", "b", "c"], done: 1 });
		assert.deepEqual(work.steps, ["looked in CSE 21"]);
	});

	it("follows a PDF job's progress line", () => {
		const work = agentWork(reply(tool("pdf", { path: "/Users/me/Rosen 7.1.pdf", question: "q" }, "j1")), [job("j1", "pdf_extract: 3-5")]);
		assert.deepEqual(work.steps, ["opened Rosen 7.1.pdf", "read pages 3 to 5"]);
		assert.deepEqual(work.reading, { kind: "pdf", path: "/Users/me/Rosen 7.1.pdf", name: "Rosen 7.1.pdf", page: 3 });
	});

	it("knows when the reply's text has arrived", () => {
		assert.equal(agentWork(reply(tool("ls", {}), { type: "text", text: "Here is the idea." }), []).replied, true);
		assert.equal(agentWork(reply({ type: "text", text: " " }), []).replied, false);
	});
});

describe("pdfActivity", () => {
	it("reads every verb the PDF reader reports", () => {
		assert.deepEqual(pdfActivity("pdf_info: triaging"), { step: "skimmed every page", page: null });
		assert.deepEqual(pdfActivity('pdf_search: "complement"'), { step: 'searched it for "complement"', page: null });
		assert.deepEqual(pdfActivity("pdf_render: 4 @150dpi"), { step: "looked closely at page 4", page: 4 });
		assert.deepEqual(pdfActivity("pdf_extract: all"), { step: "read every page", page: null });
		assert.equal(pdfActivity("reading pdf"), null);
	});

	it("spans page lists", () => {
		assert.deepEqual(pageSpanOf("1,3,7"), [1, 7]);
		assert.equal(pageSpanOf("all"), null);
	});
});

describe("textPages", () => {
	it("cuts text into numbered pages", () => {
		const text = Array.from({ length: ROWS_PER_PAGE + 2 }, (_, i) => `line ${i + 1}`).join("\n");
		const pages = textPages(text);
		assert.equal(pages.length, 2);
		assert.equal(pages[1]!.start, ROWS_PER_PAGE + 1);
	});

	it("counts a long line as the rows it wraps to", () => {
		const long = "x".repeat(58 * 10);
		const pages = textPages([long, long, long, long, long].join("\n"));
		assert.deepEqual(
			pages.map((p) => p.start),
			[1, 5],
		);
	});
});
