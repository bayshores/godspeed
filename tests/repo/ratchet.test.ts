/**
 * A list of known exceptions may only shrink. The lists are the files in tests/repo/exceptions
 * (a name with its reason, or a name with a count) and the numbers in COUNTED. A commit that adds
 * a name or raises a count fails here, unless its own message says why in a line:
 * "Ratchet: <list>, <reason>". Every commit since the branch left origin/main is compared with
 * the commit before it, so a change not yet committed is not judged.
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

/** Each name's highest count among a commit's parents: a merge may bring in what either side already had. */
function highest(parents: Counts[]): Counts {
	const top: Counts = {};
	for (const counts of parents) for (const [name, count] of Object.entries(counts)) top[name] = Math.max(top[name] ?? 0, count);
	return top;
}

/** The lists a commit's message allows to grow. */
function allowedBy(message: string): Set<string> {
	return new Set([...message.matchAll(/^Ratchet: ([\w-]+), \S.*$/gm)].map((match) => match[1]!));
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

it("no commit on this branch grew a list of exceptions without a stated reason", () => {
	const files = [LISTS, ...Object.values(COUNTED).map((counted) => counted.file)];
	const commits = git("rev-list", `${branchPoint()}..HEAD`, "--", ...files).split("\n").filter(Boolean);
	const raised = commits.flatMap((commit) => {
		const parents = git("rev-list", "--parents", "-n", "1", commit).trim().split(" ").slice(1).map(listsAt);
		const allowed = allowedBy(git("log", "-1", "--format=%B", commit));
		return [...listsAt(commit)].flatMap(([list, after]) => (allowed.has(list) ? [] : grown(highest(parents.map((lists) => lists.get(list) ?? {})), after).map((name) => `${commit.slice(0, 8)} ${list}: ${name}`)));
	});
	assert.deepEqual(raised, [], 'These commits grew a list of exceptions. Fix the code instead, or give the reason in that commit\'s message, one line for each list: "Ratchet: <list>, <reason>".');
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

	it("lets a merge keep the higher count of its two sides", () => {
		assert.deepEqual(highest([{ a: 1, b: 2 }, { b: 5, c: 1 }]), { a: 1, b: 5, c: 1 });
		assert.deepEqual(grown(highest([{ a: 1 }, { a: 3 }]), { a: 3 }), []);
	});

	it("takes a list's name from a commit message only with a reason", () => {
		const messages = "Fix the page.\n\nRatchet: fetch-allowed, a download is not JSON\nRatchet: file-size,\nratchet: copies, lower case is not the line\n";
		assert.deepEqual([...allowedBy(messages)], ["fetch-allowed"]);
	});
});
