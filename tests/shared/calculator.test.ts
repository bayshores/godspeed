import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { answerEdit, findCalculation, pieceCalculation, plainToLatex } from "../../src/shared/core/calculator.ts";

const at = (text: string) => findCalculation(text, text.length);

describe("plain typing to LaTeX", () => {
	it("powers, roots, functions and integrals", () => {
		assert.equal(plainToLatex("2^10"), "2^{10}");
		assert.equal(plainToLatex("sqrt(2)"), "\\sqrt{2}");
		assert.equal(plainToLatex("sin(x)"), "\\sin (x)");
		assert.equal(plainToLatex("abs(-4)"), "\\left|-4\\right|");
		assert.equal(plainToLatex("d/dx x^3"), "\\frac{d}{dx} x^{3}");
		assert.equal(plainToLatex("int x^2 dx"), "\\int  x^{2} \\,dx");
		assert.equal(plainToLatex("int_0^1 x dx"), "\\int_{0}^{1}  x \\,dx");
		assert.equal(plainToLatex("30°"), "30^{\\circ}");
	});

	it("ordinary words aren't math", () => {
		assert.equal(plainToLatex("hello"), null);
	});
});

describe("finding a calculation", () => {
	it("the expression before a closing =", () => {
		assert.deepEqual(at("2+3 ="), { kind: "value", latex: "2+3", variable: null, defs: [], at: 5, inPiece: false });
		assert.equal(at("so 3 * 4 =")?.latex, "3 \\cdot  4");
		assert.equal(at("5! =")?.latex, "5!");
		assert.equal(at("price is $5 and 2+2 =")?.latex, "2+2");
	});

	it("only when the caret ends the line", () => {
		assert.equal(findCalculation("2+3 = ", 3), null);
		assert.equal(findCalculation("2+3 =\nmore", 5)?.latex, "2+3");
	});

	it("nothing for unclosed brackets, comparisons or no =", () => {
		assert.equal(at("(1+2 ="), null);
		assert.equal(at("2+3"), null);
		assert.equal(at("the answer to 7*6 is ="), null);
	});

	it("values set on lines above", () => {
		assert.deepEqual(at("x = 3\nr = 1/2\nx^2 + r =")?.defs, [
			{ name: "x", latex: "3" },
			{ name: "r", latex: "1/2" },
		]);
		assert.deepEqual(at("e = 5\ne^2 =")?.defs, []);
	});

	it("solve and an equation", () => {
		assert.deepEqual(at("solve 2x + 3 = 11"), { kind: "solve", latex: "2x + 3 = 11", variable: null, defs: [], at: 17, inPiece: false });
		assert.equal(at("solve x + y = 3 for y")?.variable, "y");
	});
});

describe("a math piece being edited", () => {
	it("the last part before a closing =", () => {
		assert.deepEqual(pieceCalculation("x = 2\narea $…$", 12, "a=x\\cdot 4="), {
			kind: "value",
			latex: "x\\cdot 4",
			variable: null,
			defs: [{ name: "x", latex: "2" }],
			at: 12,
			inPiece: true,
		});
		assert.equal(pieceCalculation("", 0, "x\\cdot 4"), null);
		assert.equal(pieceCalculation("", 0, "="), null);
	});
});

describe("keeping an answer", () => {
	it("a plain number as text, after a space", () => {
		assert.deepEqual(answerEdit("2+3 =", at("2+3 =")!, { latex: "5", plain: "5" }), { from: 5, insert: " 5" });
		assert.deepEqual(answerEdit("2+3 = ", findCalculation("2+3 = ", 6)!, { latex: "5", plain: "5" }), { from: 6, insert: "5" });
	});

	it("anything else as a math piece, a solution after an arrow", () => {
		assert.deepEqual(answerEdit("sqrt(2) =", at("sqrt(2) =")!, { latex: "\\sqrt{2}\\approx 1.414213562", plain: null }), {
			from: 9,
			insert: " $\\sqrt{2}\\approx 1.414213562$",
		});
		assert.deepEqual(answerEdit("solve 2x = 8", at("solve 2x = 8")!, { latex: "x=4", plain: null }), { from: 12, insert: " → $x=4$" });
	});

	it("inside the piece when it's being edited", () => {
		const calc = pieceCalculation("", 0, "6\\cdot 4=")!;
		assert.deepEqual(answerEdit("", calc, { latex: "24", plain: "24" }), { from: 0, insert: "24" });
	});
});
