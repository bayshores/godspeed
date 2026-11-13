import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatNumber,
	keyTops,
	labelPieces,
	lineEnd,
	linePath,
	liveText,
	readPlot,
	sliderText,
	sliderTicks,
	ticks,
	type Plot,
} from "../../src/frontend/components/lesson/plot-part-model.ts";
import { LEASH_CALL, LEASH_RESULT } from "../plot-fixtures.ts";

function leash(): Plot {
	const read = readPlot(LEASH_CALL, LEASH_RESULT);
	assert.ok("plot" in read);
	return read.plot;
}

describe("readPlot", () => {
	it("reads the call and the stored y range, the formulas typeset", () => {
		const plot = leash();
		assert.equal(plot.title, "One feature, where the weight ends up");
		assert.deepEqual([plot.y.min, plot.y.max], [0, 5]);
		assert.deepEqual(
			plot.lines.map((l) => [l.label, l.latex, l.hidden, l.dashed]),
			[
				["penalty", "a/(1+\\lambda)", true, false],
				["leash", "\\min(a, 4/(1+\\lambda))", false, true],
			],
		);
		assert.equal(plot.slider.latex, "\\lambda");
		assert.equal(plot.lines[0]!.at(8, 1), 4);
		assert.equal(plot.lines[1]!.at(8, 1), 2);
	});

	it("takes numbers sent as numeric strings", () => {
		const read = readPlot({ ...LEASH_CALL, x: { ...LEASH_CALL.x, min: "0", max: "10" }, slider: { ...LEASH_CALL.slider, start: "1" } }, LEASH_RESULT);
		assert.ok("plot" in read);
		assert.equal(read.plot.x.max, 10);
		assert.equal(read.plot.slider.start, 1);
	});

	it("keeps only the title when it cannot be drawn", () => {
		const title = { title: LEASH_CALL.title };
		assert.deepEqual(readPlot(LEASH_CALL, { ...LEASH_RESULT, v: 2 }), title, "an unknown version");
		assert.deepEqual(readPlot(LEASH_CALL, { ...LEASH_RESULT, onPlot: undefined }), title, "no guess");
		assert.deepEqual(readPlot({ ...LEASH_CALL, lines: [{ label: "penalty", expr: "a/(1+lamda)" }] }, LEASH_RESULT), title, "a formula that no longer parses");
		assert.deepEqual(readPlot({ ...LEASH_CALL, lines: [{ label: "x", expr: "toString(a)" }] }, LEASH_RESULT), title, "a hostile name is just unknown");
		assert.deepEqual(readPlot(LEASH_CALL, { ...LEASH_RESULT, y: { min: 5, max: 0 } }), title, "an empty y range");
		assert.deepEqual(readPlot(null, null), { title: "" });
	});
});

describe("ticks", () => {
	it("round steps about four across", () => {
		assert.deepEqual(ticks(0, 10), [0, 2, 4, 6, 8, 10]);
		assert.deepEqual(ticks(0, 5), [0, 1, 2, 3, 4, 5]);
		assert.deepEqual(ticks(-20, 20), [-20, -10, 0, 10, 20]);
		assert.deepEqual(ticks(0, 0.3), [0, 0.1, 0.2, 0.3], "no float dust");
	});

	it("the slider shows both ends and the round ticks clear of them", () => {
		assert.deepEqual(sliderTicks(0.5, 4, 510), [0.5, 1, 2, 3, 4]);
		assert.deepEqual(sliderTicks(0.9, 4, 510), [0.9, 2, 3, 4], "1 sits too close to 0.9");
	});

	it("numbers read short, with a real minus", () => {
		assert.equal(formatNumber(0.30000000000000004), "0.3");
		assert.equal(formatNumber(-2), "−2");
		assert.equal(formatNumber(Number.NaN), "none");
	});
});

describe("lines", () => {
	const frame = { left: 44, right: 554, top: 31, bottom: 271 };

	it("the leash at lambda 1: up to (2, 2), then flat", () => {
		const plot = leash();
		const path = linePath(plot, plot.lines[1]!, 1, frame);
		assert.ok(path.startsWith("M44,271"), path.slice(0, 20));
		assert.ok(path.endsWith("L554,175"), path.slice(-20));
		assert.equal(lineEnd(plot, plot.lines[1]!, 1), 2);
		assert.equal(lineEnd(plot, plot.lines[0]!, 3), 2.5);
	});

	it("a value that is not a number, or a pole far outside, is a gap", () => {
		const read = readPlot({ ...LEASH_CALL, lines: [{ label: "pole", expr: "1/(a-5)" }, { label: "root", expr: "sqrt(a-5)" }] }, LEASH_RESULT);
		assert.ok("plot" in read);
		const pole = linePath(read.plot, read.plot.lines[0]!, 1, frame);
		assert.equal(pole.match(/M/g)?.length, 2, "two pieces either side of a = 5");
		const root = linePath(read.plot, read.plot.lines[1]!, 1, frame);
		assert.equal(root.match(/M/g)?.length, 1, "nothing left of a = 5");
	});

	it("keys sit level with their line, apart and inside the plot", () => {
		assert.deepEqual(keyTops([31, 175], 23, 271, 40, 8), [23, 167]);
		assert.deepEqual(keyTops([100, 104], 23, 271, 40, 8), [92, 132], "pushed apart");
		assert.deepEqual(keyTops([270, 271], 23, 271, 40, 8), [231, 271], "the stack moves up from the bottom");
	});
});

describe("words", () => {
	it("the live line names every shown line at the x range's ends and middle", () => {
		const plot = leash();
		assert.equal(liveText(plot, 1, false), "At lambda 1, a = 0, 5, 10: leash 0, 2, 2.");
		assert.equal(liveText(plot, 1, true), "At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2.");
		assert.equal(sliderText(plot, 1.23456), "lambda 1.23");
	});

	it("a label's $math$ is cut out; an unmatched dollar stays", () => {
		assert.deepEqual(labelPieces("where the data alone put it, $a$"), [
			{ math: false, text: "where the data alone put it, " },
			{ math: true, text: "a" },
		]);
		assert.deepEqual(labelPieces("costs $5"), [{ math: false, text: "costs $5" }]);
		assert.deepEqual(labelPieces("\\$5 and $x$"), [
			{ math: false, text: "$5 and " },
			{ math: true, text: "x" },
		]);
	});
});
