/**
 * Reads the whole repo for the checks in this folder: its tracked files, the words of its code with
 * comments left out, the file names and paths its code writes (data files are named in strings),
 * and its comments.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { readRust, rustTokens } from "./rust-source.ts";
import { tsComments, tsTokens } from "./ts-source.ts";

const root = path.resolve(import.meta.dirname, "../..");

/** A file name: a name with one of these extensions. */
export const EXTENSION = /\.(?:ts|tsx|js|mjs|cjs|rs|json|jsonl|md|css|html|toml|ya?ml|sh|pen|png|svg|pdf|tex|txt|py|lock|plist|srt|vtt|woff2|gif|mp4|mov)$/;
const SOURCE = /\.(?:ts|tsx|js|mjs|cjs|rs|css|html|toml|sh|py)$/;
const SCRIPT = /\.(?:ts|tsx|js|mjs|cjs)$/;
const NOT_CODE = /\.(?:md|pdf|png|svg|woff2|tiff|jpg|pen|jsonl|srt|txt)$/;

type Comment = { file: string; line: number; text: string };

export type Repo = {
	files: Set<string>;
	folders: Set<string>;
	/** Every tracked file's own name. */
	names: Set<string>;
	words: Set<string>;
	/** Every file name or path the code writes, as `agent-folder.json` or `.godspeed/setup-spaces.md`. */
	written: Set<string>;
	comments: Comment[];
};

export const wordsOf = (text: string) => text.match(/[A-Za-z_$][\w$]*/g) ?? [];

/** Text with its `/* */` comments taken out, but not a `/*` inside a string such as `"dist/*.js"`. */
export function withoutBlockComments(text: string): string {
	return text.replace(/("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|\/\*[\s\S]*?\*\//g, (_whole, string?: string) => string ?? "");
}

/** A file's code as the text of its tokens, comments left out, and its comments. Other text files are read whole. */
function readCode(file: string, text: string): { code: string[]; comments: Comment[] } {
	if (SCRIPT.test(file)) {
		const kind = file.endsWith("x") ? ts.ScriptKind.TSX : /\.[mc]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
		const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
		return { code: tsTokens(source, source).map((token) => token.getText(source)), comments: tsComments(source).map((comment) => ({ file, ...comment })) };
	}
	if (file.endsWith(".rs")) return { code: rustTokens(text).map((token) => token.text), comments: readRust(text).comments.map((comment) => ({ file, ...comment })) };
	return { code: [withoutBlockComments(text)], comments: [] };
}

export function readRepo(): Repo {
	const files = new Set(execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf-8" }).split("\n").filter(Boolean));
	const folders = new Set([...files].flatMap((file) => file.split("/").slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join("/"))));
	const words = new Set<string>();
	const written = new Set<string>();
	const comments: Comment[] = [];
	for (const file of files) {
		if (NOT_CODE.test(file)) continue;
		const read = readCode(file, readFileSync(path.join(root, file), "utf-8"));
		comments.push(...read.comments);
		// The checks of this folder write made-up names in the strings of their own cases.
		const code = file.startsWith("tests/repo/") ? read.code.filter((piece) => /^[A-Za-z_$][\w$]*$/.test(piece)) : read.code;
		for (const piece of code) {
			for (const word of wordsOf(piece)) words.add(word);
			for (const name of piece.match(/[\w@./-]+/g) ?? []) if (EXTENSION.test(name)) written.add(name.replace(/^\/+/, ""));
		}
	}
	return { files, folders, names: new Set([...files].map((file) => path.posix.basename(file))), words, written, comments };
}

/**
 * Whether a file path written in a doc or a comment of `from` leads somewhere: a file or folder of
 * the repo, from the top, from `from`'s folder or as the end of one (`lib/api.ts`); or a path the
 * code writes whole (`.godspeed/setup-spaces.md`); or a file the code names that the repo does not
 * hold, a data file. A repo file of that name in another folder means the path is stale.
 */
export function leadsTo(target: string, from: string, repo: Pick<Repo, "files" | "folders" | "names" | "words" | "written">): boolean {
	const plain = target.replace(/\/$/, "");
	const bare = plain.replace(/^(?:\.\.?\/)+/, "");
	const local = path.posix.normalize(path.posix.join(path.posix.dirname(from), plain));
	const endsIn = (held: string, end: string) => held === end || held.endsWith(`/${end}`);
	if ([bare, local].some((candidate) => repo.files.has(candidate) || repo.folders.has(candidate))) return true;
	if ([...repo.files, ...repo.folders, ...repo.written].some((held) => endsIn(held, bare))) return true;
	const name = path.posix.basename(bare);
	if (!repo.names.has(name) && [...repo.written].some((held) => endsIn(held, name))) return true;
	// A data file's name alone whose stem the code uses is a placeholder (`name.md`) or a field (`details.svg`).
	return bare === name && !SOURCE.test(name) && repo.words.has(name.replace(/\.\w+$/, ""));
}
