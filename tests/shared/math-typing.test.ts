import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBeforeBreak, formatPiece, hasSlots, isMathBreak, mathSpans, suggestMath, symbolSwap } from "../../src/shared/core/math-typing.ts";

describe("math spans", () => {
	it("finds $...$ pieces and their LaTeX", () => {
		assert.deepEqual(mathSpans("so $\\frac{1}{2}$ is half"), [{ from: 3, to: 16, latex: "\\frac{1}{2}" }]);
		assert.equal(mathSpans("$x$ and $y$").length, 2);
	});

	it("prices, spaced dollars, escaped dollars and line breaks stay text", () => {
		assert.deepEqual(mathSpans("it costs $5 or $6"), []);
		assert.deepEqual(mathSpans("a $ b $ c"), []);
		assert.deepEqual(mathSpans("\\$x$"), []);
		assert.deepEqual(mathSpans("$x\ny$"), []);
	});
});

describe("formatting a finished piece", () => {
	it("fractions between numbers, letters and groups", () => {
		assert.equal(formatPiece("1/2"), "$\\frac{1}{2}$");
		assert.equal(formatPiece("x/y"), "$\\frac{x}{y}$");
		assert.equal(formatPiece("(a+b)/2"), "$\\frac{a+b}{2}$");
		assert.equal(formatPiece("0.5/2"), "$\\frac{0.5}{2}$");
	});

	it("words with a slash stay text", () => {
		assert.equal(formatPiece("and/or"), null);
		assert.equal(formatPiece("km/h"), null);
	});

	it("powers and subscripts", () => {
		assert.equal(formatPiece("x^2"), "$x^{2}$");
		assert.equal(formatPiece("x_1"), "$x_{1}$");
		assert.equal(formatPiece("x_1^2"), "$x_{1}^{2}$");
		assert.equal(formatPiece("(a+b)^2"), "$(a+b)^{2}$");
		assert.equal(formatPiece("2^(n+1)"), "$2^{n+1}$");
		assert.equal(formatPiece("snake_case"), null);
		assert.equal(formatPiece("x"), null);
	});

	it("formats only the piece before a break, never inside math", () => {
		assert.deepEqual(formatBeforeBreak("so 1/2", 6), { from: 3, to: 6, insert: "$\\frac{1}{2}$" });
		assert.equal(formatBeforeBreak("so 1/2 ", 7), null);
		assert.equal(formatBeforeBreak("$1/2$", 5), null);
		assert.ok(isMathBreak(" ") && isMathBreak(",") && !isMathBreak("/") && !isMathBreak("!"));
	});
});

describe("symbol swaps", () => {
	it(">= <= != become one symbol", () => {
		assert.deepEqual(symbolSwap("x >", 3, "="), { from: 2, to: 3, insert: "≥" });
		assert.deepEqual(symbolSwap("x <", 3, "="), { from: 2, to: 3, insert: "≤" });
		assert.deepEqual(symbolSwap("x !", 3, "="), { from: 2, to: 3, insert: "≠" });
		assert.equal(symbolSwap("x =", 3, "="), null);
		assert.equal(symbolSwap("x >", 3, "x"), null);
	});
});

describe("word suggestions", () => {
	const words = (typed: string) => suggestMath(typed).map((m) => m.word);

	it("whole words and aliases suggest", () => {
		assert.deepEqual(words("sqrt"), ["sqrt", "root"]);
		assert.deepEqual(words("pi"), ["pi"]);
		assert.deepEqual(words("inf"), ["infinity"]);
		assert.deepEqual(words("SUM"), ["sum"]);
	});

	it("four letters suggest, everyday short starts don't", () => {
		assert.deepEqual(words("thet"), ["theta"]);
		assert.deepEqual(words("the"), []);
		assert.deepEqual(words("p"), []);
	});

	it("slot templates are marked", () => {
		assert.ok(hasSlots(suggestMath("sqrt")[0]!.latex));
		assert.ok(!hasSlots(suggestMath("pi")[0]!.latex));
	});
});
