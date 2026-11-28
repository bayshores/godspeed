/**
 * A path a doc writes leads somewhere. In docs/, AGENTS.md and every README.md, a link to a file
 * and a path in backticks (a name with a file extension, or a folder path that starts at the top of
 * the repo) leads to a file, a folder, or a data file the code names, as `leadsTo` judges a path.
 * Placeholders and patterns (`<crate>`, `*`), web addresses, paths outside the repo (`~/`, `/api/`)
 * and build output git ignores are left alone.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { EXTENSION, leadsTo, readRepo } from "./repo-source.ts";

const root = path.resolve(import.meta.dirname, "../..");
const LIST = "tests/repo/exceptions/doc-paths.json";

/** The paths a line of a doc writes: link targets, and backtick spans that look like a path. */
function pathsIn(line: string, top: Set<string>): string[] {
	const links = [...line.matchAll(/\]\(([^)\s]+)\)/g)].map(([, target]) => target!.split("#")[0]!);
	const spans = [...line.matchAll(/`([^`]+)`/g)].map(([, span]) => span!.trim()).filter((span) => (EXTENSION.test(span) && !/^\.[^./]+$/.test(span)) || (span.includes("/") && top.has(span.split("/")[0]!)));
	return [...links, ...spans].filter(
		(written) =>
			written !== "" &&
			/^[\w@./-]+$/.test(written) &&
			!/^(?:[a-z]+:|\/|#)/.test(written) &&
			// A first part with a dot before more parts is a web address: `raw.githubusercontent.com/…`.
			!/^[\w-]+\.[\w.-]+\//.test(written),
	);
}

/** The paths git ignores: build output, which a fresh checkout does not have. */
function ignored(paths: string[]): Set<string> {
	// check-ignore answers 1 when it ignores none of them; only a higher code is a failure.
	const run = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], { cwd: root, encoding: "utf-8", input: paths.join("\n") });
	assert.ok(run.status === 0 || run.status === 1, `git check-ignore failed: ${run.stderr}`);
	return new Set(run.stdout.split("\n").filter(Boolean));
}

it("every path a doc writes leads to a file or folder", () => {
	const repo = readRepo();
	const top = new Set([...repo.files].map((file) => file.split("/")[0]!));
	const docs = [...repo.files].filter((file) => (file.startsWith("docs/") && file.endsWith(".md")) || file === "AGENTS.md" || path.posix.basename(file) === "README.md");
	assert.ok(docs.length > 50, "found too few docs; the reader is broken");
	const found: { doc: string; line: number; written: string }[] = [];
	for (const doc of docs) {
		let fenced = false;
		readFileSync(path.join(root, doc), "utf-8")
			.split("\n")
			.forEach((line, i) => {
				if (/^\s*```/.test(line)) fenced = !fenced;
				if (fenced) return;
				for (const written of pathsIn(line, top)) if (!leadsTo(written, doc, repo)) found.push({ doc, line: i + 1, written });
			});
	}
	const output = ignored(found.map(({ written }) => written));
	const allowed = JSON.parse(readFileSync(path.join(root, LIST), "utf-8")) as Record<string, string>;
	const keys = found.filter(({ written }) => !output.has(written)).map((hit) => ({ ...hit, key: `${hit.doc}: ${hit.written}` }));
	assert.deepEqual(
		keys.filter(({ key }) => !(key in allowed)).map(({ doc, line, written }) => `${doc}:${line} ${written}`),
		[],
		"These paths lead nowhere. Write the path the file has now, or remove it from the doc.",
	);
	const listed = new Set(keys.map(({ key }) => key));
	assert.deepEqual(
		Object.keys(allowed).filter((key) => !listed.has(key)),
		[],
		`These paths lead somewhere now or are gone from the doc: remove them from ${LIST}.`,
	);
});

describe("the doc path reader", () => {
	const repo = {
		files: new Set(["docs/checks.md", "docs/tauri-shell/README.md", "src/frontend/lib/api.ts", "crates/runtime/src/claude/claude-helper.mjs"]),
		folders: new Set(["docs", "docs/tauri-shell", "src", "src/frontend", "src/frontend/lib", "crates", "crates/runtime", "crates/runtime/src", "crates/runtime/src/claude"]),
		names: new Set(["checks.md", "README.md", "api.ts", "claude-helper.mjs"]),
		words: new Set(["details", "study"]),
		written: new Set(["agent-folder.json", "claude-helper.mjs", ".godspeed/setup-claude-helper.mjs"]),
	};
	const top = new Set(["docs", "src", "crates"]);

	it("reads links and backtick paths, and leaves the rest alone", () => {
		const line = "See [the shell](tauri-shell/README.md#start), `src/frontend`, `lib/api.ts`, `<crate>/src`, `*.md`, `~/godspeed/x.json`, `/api/chats`, `npm run check`, `.md`, `raw.githubusercontent.com/a/b.json` and [site](https://example.com/a.md).";
		assert.deepEqual(pathsIn(line, top), ["tauri-shell/README.md", "src/frontend", "lib/api.ts"]);
	});

	it("finds a path that leads nowhere, or to a file that moved", () => {
		const written = ["tauri-shell/README.md", "lib/api.ts", "src/frontend", "data/agent-folder.json", ".godspeed/setup-claude-helper.mjs", "details.svg", "docs/gone.md", "agent/claude-helper.mjs", "shared/12-class-context.md", "study.ts"];
		assert.deepEqual(
			written.filter((path) => !leadsTo(path, "docs/README.md", repo)),
			["docs/gone.md", "agent/claude-helper.mjs", "shared/12-class-context.md", "study.ts"],
		);
	});
});
