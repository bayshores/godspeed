/**
 * The cheat sheet's pure core: the saved record (and the version 1 block
 * sheet upgraded on read), checking a written sheet, the page size, the
 * fit, the request's text, a page cleaned and its math rendered, and how
 * the studio lays the pages out.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	CHEAT_SHEET_VERSION,
	DOC_MAX_CHARS,
	cheatSheetRequestText,
	docProblem,
	fitPrompt,
	mistakeCounts,
	newCheatSheet,
	overflowLine,
	pageSizeCss,
	pageSizeLabel,
	parseCheatSheet,
	runsOver,
	sheetMistakes,
	withPrompt,
	type CheatSheet,
	type CheatSheetDoc,
} from "../src/core/cheat-sheet.ts";
import { cleanSheetHtml, renderSheetMath, sheetPageDocument } from "../src/core/cheat-sheet-page.ts";
import { sheetText } from "../src/core/sheet-text.ts";
import { pageCaption, pagesLayout } from "../src/components/cheat-sheet/sheet-pages-model.ts";

const doc = (over: Partial<CheatSheetDoc> = {}): CheatSheetDoc => ({ widthIn: 8.27, heightIn: 11.69, css: "", pages: ["<p>front</p>", "<p>back</p>"], ...over });

const oldSheet = (over: Record<string, unknown> = {}) => ({
	version: 1,
	deadlineId: "ddl_1",
	rules: { allowed: true, paper: "a4", writing: "printed", banned: [] },
	prefs: { content: ["formulas"], textSize: "small", columns: 3, ink: "black", instructions: "make it double sided" },
	blocks: [
		{ id: "blk_1", topicId: "watch_out", title: "Watch out", body: "- $k^n$ not $n^k$ & **never** <b>", reason: "Missed once" },
		{ id: "blk_2", topicId: "tpc_a", title: "Counting", body: "$$\\binom{n}{k}$$\n1. pick", reason: "Weak" },
	],
	confirmedAt: "2026-11-04T01:27:17.507Z",
	updatedAt: "2026-11-04T01:30:21.775Z",
	...over,
});

describe("cheat sheet: the saved record", () => {
	it("reads a saved document and its prompts, drops a broken document, and refuses a newer record", () => {
		const saved = { version: CHEAT_SHEET_VERSION, deadlineId: "ddl_1", doc: doc(), prompts: [{ text: "A4", at: "t", files: ["a.png"] }, { text: 3 }], updatedAt: "u" };
		assert.deepEqual(parseCheatSheet(saved), { deadlineId: "ddl_1", doc: doc(), prompts: [{ text: "A4", at: "t", files: ["a.png"] }], updatedAt: "u" });
		assert.equal((parseCheatSheet({ ...saved, doc: { ...doc(), widthIn: 40 } }) as CheatSheet).doc, null);
		assert.equal(parseCheatSheet({ ...saved, version: CHEAT_SHEET_VERSION + 1 }), "newer");
		assert.equal(parseCheatSheet({ version: 2 }), null);
	});

	it("keeps the last 20 prompts", () => {
		let sheet = newCheatSheet("ddl_1", "t");
		for (let i = 0; i < 25; i++) sheet = withPrompt(sheet, { text: `ask ${i}`, at: "t" });
		assert.equal(sheet.prompts.length, 20);
		assert.equal(sheet.prompts[0]!.text, "ask 5");
	});
});

describe("cheat sheet: a version 1 block sheet upgraded on read", () => {
	it("becomes its paper's page with the blocks as sections, math kept and text escaped", () => {
		const sheet = parseCheatSheet(oldSheet()) as CheatSheet;
		assert.deepEqual([sheet.doc!.widthIn, sheet.doc!.heightIn, sheet.doc!.pages.length], [8.27, 11.69, 1]);
		const page = sheet.doc!.pages[0]!;
		assert.match(page, /^<div class="cols"><section class="box"><h3>Watch out<\/h3><ul><li>\\\(k\^n\\\) not \\\(n\^k\\\) &amp; <b>never<\/b> &lt;b&gt;<\/li><\/ul><\/section>/);
		assert.match(page, /<section><h3>Counting<\/h3><div>\\\[\\binom\{n\}\{k\}\\\]<\/div><p>1\. pick<\/p><\/section>/);
		assert.match(sheet.doc!.css, /column-count: 3/);
		assert.match(sheet.doc!.css, /font: 7pt\/1\.25/);
		assert.deepEqual(sheet.prompts, [{ text: "make it double sided", at: "2026-11-04T01:27:17.507Z" }]);
		assert.equal(sheet.updatedAt, "2026-11-04T01:30:21.775Z");
		assert.equal(docProblem(sheet.doc!), null);
	});

	it("shares the blocks over both sides of a two-sided paper, by length", () => {
		const blocks = [1, 2, 3, 4].map((n) => ({ id: `b${n}`, topicId: "t", title: `T${n}`, body: "x".repeat(100), reason: "r" }));
		const sheet = parseCheatSheet(oldSheet({ rules: { paper: "letter-both" }, blocks })) as CheatSheet;
		assert.deepEqual([sheet.doc!.widthIn, sheet.doc!.heightIn], [8.5, 11]);
		assert.deepEqual(sheet.doc!.pages.map((p) => p.match(/<h3>/g)?.length), [2, 2]);
	});

	it("has no document before the agent wrote blocks, and no prompt without instructions", () => {
		const sheet = parseCheatSheet(oldSheet({ blocks: [], prefs: {} })) as CheatSheet;
		assert.deepEqual([sheet.doc, sheet.prompts], [null, []]);
		assert.equal((parseCheatSheet({ deadlineId: "ddl_1", rules: { paper: "index-card" }, blocks: oldSheet().blocks }) as CheatSheet).doc!.widthIn, 5, "no version is version 1");
	});
});

describe("cheat sheet: a written sheet", () => {
	it("needs a sane page size, 1 to 4 pages, none empty, and a bounded size", () => {
		assert.equal(docProblem(doc()), null);
		assert.match(docProblem(doc({ widthIn: 1 }))!, /between 2 and 17 inches/);
		assert.match(docProblem(doc({ heightIn: Number.NaN }))!, /between 2 and 17 inches/);
		assert.match(docProblem(doc({ pages: [] }))!, /1 to 4 pages/);
		assert.match(docProblem(doc({ pages: ["a", "b", "c", "d", "e"] }))!, /1 to 4 pages/);
		assert.match(docProblem(doc({ pages: ["a", "  "] }))!, /empty/);
		assert.match(docProblem(doc({ css: "x".repeat(DOC_MAX_CHARS) }))!, /under 200000/);
	});

	it("names the page size and the sides", () => {
		assert.equal(pageSizeLabel(doc()), "A4, front and back");
		assert.equal(pageSizeLabel(doc({ widthIn: 11, heightIn: 8.5, pages: ["a"] })), "Letter sideways, one side");
		assert.equal(pageSizeLabel(doc({ widthIn: 5, heightIn: 3, pages: ["a"] })), "3 × 5 card, one side");
		assert.equal(pageSizeLabel(doc({ widthIn: 6, heightIn: 9.125, pages: ["a", "b", "c"] })), "6 × 9.13 in, 3 pages");
		assert.equal(pageSizeCss(doc()), "8.27in 11.69in");
	});
});

describe("cheat sheet: the fit", () => {
	it("says a page runs over past a two pixel rounding, either way", () => {
		const page = { clientWidth: 794, clientHeight: 1123 };
		assert.equal(runsOver({ ...page, scrollWidth: 794, scrollHeight: 1125 }), false);
		assert.equal(runsOver({ ...page, scrollWidth: 794, scrollHeight: 1200 }), true);
		assert.equal(runsOver({ ...page, scrollWidth: 1600, scrollHeight: 1123 }), true);
	});

	it("names the pages that run over and asks the agent to fit them", () => {
		assert.equal(overflowLine([2], 2), "Page 2 runs over");
		assert.equal(overflowLine([1, 2], 2), "Pages 1 and 2 run over");
		assert.equal(overflowLine([1, 2, 3], 4), "Pages 1, 2 and 3 run over");
		assert.equal(overflowLine([1], 1), "The page runs over");
		assert.equal(fitPrompt([2], 2), "Page 2 runs over. Make everything fit on its page without making the text too small to read.");
		assert.match(fitPrompt([1], 1), /^The page runs over\. /);
	});
});

describe("cheat sheet: the request", () => {
	const topics = [
		{ id: "tpc_a", name: "Counting", status: "weak" as const, mistakes: 2, facts: [{ name: "Permutations", statement: "P(n,k) = n!/(n-k)!" }] },
		{ id: "tpc_b", name: "Sums", status: "strong" as const, mistakes: 0, facts: [] },
	];
	const base = {
		title: "CSE 21 Midterm",
		date: "2026-11-04",
		classNotes: "Rosen's notation.",
		infoFiles: ["syllabus.txt"],
		prompt: "double sided A4, and a flowchart",
		earlier: [],
		topics,
		mistakes: [{ topicId: "tpc_a", text: "7 students, 3 sections", kind: "wrong" as const, at: "t" }],
		current: null,
	};

	it("says what the student asks, where the rules are, the topics with readiness and facts, and the mistakes", () => {
		const text = cheatSheetRequestText(base);
		assert.match(text, /^Cheat sheet for: CSE 21 Midterm on 2026-11-04\nAbout the class: Rosen's notation\.\nCourse info files \(the rules are likely here\): syllabus\.txt/);
		assert.match(text, /The student asks:\ndouble sided A4, and a flowchart/);
		assert.match(text, /Counting \| weak, 2 mistakes\n {2}- Permutations: P\(n,k\) = n!\/\(n-k\)!\nSums \| knows it well/);
		assert.match(text, /answered wrong \(Counting\): "7 students, 3 sections"/);
		assert.doesNotMatch(text, /current sheet|asked before/);
	});

	it("carries the current sheet and what was asked before for a change", () => {
		const text = cheatSheetRequestText({ ...base, infoFiles: [], prompt: "bigger text", earlier: [{ text: "A4", at: "t" }], current: doc({ css: "body { padding: 0.3in }" }) });
		assert.match(text, /no course info files; search all its files/);
		const many = cheatSheetRequestText({ ...base, infoFiles: ["HW1.pdf", ...Array.from({ length: 9 }, (_, i) => `n${i}.txt`), "syllabus.txt"] });
		assert.match(many, /likely here\): syllabus\.txt, HW1\.pdf, n0\.txt, .*, n5\.txt, and 3 more\n/);
		assert.match(text, /What they asked before, oldest first:\n- A4/);
		assert.match(text, /The current sheet \(send the whole sheet back, changed as asked\):\n\nPage size: 8\.27 × 11\.69 in\n\nCSS:\nbody \{ padding: 0\.3in \}\n\nPage 1:\n<p>front<\/p>\n\nPage 2:\n<p>back<\/p>$/);
	});

	it("takes the newest mistakes in the deadline's topics, each question once, and counts them", () => {
		const answers = [
			{ text: "How many 5-card hands?", kind: "wrong" as const, at: "2026-10-01", topicIds: ["counting"] },
			{ text: "  How many 5-card   hands? ", kind: "wrong" as const, at: "2026-10-03", topicIds: ["counting"] },
			{ text: "E[X^2] for a die", kind: "hint" as const, at: "2026-10-02", topicIds: ["other", "probability"] },
			{ text: "Off topic", kind: "wrong" as const, at: "2026-10-04", topicIds: ["other"] },
		];
		assert.deepEqual(sheetMistakes(answers, ["counting", "probability"]).map((m) => [m.topicId, m.text, m.kind]), [
			["counting", "How many 5-card hands?", "wrong"],
			["probability", "E[X^2] for a die", "hint"],
		]);
		assert.deepEqual([...mistakeCounts(answers, ["counting", "probability"])], [["counting", 2], ["probability", 1]]);
	});
});

describe("cheat sheet: a page", () => {
	it("drops scripts, frames, event handlers and outside links, and keeps the rest", () => {
		const html = cleanSheetHtml(
			'<p onclick="x()" class="a">Hi<script>alert(1)</script></p><iframe src="https://x"></iframe><a href="https://evil" title="t">go</a><a href="#top">up</a><img src="data:image/png;base64,AA" onerror=y><img src="https://x/y.png"><link rel="stylesheet" href="https://x"><svg><use href="#a"/></svg>',
		);
		assert.equal(html, '<p class="a">Hi</p><a title="t">go</a><a href="#top">up</a><img src="data:image/png;base64,AA"><img><svg><use href="#a"/></svg>');
	});

	it("renders $…$, $$…$$, \\(…\\) and \\[…\\] with KaTeX, and leaves money, \\$, tags, code, styles and plain SVG alone", () => {
		const out = renderSheetMath('<p title="$x$">$a&lt;b$ and $5 or $10, \\$3</p><div>$$\\sum_k k$$</div>\\(y\\) \\[z\\]<code>$c$</code><style>.a{content:"$s$"}</style><svg><text>$t$</text><foreignObject>$f$</foreignObject></svg>');
		assert.match(out, /^<p title="\$x\$"><span class="katex">/);
		assert.match(out, /<annotation encoding="application\/x-tex">a&lt;b<\/annotation>/);
		assert.match(out, / and \$5 or \$10, \$3<\/p><div><span class="katex-display">/);
		assert.match(out, /<annotation encoding="application\/x-tex">y<\/annotation>/);
		assert.match(out, /<annotation encoding="application\/x-tex">z<\/annotation>/);
		assert.match(out, /<code>\$c\$<\/code><style>\.a\{content:"\$s\$"\}<\/style><svg><text>\$t\$<\/text><foreignObject><span class="katex">/);
	});

	it("is a whole document of the page's size, with KaTeX's styles from the app and no way out", () => {
		const page = sheetPageDocument(doc({ css: "p { color: red } </style><script>x()</script>" }), 1);
		assert.match(page, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:">/);
		assert.match(page, /<link rel="stylesheet" href="\/katex\/katex\.min\.css">/);
		assert.match(page, /@page \{ size: 8\.27in 11\.69in; margin: 0; \}/);
		assert.match(page, /html \{ width: 8\.27in; height: 11\.69in; overflow: hidden;/);
		assert.match(page, /<style>p \{ color: red \} <\\\/style><script>x\(\)<\/script><\/style>/, "the agent's CSS can't close its style tag");
		assert.match(page, /<body><p>back<\/p><\/body>/);
	});
});

describe("cheat sheet: a block's text (version 1 records)", () => {
	it("splits lines into text, bold, inline math, bullets and steps", () => {
		assert.deepEqual(sheetText("**Bayes:** $P(A)$ and \\(B\\)\n\n- one\n2) two"), [
			{ kind: "text", pieces: [{ kind: "text", text: "Bayes:", bold: true }, { kind: "text", text: " " }, { kind: "math", tex: "P(A)" }, { kind: "text", text: " and " }, { kind: "math", tex: "B" }] },
			{ kind: "bullet", pieces: [{ kind: "text", text: "one" }] },
			{ kind: "step", marker: "2)", pieces: [{ kind: "text", text: "two" }] },
		]);
	});

	it("reads display math on one line or over several", () => {
		assert.deepEqual(sheetText("$$x^2$$\n\\[\n\\sum_k k\n\\]\nafter"), [
			{ kind: "display", tex: "x^2" },
			{ kind: "display", tex: "\\sum_k k" },
			{ kind: "text", pieces: [{ kind: "text", text: "after" }] },
		]);
	});
});

describe("cheat sheet: the studio's stage", () => {
	it("puts front and back side by side while they read well, else one under the other", () => {
		const a4 = { pageW: 794, pageH: 1123 };
		const wide = pagesLayout({ stageW: 1100, stageH: 840, ...a4, pages: 2 });
		assert.equal(wide.perRow, 2);
		assert.ok(wide.scale > 0.6 && wide.scale < 0.7);
		assert.equal(pagesLayout({ stageW: 600, stageH: 840, ...a4, pages: 2 }).perRow, 1);
		assert.equal(pagesLayout({ stageW: 1100, stageH: 840, ...a4, pages: 1 }).perRow, 1);
		assert.equal(pagesLayout({ stageW: 3000, stageH: 3000, pageW: 480, pageH: 288, pages: 1 }).scale, 2, "a card grows at most to twice its size");
	});

	it("captions two pages Front and Back, more by number, one not at all", () => {
		assert.deepEqual([pageCaption(0, 2), pageCaption(1, 2), pageCaption(2, 3), pageCaption(0, 1)], ["Front", "Back", "Page 3", ""]);
	});
});
