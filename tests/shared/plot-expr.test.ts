/**
 * Plot formulas typeset under their labels: division stays inline as on
 * screen 06, brackets as the teacher wrote them, Greek names as symbols.
 * The grammar itself is the shared cases (plot-expr-golden.test.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exprToLatex, parseExpr } from "../../src/shared/core/plot-expr.ts";

function latex(src: string, names: string[] = ["a", "lambda"]): string {
	const parsed = parseExpr(src, names);
	assert.ok("expr" in parsed, src);
	return exprToLatex(parsed.expr);
}

describe("exprToLatex", () => {
	it("keeps division inline and brackets as written", () => {
		assert.equal(latex("a/(1+lambda)"), "a/(1+\\lambda)");
		assert.equal(latex("min(a, 4/(1+lambda))"), "\\min(a, 4/(1+\\lambda))");
		assert.equal(latex("((a))"), "((a))");
	});

	it("writes products with a dot and powers as superscripts", () => {
		assert.equal(latex("2*a"), "2\\cdot a");
		assert.equal(latex("lambda*a^2"), "\\lambda\\cdot {a}^{2}");
		assert.equal(latex("a^(1/2)"), "{a}^{1/2}");
		assert.equal(latex("-a^2 + 2^-1"), "-{a}^{2}+{2}^{-1}");
		assert.equal(latex("(a+1)^2"), "{(a+1)}^{2}");
	});

	it("names functions the way math does", () => {
		assert.equal(latex("sin(a) + exp(lambda) - ln(a)"), "\\sin(a)+\\exp(\\lambda)-\\ln(a)");
		assert.equal(latex("log10(a)"), "\\log_{10}(a)");
		assert.equal(latex("sqrt(a+1)"), "\\sqrt{a+1}");
		assert.equal(latex("abs(a-lambda)"), "\\left|a-\\lambda\\right|");
		assert.equal(latex("max(a, lambda)"), "\\max(a, \\lambda)");
	});

	it("shows Greek names as symbols, words in italics and subscripts after an underscore", () => {
		assert.equal(latex("pi*e"), "\\pi\\cdot e");
		assert.equal(latex("rate + w_0 + sigma_x2 + k_a_b", ["rate", "w_0", "sigma_x2", "k_a_b"]), "\\mathit{rate}+w_{0}+\\sigma_{x2}+k_{a\\_b}");
	});

	it("keeps numbers as written", () => {
		assert.equal(latex("0.50 + .25"), "0.50+.25");
	});
});
