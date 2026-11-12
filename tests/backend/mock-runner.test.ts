/**
 * Run examples on this computer: a right answer passes, a wrong one says
 * what it returned, broken code says why, a loop is stopped, and only the
 * learner's own function is ever called.
 */
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isStandInPython, runExamples } from "../../src/backend/server/mock-runner.ts";
import type { CodeQuestion } from "../../src/shared/core/mock.ts";

const QUESTION: CodeQuestion = {
	id: "q1",
	kind: "code",
	title: "Add",
	statement: "Add two numbers.",
	fn: { name: "add", params: ["a", "b"] },
	examples: [
		{ args: "[1,2]", expected: "3" },
		{ args: "[-1,1]", expected: "0" },
	],
};

describe("running a code answer's examples", () => {
	it("passes a right JavaScript answer and keeps what it printed", async () => {
		const run = await runExamples(QUESTION, "function add(a, b) { console.log('adding'); return a + b; }", "javascript");
		assert.deepEqual(run.examples, [{ returned: "3", passed: true }, { returned: "0", passed: true }]);
		assert.equal(run.printed, "adding\nadding");
	});

	it("says what a wrong answer returned, and what one threw", async () => {
		const wrong = await runExamples(QUESTION, "const add = (a, b) => a - b;", "javascript");
		assert.deepEqual(wrong.examples, [{ returned: "-1", passed: false }, { returned: "-2", passed: false }]);
		const threw = await runExamples(QUESTION, "function add() { throw new RangeError('no'); }", "javascript");
		assert.deepEqual(threw.examples[0], { error: "RangeError: no", passed: false });
	});

	it("says why code that doesn't parse never ran, without the temp folder's path", async () => {
		const run = await runExamples(QUESTION, "function add(a, b) { return a +", "javascript");
		assert.equal(run.examples.length, 0);
		assert.match(run.error ?? "", /SyntaxError/);
		assert.match(run.error ?? "", /^solution\.js:/);
	});

	it("stops code that never ends", async () => {
		const run = await runExamples(QUESTION, "function add() { while (true) {} }", "javascript");
		assert.match(run.error ?? "", /more than 5 seconds/);
	});

	it("never calls a built-in of the function's name, so the examples can't run as code", async () => {
		const evil: CodeQuestion = { ...QUESTION, fn: { name: "eval", params: ["code"] }, examples: [{ args: '["console.log(\'RAN\')"]', expected: "null" }, { args: '["1"]', expected: "1" }] };
		const run = await runExamples(evil, "// nothing written yet", "javascript");
		assert.deepEqual(run.examples, [
			{ error: "Your code has no function named eval.", passed: false },
			{ error: "Your code has no function named eval.", passed: false },
		]);
		assert.equal(run.printed, undefined);
		const own = await runExamples({ ...QUESTION, fn: { name: "fetch", params: ["a", "b"] } }, "function fetch(a, b) { return a + b; }", "javascript");
		assert.deepEqual(own.examples, [{ returned: "3", passed: true }, { returned: "0", passed: true }], "the learner's own function of that name runs");
	});

	it("keeps godspeed's own settings, like the desktop key, from the learner's program", async () => {
		process.env.LH_DESKTOP_API_SECRET = "s".repeat(64);
		try {
			const run = await runExamples(QUESTION, "function add() { return process.env.LH_DESKTOP_API_SECRET ?? null; }", "javascript");
			assert.deepEqual(run.examples[0], { returned: "null", passed: false });
		} finally {
			delete process.env.LH_DESKTOP_API_SECRET;
		}
	});

	it("gives the program nothing to read, Python's prints in UTF-8 and no compile cache", async () => {
		process.env.NODE_COMPILE_CACHE = path.join(os.tmpdir(), "godspeed-test-compile-cache");
		try {
			const read = await runExamples(QUESTION, "function add() { return require('node:fs').readFileSync(0, 'utf8'); }", "javascript");
			assert.deepEqual(read.examples[0], { returned: '""', passed: false }, "stdin is closed, so reading it ends at once");
			const env = await runExamples(QUESTION, "function add() { return [process.env.PYTHONIOENCODING, process.env.NODE_COMPILE_CACHE ?? null]; }", "javascript");
			assert.deepEqual(env.examples[0], { returned: '["utf-8",null]', passed: false });
		} finally {
			delete process.env.NODE_COMPILE_CACHE;
		}
	});

	it("passes over a Python that only opens an installer", () => {
		const yes = () => true;
		const no = () => false;
		assert.equal(isStandInPython("/usr/bin/python3", "darwin", no), true, "a Mac without developer tools");
		assert.equal(isStandInPython("/usr/bin/python3", "darwin", yes), false);
		assert.equal(isStandInPython("/opt/homebrew/bin/python3", "darwin", no), false);
		assert.equal(isStandInPython("C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\python.exe", "win32", yes), true);
		assert.equal(isStandInPython("C:\\Python312\\python.exe", "win32", yes), false);
		assert.equal(isStandInPython("/usr/bin/python3", "linux", no), false);
	});

	it("runs Python when this computer has it, and never its built-ins", async (t) => {
		const run = await runExamples(QUESTION, "def add(a, b):\n    return a + b\n", "python");
		if (run.error?.includes("couldn't find Python")) return t.skip("no Python here");
		assert.deepEqual(run.examples, [{ returned: "3", passed: true }, { returned: "0", passed: true }]);
		const evil: CodeQuestion = { ...QUESTION, fn: { name: "exec", params: ["code"] }, examples: [{ args: '["print(\'RAN\')"]', expected: "null" }, { args: '["1"]', expected: "null" }] };
		const refused = await runExamples(evil, "x = 1\n", "python");
		assert.equal(refused.examples[0]?.error, "Your code has no function named exec.");
		assert.equal(refused.printed, undefined);
		const asks = await runExamples(QUESTION, "def add(a, b):\n    print('→')\n    return int(input())\n", "python");
		assert.equal(asks.printed, "→\n→");
		assert.match(asks.examples[0]?.error ?? "", /^EOFError/, "input() ends at once");
	});
});
