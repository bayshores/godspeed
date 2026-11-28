/**
 * A comment names only what exists, and holds no history. In the comments of the TypeScript and
 * Rust files of src/, crates/, tests/ and scripts/:
 * - A name in backticks that looks like code (a case change inside it, or an underscore) is written
 *   in the repo's code, or in the type declarations of a package the repo installs, which covers
 *   the Node and library calls a comment cites. Commands, flags and plain words in backticks are
 *   left alone.
 * - A file in backticks (a name with a file extension) is a file of the repo or a name the code
 *   writes, as a data file's name is.
 * - None of the history phrases of HISTORY: a ruling, a promise of later, a numbered phase.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import { readRust, rustTokens } from "./rust-source.ts";
import { tsComments, tsTokens } from "./ts-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const LIST = "tests/repo/exceptions/comment-names.json";
const SCRIPT = /\.(?:ts|tsx|js|mjs|cjs)$/;
const EXTENSION = /\.(?:ts|tsx|js|mjs|cjs|rs|json|jsonl|md|css|html|toml|ya?ml|sh|pen|png|svg|pdf|tex|txt|py|lock|plist|srt|vtt)$/;
const HISTORY = /\b(?:owner ruling|for now|(?:phase|round|wave) \d+)\b/gi;

type Comment = { file: string; line: number; text: string };
/** What the code holds: its words, its files, and its text with strings, to find a data file's name. */
type Known = { words: Set<string>; files: string[]; text: string };

const wordsOf = (text: string) => text.match(/[A-Za-z_$][\w$]*/g) ?? [];

/** A name in backticks the check reads: a file, or a name path whose parts are code names. */
function codeName(span: string): { file: string } | { names: string[] } | undefined {
	// A file has a name before its extension: `.md` alone is an extension, `.mcp.json` a file.
	if (/^[\w@./-]+$/.test(span) && EXTENSION.test(span) && !/^\.[^./]+$/.test(span)) return { file: span.replace(/^(?:\.\.?\/)+/, "") };
	const path = /^([A-Za-z_$][\w$]*(?:(?:::|\.)[A-Za-z_$][\w$]*)*)(?:\(\))?!?$/.exec(span)?.[1];
	if (!path) return undefined;
	const names = path.split(/::|\./).filter((part) => /[a-z][A-Z]/.test(part) || /[A-Za-z\d]_[A-Za-z\d]/.test(part));
	return names.length > 0 ? { names } : undefined;
}

