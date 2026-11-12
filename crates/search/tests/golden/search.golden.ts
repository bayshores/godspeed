// What src/shared/core/search.ts gives for made-up space texts (tests/fixtures) and for
// odd inputs: passages, places, snippets, MiniSearch results with their scores, fusion, vector
// ranking, and Math.log (BM25's idf).
//
// The cases run in the app's Electron (ELECTRON_RUN_AS_NODE), like the server: its Math.log is
// correctly rounded and Node's is not, which shows in the last bit of keyword scores.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chunkFile, chunkText, fuseRankings, keywordIndex, rangePoint, snippetOf, vectorRanking } from "../../../../src/shared/core/search.ts";

const fixtures = path.join(import.meta.dirname, "..", "fixtures");
const read = (file: string) => fs.readFileSync(path.join(fixtures, file), "utf8");

/** Fixture file, then the name chunkFile sees (the name picks the cutter). */
export const FILES: [string, string][] = [
	["bits-lecture.pdf.txt", "2026-09-30 bits - lecture-l2.pdf"],
	["git-lab.pdf.txt", "Git Lab 2.PDF"],
	["problem-set.txt", "problem-set.txt"],
	["lecture-captions.srt", "Captions_2026-09-25.srt"],
];

const words = (n: number, w = "word") => Array.from({ length: n }, (_, i) => `${w}${i}`).join(" ");
const cue = (i: number, from: string, to: string, text: string) => `${i}\n${from} --> ${to}\n${text}\n`;

/** [name, text] pairs for chunkFile. */
export const EDGES: [string, string][] = [
	["empty.txt", ""],
	["blank.txt", "\n\n  \n\t\n"],
	["one-line.md", "just one line"],
	["trailing.md", "a\nb\n"],
	["crlf.txt", "first\r\nsecond\r\rthird\rfourth\r\n"],
	["paragraphs.txt", Array.from({ length: 12 }, (_, i) => `${words(25, `p${i}w`)}\n${words(10, `q${i}w`)}`).join("\n\n")],
	["dense.txt", Array.from({ length: 80 }, (_, i) => `line ${i} ${"x".repeat(i % 7 === 0 ? 300 : 20)}`).join("\n")],
	["exact.txt", `${"a".repeat(1599)}\n${"b".repeat(1600)}\n${"c".repeat(1601)}`],
	["huge-line.txt", "z".repeat(5000)],
	["spaced-line.txt", words(900)],
	["early-space.txt", `ab ${"y".repeat(3000)}`],
	["emoji-cut.txt", `${"e".repeat(1599)}😀${"f".repeat(100)}`],
	["emoji-lines.txt", `${"😀".repeat(500)}\n${"é".repeat(700)}\n中文 ${"字".repeat(900)}`],
	["nbsp.txt", " \nreal text \n \nmore﻿"],
	["windows.txt", Array.from({ length: 30 }, (_, i) => `${"m".repeat(90)} ${i}\n`).join("\n")],
	["pages.pdf", "cover text\n--- Page 1 ---\nfirst page\n--- Page 3 ---\n\n--- Page 2 ---\nsecond\n--- Page 2 ---\nagain two"],
	["no-heads.pdf", "plain text with no page heads"],
	["one-page.pdf", "--- Page 1 ---\nonly"],
	["big-page.pdf", `--- Page 7 ---\n${words(500)}\n--- Page 99999999999999999999 ---\nfar`],
	["inline-head.pdf", "x --- Page 1 --- y\n--- Page 1 --- \n--- Page 4 ---\r\nwindows\r\n--- Page 5 ---"],
	["slides.pptx", "--- Slide 1 ---\nTitle\n--- Slide 2 ---\nBody text\n--- Slide 10 ---\nEnd"],
	["one-slide.pptx", "--- Slide 1 ---\nhi"],
	["slides-as-pdf.pdf", "--- Slide 1 ---\nnot pages"],
	["rolling.vtt", `WEBVTT\n\n${cue(1, "00:00.000", "00:02.000", "<v Speaker>Hello</v> there")}\n${cue(2, "00:02.000", "00:04.000", "Hello there")}\n${cue(3, "00:04.000", "00:30.500", "<b>bold</b> words\nsecond line")}\n${cue(4, "00:31.000", "01:05.250", "past a minute")}\n${cue(5, "01:05.250", "01:10.000", "next window")}`],
	["long-gap.srt", `${cue(1, "00:00:01,000", "00:00:02,000", "start")}\n${cue(2, "00:02:00,000", "00:02:01,000", "after a gap")}\n${cue(3, "01:00:00,000", "01:00:05,999", "an hour in")}`],
	["many-chars.srt", Array.from({ length: 30 }, (_, i) => cue(i + 1, `00:00:${String(i).padStart(2, "0")},000`, `00:00:${String(i + 1).padStart(2, "0")},000`, words(12, `c${i}`))).join("\n")],
	["odd-stamps.srt", `${cue(1, "1,2,3", "4", "comma stamps")}\n${cue(2, "00:00:05.5", "00:00:06", "dot stamp")}\n${cue(3, ":", "::", "colons")}\n${cue(4, "99999999999999999999999:00", "1", "huge")}`],
	["no-cues.srt", "1\nno timing here\n\n2\nnor here"],
	["crlf.srt", "1\r\n00:00:01,000 --> 00:00:02,000\r\nwindows line\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nnext\r\n"],
	["captions.SRT", cue(1, "00:00:01,000", "00:00:02,000", "upper-case extension")],
	["noext", "no extension\nat all"],
	["weird.ext.toolongextension", "an extension longer than ten letters"],
];

