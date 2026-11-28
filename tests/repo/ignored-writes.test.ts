/**
 * A save or a delete whose failure is thrown away fails silently: the learner's change is gone
 * and nothing says so. This fails on a statement that discards the result (`let _ =`, `_ =` or
 * `.ok();`) of a store call or a file write, rename, copy or delete in the code the app builds.
 * A channel send or a log line may still be discarded; a file nothing needs any more goes through
 * `fsx::remove_leftover`, which logs a failure.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appSources, discardedResults, readAppCode } from "./rust-source.ts";

/** A store call, or a write, rename, copy or delete of a file. */
const WRITE = /\bstores\s*\.\s*\w+\s*\.\s*\w+\s*\(|\bfsx\s*::\s*(?:write\w*|rename_over|remove_if_present|remove_dir_if_present)\s*\(|\bfs\s*::\s*(?:write|rename|copy|hard_link|remove_file|remove_dir|remove_dir_all)\s*\(|\bFile\s*::\s*create\s*\(/;

/** The statement with what its brackets hold left out: the calls whose result it throws away, not the ones inside their arguments. */
function outerCalls(text: string): string {
	let depth = 0;
	let out = "";
	for (const c of text) {
		if (")]}".includes(c)) depth--;
		if (depth === 0) out += c;
		if ("([{".includes(c)) depth++;
	}
	return out;
}

/** Each statement in `code` that throws away the result of a write, as `<file>:<line> <statement>`. */
function ignoredWrites(file: string, code: string): string[] {
	return discardedResults(code)
		.filter(({ text }) => WRITE.test(outerCalls(text)))
		.map(({ line, text }) => `${file}:${line} ${text}`);
}

it("no code the app builds throws away the result of a save or a delete", () => {
	assert.deepEqual(
		appSources().flatMap(({ file, code }) => ignoredWrites(file, code)),
		[],
		'These statements throw away whether a save or a delete worked. Pass the error up with ?, or log it with where it happened (eprintln!("[area] could not ...: {err}")). A file nothing needs any more goes through fsx::remove_leftover.',
	);
});

describe("finding ignored writes", () => {
	const found = (text: string) => ignoredWrites("crates/demo/src/lib.rs", readAppCode(text).code);

	it("finds a dropped store call and file write, however the statement is written", () => {
		const text = [
			"fn run(app: &App) {",
			"\tlet _ = app.stores.spaces.delete_space(id);",
			"\tlet _ = app",
			"\t\t.stores",
			"\t\t.chats",
			"\t\t.save_chat(&chat);",
			"\tstd::fs::remove_file(&path).ok();",
			'\t_ = fsx::write_text_atomic(&file, "x");',
			"\tlet _: Result<(), String> = tokio::fs::rename(&a, &b).await;",
			"}",
		].join("\n");
		assert.deepEqual(found(text), [
			"crates/demo/src/lib.rs:2 let _ = app.stores.spaces.delete_space(id);",
			"crates/demo/src/lib.rs:3 let _ = app .stores .chats .save_chat(&chat);",
			"crates/demo/src/lib.rs:7 std::fs::remove_file(&path).ok();",
			'crates/demo/src/lib.rs:8 _ = fsx::write_text_atomic(&file, " ");',
			"crates/demo/src/lib.rs:9 let _: Result<(), String> = tokio::fs::rename(&a, &b).await;",
		]);
	});

	it("lets through a kept result, a channel send, a log line, a comment, a string and a test", () => {
		const text = [
			"fn run(app: &App) {",
			"\tlet _ = tx.send(1);",
			"\tlet _ = done.send(fsx::write_atomic(&path, &bytes, None));",
			'\tlet _ = writeln!(out, "x");',
			"\tlet meta = std::fs::metadata(&path).ok();",
			"\tlibrary = std::fs::read(&file).ok();",
			"\tlet _guard = app.stores.spaces.lock(id);",
			"\t// let _ = app.stores.spaces.delete_space(id);",
			'\tlog("let _ = std::fs::remove_file(&path);");',
			"\tfsx::remove_leftover(&tmp);",
			"}",
			"#[cfg(test)]",
			"mod tests {",
			"\tfn clean() { let _ = std::fs::remove_dir_all(&dir); }",
			"}",
		].join("\n");
		assert.deepEqual(found(text), []);
	});
});
