/**
 * Run examples, the pure half: the program built around the learner's
 * code, and how what it printed is read and checked.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readRun, runnerSource } from "../../src/shared/core/mock-run.ts";

const MARK = "__mark__";
const EXAMPLES = [
	{ args: "[[1,2],3]", expected: "[0,1]" },
	{ args: '[["a"],0]', expected: '{"b":1.5,"a":[1,2]}' },
];
const FN = { name: "solve", params: ["items", "n"] };

describe("the program that runs the examples", () => {
	it("keeps the learner's code first, so its line numbers stay theirs", () => {
		for (const language of ["javascript", "python"] as const) {
			const source = runnerSource("LINE ONE\nLINE TWO", FN, EXAMPLES, language, MARK);
			assert.ok(source.startsWith("LINE ONE\nLINE TWO\n"), language);
			assert.ok(source.includes(MARK), language);
		}
	});

	it("takes the function only from the learner's own names, never a built-in", () => {
		assert.ok(runnerSource("", FN, EXAMPLES, "python", MARK).includes('fn = globals().get("solve")'));
		assert.ok(runnerSource("", FN, EXAMPLES, "javascript", MARK).includes("solve !== globalThis.solve ? solve : null"));
	});
});

describe("reading what the program printed", () => {
	const printed = (results: unknown, before = "") => `${before}\n${MARK}${JSON.stringify(results)}\n`;

	it("checks each example, object keys in any order and Python's spacing", () => {
		const run = readRun(printed([{ returned: "[0, 1]" }, { returned: '{"a": [1, 2], "b": 1.5000000000001}' }]), "", MARK, EXAMPLES);
		assert.deepEqual(run, { examples: [{ returned: "[0,1]", passed: true }, { returned: '{"a":[1,2],"b":1.5000000000001}', passed: true }] });
	});

	it("says what a wrong one returned, and keeps a thrown error", () => {
		const run = readRun(printed([{ returned: "[1,0]" }, { error: "TypeError: x is not a function" }]), "", MARK, EXAMPLES);
		assert.deepEqual(run.examples, [{ returned: "[1,0]", passed: false }, { error: "TypeError: x is not a function", passed: false }]);
	});

	it("keeps what the code printed itself apart from the results", () => {
		const run = readRun(printed([{ returned: "[0,1]" }, { returned: "0" }], "hello\nworld"), "", MARK, EXAMPLES);
		assert.equal(run.printed, "hello\nworld");
		assert.equal(run.examples.length, 2);
	});

	it("with no results, gives the error text without Node's own frames", () => {
		const stderr = ["solution.js:2", "  return [", "SyntaxError: Unexpected token", "    at wrapSafe (node:internal/modules/cjs/loader:1888:18)", "", "Node.js v24.0.0"].join("\n");
		assert.deepEqual(readRun("partial", stderr, MARK, EXAMPLES), { examples: [], error: "solution.js:2\n  return [\nSyntaxError: Unexpected token", printed: "partial" });
		assert.equal(readRun("", "", MARK, EXAMPLES).error, "Your code stopped before the examples ran.");
	});

	it("is not fooled by code that prints the results' shape without the mark", () => {
		const run = readRun('[{"returned":"[0,1]"}]\n', "", MARK, EXAMPLES);
		assert.equal(run.examples.length, 0);
	});
});
