/**
 * rustc reports dead code only for items that are not `pub`: an item a library makes public counts
 * as used. So a top-level `pub` item (fn, struct, enum, trait, const, static, type, union) in a
 * crate's src must be:
 * - named in code the app builds, its own definition aside. Code only tests call is dead code, so a
 *   test's use does not count.
 * - taken by another crate: along a path from this crate (`use gs_core::...`, `gs_core::a::b`), by
 *   the crate's own binary, through a macro it exports, or as part of the signature of an item that
 *   is taken. Tests take too: another crate's test code and the crate's own `tests/` folder can only
 *   reach a `pub` item. The crate's unit tests in `src` reach a `pub(crate)` one, so they do not
 *   count. Anything else is `pub(crate)` or private, where rustc sees it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { appSources, exportedMacros, namesFromCrate, readAppCode, readRust, rustFiles, topLevelItems, topLevelPubItems } from "./rust-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const LIST = "tests/repo/exceptions/rust-pub-wide.json";

type Source = { file: string; code: string };

const crateOf = (file: string) => file.split("/")[1]!;
const isBinary = (file: string) => /^crates\/[^/]+\/src\/(?:main\.rs|bin\/)/.test(file);
const words = (text: string): string[] => text.match(/[A-Za-z_]\w*/g) ?? [];

