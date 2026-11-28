/**
 * A file too long to hold one job fails. A file's size is what a reader reads: its characters
 * that are not blank and not in a comment, strings included, and for Rust only the code above its
 * first `#[cfg(test)]`. Files that were over the limit when this check came are listed in
 * exceptions/file-size.json with their size, which may only go down.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { rustFiles, rustSize } from "./rust-source.ts";

/** About 500 lines of this repo's Rust, whose lines hold 34.5 such characters on average. */
const LIMIT = 17_000;
const LIST = "tests/repo/exceptions/file-size.json";

type Sized = { file: string; size: number };

/** The files the app builds, by size. Files only tests build are not measured. */
function sizes(): Sized[] {
	return rustFiles()
		.filter((entry) => !entry.testOnly)
		.map(({ file, text }) => ({ file, size: rustSize(text) }));
}

/** What is wrong with the files' sizes, given the listed ones, each saying how to fix it. */
function sizeProblems(sized: Sized[], listed: Record<string, number>): string[] {
	const problems = sized.flatMap(({ file, size }) => {
		const allowed = listed[file];
		if (allowed === undefined) return size > LIMIT ? [`${file} has ${size} characters, over the limit of ${LIMIT}. Split it into files that each do one job.`] : [];
		if (size > allowed) return [`${file} grew to ${size} characters, past its listed ${allowed}. Move code out of it instead.`];
		if (size <= LIMIT) return [`${file} has ${size} characters, within the limit now: remove it from ${LIST}.`];
		return size < allowed ? [`${file} shrank to ${size} characters: write ${size} for it in ${LIST}, so it cannot grow back.`] : [];
	});
	const measured = new Set(sized.map(({ file }) => file));
	return [...problems, ...Object.keys(listed).filter((file) => !measured.has(file)).map((file) => `${file} is gone: remove it from ${LIST}.`)];
}

it("no file is over the size limit or past its listed size", () => {
	const listed = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../..", LIST), "utf-8")) as Record<string, number>;
	assert.deepEqual(sizeProblems(sizes(), listed), []);
});

describe("measuring file sizes", () => {
	it("counts code and strings, not blanks, comments or the tests", () => {
		const text = ['// a comment that is long', "fn run() {", '\tsay("hi there"); /* note */', "}", "", "#[cfg(test)]", "mod tests { fn t() {} }"].join("\n");
		assert.equal(rustSize(text), "fnrun(){say(\"hithere\");}".length);
	});

	it("is not fooled by a test marker in a comment or a string", () => {
		assert.equal(rustSize('// #[cfg(test)]\nfn a() {}'), "fna(){}".length);
		assert.equal(rustSize('const T: &str = "#[cfg(test)]";\nfn a() {}'), 'constT:&str="#[cfg(test)]";fna(){}'.length);
	});

	it("tells an oversized file, a listed one that grew, shrank, fits or went, and lets the rest through", () => {
		const sized = [
			{ file: "big.rs", size: LIMIT + 1 },
			{ file: "grew.rs", size: LIMIT + 50 },
			{ file: "shrank.rs", size: LIMIT + 5 },
			{ file: "fits.rs", size: LIMIT },
			{ file: "same.rs", size: LIMIT + 9 },
			{ file: "small.rs", size: 10 },
		];
		const listed = { "grew.rs": LIMIT + 10, "shrank.rs": LIMIT + 10, "fits.rs": LIMIT + 10, "same.rs": LIMIT + 9, "gone.rs": LIMIT + 10 };
		assert.deepEqual(
			sizeProblems(sized, listed).map((problem) => problem.split(" ")[0]),
			["big.rs", "grew.rs", "shrank.rs", "fits.rs", "gone.rs"],
		);
	});

	it("measures the workspace", () => {
		const measured = sizes();
		assert.ok(measured.length > 400 && measured.some(({ size }) => size > LIMIT / 2), "found too few files, or only small ones; the measure is broken");
	});
});
