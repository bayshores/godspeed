/** The Rust reader the checks in this folder stand on: a reader that misreads a string hides real findings. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appSources, discardedResults, exportedMacros, inTraitImpl, namesFromCrate, readAppCode, readRust, rustFiles, rustFunctions, rustSize, rustTokens, topLevelPubItems } from "./rust-source.ts";

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

	it("all read with balanced braces once what only tests build is blanked too", () => {
		const unbalanced = files.filter(({ text }) => {
			const code = readAppCode(text).code;
			return code.split("{").length !== code.split("}").length;
		});
		assert.deepEqual(
			unbalanced.map((entry) => entry.file),
			[],
		);
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

describe("reading what the app builds", () => {
	it("blanks every item behind a test cfg, wherever it sits, and names the test modules it declares", () => {
		const text = ["#[cfg(test)]", "mod helpers;", "fn run() {}", '#[cfg(any(test, feature = "fake"))]', "pub fn fake() { let a = [1; 2]; }", '#[cfg(feature = "test-support")]', "pub mod memory;", "fn after() {}", "#[cfg(test)]", "mod tests {", "\tfn t() {}", "}"].join("\n");
		const read = readAppCode(text);
		assert.deepEqual(read.code.split("\n").map((line) => line.trim()), ["", "", "fn run() {}", "", "", "", "", "fn after() {}", "", "", "", ""]);
		assert.deepEqual(read.testModules, ["helpers", "memory"]);
	});

	it("keeps app code behind other cfgs, and a name used as an inline format argument", () => {
		const text = ['#[cfg(not(test))]', "fn real() {}", '#[cfg(feature = "screens")]', "fn screens() {}", 'fn say() { println!("{NAME} and {width:>4}, not {{braces}}"); }'].join("\n");
		const code = readAppCode(text).code;
		assert.ok(code.includes("fn real()") && code.includes("fn screens()"));
		assert.deepEqual(code.match(/[A-Za-z_]\w*/g)?.slice(-3), ["println", "NAME", "width"]);
	});

	it("lists the top-level pub items, not methods, private ones or pub(crate) ones", () => {
		const code = ["pub fn a() {}", "pub(crate) fn b() {}", "pub async fn c() {}", 'pub unsafe extern " " fn d() {}', "pub static mut E: u8 = 0;", "pub type F = u8;", "pub trait G {}", "impl H {", "\tpub fn method() {}", "}", "pub enum I {}", "pub use j::K;", "fn private() {}"].join("\n");
		assert.deepEqual(topLevelPubItems(code), [
			{ name: "a", line: 1 },
			{ name: "c", line: 3 },
			{ name: "d", line: 4 },
			{ name: "E", line: 5 },
			{ name: "F", line: 6 },
			{ name: "G", line: 7 },
			{ name: "I", line: 11 },
		]);
	});

	it("finds the statements that throw a result away, whole, and not the ones that keep it", () => {
		const code = ["fn f() {", "\tlet _ = a(b(c), {", "\t\td", "\t});", "\t_ = e();", "\tg().ok();", "\tlet h = i().ok();", "\tj = k().ok();", "\tlet _guard = l();", "\tmatch m { _ => n() }", "}"].join("\n");
		assert.deepEqual(discardedResults(code), [
			{ line: 2, text: "let _ = a(b(c), { d });" },
			{ line: 5, text: "_ = e();" },
			{ line: 6, text: "g().ok();" },
		]);
	});

	it("sizes a file by the code the app builds and its strings, wherever its tests sit", () => {
		const size = (text: string) => rustSize(text, readAppCode(text).code);
		assert.equal(size('// note\nfn a() { b("c d"); }\n#[cfg(test)]\nmod tests {}'), 'fna(){b("cd");}'.length);
		assert.equal(size('#[cfg(test)]\nmod a_tests;\nfn a() { b("c d"); }\n#[cfg(test)]\nimpl A { fn t() {} }\nfn e() {}'), 'fna(){b("cd");}fne(){}'.length);
	});

	it("blanks an enum variant, a field or a match arm behind a test cfg up to its comma", () => {
		const text = ["enum Start {", "\tCodex,", "\t#[cfg(test)]", "\tPipes(Box<dyn Fn()>),", "}", "struct S { #[cfg(test)] a: u8, b: u8 }", "fn f(x: u8) { match x { #[cfg(test)] 0 => {} _ => g() } }", "fn h(k: Kind) -> u8 { match k { #[cfg(test)] Kind::A { x } => x, Kind::B => 1 } }", "enum Next {}"].join("\n");
		const code = readAppCode(text).code;
		assert.equal(code.split("{").length, code.split("}").length);
		for (const kept of ["Codex,", "b: u8", "enum Next {}", "_ => g()", "Kind::B => 1"]) assert.ok(code.includes(kept), kept);
		for (const gone of ["Pipes", "a: u8", "0 =>", "Kind::A", "=> x,"]) assert.ok(!code.includes(gone), gone);
	});

	it("knows which names a file takes from another crate, only along a path from that crate", () => {
		const code = readRust(
			[
				"use gs_core::session::{plot::{Plot, Range as Span}, compaction};",
				"use gs_base::tasks::{self, detach};",
				"// gs_core::session::comment_only",
				"fn f() {",
				'\tlet s = "gs_core::session::string_only";',
				"\tcompaction::trim(gs_core::study::topic_end::ends_topic(x));",
				"\tx.merge();",
				"\tother::cut();",
				"\ttasks::set_runtime();",
				"}",
			].join("\n"),
		).code;
		assert.deepEqual([...namesFromCrate(code, "gs_core")].sort(), ["Plot", "Range", "Span", "compaction", "ends_topic", "plot", "session", "study", "topic_end", "trim"]);
		assert.deepEqual([...namesFromCrate(code, "gs_base")].sort(), ["detach", "set_runtime", "tasks"]);
	});

	it("finds the macros a file exports, whole, and not the ones it keeps", () => {
		const code = readRust("macro_rules! own { () => {} }\n#[macro_export]\nmacro_rules! json { ($($tt:tt)+) => { $crate::from_value($($tt)+) }; }\nfn after() {}").code;
		assert.deepEqual(exportedMacros(code), ["#[macro_export]\nmacro_rules! json { ($($tt:tt)+) => { $crate::from_value($($tt)+) }; }"]);
	});

	it("leaves out the files only tests build: by name, by a test cfg on their mod line, or by their module's", () => {
		const files = new Set(appSources().map((source) => source.file));
		assert.ok(files.has("crates/base/src/events.rs") && files.has("crates/core/src/lib.rs"));
		for (const file of ["crates/agent/src/tools/test_record.rs", "crates/runtime/src/fake.rs", "crates/runtime/src/fake/codex.rs", "crates/core/src/graph/memory.rs", "crates/transcribe/src/test_support.rs"]) {
			assert.ok(!files.has(file), `${file} is only for tests`);
		}
	});
});
