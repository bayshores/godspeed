/**
 * Reads Rust source as text for the checks in this folder, which have no Rust parser: tells code
 * from comments and from the inside of strings, so a check never matches a word in a comment.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

type RustFile = {
	/** From the repo's root, as `crates/core/src/lib.rs`. */
	file: string;
	text: string;
	/** A file only tests build: under a crate's `tests/`, or named as a test or test support file. */
	testOnly: boolean;
};

type RustText = {
	/** The source with every comment and the inside of every string and char blanked. Same length, same line breaks. */
	code: string;
	comments: { line: number; text: string }[];
};

const isTestOnly = (file: string) => /\/tests\/|(^|[/_])tests?\.rs$|test_support\.rs$/.test(file);

/** Every Rust file of the workspace's crates. */
export function rustFiles(): RustFile[] {
	const walk = (dir: string): string[] =>
		readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
			const file = `${dir}/${entry.name}`;
			if (entry.isDirectory()) return entry.name === "target" ? [] : walk(file);
			return entry.name.endsWith(".rs") ? [file] : [];
		});
	return walk("crates").map((file) => ({ file, text: readFileSync(path.join(root, file), "utf-8"), testOnly: isTestOnly(file) }));
}

/** How many `#` a raw string opens with at `at` (`r"`, `r#"`, `br##"`), or -1 where none opens. */
function rawStringHashes(text: string, at: number): number {
	const before = text[at - 1] ?? "";
	if (text[at] !== "r" || (/\w/.test(before) && !(before === "b" && !/\w/.test(text[at - 2] ?? "")))) return -1;
	let hashes = 0;
	while (text[at + 1 + hashes] === "#") hashes++;
	return text[at + 1 + hashes] === '"' ? hashes : -1;
}

/** The end of a char literal that opens at `at`, or -1 where the quote starts a lifetime. */
function charEnd(text: string, at: number): number {
	if (text[at + 1] === "\\") return text.indexOf("'", at + 3);
	const width = (text.codePointAt(at + 1) ?? 0) > 0xffff ? 2 : 1;
	return text[at + 1 + width] === "'" ? at + 1 + width : -1;
}

/** Splits Rust source into its code and its comments. */
export function readRust(text: string): RustText {
	// By UTF-16 unit, as every index below is: spreading the text would split it by code point.
	const out = text.split("");
	const comments: RustText["comments"] = [];
	let line = 1;
	const blank = (from: number, to: number) => {
		for (let i = from; i < to; i++) {
			if (text[i] === "\n") line++;
			else out[i] = " ";
		}
	};
	const comment = (from: number, to: number) => {
		comments.push({ line, text: text.slice(from, to) });
		blank(from, to);
	};

	let at = 0;
	while (at < text.length) {
		const two = text.slice(at, at + 2);
		const hashes = rawStringHashes(text, at);
		if (two === "//") {
			const end = text.indexOf("\n", at);
			comment(at, end === -1 ? text.length : end);
			at = end === -1 ? text.length : end;
		} else if (two === "/*") {
			let depth = 1;
			let end = at + 2;
			while (end < text.length && depth > 0) {
				if (text.startsWith("/*", end)) depth++, end++;
				else if (text.startsWith("*/", end)) depth--, end++;
				end++;
			}
			comment(at, end);
			at = end;
		} else if (hashes >= 0) {
			const open = at + 2 + hashes;
			const close = text.indexOf(`"${"#".repeat(hashes)}`, open);
			const end = close === -1 ? text.length : close;
			blank(open, end);
			at = end + 1 + hashes;
		} else if (text[at] === '"') {
			let end = at + 1;
			while (end < text.length && text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
			blank(at + 1, end);
			at = end + 1;
		} else if (text[at] === "'") {
			const end = charEnd(text, at);
			if (end > at) blank(at + 1, end);
			at = end > at ? end + 1 : at + 1;
		} else {
			if (text[at] === "\n") line++;
			at++;
		}
	}
	return { code: out.join(""), comments };
}

/** The code above a file's first `#[cfg(test)]`: what the app itself runs. */
export function beforeTests(code: string): string {
	const tests = code.indexOf("#[cfg(test)]");
	return tests === -1 ? code : code.slice(0, tests);
}