/** The top-level `pub` items under `crates/<crate>/src` that no code in `sources` names but their own definition. */
function unusedPub(sources: Source[]): string[] {
	const uses = new Map<string, number>();
	for (const { code } of sources) for (const word of words(code)) uses.set(word, (uses.get(word) ?? 0) + 1);
	return sources
		.filter(({ file }) => /^crates\/[^/]+\/src\//.test(file))
		.flatMap(({ file, code }) => topLevelPubItems(code).filter(({ name }) => uses.get(name) === 1).map(({ name, line }) => `${file}:${line} ${name}`));
}

/** What an item hands out with itself: a function's signature, a constant's type, a type's whole text. */
function signature(item: ReturnType<typeof topLevelItems>[number]): string {
	if (item.kind === "fn") return item.text.split("{")[0]!;
	if (item.kind === "const" || item.kind === "static") return item.text.split("=")[0]!;
	return item.text;
}

/** An impl block's own members, their bodies left out: the signatures and associated items it hands out. */
function members(text: string): string {
	let depth = 0;
	return [...text].filter((c) => (c === "{" ? ++depth : c === "}" ? depth-- : depth) <= 1).join("");
}

/**
 * The top-level `pub` items of each crate in `libs` (its folder under `crates/`, with its library's
 * name) that no other crate takes. `app` is the code the app builds, where the items are; `all` is
 * every Rust file with its test code, where the takers are.
 */
function widePub(app: Source[], all: Source[], libs: Map<string, string>): { file: string; line: number; name: string }[] {
	return [...libs].flatMap(([crate, lib]) => {
		const own = app.filter((source) => crateOf(source.file) === crate && source.file.startsWith(`crates/${crate}/src/`) && !isBinary(source.file));
		const items = own.flatMap((source) => topLevelItems(source.code).map((item) => ({ ...item, file: source.file })));
		const takes = (file: string) => crateOf(file) !== crate || isBinary(file) || file.startsWith(`crates/${crate}/tests/`);
		const taken = new Set<string>();
		for (const source of all) if (takes(source.file)) for (const name of namesFromCrate(source.code, lib)) taken.add(name);
		for (const word of own.flatMap(({ code }) => exportedMacros(code)).flatMap(words)) taken.add(word);
		// An item that is taken hands out what its signature names, and a type also what its impls' members name.
		const handed = new Set<string>();
		for (let grew = true; grew; ) {
			grew = false;
			for (const item of items.filter((item) => item.kind !== "impl" && taken.has(item.name) && !handed.has(`${item.file}:${item.line}`))) {
				handed.add(`${item.file}:${item.line}`);
				const impls = ["struct", "enum", "union", "type", "trait"].includes(item.kind) ? items.filter((impl) => impl.kind === "impl" && words(impl.name).includes(item.name)) : [];
				for (const word of [signature(item), ...impls.map((impl) => `${impl.name} ${members(impl.text)}`)].flatMap(words)) {
					grew ||= !taken.has(word);
					taken.add(word);
				}
			}
		}
		return items.filter((item) => item.pub && item.kind !== "impl" && !taken.has(item.name)).map(({ file, line, name }) => ({ file, line, name }));
	});
}

/** Each crate folder with its library's name, from its Cargo.toml. */
function crateLibs(): Map<string, string> {
	const crates = [...new Set(appSources().map((source) => crateOf(source.file)))];
	return new Map(crates.map((crate) => [crate, readFileSync(path.join(root, "crates", crate, "Cargo.toml"), "utf-8").match(/^name\s*=\s*"([^"]+)"/m)![1]!.replaceAll("-", "_")]));
}

it("every top-level pub item in the crates is used by code the app builds", () => {
	assert.deepEqual(unusedPub(appSources()), [], "These pub items are named nowhere in the code the app builds. Delete each one, with the tests that only exercised it; a helper a test still needs moves into that test's module.");
});

it("every top-level pub item in the crates is taken by another crate", () => {
	const all = rustFiles().map(({ file, text }) => ({ file, code: readRust(text).code }));
	const found = widePub(appSources(), all, crateLibs());
	const counts = new Map<string, number>();
	for (const { file } of found) counts.set(file, (counts.get(file) ?? 0) + 1);
	const listed = JSON.parse(readFileSync(path.join(root, LIST), "utf-8")) as Record<string, number>;
	assert.deepEqual(
		found.filter(({ file }) => (counts.get(file) ?? 0) > (listed[file] ?? 0)).map(({ file, line, name }) => `${file}:${line} ${name}`),
		[],
		"No other crate takes these pub items. Make each one pub(crate), or private where only its own file uses it, so rustc reports it once nothing uses it.",
	);
	const fewer = Object.entries(listed)
		.filter(([file, count]) => (counts.get(file) ?? 0) < count)
		.map(([file, count]) => `${file}: listed ${count}, found ${counts.get(file) ?? 0}`);
	assert.deepEqual(fewer, [], `These files have fewer pub items no other crate takes than ${LIST} says. Lower their count, or remove the line at 0.`);
});

describe("finding unused pub items", () => {
	const source = (file: string, text: string): Source => ({ file, code: readAppCode(text).code });
	const defines = source(
		"crates/demo/src/lib.rs",
		["pub fn used() {}", "pub fn unused() {}", "pub(crate) fn private_one() {}", "pub struct Thing;", "pub const LABEL: &str = \"x\";", "struct Holder;", "impl Holder {", "\tpub fn method() {}", "}"].join("\n"),
	);

	it("finds an item no other code names, and lets through one that is called or used in a format string", () => {
		const calls = source("crates/demo/src/main.rs", 'fn main() { used(); let t = Thing; println!("{LABEL}"); }');
		assert.deepEqual(unusedPub([defines, calls]), ["crates/demo/src/lib.rs:2 unused"]);
	});

	it("is not fooled by a name in a comment, in a string or in a test", () => {
		const dodges = source(
			"crates/demo/src/main.rs",
			['fn main() { used(); println!("{LABEL}"); }', "// unused() is kept for later", 'const NOTE: &str = "unused";', "#[cfg(test)]", "mod tests {", "\tfn t() { let _ = super::Thing; }", "}"].join("\n"),
		);
		assert.deepEqual(unusedPub([defines, dodges]), ["crates/demo/src/lib.rs:2 unused", "crates/demo/src/lib.rs:4 Thing"]);
	});

	it("checks only the crates' src folders", () => {
		const tool = source("crates/demo/build.rs", "pub fn only_here() {}");
		assert.deepEqual(unusedPub([tool]), []);
	});
});

describe("finding pub items no other crate takes", () => {
	const app = (file: string, text: string): Source => ({ file, code: readAppCode(text).code });
	const all = (file: string, text: string): Source => ({ file, code: readRust(text).code });
	const libs = new Map([["demo", "gs_demo"]]);
	const names = (found: ReturnType<typeof widePub>) => found.map(({ name }) => name);
	const demo = app(
		"crates/demo/src/lib.rs",
		[
			"pub fn taken(shape: &Shape) -> Result<Plot, Fault> { inner() }",
			"pub struct Shape { pub line: Line }",
			"pub struct Line;",
			"pub struct Plot;",
			"impl Plot { pub fn slider(&self) -> Slider { Slider } }",
			"pub struct Slider;",
			"pub struct Fault;",
			"pub fn inner() {}",
			"pub(crate) fn already_narrow() {}",
			"pub fn by_path() {}",
			"pub fn by_binary() {}",
			"pub fn by_macro() {}",
			"#[macro_export]",
			"macro_rules! demo { () => { $crate::by_macro() }; }",
		].join("\n"),
	);

	it("lets through what another crate takes, with what its signature and its impls hand out, and fails the rest", () => {
		const user = all("crates/other/src/lib.rs", "use gs_demo::taken;\nfn f() { gs_demo::by_path(); }");
		const binary = all("crates/demo/src/main.rs", "fn main() { gs_demo::by_binary(); }");
		assert.deepEqual(names(widePub([demo], [demo, user, binary], libs)), ["inner"]);
	});

	it("is not fooled by a name another crate writes in a comment, in a string (a test's too) or as a method", () => {
		const dodges = all(
			"crates/other/src/lib.rs",
			["// gs_demo::inner()", 'const NOTE: &str = "gs_demo::by_path";', "fn f(x: X) { x.by_binary(); by_path(); }", "#[cfg(test)]", "mod tests {", '\tconst T: &str = "gs_demo::taken";', "}"].join("\n"),
		);
		assert.deepEqual(names(widePub([demo], [demo, dodges], libs)), ["taken", "Shape", "Line", "Plot", "Slider", "Fault", "inner", "by_path", "by_binary"]);
	});

	it("counts another crate's tests and the crate's own tests folder as takers, and not the crate's unit tests in src", () => {
		const lib = ["pub fn by_unit_test() {}", "pub fn by_test_file() {}", "pub fn by_other_test() {}", "pub fn by_other_tests_folder() {}", "pub fn by_tests_folder() {}", "#[cfg(test)]", "mod tests {", "\tuse gs_demo::by_unit_test;", "}"].join("\n");
		const takers = [
			all("crates/demo/src/lib.rs", lib),
			all("crates/demo/src/test_support.rs", "fn f() { gs_demo::by_test_file(); }"),
			all("crates/other/src/lib.rs", "#[cfg(test)]\nmod tests {\n\tuse gs_demo::by_other_test;\n}"),
			all("crates/other/tests/golden.rs", "#[test]\nfn golden() { gs_demo::by_other_tests_folder(); }"),
			all("crates/demo/tests/golden.rs", "#[test]\nfn golden() { gs_demo::by_tests_folder(); }"),
		];
		assert.deepEqual(names(widePub([app("crates/demo/src/lib.rs", lib)], takers, libs)), ["by_unit_test", "by_test_file"]);
	});
});
