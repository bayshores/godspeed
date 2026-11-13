import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	codeLanguage,
	codeRows,
	excerptParts,
	linesLabel,
	markRuns,
	pageBand,
	pageLabel,
	pageSource,
	passageQuote,
	splitAfterSource,
	topicPageMarks,
} from "../../src/frontend/components/citations/page-excerpt-model.ts";
import { citeView, fileCiteMark, openerLeadId, projectView, topicParts, type LhViewPart } from "../../src/shared/core/index.ts";
import { text as replyText } from "../stop-fixtures.ts";

const FILE = "f_1a2b3c4d5e6f";
const page14 = fileCiteMark(FILE, "p. 14", "Lecture 6.pdf", "degree 12");
const text = (id: string, body: string): LhViewPart => ({ type: "text", id, text: body, state: "done" });

describe("which text draws a topic's page", () => {
	it("a reply's page is keyed by its message, an opener lead's by its part", () => {
		const marks = topicPageMarks([
			{ nodeId: "reg", page: { messageId: "m_r1", leadOf: null, fileId: FILE, range: "p. 14", name: "Lecture 6.pdf", quote: "degree 12" } },
			{ nodeId: "cv", page: { messageId: null, leadOf: "t1", fileId: FILE, range: "p. 3", name: "Lecture 7.pdf", quote: "a different 12" } },
			{ nodeId: "ms", page: null },
		]);
		assert.deepEqual([...marks], [
			["m_r1", page14],
			[openerLeadId("t1"), fileCiteMark(FILE, "p. 3", "Lecture 7.pdf", "a different 12")],
		]);
	});

	it("the first text part of the message holding the mark draws it, once", () => {
		const marks = new Map([["m_r1", page14]]);
		const parts = [text("m_r1-t0", "No mark here."), text("m_r1-t1", `The curve.${page14}`), text("m_r1-t2", `Again.${page14}`)];
		assert.deepEqual([...excerptParts(parts, marks)], [[1, page14]]);
	});

	it("an opener lead in another message's row still draws its page", () => {
		const lead = fileCiteMark(FILE, "p. 3", "Lecture 7.pdf", "a different 12");
		const marks = new Map([[openerLeadId("t1"), lead]]);
		const parts = [text("m_x-t0", "Done with that."), { type: "step-start" } as LhViewPart, text(openerLeadId("t1"), `Here λ is picked.${lead}`)];
		assert.deepEqual([...excerptParts(parts, marks)], [[2, lead]]);
	});

	it("a page quoted in a plain opening reply draws under that reply at once, on the plan's first topic", () => {
		const record = [replyText("r0", `Here the curve misses.${page14}`, 1)];
		const topics = topicParts(record, "reg");
		assert.deepEqual(topics.map((t) => [t.nodeId, t.page?.messageId]), [["reg", "m_r0"]]);
		const [row] = projectView(record);
		assert.deepEqual([...excerptParts(row!.parts, topicPageMarks(topics))], [[1, page14]], "the text part after the row's step-start");
	});

	it("text whose mark lost its quote draws nothing", () => {
		const marks = new Map([["m_r1", page14]]);
		assert.equal(excerptParts([text("m_r1-t0", `The curve.${fileCiteMark(FILE, "p. 14", "Lecture 6.pdf")}`)], marks).size, 0);
	});
});

describe("where the text splits around the page", () => {
	it("the page's source number keeps the quote", () => {
		const raw = `First.${fileCiteMark(FILE, "p. 2", "Lecture 6.pdf")} The curve.${page14}`;
		assert.deepEqual(pageSource(raw, citeView(raw).cites, page14), { n: 2, nth: 0, cite: { kind: "file", fileId: FILE, range: "p. 14", name: "Lecture 6.pdf", quote: "degree 12" } });
		assert.equal(pageSource(raw, [], page14), null);
	});

	it("an earlier plain mark of the same page leaves the page under the quoting paragraph", () => {
		const raw = `Overfitting starts here.${fileCiteMark(FILE, "p. 14", "Lecture 6.pdf")}\n\nThe curve at degree 12.${page14}\n\nSo it swings.`;
		const view = citeView(raw);
		const source = pageSource(raw, view.cites, page14)!;
		assert.deepEqual({ n: source.n, nth: source.nth }, { n: 1, nth: 1 });
		assert.equal(view.cites[0]?.kind === "file" && view.cites[0].quote, "degree 12");
		const [head, tail] = splitAfterSource(view.text, source.n, source.nth);
		assert.ok(head.endsWith('The curve at degree 12.<lh-cite n="1"></lh-cite>'));
		assert.equal(tail, "So it swings.");
	});

	it("splits after the paragraph holding the number", () => {
		const view = citeView(`Here the curve swings.${page14}\n\nA curve swings like that.\n\n$$\nL(w)\n$$`);
		const [head, tail] = splitAfterSource(view.text, 1, 0);
		assert.equal(head, 'Here the curve swings.<lh-cite n="1"></lh-cite>');
		assert.equal(tail, "A curve swings like that.\n\n$$\nL(w)\n$$");
	});

	it("a number inside a list splits after the whole list", () => {
		const view = citeView(`- one${page14}\n- two\n\nAfter.`);
		assert.deepEqual(splitAfterSource(view.text, 1, 0), [`- one<lh-cite n="1"></lh-cite>\n- two`, "After."]);
	});

	it("a number in the last paragraph leaves nothing after", () => {
		const view = citeView(`Only this.${page14}`);
		assert.deepEqual(splitAfterSource(view.text, 1, 0), [view.text, ""]);
	});

	it("no such number keeps the text whole", () => {
		assert.deepEqual(splitAfterSource("Plain.", 1, 0), ["Plain.", ""]);
		assert.deepEqual(splitAfterSource('One.<lh-cite n="1"></lh-cite>', 1, 1), ['One.<lh-cite n="1"></lh-cite>', ""]);
	});
});

