import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	formatNumber,
	heldBack,
	keyTops,
	labelPieces,
	lineEnd,
	linePath,
	liveText,
	pointMarks,
	readPlot,
	sliderText,
	sliderTicks,
	ticks,
	type Plot,
	type PlotLine,
} from "../../src/frontend/components/lesson/plot-part-model.ts";
import { CV_CALL, CV_RESULT, LEASH_CALL, LEASH_RESULT } from "../plot-fixtures.ts";

function leash(): Plot {
	const read = readPlot(LEASH_CALL, LEASH_RESULT);
	assert.ok("plot" in read);
	return read.plot;
}

function cv(call: unknown = CV_CALL): Plot {
	const read = readPlot(call, CV_RESULT);
	assert.ok("plot" in read);
	return read.plot;
}

/** A formula line's value function; a points line has none. */
function at(l: PlotLine | undefined): (x: number, slider: number) => number {
	assert.ok(l && l.points === null);
	return l.at;
}

const MIXED_CALL = { ...LEASH_CALL, lines: [{ label: "model", expr: "a/(1+lambda)" }, { label: "data", points: [[2, 1.2], [6, 2.7], [10, 5.4]], hidden: true }] };

describe("readPlot", () => {
	it("reads the call and the stored y range, the formulas typeset", () => {
		const plot = leash();
		assert.equal(plot.title, "One feature, where the weight ends up");
		assert.deepEqual([plot.y.min, plot.y.max], [0, 5]);
		assert.deepEqual(
			plot.lines.map((l) => [l.label, l.points === null ? l.latex : "", l.hidden, l.dashed]),
			[
				["penalty", "a/(1+\\lambda)", true, false],
				["leash", "\\min(a, 4/(1+\\lambda))", false, true],
			],
		);
		assert.equal(plot.slider?.latex, "\\lambda");
		assert.equal(at(plot.lines[0])(8, 1), 4);
		assert.equal(at(plot.lines[1])(8, 1), 2);
	});

	it("a plot sent with no guess, while a question was open, draws", () => {
		const { onPlot: _, ...noGuess } = LEASH_RESULT;
		const read = readPlot(LEASH_CALL, noGuess);
		assert.ok("plot" in read);
		assert.equal(read.plot.lines.length, 2);
	});

	it("takes numbers sent as numeric strings", () => {
		const read = readPlot({ ...LEASH_CALL, x: { ...LEASH_CALL.x, min: "0", max: "10" }, slider: { ...LEASH_CALL.slider, start: "1" } }, LEASH_RESULT);
		assert.ok("plot" in read);
		assert.equal(read.plot.x.max, 10);
		assert.equal(read.plot.slider?.start, 1);
	});

	it("a formula plot stored before points reads exactly as before", () => {
		const plot = leash();
		assert.deepEqual(plot.slider, { name: "lambda", latex: "\\lambda", min: 0.5, max: 4, start: 1 });
		assert.deepEqual(plot.x, { name: "a", label: "where the data alone put it, $a$", min: 0, max: 10 });
		assert.deepEqual(
			plot.lines.map((l) => l.points),
			[null, null],
		);
		assert.equal(liveText(plot, 1, true), "At lambda 1, a = 0, 5, 10: penalty 0, 2.5, 5. leash 0, 2, 2.");
	});

	it("measured points read as pairs, with no slider and no formula", () => {
		const plot = cv();
		assert.equal(plot.slider, null);
		assert.deepEqual(
			plot.lines.map((l) => [l.label, "latex" in l, l.points]),
			[
				[
					"cv_error",
					false,
					[
						[1, 0.8],
						[3, 0.4],
						[5, 0.3],
						[9, 0.9],
					],
				],
			],
		);
		const strings = cv({ ...CV_CALL, lines: [{ label: "cv_error", points: [["1", "0.8"], ["3", "0.4"]] }] });
		assert.deepEqual(strings.lines[0]!.points, [
			[1, 0.8],
			[3, 0.4],
		]);
		assert.equal(cv({ ...CV_CALL, x: { label: "polynomial degree", min: 0, max: 10 } }).x.name, "polynomial degree", "no x name: the axis title");
	});

	it("a formula and points share a plot", () => {
		const read = readPlot(MIXED_CALL, { ...LEASH_RESULT, y: { min: 0, max: 6 } });
		assert.ok("plot" in read);
		assert.deepEqual(
			read.plot.lines.map((l) => [l.label, l.points === null, l.dashed, l.hidden]),
			[
				["model", true, false, false],
				["data", false, true, true],
			],
		);
		assert.equal(read.plot.slider?.name, "lambda");
		assert.equal(liveText(read.plot, 1, true), "At lambda 1, a = 0, 5, 10: model 0, 2.5, 5. a = 2, 6, 10: data 1.2, 2.7, 5.4.");
	});

	it("keeps only the title when it cannot be drawn", () => {
		const title = { title: LEASH_CALL.title };
		assert.deepEqual(readPlot(LEASH_CALL, { ...LEASH_RESULT, v: 2 }), title, "an unknown version");
		assert.deepEqual(readPlot(LEASH_CALL, { ...LEASH_RESULT, onPlot: { value: 4 } }), title, "a broken guess");
		assert.deepEqual(readPlot({ ...LEASH_CALL, lines: [{ label: "penalty", expr: "a/(1+lamda)" }] }, LEASH_RESULT), title, "a formula that no longer parses");
		assert.deepEqual(readPlot({ ...LEASH_CALL, lines: [{ label: "x", expr: "toString(a)" }] }, LEASH_RESULT), title, "a hostile name is just unknown");
		assert.deepEqual(readPlot(LEASH_CALL, { ...LEASH_RESULT, y: { min: 5, max: 0 } }), title, "an empty y range");
		assert.deepEqual(readPlot(null, null), { title: "" });
		const cvTitle = { title: CV_CALL.title };
		const points = (raw: unknown) => readPlot({ ...CV_CALL, lines: [{ label: "cv_error", points: raw }] }, CV_RESULT);
		assert.deepEqual(points([[1, 2]]), cvTitle, "one point");
		assert.deepEqual(points([[3, 2], [1, 2]]), cvTitle, "x falling");
		assert.deepEqual(points([[1, 2], [3, "high"]]), cvTitle, "a y that is not a number");
		assert.deepEqual(points("[[1, 2], [3, 4]]"), cvTitle, "points sent as text");
	});
});

