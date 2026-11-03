/**
 * The cheat sheet's pure core: reading saved records, the rules and
 * choices, which topics go on it, the setup's summary, line budgets,
 * the mistakes, and the fit (packing, the meter's words, the fixes, the
 * margin notes).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	DEFAULT_PREFS,
	DEFAULT_RULES,
	WATCH_OUT,
	bannedContent,
	cleanBanned,
	leftOutTopics,
	lineBudgets,
	linesPerColumn,
	mergePrefs,
	mergeRules,
	newCheatSheet,
	parseCheatSheet,
	planLines,
	prefsForWriting,
	sheetContent,
	sheetLines,
	sheetMistakes,
	sheetTopics,
	type CheatSheetBlock,
	type SheetTopic,
} from "../src/core/cheat-sheet.ts";
import { fitFixes, fitLabel, overflowLines, packBlocks, stackNotes } from "../src/core/cheat-sheet-fit.ts";

const topic = (id: string, status: SheetTopic["status"], mistakes = 0): SheetTopic => ({ id, name: id[0]!.toUpperCase() + id.slice(1), status, mistakes });
const block = (id: string, topicId: string, pinned = false): CheatSheetBlock => ({ id, topicId, title: id, body: "x", reason: "r", ...(pinned ? { pinned: true as const } : {}) });

describe("cheat sheet: the saved record", () => {
	it("reads an old or partial record with defaults, and refuses a newer one", () => {
		const sheet = parseCheatSheet({ deadlineId: "ddl_1", rules: { paper: "a4", banned: ["Worked examples", "worked examples", 3] }, blocks: [block("blk_1", "t1"), { id: "bad" }] });
		assert.ok(sheet && sheet !== "newer");
		assert.equal(sheet.rules.paper, "a4");
		assert.equal(sheet.rules.allowed, true);
		assert.deepEqual(sheet.rules.banned, ["Worked examples"]);
		assert.deepEqual(sheet.prefs, DEFAULT_PREFS);
		assert.deepEqual(sheet.blocks.map((b) => b.id), ["blk_1"]);
		assert.equal(parseCheatSheet({ deadlineId: "ddl_1", version: 99 }), "newer");
		assert.equal(parseCheatSheet({ nope: true }), null);
	});

	it("merges patches field by field and drops what it doesn't know", () => {
		const rules = mergeRules(DEFAULT_RULES, { paper: "index-card", writing: "by-hand", allowed: "yes", source: "  Syllabus.pdf, page 3 " });
		assert.deepEqual(rules, { allowed: true, paper: "index-card", writing: "by-hand", banned: [], source: "Syllabus.pdf, page 3" });
		assert.equal(mergeRules(rules, { source: null }).source, undefined);
		const prefs = mergePrefs(DEFAULT_PREFS, { content: ["examples", "formulas", "nonsense"], columns: 4, ink: "color" });
		assert.deepEqual(prefs, { ...DEFAULT_PREFS, content: ["formulas", "examples"], ink: "color" });
	});

	it("cleans banned items to short single lines, at most 8", () => {
		assert.deepEqual(cleanBanned(["  Worked\n examples ", "", "x".repeat(80)]), ["Worked examples", "x".repeat(60)]);
		assert.equal(cleanBanned(Array.from({ length: 12 }, (_, i) => `ban ${i}`)).length, 8);
	});
});

describe("cheat sheet: rules and choices", () => {
	it("a ban rules out the kind it names; what goes on it skips banned kinds", () => {
		assert.deepEqual([...bannedContent(["Worked examples", "No theorems"])].sort(), ["examples", "theorems"]);
		const sheet = { rules: { ...DEFAULT_RULES, banned: ["Worked examples"] }, prefs: { ...DEFAULT_PREFS, content: [...DEFAULT_PREFS.content, "examples" as const] } };
		assert.deepEqual(sheetContent(sheet), ["formulas", "definitions", "theorems", "mistakes"]);
	});

	it("handwritten takes Large text, printed Medium", () => {
		assert.equal(prefsForWriting(DEFAULT_PREFS, "by-hand").textSize, "large");
		assert.equal(prefsForWriting({ ...DEFAULT_PREFS, textSize: "small" }, "printed").textSize, "medium");
	});

	it("counts lines per column and for the sheet from paper, size and spacing", () => {
		const sheet = newCheatSheet("d", "t");
		// Letter: 11 - 0.8 margins - 0.4 header = 9.8 in; 8.5 pt × 1.25 = 0.1476 in a line.
		assert.equal(linesPerColumn(sheet), 66);
		assert.equal(sheetLines(sheet), 132);
		assert.equal(sheetLines({ ...sheet, rules: { ...sheet.rules, paper: "letter-both" } }), 264);
		assert.equal(linesPerColumn({ ...sheet, rules: { ...sheet.rules, writing: "by-hand" }, prefs: { ...sheet.prefs, textSize: "large" } }), 40);
	});
});

describe("cheat sheet: tailoring", () => {
	const topics = [topic("counting", "weak", 2), topic("binomial", "shaky"), topic("sums", "strong"), topic("probability", "untested"), topic("induction", "strong", 1)];

	it("leaves out the topics known cold, unless there was a mistake in one", () => {
		const { on, leftOut } = sheetTopics(topics);
		assert.deepEqual(on.map((t) => t.id), ["counting", "binomial", "probability", "induction"]);
		assert.deepEqual(leftOut.map((t) => t.id), ["sums"]);
		assert.deepEqual(leftOutTopics(topics, [block("b", "counting"), block("w", WATCH_OUT)]).map((t) => t.id), ["binomial", "sums", "probability", "induction"]);
	});

	it("sums up the plan as the setup shows it", () => {
		assert.deepEqual(planLines(topics, 3, true), [
			{ status: "weak", text: "First: your 3 mistakes from practice and your weak topic" },
			{ status: "shaky", text: "Then: your shaky topic, short" },
			{ status: "untested", text: "Then: the key formulas for the 1 topic you haven't been tested on" },
			{ status: "strong", text: "Left out: the 1 topic you know cold" },
		]);
		assert.deepEqual(planLines([topic("a", "untested"), topic("b", "untested")], 2, false), [
			{ status: "untested", text: "First: the key formulas for the 2 topics you haven't been tested on" },
		]);
	});

	it("gives weak topics the most lines, the Watch out block a share, everyone at least 2", () => {
		const budgets = lineBudgets(120, [topic("w", "weak"), topic("s", "shaky"), topic("u", "untested")], 3);
		assert.equal(budgets.get(WATCH_OUT), 6);
		assert.ok(budgets.get("w")! > budgets.get("s")! && budgets.get("s")! > budgets.get("u")!);
		assert.equal(lineBudgets(4, [topic("u", "untested")], 0).get("u"), 2);
	});

	it("takes the newest mistakes in the deadline's topics, each question once", () => {
		const mistakes = sheetMistakes(
			[
				{ text: "How many 5-card hands?", kind: "wrong", at: "2026-10-01", topicIds: ["counting"] },
				{ text: "  How many 5-card   hands? ", kind: "wrong", at: "2026-10-03", topicIds: ["counting"] },
				{ text: "E[X^2] for a die", kind: "hint", at: "2026-10-02", topicIds: ["other", "probability"] },
				{ text: "Off topic", kind: "wrong", at: "2026-10-04", topicIds: ["other"] },
			],
			["counting", "probability"],
		);
		assert.deepEqual(mistakes.map((m) => [m.topicId, m.text, m.kind]), [
			["counting", "How many 5-card hands?", "wrong"],
			["probability", "E[X^2] for a die", "hint"],
		]);
	});
});

describe("cheat sheet: the fit", () => {
	const opts = { columnHeight: 100, columns: 2, sides: 1, gap: 10 };

	it("packs blocks down a column, then the next, and says how full it is", () => {
		const p = packBlocks([40, 40, 30, 50], opts);
		assert.deepEqual(p.placements.map((x) => [x.column, x.top, x.over]), [[0, 0, false], [0, 50, false], [1, 0, false], [1, 40, false]]);
		assert.equal(p.overflow, 0);
		assert.equal(p.fill, (100 + 90) / 200);
	});

	it("hangs what doesn't fit below the last column and counts the overflow", () => {
		const p = packBlocks([90, 90, 30], opts);
		assert.deepEqual(p.placements.map((x) => [x.column, x.top, x.over]), [[0, 0, false], [1, 0, false], [1, 100, true]]);
		assert.equal(p.overflow, 30);
		assert.ok(p.fill > 1);
		assert.equal(overflowLines(30, 12), 3);
		assert.equal(overflowLines(2, 12), 1);
		assert.equal(overflowLines(0, 12), 0);
	});

	it("goes on to the second side of a two-sided sheet", () => {
		const p = packBlocks([90, 90, 90], { ...opts, sides: 2 });
		assert.deepEqual(p.placements.map((x) => [x.side, x.column]), [[0, 0], [0, 1], [1, 0]]);
		assert.equal(p.overflow, 0);
	});

	it("names the paper in the meter", () => {
		assert.equal(fitLabel("letter", true), "Fits on one side");
		assert.equal(fitLabel("letter-both", false), "Too long for both sides");
		assert.equal(fitLabel("index-card", false), "Too long for the card");
	});

	it("offers three fixes and never cuts pinned blocks or Watch out", () => {
		const topics = [topic("a", "weak"), topic("b", "untested"), topic("c", "untested"), topic("d", "shaky")];
		const sheet = {
			prefs: DEFAULT_PREFS,
			blocks: [block("w", WATCH_OUT), block("ba", "a"), block("bb", "b"), block("bc", "c", true), block("bd", "d")],
		};
		const heights = new Map([["w", 80], ["ba", 60], ["bb", 50], ["bc", 99], ["bd", 70]]);
		const fixes = fitFixes(sheet, heights, topics);
		assert.deepEqual(fixes, [
			{ kind: "tighten", blockIds: ["w", "bd", "ba"], label: "Tighten the 3 longest blocks" },
			{ kind: "small-text", label: "Use Small text" },
			{ kind: "leave-out", blockId: "bb", label: "Leave out B" },
		]);
		assert.deepEqual(fitFixes({ ...sheet, prefs: { ...DEFAULT_PREFS, textSize: "small" } }, heights, topics).map((f) => f.kind), ["tighten", "leave-out"]);
	});

	it("stacks margin notes so none overlaps", () => {
		assert.deepEqual(stackNotes([{ id: "a", y: 0 }, { id: "c", y: 50 }, { id: "b", y: 10 }], 20).map((n) => [n.id, n.y]), [["a", 0], ["b", 20], ["c", 50]]);
	});
});
