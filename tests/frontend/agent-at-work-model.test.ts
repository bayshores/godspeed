/**
 * The lesson's "agent at work" view: plan, steps and the file being read,
 * from the in-flight reply's tool calls.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { JobRecord, LhViewMessage, LhViewPart } from "../../src/shared/core/index.ts";
import { agentWork, pageSpanOf, pdfActivity, textPages, ROWS_PER_PAGE } from "../../src/frontend/components/lesson/agent-at-work-model.ts";

const tool = (name: string, input: Record<string, unknown>, toolCallId = name): LhViewPart => ({ type: `tool-${name}`, state: "output-available", toolCallId, input });
const reply = (...parts: LhViewPart[]): LhViewMessage => ({ id: "m1", role: "assistant", parts });
const job = (toolCallId: string, activity: string) => ({ toolCallId, activity }) as unknown as JobRecord;

describe("agentWork", () => {
	it("is empty for no message or a learner message", () => {
		assert.deepEqual(agentWork(undefined, [], []), { plan: null, steps: [], reading: null, replied: false });
		assert.equal(agentWork({ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] }, [], []).replied, false);
	});

	it("labels steps in plain words and tracks the file being read", () => {
		const work = agentWork(
			reply(tool("grep", { pattern: "complement", path: "notes/lecture-7.md" }), tool("read", { path: "notes/lecture-7.md", offset: 40, limit: 23 })),
			[],
			[],
		);
		assert.deepEqual(work.steps, ['searched lecture-7.md for "complement"', "read lines 40 to 62 of lecture-7.md"]);
		assert.deepEqual(work.reading, { kind: "text", path: "notes/lecture-7.md", name: "lecture-7.md", from: 40, to: 62 });
	});

	it("skips image reads as the page source", () => {
		assert.equal(agentWork(reply(tool("read", { path: "fig.png" })), [], []).reading, null);
	});

	it("keeps the newest plan and only the steps since it", () => {
		const work = agentWork(
			reply(
				tool("work_plan", { items: ["a", "b", "c"], done: 0 }, "p1"),
				tool("read_space", {}),
				tool("work_plan", { items: ["a", "b", "c"], done: 1 }, "p2"),
				tool("ls", { path: "Documents/CSE 21" }),
			),
			[],
			[],
		);
		assert.deepEqual(work.plan, { items: ["a", "b", "c"], done: 1 });
		assert.deepEqual(work.steps, ["looked in CSE 21"]);
	});

	it("drops the work of a reply that ended in an answered question", () => {
		const work = agentWork(
			reply(tool("work_plan", { items: ["a", "b"], done: 0 }), tool("read", { path: "notes.md", offset: 3, limit: 10 }), { type: "text", text: "Try this." }, tool("quiz", {})),
			[],
			[],
		);
		assert.deepEqual(work, { plan: null, steps: [], reading: null, replied: false });
	});

	it("keeps only the steps after the answered question", () => {
		const work = agentWork(
			reply(tool("work_plan", { items: ["a", "b"], done: 0 }), tool("read", { path: "notes.md" }), tool("quiz", {}), tool("read", { path: "other.md" }, "r2")),
			[],
			[],
		);
		assert.equal(work.plan, null);
		assert.deepEqual(work.steps, ["opened other.md"]);
		assert.deepEqual(work.reading, { kind: "text", path: "other.md", name: "other.md", from: null, to: null });
	});

	it("keeps the reply's work across a question that failed or is still being written", () => {
		const failed: LhViewPart = { ...tool("quiz", {}), state: "output-error" };
		const writing: LhViewPart = { ...tool("probe", {}, "p2"), state: "input-streaming" };
		for (const question of [failed, writing]) {
			const work = agentWork(reply(tool("work_plan", { items: ["a"], done: 0 }), tool("read", { path: "notes.md" }), question), [], []);
			assert.deepEqual(work.plan, { items: ["a"], done: 0 });
			assert.deepEqual(work.steps, ["opened notes.md"]);
		}
	});

	it("follows a PDF job's progress line", () => {
		const work = agentWork(reply(tool("pdf", { path: "/Users/me/Rosen 7.1.pdf", question: "q" }, "j1")), [job("j1", "pdf_extract: 3-5")], []);
		assert.deepEqual(work.steps, ["opened Rosen 7.1.pdf", "read pages 3 to 5"]);
		assert.deepEqual(work.reading, { kind: "pdf", path: "/Users/me/Rosen 7.1.pdf", name: "Rosen 7.1.pdf", page: 3 });
	});

	it("knows when the reply's text has arrived", () => {
		assert.equal(agentWork(reply(tool("ls", {}), { type: "text", text: "Here is the idea." }), [], []).replied, true);
		assert.equal(agentWork(reply({ type: "text", text: " " }), [], []).replied, false);
	});
});

describe("the space's files", () => {
	const notes = "/data/spaces/s/files/f_a9344168eb05/Week 7 Graphs.md";
	const files = [
		{ name: "Week 7 Graphs.md", kind: "study" as const, path: notes },
		{ name: "Rosen 7.1.pdf", kind: "study" as const, path: "/Users/me/Math/Rosen 7.1.pdf" },
		{ name: "Week 8.pptx", kind: "study" as const, path: "/Users/me/Math/Week 8.pptx" },
	];
	const search = (output: string): LhViewPart => ({ ...tool("search_space_files", { query: "handshake lemma" }, "s1"), output });
	const passage = (id: string, output?: string): LhViewPart => ({ ...tool("read_passage", { passage_id: id }, `r:${id}`), ...(output ? { output } : { state: "input-available" }) });
	const found = 'Top 1 of 1 passages for "handshake lemma":\nf_a9344168eb05:1 · Week 7 Graphs.md · lines 1–21\n  …The sum of all degrees…\nOpen one with read_passage.';

	it("says what a search of the files, a look at what was studied and a passage read did", () => {
		const work = agentWork(
			reply(search(found), tool("search_graph", { query: "trees" }), passage("f_a9344168eb05:1", "Week 7 Graphs.md · lines 1–21 · f_a9344168eb05:1\n(first passage of the file · last passage of the file)\n\n# Week 7")),
			[],
			files,
		);
		assert.deepEqual(work.steps, ['searched your files for "handshake lemma"', "searched your knowledge graph", "read lines 1 to 21 of Week 7 Graphs.md"]);
		assert.deepEqual(work.reading, { kind: "text", path: notes, name: "Week 7 Graphs.md", from: 1, to: 21 });
	});

	it("names a passage from the search that found it before its own result arrives", () => {
		const work = agentWork(reply(search(found), passage("f_a9344168eb05:1")), [], files);
		assert.equal(work.steps.at(-1), "read lines 1 to 21 of Week 7 Graphs.md");
		assert.equal(work.reading?.path, notes);
	});

	it("opens a PDF passage at its page, finds a linked file by its name and leaves a slide deck off the desk", () => {
		const pdf = agentWork(reply(passage("f_0123456789ab:12", "Rosen 7.1.pdf · p. 3 · f_0123456789ab:12\n(previous: f_0123456789ab:11 · next: f_0123456789ab:13)")), [], files);
		assert.deepEqual(pdf.steps, ["read page 3 of Rosen 7.1.pdf"]);
		assert.deepEqual(pdf.reading, { kind: "pdf", path: "/Users/me/Math/Rosen 7.1.pdf", name: "Rosen 7.1.pdf", page: 3 });
		const slides = agentWork(reply(passage("f_0000000000aa:4", "Week 8.pptx · slide 4 · f_0000000000aa:4\n(first passage of the file · next: f_0000000000aa:5)")), [], files);
		assert.deepEqual(slides.steps, ["read slide 4 of Week 8.pptx"]);
		assert.equal(slides.reading, null);
	});

	it("knows nothing of a passage no search found while it is still being read", () => {
		assert.deepEqual(agentWork(reply(passage("f_a9344168eb05:2")), [], files).steps, []);
	});

});

describe("pdfActivity", () => {
	it("reads every verb the PDF reader reports", () => {
		assert.deepEqual(pdfActivity("pdf_info: triaging"), { step: "skimmed every page", page: null });
		assert.deepEqual(pdfActivity('pdf_search: "complement"'), { step: 'searched it for "complement"', page: null });
		assert.deepEqual(pdfActivity("pdf_render: 4 @150dpi"), { step: "looked closely at page 4", page: 4 });
		assert.deepEqual(pdfActivity("pdf_extract: all"), { step: "read every page", page: null });
		assert.deepEqual(pdfActivity("save_page: 7"), { step: "kept page 7 for later", page: 7 });
		assert.equal(pdfActivity("save_page: x"), null);
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
		const long = "x".repeat(64 * 10);
		const pages = textPages([long, long, long, long, long].join("\n"));
		assert.deepEqual(
			pages.map((p) => p.start),
			[1, 4],
		);
	});
});
