/**
 * Works out a writing box's calculation with the Compute Engine: a value
 * (exact when it can be, with its decimal), a simplified or expanded
 * expression, a derivative or integral, or an equation's solutions.
 * Null whenever the answer isn't certain or adds nothing. Runs in the
 * calculator's worker (calculate.worker.ts).
 */
import type { ComputeEngine, Expression as Expr } from "@cortex-js/compute-engine";
import type { CalcAnswer, Calculation } from "@/shared/core";

/** LaTeX that KaTeX draws and the teacher reads: plain e and i, no digit grouping. */
const LATEX = { digitGroupSeparator: "", imaginaryUnit: "i", exponentialE: "e", prettify: true };

/** Significant digits in a decimal, like a calculator's screen. */
const DIGITS = 10;

/** Longer whole numbers show in scientific notation. */
const MAX_INTEGER_DIGITS = 30;

/** Operators left over when the engine couldn't work something out. */
const UNFINISHED = /"(D|Integrate|Limit|Sum|Product|Error|Derivative)"/;

export function calculate(ce: ComputeEngine, calc: Calculation): CalcAnswer | null {
	const values: Record<string, Expr> = {};
	for (const def of calc.defs) {
		const value = substitute(ce.parse(def.latex), values).evaluate();
		if (value.isValid && value.unknowns.length === 0) values[def.name] = value;
		else delete values[def.name];
	}
	const input = ce.parse(calc.latex);
	if (!input.isValid) return null;
	const expr = substitute(input, values);
	return calc.kind === "solve" ? solve(expr, calc.variable) : value(ce, expr, calc.latex);
}

function substitute(expr: Expr, values: Record<string, Expr>): Expr {
	return Object.keys(values).length ? expr.subs(values) : expr;
}

function value(ce: ComputeEngine, expr: Expr, typed: string): CalcAnswer | null {
	const result = expr.evaluate();
	if (!result.isValid || UNFINISHED.test(JSON.stringify(result.json))) return null;
	if (result.unknowns.length === 0) {
		const answer = numberAnswer(result);
		// "12 =": nothing to work out.
		return answer && !sameUpToOrder(answer.latex, typed) ? answer : null;
	}
	const expanded = ce.box(["Expand", result]).evaluate();
	const latex = tidy((expanded.isValid ? expanded : result).toLatex(LATEX));
	// Only reordered ("1+2x" → "2x+1"): nothing worked out.
	if (sameUpToOrder(latex, typed)) return null;
	const indefinite = /\\int(?!_)/.test(typed);
	return { latex: indefinite ? `${latex}+C` : latex, plain: null };
}

function numberAnswer(result: Expr): CalcAnswer | null {
	if (result.isFinite === false) return null;
	const n = result.N();
	const re = n.re;
	const im = n.im;
	if (!Number.isFinite(re) || !Number.isFinite(im)) return null;
	if (im !== 0) return { latex: tidy((isDecimal(result) ? n : result).toLatex(LATEX)), plain: null };
	if (result.isInteger) {
		const digits = tidy(result.toLatex(LATEX));
		if (/^-?\d+$/.test(digits) && digits.replace("-", "").length <= MAX_INTEGER_DIGITS) return { latex: digits, plain: digits };
		return { latex: `\\approx ${decimal(re).latex}`, plain: null };
	}
	if (isDecimal(result)) return decimal(re);
	// Exact but not whole (1/3, √2, π): the exact form, then its decimal.
	const approx = decimal(re);
	return { latex: `${tidy(result.toLatex(LATEX))}\\approx ${approx.latex}`, plain: null };
}

/** A decimal number (0.1+0.2), not an exact form like a fraction or root. */
function isDecimal(result: Expr): boolean {
	const json = result.json;
	return typeof json === "number" || (typeof json === "object" && json !== null && "num" in json);
}

function decimal(x: number): CalcAnswer {
	if (x === 0) return { latex: "0", plain: "0" };
	const size = Math.abs(x);
	if (size >= 1e15 || size < 1e-6) {
		const [mantissa, exponent] = x.toExponential(DIGITS - 1).split("e");
		const m = String(Number(mantissa));
		return { latex: `${m}\\times10^{${Number(exponent)}}`, plain: null };
	}
	const s = String(Number(x.toPrecision(DIGITS)));
	return { latex: s, plain: s };
}

function tidy(latex: string): string {
	return latex.replaceAll("\\exponentialE", "e").replaceAll("\\imaginaryI", "i").replaceAll("\\,", "").trim();
}

/** The same characters in another order (spacing and \cdot aside). */
function sameUpToOrder(a: string, b: string): boolean {
	const norm = (s: string) => [...s.replace(/\\cdot|\\left|\\right|[\s{}]/g, "")].sort().join("");
	return norm(a) === norm(b);
}

function isExpr(x: unknown): x is Expr {
	return typeof x === "object" && x !== null && "evaluate" in x;
}

function solve(equation: Expr, variable: string | null): CalcAnswer | null {
	if (equation.operator !== "Equal") return null;
	const unknowns = equation.unknowns;
	const v = variable ?? (unknowns.length === 1 ? unknowns[0]! : null);
	if (v === null || !unknowns.includes(v)) return null;
	const solutions = equation.solve([v]);
	// One letter gives a list of values (a system would give records).
	const list: unknown[] = Array.isArray(solutions) ? [...solutions] : [];
	const values = list.filter(isExpr);
	if (values.length === 0 || values.length !== list.length) return null;
	const parts = values.map((s) => `${v}=${tidy(s.evaluate().toLatex(LATEX))}`);
	return { latex: parts.join("\\text{ or }"), plain: null };
}
