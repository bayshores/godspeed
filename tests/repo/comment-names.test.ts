/**
 * A comment names only what exists, and holds no history. In the comments of every TypeScript,
 * JavaScript and Rust file of the repo:
 * - A name in backticks that looks like code (a case change inside it, or an underscore) is written
 *   in the repo's code, or in the type declarations of a package the repo installs, which covers
 *   the Node and library calls a comment cites. Commands, flags and plain words in backticks are
 *   left alone.
 * - A file in backticks (a name with a file extension) leads somewhere, as `leadsTo` judges a path.
 * - None of the history phrases of HISTORY: a ruling, a promise of later, a numbered phase.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { EXTENSION, leadsTo, readRepo, type Repo, wordsOf } from "./repo-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const LIST = "tests/repo/exceptions/comment-names.json";
const HISTORY = /\b(?:owner ruling|for now|(?:phase|round|wave) \d+)\b/gi;

type Known = Pick<Repo, "files" | "folders" | "names" | "words" | "written">;

/** A name in backticks the check reads: a file, or a name path whose parts are code names. */
function codeName(span: string): { file: string } | { names: string[] } | undefined {
	// A file has a name before its extension: `.md` alone is an extension, `.mcp.json` a file.
	if (/^[\w@./-]+$/.test(span) && EXTENSION.test(span) && !/^\.[^./]+$/.test(span)) return { file: span };
	const path = /^([A-Za-z_$][\w$]*(?:(?:::|\.)[A-Za-z_$][\w$]*)*)(?:\(\))?!?$/.exec(span)?.[1];
	if (!path) return undefined;
	const names = path.split(/::|\./).filter((part) => /[a-z][A-Z]/.test(part) || /[A-Za-z\d]_[A-Za-z\d]/.test(part));
	return names.length > 0 ? { names } : undefined;
}

/** What a comment of `file` says that is not so: each name or file it cites that the code lacks, and each piece of history. */
function untrue(comment: string, file: string, known: Known): string[] {
	const found: string[] = [];
	for (const [, span] of comment.matchAll(/`([^`\n]+)`/g)) {
		const name = codeName(span!.trim());
		if (!name) continue;
		if ("file" in name) {
			if (!leadsTo(name.file, file, known)) found.push(name.file);
		} else found.push(...name.names.filter((part) => !known.words.has(part)));
	}
	for (const [phrase] of comment.matchAll(HISTORY)) found.push(`"${phrase}"`);
	return found;
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
	const repo = readRepo();
	const known = { ...repo, words: new Set([...repo.words, ...outsideNames()]) };
	assert.ok(repo.comments.length > 10_000 && known.words.has("unlinkSync"), "found too few comments or no package types; the reader is broken");
	const allowed = JSON.parse(readFileSync(path.join(root, LIST), "utf-8")) as Record<string, number>;
	const found = new Map<string, { count: number; lines: string[] }>();
	for (const comment of repo.comments) {
		for (const name of untrue(comment.text, comment.file, known)) {
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
	const known: Known = {
		words: new Set(["unlinkSync", "list_space_chats", "fs", "study"]),
		files: new Set(["docs/checks.md", "src/frontend/lib/api.ts"]),
		folders: new Set(["docs", "src", "src/frontend", "src/frontend/lib"]),
		names: new Set(["checks.md", "api.ts"]),
		written: new Set(["deadline-requests.json"]),
	};

	it("finds a name or a file that is gone", () => {
		assert.deepEqual(untrue("// Soonest first (`compareDeadlines`), as `fs.unlinkSync` and `list_space_chats` do.", "a.rs", known), ["compareDeadlines"]);
		assert.deepEqual(untrue("/** See `docs/checks.md`, `lib/api.ts`, `docs/gone.md` and `study.ts`. */", "a.ts", known), ["docs/gone.md", "study.ts"]);
		assert.deepEqual(untrue("// Kept as `data/deadline-requests.json`, `<id>.json` and `*.md`, read by `fs.json`.", "a.rs", known), []);
	});

	it("leaves commands, flags, extensions and plain words alone", () => {
		assert.deepEqual(untrue("// `npm run layout`, `--no-verify`, `Esc`, `MAX`, `.md`, `x > 0`, `self.reader.alive()`", "a.rs", known), []);
	});

	it("finds history", () => {
		assert.deepEqual(untrue("// Owner ruling: keep it for now. Phase 2, round 3, wave 1; a round of work stays.", "a.rs", known), ['"Owner ruling"', '"for now"', '"Phase 2"', '"round 3"', '"wave 1"']);
	});
});