const RANGES = ["p. 12", "12", "12:30", "1:02:03", "lines 40–80", "slide 3", "start", "", "0:5", "10:100", "page 007", "1:2:3:4", "00:01:02,500", "-5", "1.5", "99999999999999999999", "p.12-14", "١٢"];

const SNIPPET_QUERIES = ["", "the", "pointer arithmetic", "UTF-8 encoding of bytes", "İstanbul", "zz qq", "a an to", "lecture", "malloc free", "CSE"];
const SNIPPET_TEXTS = [
	"  short \n\t text  ",
	`${"lead ".repeat(30)}İSTANBUL is here ${"tail ".repeat(40)}`,
	`${"x".repeat(150)} the end ${"y".repeat(150)}`,
	`${"😀 ".repeat(120)}lecture ${"é ".repeat(100)}`,
	`Σ ΣΑΣ ${"word ".repeat(60)} malloc ${"more ".repeat(30)}`,
];

const QUERIES = [
	"utf-8 encoding",
	"How many bytes does a UTF-8 character use?",
	"pointer",
	"Pointer POINTER pointer",
	"the",
	"",
	"   ",
	"!!!",
	"lecture one",
	"bit operations and masks",
	"git commit push",
	"strlen strcpy",
	"zebra unicorn",
	"İstanbul",
	"Café naïve",
	"1789",
	"problem-set",
	"i'm not sure which button this is",
	"so I'm going to see if I can get the projector switched on",
	"cse29 cse 29",
];

const EDGE_DOCS = [
	{ id: "a", text: "The cat sat on the mat. The cat!" },
	{ id: "b", text: "the CAT; the hat — and a bat…" },
	{ id: "c", text: "" },
	{ id: "d", text: "...!!!" },
	{ id: "e", text: "İstanbul café naïve ΣΑΣ" },
	{ id: "f", text: "cats dogs birds fish\nnewt\r\neel" },
	{ id: "7", text: "numbers 1789 and 2026" },
	{ id: "g", text: "emoji 😀 cat 😀 hat" },
];
const EDGE_QUERIES = ["cat", "the cat", "hat bat", "CAT cat", "istanbul", "İstanbul", "σας", "café", "birds fish", "eel", "😀", "1789", "", "dogs birds", "mat. cat!"];

/** Deterministic f32 vectors: rows of `dims` with repeats, so ties happen. */
function vectors(rows: number, dims: number, seed: number): number[] {
	let s = seed;
	const next = () => {
		s = (s * 1103515245 + 12345) % 2147483648;
		return (s / 2147483648) * 2 - 1;
	};
	const out: number[] = [];
	for (let r = 0; r < rows; r++) {
		if (r % 5 === 4) out.push(...out.slice((r - 2) * dims, (r - 1) * dims));
		else for (let d = 0; d < dims; d++) out.push(Math.fround(next()));
	}
	return out;
}

