/**
 * A list of known exceptions may only shrink. The lists are the files in tests/repo/exceptions
 * (a name with its reason, or a name with a count) and the numbers in COUNTED. A branch that adds
 * a name or raises a count fails here, unless one of its commits says why in a line of its
 * message: "Ratchet: <list>, <reason>". The last commit is compared with the commit where the
 * branch left origin/main, so a change not yet committed is not judged.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const LISTS = "tests/repo/exceptions";

type Counts = Record<string, number>;

/** A list file as counts: a name with a reason counts as one. */
function listCounts(list: string, text: string): Counts {
	return Object.fromEntries(
		Object.entries(JSON.parse(text) as Record<string, unknown>).map(([name, value]) => {
			if (typeof value === "number" && Number.isInteger(value) && value > 0) return [name, value];
			assert.ok(typeof value === "string" && value.trim() !== "", `${list}: "${name}" needs a reason or a count`);
			return [name, 1];
		}),
	);
}

/** Lists that are a check's own cases, counted from its source. */
const COUNTED: Record<string, { file: string; counts: (text: string) => Counts }> = {
	"rust-twins": { file: "tests/repo/rust-twins.test.ts", counts: (text) => ({ cases: text.match(/^\s*it\(/gm)?.length ?? 0 }) },
};

/** The names that are new, or higher than they were. */
function grown(before: Counts, after: Counts): string[] {
	return Object.keys(after).filter((name) => after[name]! > (before[name] ?? 0));
}

/** The lists a branch's commit messages allow to grow. */
function allowedBy(messages: string): Set<string> {
	return new Set([...messages.matchAll(/^Ratchet: ([\w-]+), \S.*$/gm)].map((match) => match[1]!));
}

function git(...args: string[]): string {
	return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

/** Every list as it is at a commit. A list the commit does not have is empty. */
function listsAt(commit: string): Map<string, Counts> {
	const lists = new Map<string, Counts>();
	const files = git("ls-tree", "-r", "--name-only", commit, "--", LISTS).split("\n");
	for (const file of files.filter((name) => name.endsWith(".json"))) {
		const list = path.basename(file, ".json");
		lists.set(list, listCounts(list, git("show", `${commit}:${file}`)));
	}
	for (const [list, { file, counts }] of Object.entries(COUNTED)) {
		const there = git("ls-tree", "--name-only", commit, "--", file).trim() !== "";
		lists.set(list, there ? counts(git("show", `${commit}:${file}`)) : {});
	}
	return lists;
}

/** Where the branch left origin/main. */
function branchPoint(): string {
	try {
		return git("merge-base", "HEAD", "origin/main").trim();
	} catch (error) {
		return assert.fail(`This check compares the branch with origin/main and could not find where they part. Run "git fetch origin main"; a CI job needs "fetch-depth: 0". ${String(error)}`);
	}
}

it("no list of exceptions grew on this branch without a stated reason", () => {
	const from = branchPoint();
	const before = listsAt(from);
	const allowed = allowedBy(git("log", "--format=%B", `${from}..HEAD`));
	const raised = [...listsAt("HEAD")].flatMap(([list, after]) => (allowed.has(list) ? [] : grown(before.get(list) ?? {}, after).map((name) => `${list}: ${name}`)));
	assert.deepEqual(raised, [], 'These lists of exceptions grew. Fix the code instead, or give the reason in the commit message, one line for each list: "Ratchet: <list>, <reason>".');
});

describe("the ratchet reads its lists", () => {
	it("counts a reason as one and keeps a count", () => {
		assert.deepEqual(listCounts("made-up", '{ "a.ts": "streams bytes", "b.ts": 4 }'), { "a.ts": 1, "b.ts": 4 });
	});

	it("refuses a name with no reason", () => {
		assert.throws(() => listCounts("made-up", '{ "a.ts": "" }'), /needs a reason or a count/);
		assert.throws(() => listCounts("made-up", '{ "a.ts": 0 }'), /needs a reason or a count/);
	});

	it("finds a new name and a raised count, and nothing in a list that shrank", () => {
		assert.deepEqual(grown({ a: 1, b: 4 }, { a: 1, b: 5, c: 1 }), ["b", "c"]);
		assert.deepEqual(grown({ a: 1, b: 4 }, { b: 3 }), []);
	});

	it("counts the cases of a check that is its own list", () => {
		assert.deepEqual(COUNTED["rust-twins"]!.counts('describe("x", () => {\n\tit("a", () => {});\n\tit("b", () => {});\n});'), { cases: 2 });
	});

	it("takes a list's name from a commit message only with a reason", () => {
		const messages = "Fix the page.\n\nRatchet: fetch-allowed, a download is not JSON\nRatchet: file-size,\nratchet: copies, lower case is not the line\n";
		assert.deepEqual([...allowedBy(messages)], ["fetch-allowed"]);
	});
});