describe("a PDF page in its frame", () => {
	const box = { x: 0.2, y: 0.6, w: 0.3, h: 0.02 };

	it("a landscape page shows whole", () => {
		assert.deepEqual(pageBand({ w: 1333, h: 750 }, [box]), { landscape: true, aspect: 1333 / 750, at: 0.61 });
	});

	it("a portrait page shows the band around the marked words", () => {
		const band = pageBand({ w: 850, h: 1100 }, [box, { x: 0.1, y: 0.7, w: 0.2, h: 0.02 }]);
		assert.equal(band.landscape, false);
		assert.equal(band.at, (0.6 + 0.72) / 2);
	});

	it("unmarked, it shows the top; before the image loads it is taken as a wide slide", () => {
		assert.equal(pageBand({ w: 850, h: 1100 }, []).at, 0);
		assert.deepEqual(pageBand(null, []), { landscape: true, aspect: 16 / 9, at: 0 });
	});

	it("its alt text names the page and the marked words", () => {
		assert.equal(pageLabel("Lecture 6.pdf", 14, "degree 12", true), 'Lecture 6, page 14, marked "degree 12"');
		assert.equal(pageLabel("Lecture 6.pdf", 14, "degree 12", false), "Lecture 6, page 14");
	});
});

describe("code lines", () => {
	const marks = {
		kind: "lines" as const,
		first: 10,
		lines: ["#include <stdio.h>", "", "int main(void) {", "\tint *p = scores;", '\tprintf("%p %p\\n", (void *)p, (void *)(p + 1));'],
		spans: [{ line: 14, start: 30, end: 45 }],
	};

	it("numbers the lines as in the file and turns tabs into 4 spaces, marks moved with them", () => {
		const rows = codeRows(marks);
		assert.deepEqual(rows.map((r) => r.n), [10, 11, 12, 13, 14]);
		assert.equal(rows[3]!.text, "    int *p = scores;");
		const last = rows[4]!;
		assert.deepEqual(last.marks, [[33, 48]]);
		assert.equal(last.text.slice(33, 48), "(void *)(p + 1)");
	});

	it("a tab after text goes to the next stop", () => {
		const [row] = codeRows({ kind: "lines", first: 1, lines: ["ab\tc"], spans: [{ line: 1, start: 3, end: 4 }] });
		assert.equal(row!.text, "ab  c");
		assert.deepEqual(row!.marks, [[4, 5]]);
	});

	it("its accessible name gives the lines shown", () => {
		assert.equal(linesLabel("lab3/arrays.c", { ...marks, lines: new Array(12).fill("") }), "lab3/arrays.c, lines 10 to 21");
	});

	it("is coloured by its extension", () => {
		assert.equal(codeLanguage("lab3/arrays.c"), "c");
		assert.equal(codeLanguage("list.h"), "c");
		assert.equal(codeLanguage("solve.py"), "py");
		assert.equal(codeLanguage("Makefile"), "text");
	});

	it("coloured runs are cut at the marks", () => {
		const runs = [{ content: "printf(" }, { content: "(void *)" }, { content: "(p + 1));" }];
		const stretches = markRuns(runs, [[7, 22]]).map((s) => [s.pieces.map((p) => p.text), s.marked]);
		assert.deepEqual(stretches, [
			[["printf("], false],
			[["(void *)", "(p + 1)"], true],
			[[");"], false],
		]);
		assert.equal(markRuns(runs, [[7, 22]])[1]!.pieces[1]!.run, runs[2]);
	});

	it("an unmarked line is its runs unchanged", () => {
		assert.deepEqual(markRuns([{ content: "return 0;" }], []).map((s) => [s.pieces.map((p) => p.text), s.marked]), [[["return 0;"], false]]);
	});
});

describe("a .docx or .pptx quote", () => {
	it("is the line holding the marked words, cut in three", () => {
		const passage = "A heap keeps the smallest key on top.\nSo a heap is a tree, and a heap is quick.";
		assert.deepEqual(passageQuote(passage, 17, 29), { before: "A heap keeps the ", marked: "smallest key", after: " on top." });
		assert.deepEqual(passageQuote(passage, 41, 47), { before: "So ", marked: "a heap", after: " is a tree, and a heap is quick." });
	});

	it("a long paragraph shows only the sentence holding the words", () => {
		const passage = `First an idea. ${"Filler words go here. ".repeat(10)}A heap keeps the smallest key on top. Then more text follows here.`;
		const start = passage.indexOf("smallest key");
		assert.deepEqual(passageQuote(passage, start, start + 12), { before: "A heap keeps the ", marked: "smallest key", after: " on top." });
	});

	it("a transcript without sentence ends shows about 200 characters around the words, cut at word edges", () => {
		const passage = `${"so we say ".repeat(30)}the heap property says ${"the parent is small ".repeat(30)}`;
		const start = passage.indexOf("heap property");
		const quote = passageQuote(passage, start, start + 13);
		assert.equal(quote.marked, "heap property");
		assert.match(quote.before, /^…(so|we|say) .* the $/);
		assert.match(quote.after, /^ says the parent .* (the|parent|is|small)…$/);
		const shown = quote.before.length + quote.marked.length + quote.after.length;
		assert.ok(shown > 150 && shown <= 202, `${shown}`);
	});
});
