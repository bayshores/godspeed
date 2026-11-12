import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ComputeEngine } from "@cortex-js/compute-engine";
import { findCalculation } from "../../src/shared/core/calculator.ts";
import { calculate } from "../../src/frontend/lib/calculate.ts";

const ce = new ComputeEngine();

/** The answer's LaTeX for a line typed in a writing box. */
function answer(text: string): string | null {
	const calc = findCalculation(text, text.length);
	assert.ok(calc, `no calculation in ${text}`);
	return calculate(ce, calc)?.latex ?? null;
}

describe("working out a calculation", () => {
	it("numbers, plain when whole", () => {
		assert.deepEqual(calculate(ce, findCalculation("2+3 =", 5)!), { latex: "5", plain: "5" });
		assert.equal(answer("5! ="), "120");
		assert.equal(answer("2^10 ="), "1024");
		assert.equal(answer("abs(-4) ="), "4");
		assert.equal(answer("0.1+0.2 ="), "0.3");
	});

	it("exact forms with their decimal", () => {
		assert.equal(answer("1/3 + 1/6 ="), "\\frac{1}{2}\\approx 0.5");
		assert.equal(answer("sqrt(2) ="), "\\sqrt{2}\\approx 1.414213562");
		assert.equal(answer("sin(30°) ="), "\\frac{1}{2}\\approx 0.5");
		assert.equal(answer("2^100 ="), "\\approx 1.2676506\\times10^{30}");
		assert.equal(answer("sqrt(-1) ="), "i");
	});

	it("letters set above", () => {
		assert.equal(answer("x = 3\nx^2 + 2x ="), "15");
	});

	it("algebra, derivatives and integrals", () => {
		assert.equal(answer("(x+1)^2 ="), "x^2+2x+1");
		assert.equal(answer("d/dx x^3 ="), "3x^2");
		assert.equal(answer("int x^2 dx ="), "\\frac{x^3}{3}+C");
		assert.equal(answer("int_0^1 x^2 dx ="), "\\frac{1}{3}\\approx 0.3333333333");
	});

	it("solving", () => {
		assert.equal(answer("solve 2x + 3 = 11"), "x=4");
		assert.equal(answer("solve x^2 = 4"), "x=2\\text{ or }x=-2");
	});

	it("nothing when there's nothing to work out or it can't be", () => {
		assert.equal(answer("12 ="), null);
		assert.equal(answer("1+2x ="), null);
		assert.equal(answer("1/0 ="), null);
	});
});
