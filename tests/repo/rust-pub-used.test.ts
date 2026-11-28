/**
 * A `pub` item that nothing names is dead code rustc cannot see: an item a library makes public
 * counts as used. This fails on a top-level `pub` item (fn, struct, enum, trait, const, static,
 * type) in a crate's src whose name appears in no code the app builds, its own definition aside.
 * Code only tests call is dead code too, so a test's use does not count.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appSources, readAppCode, topLevelPubItems } from "./rust-source.ts";

type Source = { file: string; code: string };

/** The top-level `pub` items under `crates/<crate>/src` that no code in `sources` names but their own definition. */
function unusedPub(sources: Source[]): string[] {
	const uses = new Map<string, number>();
	for (const { code } of sources) for (const word of code.match(/[A-Za-z_]\w*/g) ?? []) uses.set(word, (uses.get(word) ?? 0) + 1);
	return sources
		.filter(({ file }) => /^crates\/[^/]+\/src\//.test(file))
		.flatMap(({ file, code }) => topLevelPubItems(code).filter(({ name }) => uses.get(name) === 1).map(({ name, line }) => `${file}:${line} ${name}`));
}

it("every top-level pub item in the crates is used by code the app builds", () => {
	assert.deepEqual(unusedPub(appSources()), [], "These pub items are named nowhere in the code the app builds. Delete each one, with the tests that only exercised it; a helper a test still needs moves into that test's module.");
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
