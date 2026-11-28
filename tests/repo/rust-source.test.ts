/** The Rust reader the checks in this folder stand on: a reader that misreads a string hides real findings. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beforeTests, inTraitImpl, readRust, rustFiles, rustFunctions, rustTokens } from "./rust-source.ts";

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

describe("reading Rust tokens and functions", () => {
	it("reads strings and chars whole, comments left out", () => {
		const tokens = rustTokens('let s = r#"a "b""#; // gone\nlet c = b\'\\n\'; f::<\'a>(0x1F, 1.5e3, b"x")');
		assert.deepEqual(
			tokens.map((token) => token.text),
			["let", "s", "=", 'r#"a "b""#', ";", "let", "c", "=", "b'\\n'", ";", "f", ":", ":", "<", "'a", ">", "(", "0x1F", ",", "1.5e3", ",", 'b"x"', ")"],
		);
	});

	it("finds functions with their bodies, and tells free ones from methods and trait methods", () => {
		const text = "impl Display for X { fn fmt(&self) -> String { s() } }\nimpl X { fn new(a: u32) -> Self { Self { a } } }\nfn run(f: impl Fn() -> u32) -> [u8; 4] { fn inner() {} [0; 4] }\ntrait T { fn decl(&self); }\n";
		const tokens = rustTokens(text);
		const found = rustFunctions(tokens).map((fn) => [fn.name, fn.body.map((token) => token.text).join(" "), fn.traitImpl, fn.free]);
		assert.deepEqual(found, [
			["fmt", "{ s ( ) }", true, false],
			["new", "{ Self { a } }", false, false],
			["run", "{ fn inner ( ) { } [ 0 ; 4 ] }", false, true],
			["inner", "{ }", false, false],
		]);
		const traitImpl = inTraitImpl(tokens);
		assert.deepEqual([tokens.findIndex((token) => token.text === "fmt"), tokens.findIndex((token) => token.text === "new")].map(traitImpl), [true, false]);
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
