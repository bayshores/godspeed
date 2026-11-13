/**
 * The plot formula twins replay the shared cases the Rust server also
 * replays (crates/core/tests/plot_expr_golden.rs), so the window draws the
 * line the server checked and refuses the same formulas in the same words.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { evalExpr, parseExpr } from "../../src/shared/core/plot-expr.ts";

interface Case {
	name: string;
	output: { args: { src: string; names: string[]; at: [number, number][] }; result: { error: string } | { values: (number | string)[] } };
}

const cases = JSON.parse(readFileSync(new URL("../../crates/core/tests/golden/plot_expr.json", import.meta.url), "utf-8")) as Case[];

const shown = (v: number): number | string => (Number.isFinite(v) ? v : String(v));

describe("plot_expr shared cases", () => {
	for (const { name, output } of cases) {
		it(name, () => {
			const { src, names, at } = output.args;
			const parsed = parseExpr(src, names);
			if ("error" in parsed) return assert.deepEqual({ error: parsed.error }, output.result);
			const values = at.map(([x, s]) => shown(evalExpr(parsed.expr, new Map([[names[0] ?? "x", x], [names[1] ?? "s", s]]))));
			assert.deepEqual({ values }, output.result);
		});
	}
});