/** What a comment says that is not so: each name or file it cites that the code lacks, and each piece of history. */
function untrue(comment: string, known: Known): string[] {
	const found: string[] = [];
	for (const [, span] of comment.matchAll(/`([^`\n]+)`/g)) {
		const name = codeName(span!.trim());
		if (!name) continue;
		if ("file" in name) {
			const base = path.basename(name.file);
			// A bare name whose stem the code uses is a placeholder (`name.md`) or a field path (`app.pdf`).
			const there = known.files.some((file) => file === name.file || file.endsWith(`/${name.file}`)) || known.text.includes(base) || (base === name.file && known.words.has(base.replace(/\.\w+$/, "")));
			if (!there) found.push(name.file);
		} else found.push(...name.names.filter((part) => !known.words.has(part)));
	}
	for (const [phrase] of comment.matchAll(HISTORY)) found.push(`"${phrase}"`);
	return found;
}

function tsSource(file: string, text: string): ts.SourceFile {
	const kind = file.endsWith("x") ? ts.ScriptKind.TSX : /\.[mc]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
	return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
}

/** The repo's code without its comments, and the comments of src/, crates/, tests/ and scripts/. */
function readRepo(): { known: Known; comments: Comment[] } {
	const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf-8" }).split("\n").filter(Boolean);
	const words = new Set<string>();
	const code: string[] = [];
	const comments: Comment[] = [];
	const checked = (file: string) => /^(?:src|crates|tests|scripts)\//.test(file);
	for (const file of files) {
		if (file.startsWith("docs/") || /\.(?:md|pdf|png|svg|woff2|tiff|jpg|pen|jsonl|srt|txt)$/.test(file)) continue;
		const text = readFileSync(path.join(root, file), "utf-8");
		let pieces: string[];
		if (SCRIPT.test(file)) {
			const source = tsSource(file, text);
			pieces = tsTokens(source, source).map((token) => token.getText(source));
			if (checked(file)) comments.push(...tsComments(source).map((comment) => ({ file, ...comment })));
		} else if (file.endsWith(".rs")) {
			pieces = rustTokens(text).map((token) => token.text);
			if (checked(file)) comments.push(...readRust(text).comments.map((comment) => ({ file, ...comment })));
		} else pieces = [text.replace(/\/\*[\s\S]*?\*\//g, "")];
		for (const piece of pieces) for (const word of wordsOf(piece)) words.add(word);
		code.push(pieces.join("\n"));
	}
	for (const word of outsideNames()) words.add(word);
	return { known: { words, files, text: code.join("\n") }, comments };
}

/** The names in the type declarations of every package the repo depends on. */
function outsideNames(): Set<string> {
	const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")) as Record<string, Record<string, string> | undefined>;
	const names = new Set<string>();
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory() && entry.name !== "node_modules") walk(full);
			else if (/\.d\.[mc]?ts$/.test(entry.name)) for (const word of wordsOf(readFileSync(full, "utf-8"))) names.add(word);
		}
	};
	for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) walk(path.join(root, "node_modules", name));
	return names;
}

it("every comment names only code that exists, and holds no history", () => {
	const { known, comments } = readRepo();
	assert.ok(comments.length > 10_000 && known.words.has("unlinkSync"), "found too few comments or no package types; the reader is broken");
	const allowed = JSON.parse(readFileSync(path.join(root, LIST), "utf-8")) as Record<string, number>;
	const found = new Map<string, { count: number; lines: string[] }>();
	for (const comment of comments) {
		for (const name of untrue(comment.text, known)) {
			const key = `${comment.file}: ${name}`;
			const seen = found.get(key) ?? { count: 0, lines: [] };
			found.set(key, { count: seen.count + 1, lines: [...seen.lines, `${comment.file}:${comment.line} ${name}`] });
		}
	}
	const stale = [...found].filter(([key, { count }]) => count > (allowed[key] ?? 0)).flatMap(([, { lines }]) => lines);
	assert.deepEqual(
		stale,
		[],
		"These comments name code or files that do not exist, or hold history. Rewrite the comment to say what is true now, or delete it; a comment says why, and git keeps the history.",
	);
	const fewer = Object.entries(allowed).filter(([key, count]) => (found.get(key)?.count ?? 0) < count);
	assert.deepEqual(fewer, [], `These are fixed, or fewer now: lower or remove their line in ${LIST}.`);
});

describe("the comment reader", () => {
	const known: Known = { words: new Set(["unlinkSync", "list_space_chats", "fs"]), files: ["docs/checks.md", "src/frontend/lib/api.ts"], text: 'const NAME = "deadline-requests.json";' };

	it("finds a name or a file that is gone", () => {
		assert.deepEqual(untrue("// Soonest first (`compareDeadlines`), as `fs.unlinkSync` and `list_space_chats` do.", known), ["compareDeadlines"]);
		assert.deepEqual(untrue("/** See `docs/checks.md`, `lib/api.ts` and `docs/gone.md`. */", known), ["docs/gone.md"]);
		assert.deepEqual(untrue("// Kept as `data/deadline-requests.json`, `<id>.json` and `*.md`, read by `fs.json`.", known), []);
	});

	it("leaves commands, flags, extensions and plain words alone", () => {
		assert.deepEqual(untrue("// `npm run layout`, `--no-verify`, `Esc`, `MAX`, `.md`, `x > 0`, `self.reader.alive()`", known), []);
	});

	it("finds history", () => {
		assert.deepEqual(untrue("// Owner ruling: keep it for now. Phase 2, round 3, wave 1; a round of work stays.", known), ['"Owner ruling"', '"for now"', '"Phase 2"', '"round 3"', '"wave 1"']);
	});
});