describe("ticks", () => {
	it("round steps about four across", () => {
		assert.deepEqual(ticks(0, 10), [0, 2, 4, 6, 8, 10]);
		assert.deepEqual(ticks(0, 5), [0, 1, 2, 3, 4, 5]);
		assert.deepEqual(ticks(-20, 20), [-20, -10, 0, 10, 20]);
		assert.deepEqual(ticks(0, 0.3), [0, 0.1, 0.2, 0.3], "no float dust");
	});

	it("a range too narrow for its numbers shows its ends and never repeats a tick", () => {
		assert.deepEqual(ticks(1e18, 1e18 + 256), [1e18, 1e18 + 256], "past 2^52 steps the count stops moving");
		const near = ticks(1e17, 1e17 + 96);
		assert.equal(new Set(near).size, near.length);
		assert.deepEqual(ticks(3, 3), [3]);
		assert.ok(ticks(0, 1e9).length <= 50);
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

	it("measured points are joined by straight segments, the key level with the last", () => {
		const plot = cv();
		const path = linePath(plot, plot.lines[0]!, Number.NaN, frame);
		assert.equal(path, "M95,91L197,211L299,241L503,61");
		assert.equal(lineEnd(plot, plot.lines[0]!, Number.NaN), 0.9);
	});

	it("a stored point far outside the y range stays near the box, never a huge path", () => {
		for (const far of [1e300, 1.7e308]) {
			const plot = cv({ ...CV_CALL, lines: [{ label: "cv_error", points: [[1, 0.5], [9, far]] }] });
			assert.equal(linePath(plot, plot.lines[0]!, Number.NaN, frame), "M95,181L503,-209", "one plot height above the top");
		}
	});

	it("the point his guess asks at is held back until he answers: no square, no segment to it, not read out", () => {
		const locked = heldBack(cv(), { line: "cv_error", x: 5 });
		const line = locked.lines[0]!;
		assert.ok(line.points);
		assert.equal(linePath(locked, line, Number.NaN, frame), "M95,91L197,211M503,61Z", "a gap where the point was");
		assert.deepEqual(
			pointMarks(locked, line, frame).map((m) => m[0]),
			[95, 197, 503],
		);
		assert.equal(liveText(locked, Number.NaN, false), "degree = 1, 3, 9: cv_error 0.8, 0.4, 0.9.");
		const open = cv();
		const openLine = open.lines[0]!;
		assert.ok(openLine.points);
		assert.equal(pointMarks(open, openLine, frame).length, 4, "the open plot draws every point");
		assert.equal(liveText(open, Number.NaN, true), "degree = 1, 3, 5, 9: cv_error 0.8, 0.4, 0.3, 0.9.");
		assert.equal(lineEnd(heldBack(cv(), { line: "cv_error", x: "9" }), line, Number.NaN), 0.9, "the key follows the line as given");
	});

	it("only a shown points line holds a point back", () => {
		const read = readPlot(MIXED_CALL, { ...LEASH_RESULT, y: { min: 0, max: 6 } });
		assert.ok("plot" in read);
		assert.ok(heldBack(read.plot, { line: "data", x: 6 }).lines.every((l, i) => l === read.plot.lines[i]), "the data line is hidden whole");
		const plot = leash();
		assert.ok(heldBack(plot, { line: "leash", x: 8 }).lines.every((l, i) => l === plot.lines[i]), "formulas are untouched");
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
		assert.ok(plot.slider);
		assert.equal(sliderText(plot.slider, 1.23456), "lambda 1.23");
	});

	it("the live line names every point of a points line", () => {
		assert.equal(liveText(cv(), Number.NaN, false), "degree = 1, 3, 5, 9: cv_error 0.8, 0.4, 0.3, 0.9.");
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
