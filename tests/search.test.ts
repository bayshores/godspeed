/**
 * Class search, the pure parts (src/core/search.ts): passages with their
 * place in the file, the two rankings, and their fusion.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classCardText } from "../src/core/native-messages.ts";
import { chunkFile, chunkText, fuseRankings, keywordIndex, keywordRanking, rangePoint, snippetOf, vectorRanking } from "../src/core/search.ts";

describe("passages", () => {
	it("a PDF is cut by page, a long page into parts of the same page", () => {
		const long = Array.from({ length: 80 }, (_, i) => `line ${i} of a very long page about counting`).join("\n");
		const { chunks, extent } = chunkFile("ch6.pdf", `--- Page 1 ---\nIntro\n--- Page 2 ---\n\n--- Page 3 ---\n${long}`);
		assert.equal(extent, "3 pages");
		assert.deepEqual(chunks[0], { range: "p. 1", from: 1, to: 1, text: "Intro" });
		assert.ok(chunks.slice(1).every((c) => c.range === "p. 3" && c.text.length <= 1600), "the empty page 2 has no passage");
		assert.ok(chunks.length >= 3);
		assert.equal(chunks.slice(1).map((c) => c.text).join("\n"), long);
	});

	it("captions are cut into windows of 60–90 s with their times", () => {
		const cue = (n: number, start: number, text: string) =>
			`${n}\n00:${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")},000 --> 00:${String(Math.floor((start + 4) / 60)).padStart(2, "0")}:${String((start + 4) % 60).padStart(2, "0")},000\n${text}\n`;
		const raw = Array.from({ length: 40 }, (_, i) => cue(i + 1, i * 5, i === 1 ? "word 0" : `word ${i}`)).join("\n");
		const { chunks, extent } = chunkFile("lecture.srt", raw);
		assert.equal(chunks[0]!.range, "0:00–1:04");
		assert.equal(chunks[0]!.from, 0);
		assert.ok(chunks.every((c) => c.to - c.from <= 90));
		assert.ok(!chunks[0]!.text.includes("word 0 word 0"), "a rolling caption's repeat is kept once");
		assert.match(chunks[0]!.text, /^word 0 word 2/);
		assert.equal(extent, "3 min");
	});

	it("WebVTT cues without hours and with tags", () => {
		const { chunks } = chunkFile("a.vtt", "WEBVTT\n\n01:02.000 --> 01:05.500\n<v Prof>Stars and bars</v>\n");
		assert.deepEqual(chunks, [{ range: "1:02–1:05", from: 62, to: 65.5, text: "Stars and bars" }]);
	});

	it("text is cut into paragraph windows with line ranges", () => {
		const para = (n: number) => `Paragraph ${n} `.repeat(42).trim();
		const text = ["", para(1), "", para(2), "", para(3), "", para(4), ""].join("\n");
		const { chunks, extent } = chunkText(text);
		assert.equal(extent, "9 lines");
		assert.deepEqual(
			chunks.map((c) => c.range),
			["lines 2–6", "lines 8–8"],
		);
		assert.ok(chunks.every((c) => c.text.length <= 1600));
		assert.ok(chunks[1]!.text.startsWith("Paragraph 4"));
	});

	it("names a point in a file: page, time or line", () => {
		assert.equal(rangePoint("p. 12"), 12);
		assert.equal(rangePoint("12:30–13:45"), 750);
		assert.equal(rangePoint("1:02:03"), 3723);
		assert.equal(rangePoint("lines 40–80"), 40);
		assert.equal(rangePoint("start"), null);
	});
});

describe("ranking", () => {
	it("keyword ranking finds the passage with the words", () => {
		const index = keywordIndex([
			{ id: "a", text: "The pigeonhole principle and boxes" },
			{ id: "b", text: "Stars and bars counts distributions of identical objects" },
		]);
		assert.deepEqual(keywordRanking(index, "stars bars", 5), ["b"]);
	});

	it("vector ranking scores each row by its best query", () => {
		const v = (...xs: number[]) => Float32Array.from(xs);
		const rows = v(1, 0, 0, 1, 0.6, 0.8);
		assert.deepEqual(vectorRanking([v(0, 1)], rows, 2, 3), [1, 2, 0]);
		assert.deepEqual(vectorRanking([v(0, 1), v(1, 0)], rows, 2, 2).sort(), [0, 1]);
	});

	it("fusion weights each ranking", () => {
		assert.deepEqual(fuseRankings([{ ids: ["a", "b"], weight: 1 }, { ids: ["b", "c"], weight: 0.5 }]), ["b", "a", "c"]);
		assert.deepEqual(fuseRankings([{ ids: ["a", "b"], weight: 0.5 }, { ids: ["b", "a"], weight: 1 }]), ["b", "a"]);
	});

	it("a snippet starts near the first query word", () => {
		const text = `${"filler ".repeat(60)}the binomial theorem expands (x+y)^n ${"more ".repeat(60)}`;
		const snip = snippetOf(text, "binomial theorem");
		assert.ok(snip.length <= 202);
		assert.match(snip, /binomial theorem/);
		assert.equal(snippetOf("short text", "x"), "short text");
	});
});

describe("the class outline in the class card", () => {
	it("shows each file's size and unfinished state, then the topics with fact counts", () => {
		const text = classCardText({
			classId: "cls_x",
			name: "CSE 21",
			description: "",
			files: [
				{ name: "06_Counting.pdf", kind: "study", path: "/c/06.pdf", size: "98 pages", status: "ready" },
				{ name: "HW4.pdf", kind: "info", path: "/c/hw4.pdf", status: "pending" },
			],
			topics: [{ name: "Counting rules", facts: 24 }, { name: "Stars and bars", facts: 6 }],
		});
		assert.match(text, /^- \[study material\] 06_Counting\.pdf \(98 pages\) — \/c\/06\.pdf$/m);
		assert.match(text, /^- \[course info\] HW4\.pdf \(pending\) — \/c\/hw4\.pdf$/m);
		assert.match(text, /Topics in the class's knowledge graph \(facts in each\):\nCounting rules \(24\), Stars and bars \(6\)$/);
	});
});