const CASES: Record<string, () => unknown> = {
	files: () =>
		FILES.map(([file, name]) => {
			const { chunks, extent } = chunkFile(name, read(file));
			return { file, name, extent, chunks };
		}),
	edges: () => EDGES.map(([name, text]) => ({ name, text, ...chunkFile(name, text) })),
	chunkText: () => [read("problem-set.txt"), "a\n\nb", ""].map((text) => chunkText(text)),
	ranges: () => RANGES.map((range) => ({ range, point: rangePoint(range) })),
	snippets: () => {
		const passages = chunkFile(FILES[1]![1], read(FILES[1]![0])).chunks.map((c) => c.text);
		const texts = [...SNIPPET_TEXTS, ...passages.slice(0, 6)];
		return { queries: SNIPPET_QUERIES, texts: texts.map((text) => ({ text, snippets: SNIPPET_QUERIES.map((query) => snippetOf(text, query)) })) };
	},
	keywords: () => {
		const docs = FILES.flatMap(([file, name]) => chunkFile(name, read(file)).chunks.map((c, n) => ({ id: `${file}:${n + 1}`, text: c.text })));
		const index = keywordIndex(docs);
		return QUERIES.map((query) => ({ query, hits: index.search(query, { combineWith: "OR" }).map((h) => [h.id, h.score]) }));
	},
	keywordEdges: () => {
		const index = keywordIndex(EDGE_DOCS);
		return EDGE_QUERIES.map((query) => ({ query, hits: index.search(query, { combineWith: "OR" }).map((h) => [h.id, h.score]) }));
	},
	duplicateId: () => keywordIndex([{ id: "x", text: "a" }, { id: "x", text: "b" }]),
	fusion: () => {
		const sets = [
			[{ ids: ["a", "b", "c"], weight: 1 }, { ids: ["c", "d"], weight: 0.5 }],
			[{ ids: ["p", "q"], weight: 1 }, { ids: ["q", "p"], weight: 1 }],
			[{ ids: Array.from({ length: 60 }, (_, i) => `v${i}`), weight: 1 }, { ids: Array.from({ length: 60 }, (_, i) => `v${59 - i}`), weight: 0.5 }],
			[{ ids: ["x", "x", "y"], weight: 1 }],
			[],
		];
		return sets.map((rankings) => ({ rankings, fused: fuseRankings(rankings) }));
	},
	vectors: () =>
		[
			{ rows: 40, dims: 8, queries: 1, n: 50 },
			{ rows: 25, dims: 16, queries: 3, n: 10 },
			{ rows: 1, dims: 4, queries: 1, n: 5 },
		].map(({ rows, dims, queries, n }, k) => {
			const table = vectors(rows, dims, k + 1);
			const qs = Array.from({ length: queries }, (_, i) => vectors(1, dims, 100 + i));
			return { table, dims, queries: qs, n, ranked: vectorRanking(qs.map((q) => Float32Array.from(q)), Float32Array.from(table), dims, n) };
		}),
	log: () => {
		const xs = [1, 1.5, 2, Math.E, 10, 0.1, 1e-300, 5e-324, 1e300, 1 + 1e-10, 1 + 2 ** -20, 1 - 2 ** -21, 3.999999, 0.7, 1.2307692307692308, 4.112820512820512, 2.264073694984647, 3.134083930399181];
		for (let m = 1; m <= 60; m++) for (const total of [1, 7, 61, 400, 2501]) if (m <= total) xs.push(1 + (total - m + 0.5) / (m + 0.5));
		return xs.map((x) => [x, Math.log(x)]);
	},
};

/** Each case's output, or its error, computed in this process. */
function runCases(): Record<string, { output?: unknown; error?: string }> {
	const out: Record<string, { output?: unknown; error?: string }> = {};
	for (const [name, run] of Object.entries(CASES)) {
		try {
			out[name] = { output: run() };
		} catch (err) {
			out[name] = { error: err instanceof Error ? err.message : String(err) };
		}
	}
	return out;
}

/** The cases as Electron's runtime computes them. */
async function inElectron(): Promise<Record<string, () => unknown>> {
	const { default: electron } = await import("electron");
	const child = spawnSync(String(electron), ["--import", "tsx", import.meta.filename], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SEARCH_GOLDEN_CHILD: "1" },
		encoding: "utf8",
		maxBuffer: 1 << 28,
	});
	if (child.status !== 0) throw new Error(`electron failed: ${child.stderr}`);
	const results = JSON.parse(child.stdout) as ReturnType<typeof runCases>;
	return Object.fromEntries(
		Object.entries(results).map(([name, r]) => [
			name,
			() => {
				if (r.error !== undefined) throw new Error(r.error);
				return r.output;
			},
		]),
	);
}

if (process.env.SEARCH_GOLDEN_CHILD) process.stdout.write(JSON.stringify(runCases()));

export default process.versions.electron ? CASES : await inElectron();
