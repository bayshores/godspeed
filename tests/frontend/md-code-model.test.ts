import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { numbersOwnLines } from "../../src/frontend/components/md-code-model.ts";

describe("numbersOwnLines", () => {
	it("is true for pseudocode that numbers its lines, a heading line aside", () => {
		const code = "Bin2DecRec(b1, ..., bn):\n1. if n == 0:\n2.   return 0\n3. if bn == 0:\n4.   return 2 * Bin2DecRec(b1, ..., b(n-1))";
		assert.equal(numbersOwnLines(code), true);
	});

	it("is false for ordinary code, a single numbered line, or numbers out of order", () => {
		assert.equal(numbersOwnLines("def f(n):\n    return n + 1"), false);
		assert.equal(numbersOwnLines("x = 1\n1. note\ny = 2\nz = 3"), false);
		assert.equal(numbersOwnLines("3. c\n1. a\n2. b"), false);
	});

	it("reads only lines that start with a number and a mark", () => {
		assert.equal(numbersOwnLines("1 + 2\n3 + 4"), false);
		assert.equal(numbersOwnLines("1) first\n2) second"), true);
	});
});
