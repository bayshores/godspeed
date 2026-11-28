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

/** A piece of Rust code at its offset: a word, a number, a lifetime, a whole string or char as written, or one mark. */
export type RustToken = { text: string; at: number };

const NUMBER = /\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?\w*/y;

/** Where a string that opens at `at` (its `"` or the `#` of a raw one) ends, in code whose strings are blanked. */
function stringEnd(code: string, at: number): number {
	let hashes = 0;
	while (code[at + hashes] === "#") hashes++;
	const close = code.indexOf('"', at + hashes + 1);
	return close === -1 ? code.length : close + 1 + hashes;
}

/**
 * The tokens of Rust source, comments left out. `code` is the source as `readRust` gives it, or a cut
 * of it such as `beforeTests`; strings and chars are read whole from `text`.
 */
export function rustTokens(text: string, code = readRust(text).code): RustToken[] {
	const tokens: RustToken[] = [];
	let at = 0;
	while (at < code.length) {
		const char = code[at]!;
		let end = at + 1;
		if (/\s/.test(char)) {
			at++;
			continue;
		}
		if (/[A-Za-z_]/.test(char)) {
			while (end < code.length && /\w/.test(code[end]!)) end++;
			const word = code.slice(at, end);
			if (/^(?:b|r|br)$/.test(word) && /^#*"/.test(code.slice(end, end + 8))) end = stringEnd(code, end);
			else if (word === "b" && code[end] === "'") end = code.indexOf("'", end + 1) + 1 || code.length;
		} else if (/\d/.test(char)) {
			NUMBER.lastIndex = at;
			NUMBER.test(code);
			end = NUMBER.lastIndex;
		} else if (char === '"') {
			end = stringEnd(code, at);
		} else if (char === "'") {
			const lifetime = /[A-Za-z_]/.test(code[at + 1] ?? "");
			while (lifetime && end < code.length && /\w/.test(code[end]!)) end++;
			if (!lifetime) end = code.indexOf("'", at + 1) + 1 || code.length;
		}
		tokens.push({ text: text.slice(at, end), at });
		at = end;
	}
	return tokens;
}

/** Each `{` among the tokens with the `}` that closes it, by token index. */
function braces(tokens: RustToken[]): Map<number, number> {
	const closes = new Map<number, number>();
	const open: number[] = [];
	tokens.forEach((token, i) => {
		if (token.text === "{") open.push(i);
		else if (token.text === "}" && open.length > 0) closes.set(open.pop()!, i);
	});
	return closes;
}

type Span = readonly [from: number, to: number];
const inside = (spans: Span[], at: number) => spans.some(([from, to]) => from < at && at < to);

/** The `impl` blocks among the tokens, by token index, each marked when it implements a trait. */
function implBlocks(tokens: RustToken[], closes: Map<number, number>): { span: Span; trait: boolean }[] {
	return tokens.flatMap((token, i) => {
		// An `impl` item starts a statement; one in a type (`-> impl Fn()`) follows a mark such as `>` or `:`.
		if (token.text !== "impl" || !["}", ";", "{", "]", "unsafe", undefined].includes(tokens[i - 1]?.text)) return [];
		const brace = tokens.findIndex((word, at) => at > i && word.text === "{");
		if (brace < 0) return [];
		return [{ span: [brace, closes.get(brace) ?? tokens.length] as const, trait: tokens.slice(i, brace).some((word) => word.text === "for") }];
	});
}

/** Whether the token at an index lies inside an `impl Trait for Type` block, where a trait gives every type the same items. */
export function inTraitImpl(tokens: RustToken[]): (at: number) => boolean {
	const spans = implBlocks(tokens, braces(tokens)).flatMap((block) => (block.trait ? [block.span] : []));
	return (at) => inside(spans, at);
}

type RustFunction = {
	name: string;
	/** The body's tokens, its braces included. */
	body: RustToken[];
	/** Declared in an `impl Trait for Type` block. */
	traitImpl: boolean;
	/** Neither a method nor declared inside another function. */
	free: boolean;
};

/** The functions with a body among a file's tokens, nested ones included. */
export function rustFunctions(tokens: RustToken[]): RustFunction[] {
	const closes = braces(tokens);
	const impls = implBlocks(tokens, closes);
	const found = tokens.flatMap((token, i) => {
		if (token.text !== "fn" || !/^[A-Za-z_]\w*$/.test(tokens[i + 1]?.text ?? "")) return [];
		let depth = 0;
		let end = i + 2;
		for (; end < tokens.length; end++) {
			const mark = tokens[end]!.text;
			if (mark === "(" || mark === "[") depth++;
			else if (mark === ")" || mark === "]") depth--;
			else if (depth === 0 && (mark === "{" || mark === ";")) break;
		}
		const close = closes.get(end);
		return tokens[end]?.text === "{" && close !== undefined ? [{ at: i, name: tokens[i + 1]!.text, span: [end, close] as const }] : [];
	});
	const bodies = found.map((fn) => fn.span);
	return found.map(({ at, name, span }) => ({
		name,
		body: tokens.slice(span[0], span[1] + 1),
		traitImpl: impls.some((block) => block.trait && inside([block.span], at)),
		free: !inside(impls.map((block) => block.span), at) && !inside(bodies, at),
	}));
}

/**
 * Whether a `#[cfg(...)]` builds its item only for tests: it names `test`, or a feature for tests
 * (`fake`, or one with "test" in its name). A `not(...)` is read as app code.
 */
function isTestCfg(attribute: string): boolean {
	if (!attribute.startsWith("#[cfg(") || /\bnot\s*\(/.test(attribute)) return false;
	const features = [...attribute.matchAll(/feature\s*=\s*"([^"]*)"/g)].map((match) => match[1]!);
	return /\btest\b/.test(attribute.replace(/"[^"]*"/g, '""')) || features.some((feature) => feature === "fake" || feature.includes("test"));
}

/** The end of the bracket that opens at `open` in blanked code. */
function closing(code: string, open: number): number {
	let depth = 0;
	for (let i = open; i < code.length; i++) {
		if ("([{".includes(code[i]!)) depth++;
		else if (")]}".includes(code[i]!) && --depth === 0) return i + 1;
	}
	return code.length;
}

/** The end of the item that starts at `from` in blanked code: past its `;`, or past its body's closing brace. */
function itemEnd(code: string, from: number): number {
	for (let i = from; i < code.length; i++) {
		if (code[i] === ";") return i + 1;
		if (code[i] === "{") return closing(code, i);
		if ("([".includes(code[i]!)) i = closing(code, i) - 1;
	}
	return code.length;
}

/** Where the inside of each string lies in blanked code. Every quote left in the code opens or closes a string, so they pair up in order. */
function stringSpans(code: string): [number, number][] {
	const quotes = [...code.matchAll(/"/g)].map((match) => match.index);
	const spans: [number, number][] = [];
	for (let q = 0; q + 1 < quotes.length; q += 2) spans.push([quotes[q]! + 1, quotes[q + 1]!]);
	return spans;
}

/**
 * What the app builds of a Rust file: its code as `readRust` leaves it, with every item behind a
 * test cfg blanked too (a test module, a test helper, a `mod` line naming a file of tests), and the
 * names of the modules those `mod` lines declare. A name a string uses as an inline format argument
 * (`"{name}"`, `"{name:>4}"`) is code, so it stays in place.
 */
export function readAppCode(text: string): { code: string; testModules: string[] } {
	const { code } = readRust(text);
	const out = code.split("");
	const testModules: string[] = [];
	for (const [from, to] of stringSpans(code)) {
		for (const arg of text.slice(from, to).matchAll(/(?<!\{)\{([A-Za-z_]\w*)(?=[}:])/g)) {
			for (let i = 1; i <= arg[1]!.length; i++) out[from + arg.index + i] = text[from + arg.index + i]!;
		}
	}
	let at = code.indexOf("#[");
	while (at !== -1) {
		let end = at;
		let test = false;
		while (code.startsWith("#[", end)) {
			const close = closing(code, end + 1);
			test ||= isTestCfg(text.slice(end, close));
			end = close;
			while (/\s/.test(code[end] ?? "")) end++;
		}
		if (test) {
			const item = itemEnd(code, end);
			const declared = /^(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/.exec(code.slice(end, item));
			if (declared) testModules.push(declared[1]!);
			for (let i = at; i < item; i++) if (out[i] !== "\n") out[i] = " ";
			end = item;
		}
		at = code.indexOf("#[", end);
	}
	return { code: out.join(""), testModules };
}

/** The files that may declare a file's module (`mod name;`), with the module's name. None for a crate's root. */
function declaredIn(file: string): { name: string; files: string[] } | undefined {
	const match = /^(crates\/[^/]+\/src)\/(.+)\.rs$/.exec(file);
	if (!match) return undefined;
	const [, src, rel] = match;
	const parts = rel!.split("/");
	if (parts.at(-1) === "mod") parts.pop();
	if (parts[0] === "bin" || (parts.length === 1 && ["lib", "main"].includes(parts[0]!))) return undefined;
	const name = parts.pop()!;
	const dir = parts.length > 0 ? `${src}/${parts.join("/")}` : undefined;
	return { name, files: dir ? [`${dir}.rs`, `${dir}/mod.rs`] : [`${src}/lib.rs`, `${src}/main.rs`] };
}

/**
 * The code of every Rust file the app builds, as `readAppCode` reads it. A file only tests build is
 * left out: by its name (see `rustFiles`), because its `mod` line sits behind a test cfg, or
 * because it belongs to such a module.
 */
export function appSources(): { file: string; text: string; code: string }[] {
	const files = rustFiles();
	const testOnly = new Set(files.filter((entry) => entry.testOnly).map((entry) => entry.file));
	const read = new Map(files.filter((entry) => !entry.testOnly).map((entry) => [entry.file, { text: entry.text, ...readAppCode(entry.text) }]));
	const forTests = (file: string): boolean => {
		const parent = declaredIn(file);
		const declaring = parent?.files.find((candidate) => read.has(candidate) || testOnly.has(candidate));
		if (!parent || !declaring) return false;
		return testOnly.has(declaring) || read.get(declaring)!.testModules.includes(parent.name) || forTests(declaring);
	};
	return [...read].filter(([file]) => !forTests(file)).map(([file, { text, code }]) => ({ file, text, code }));
}

/** The `pub` items at the top of a file's blanked code (fn, struct, enum, trait, const, static, type, union), by name and line. Methods and `pub(crate)` items are not among them. */
export function topLevelPubItems(code: string): { name: string; line: number }[] {
	const item = /^[ \t]*pub[ \t]+(?:(?:async|const|unsafe|extern[ \t]+"[^"]*")[ \t]+)*(?:fn|struct|enum|trait|const|static|type|union)[ \t]+(?:mut[ \t]+)?([A-Za-z_]\w*)/;
	const items: { name: string; line: number }[] = [];
	let depth = 0;
	code.split("\n").forEach((text, index) => {
		const found = depth === 0 ? item.exec(text) : null;
		if (found) items.push({ name: found[1]!, line: index + 1 });
		for (const c of text) depth += c === "{" ? 1 : c === "}" ? -1 : 0;
	});
	return items;
}

/** Where the statement around `at` in blanked code begins: after the `;`, `{` or `}` before it at its own depth. */
function statementStart(code: string, at: number): number {
	let depth = 0;
	for (let i = at - 1; i >= 0; i--) {
		const c = code[i]!;
		if (")]".includes(c)) depth++;
		else if ("([".includes(c)) depth--;
		else if (depth === 0 && ";{}".includes(c)) return i + 1;
	}
	return 0;
}

/** Where the statement that goes on at `from` in blanked code ends: past its `;`, or at the brace that closes its block. */
function statementEnd(code: string, from: number): number {
	let depth = 0;
	for (let i = from; i < code.length; i++) {
		const c = code[i]!;
		if ("([{".includes(c)) depth++;
		else if (")]}".includes(c) && --depth < 0) return i;
		else if (c === ";" && depth === 0) return i + 1;
	}
	return code.length;
}

/**
 * The statements of blanked code that throw a result away: `let _ = <expr>;`, `_ = <expr>;` and
 * `<expr>.ok();` (not `let x = <expr>.ok();`, which keeps it), each with the line it starts on and
 * its text on one line.
 */
export function discardedResults(code: string): { line: number; text: string }[] {
	const spans: [number, number][] = [];
	for (const match of code.matchAll(/(?:\blet\s+)?(?<![\w.])_\s*(?::[^=;]*)?=(?![=>])/g)) {
		spans.push([match.index, statementEnd(code, match.index + match[0].length)]);
	}
	for (const match of code.matchAll(/\.ok\(\s*\)\s*;/g)) {
		const start = statementStart(code, match.index);
		if (!/^\s*let\b|^[^=]*[^=!<>]=[^=]/.test(code.slice(start, match.index))) spans.push([start, match.index + match[0].length]);
	}
	return spans
		.map(([from, to]) => {
			const start = from + (code.slice(from).search(/\S/) || 0);
			return { line: code.slice(0, start).split("\n").length, text: code.slice(start, to).replace(/\s+/g, " ").trim() };
		})
		.sort((a, b) => a.line - b.line);
}

/** A Rust file's size as the size check counts it: the characters that are not blank and not in a comment, strings included, above the file's first `#[cfg(test)]`. */
export function rustSize(text: string): number {
	const { code } = readRust(text);
	const kept = code.split("");
	for (const [from, to] of stringSpans(code)) for (let i = from; i < to; i++) kept[i] = text[i]!;
	return kept.slice(0, beforeTests(code).length).join("").replace(/\s/g, "").length;
}
