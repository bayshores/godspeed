/** The Rust reader the checks in this folder stand on: a reader that misreads a string hides real findings. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beforeTests, readRust, rustFiles } from "./rust-source.ts";

describe("reading Rust source", () => {
	it("blanks comments and keeps their words apart from the code", () => {
		const read = readRust("let a = 1; // fetch it\n/* old /* nested */ still */ let b = 2;\n");
		assert.equal(read.code, "let a = 1;            \n                             let b = 2;\n");
		assert.deepEqual(read.comments, [
			{ line: 1, text: "// fetch it" },
			{ line: 2, text: "/* old /* nested */ still */" },
		]);
	});

	it("blanks the inside of strings, also raw ones and ones with an escaped quote", () => {
		assert.equal(readRust('call("a // b", "say \\"hi\\"")').code, 'call("      ", "          ")');
		assert.equal(readRust('let re = r#"a "quoted" // b"#; next()').code, 'let re = r#"               "#; next()');
		assert.equal(readRust('let bytes = br"\\d+"; next()').code, 'let bytes = br"   "; next()');
	});

	it("tells a char from a lifetime", () => {
		assert.equal(readRust("fn f<'a>(x: &'a str) -> char { '\"' }").code, "fn f<'a>(x: &'a str) -> char { ' ' }");
		assert.equal(readRust("match c { '\\'' => 1, '{' => 2, _ => 3 }").code, "match c { '  ' => 1, ' ' => 2, _ => 3 }");
	});

	it("stays in step after a character that takes two units", () => {
		assert.equal(readRust('let face = "😀"; let next = "{";').code, 'let face = "  "; let next = " ";');
		assert.equal(readRust("let face = '😀'; let next = '{';").code, "let face = '  '; let next = ' ';");
	});

	it("keeps every line where it was, a comment's line number counted through a long string", () => {
		const read = readRust('let s = "one\ntwo";\n// after\n');
		assert.equal(read.code.split("\n").length, 4);
		assert.deepEqual(read.comments, [{ line: 3, text: "// after" }]);
	});

	it("cuts a file at its tests", () => {
		assert.equal(beforeTests("fn run() {}\n#[cfg(test)]\nmod tests {}\n"), "fn run() {}\n");
		assert.equal(beforeTests("fn run() {}\n"), "fn run() {}\n");
	});
});

describe("the workspace's Rust files", () => {
	const files = rustFiles();

	it("are found, with test files told apart", () => {
		assert.ok(files.length > 400, "found too few Rust files; the reader is broken");
		assert.ok(files.some((entry) => entry.testOnly) && files.some((entry) => !entry.testOnly));
		assert.equal(files.find((entry) => entry.file === "crates/base/src/events.rs")?.testOnly, false);
	});

	it("all read with balanced braces once comments and strings are blanked", () => {
		const unbalanced = files.filter(({ text }) => {
			const code = readRust(text).code;
			return code.split("{").length !== code.split("}").length;
		});
		assert.deepEqual(
			unbalanced.map((entry) => entry.file),
			[],
		);
	});
});
