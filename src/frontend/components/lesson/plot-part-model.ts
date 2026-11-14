/**
 * A teacher's plot, read from its stored call and result: the lines as
 * formulas in the plot grammar (never run as code) or measured points, the
 * axes' ticks, the paths at a slider value, where each line's key sits, and
 * the words a screen reader hears. Pure; plot-part.tsx draws it.
 */
import { line } from "d3-shape";
import { evalExpr, exprToLatex, parseExpr } from "@/shared/core";

interface Axis {
	name: string;
	label: string;
	min: number;
	max: number;
}

interface LineBase {
	label: string;
	/** Held back until his guess is answered. */
	hidden: boolean;
	/** The second line is dashed. */
	dashed: boolean;
}

interface FormulaLine extends LineBase {
	/** The formula typeset under the label. */
	latex: string;
	points: null;
	/** The line's value at x and the slider value; not finite where the math is not. */
	at: (x: number, slider: number) => number;
}

interface PointsLine extends LineBase {
	/** Measured [x, y] by increasing x. A point held back until his answer
	 *  has a y that is not a number. */
	points: [number, number][];
}

export type PlotLine = FormulaLine | PointsLine;

export interface Slider {
	name: string;
	latex: string;
	min: number;
	max: number;
	start: number;
}

export interface Plot {
	title: string;
	x: Axis;
	y: { label: string; min: number; max: number };
	/** Only when a line is a formula. */
	slider: Slider | null;
	lines: PlotLine[];
}

/** A number the stored call may carry as a numeric string. */
function num(v: unknown): number {
	if (typeof v === "number") return v;
	if (typeof v === "string" && v.trim() !== "") return Number(v);
	return Number.NaN;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const range = (min: number, max: number): boolean => Number.isFinite(min) && Number.isFinite(max) && min < max;
const present = (v: unknown): boolean => v !== undefined && v !== null;

/** A points line's pairs, or null when they cannot be drawn. */
function readPoints(raw: unknown): [number, number][] | null {
	if (!Array.isArray(raw) || raw.length < 2) return null;
	const points = raw.map((pair): [number, number] => (Array.isArray(pair) && pair.length === 2 ? [num(pair[0]), num(pair[1])] : [Number.NaN, Number.NaN]));
	const drawable = points.every(([x, y], i) => Number.isFinite(x) && Number.isFinite(y) && (i === 0 || x > points[i - 1]![0]));
	return drawable ? points : null;
}

/** The plot a stored call and its result draw, or only its title when it
 *  cannot be drawn (an unknown version, no guess, a formula that no longer
 *  parses, points out of order or not numbers). */
export function readPlot(input: unknown, output: unknown): { plot: Plot } | { title: string } {
	const call = (input ?? {}) as Record<string, Record<string, unknown> | undefined>;
	const title = str(call.title);
	const details = (output ?? {}) as { v?: unknown; onPlot?: { toolCallId?: unknown }; y?: { min?: unknown; max?: unknown } };
	const x = { name: str(call.x?.name), label: str(call.x?.label), min: num(call.x?.min), max: num(call.x?.max) };
	const y = { label: str(call.y?.label), min: num(details.y?.min), max: num(details.y?.max) };
	const rawLines = Array.isArray(call.lines) ? (call.lines as Record<string, unknown>[]) : [];
	if (details.v !== 1 || typeof details.onPlot?.toolCallId !== "string") return { title };
	if (!range(x.min, x.max) || !range(y.min, y.max) || rawLines.length < 1 || rawLines.length > 2) return { title };
	// The slider and x's name serve the formulas; a plot of points alone has neither.
	const formulas = rawLines.some((raw) => present(raw?.expr));
	const s = call.slider;
	const slider = formulas ? { name: str(s?.name), latex: "", min: num(s?.min), max: num(s?.max), start: num(s?.start) } : null;
	if (slider && (!x.name || !slider.name || !range(slider.min, slider.max) || !Number.isFinite(slider.start))) return { title };
	const names = slider ? [x.name, slider.name] : [];
	const lines: PlotLine[] = [];
	for (const [i, raw] of rawLines.entries()) {
		if (typeof raw?.label !== "string") return { title };
		const common = { label: raw.label, hidden: raw.hidden === true, dashed: i === 1 };
		if (!present(raw.expr)) {
			const points = readPoints(raw.points);
			if (!points) return { title };
			lines.push({ ...common, points });
			continue;
		}
		const parsed = parseExpr(str(raw.expr), names);
		if ("error" in parsed || !slider) return { title };
		const { expr } = parsed;
		lines.push({ ...common, latex: exprToLatex(expr), points: null, at: (xv, sv) => evalExpr(expr, new Map([[x.name, xv], [slider.name, sv]])) });
	}
	if (slider) {
		const sliderName = parseExpr(slider.name, [slider.name]);
		slider.latex = "expr" in sliderName ? exprToLatex(sliderName.expr) : slider.name;
		slider.start = Math.min(slider.max, Math.max(slider.min, slider.start));
	}
	// A points plot with no x name is read out by its axis title.
	x.name ||= x.label.trim() || "x";
	return { plot: { title, x, y, slider, lines } };
}

/** The plot as it shows before his answer: on a shown points line, the
 *  point his guess asks at (its `onPlot`) is held back. */
export function heldBack(plot: Plot, guessAt: unknown): Plot {
	const on = (guessAt ?? {}) as { line?: unknown; x?: unknown };
	const x = num(on.x);
	const lines = plot.lines.map((l): PlotLine => (l.points && !l.hidden && l.label === on.line ? { ...l, points: l.points.map(([px, py]): [number, number] => [px, px === x ? Number.NaN : py]) } : l));
	return { ...plot, lines };
}

/** A tick or value as it reads: up to 4 significant figures, a real minus. */
export function formatNumber(n: number): string {
	if (!Number.isFinite(n)) return "none";
	return String(Number(n.toPrecision(4))).replace("-", "−");
}

/** Round steps of 1, 2 or 5 about four across, d3's rule. */
export function ticks(min: number, max: number): number[] {
	const rough = (max - min) / 4;
	const power = 10 ** Math.floor(Math.log10(rough));
	const error = rough / power;
	const step = (error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1) * power;
	// Past 2^52 steps from 0, i++ no longer moves i, so such a range shows only its ends.
	if (!(step > 0) || Math.max(Math.abs(min), Math.abs(max)) / step > 2 ** 52) return min < max ? [min, max] : [min];
	const out: number[] = [];
	for (let i = Math.ceil(min / step - 1e-9); i * step <= max + step * 1e-9 && out.length < 50; i++) {
		const tick = Number((i * step).toPrecision(12));
		if (tick !== out.at(-1)) out.push(tick);
	}
	return out;
}

/** The slider's ticks: its two ends always, and the round ticks between
 *  them that keep `clear` px from an end's label. */
export function sliderTicks(min: number, max: number, width: number, clear = 24): number[] {
	const px = (v: number) => ((v - min) / (max - min)) * width;
	const inner = ticks(min, max).filter((v) => px(v) >= clear && px(v) <= width - clear);
	return [min, ...inner, max];
}

/** A linear map from a value range onto a pixel range. */
export function scale(min: number, max: number, from: number, to: number): (v: number) => number {
	return (v) => from + ((v - min) / (max - min)) * (to - from);
}

const SAMPLES = 200;

/** The x values a line is drawn through, both ends included. */
function sampleXs(plot: Plot): number[] {
	const { min, max } = plot.x;
	return Array.from({ length: SAMPLES }, (_, i) => min + ((max - min) * i) / (SAMPLES - 1));
}

type Frame = { left: number; right: number; top: number; bottom: number };

/** A points line's points in px, each kept within one plot height and width
 *  of the box so a stored call never yields a huge path; a held-back point
 *  is left out, or with `gaps` kept with a y that is not a number. */
export function pointMarks(plot: Plot, plotLine: PointsLine, frame: Frame, gaps = false): [number, number][] {
	const px = scale(plot.x.min, plot.x.max, frame.left, frame.right);
	const py = scale(plot.y.min, plot.y.max, frame.bottom, frame.top);
	const near = (v: number, min: number, max: number) => Math.min(max + (max - min), Math.max(min - (max - min), v));
	const marks = plotLine.points.map(([x, y]): [number, number] => [px(near(x, plot.x.min, plot.x.max)), py(near(y, plot.y.min, plot.y.max))]);
	return gaps ? marks : marks.filter((m) => Number.isFinite(m[1]));
}

/** The SVG path of a line at a slider value, inside the pixel box `frame`.
 *  A formula's value that is not a number, or far outside the y range (a
 *  pole), is a gap; measured points are joined by straight segments. The
 *  rest is clipped to the box where it is drawn. */
export function linePath(plot: Plot, plotLine: PlotLine, slider: number, frame: Frame): string {
	if (plotLine.points) {
		const path = line<[number, number]>().defined((p) => Number.isFinite(p[1]));
		return path(pointMarks(plot, plotLine, frame, true)) ?? "";
	}
	const px = scale(plot.x.min, plot.x.max, frame.left, frame.right);
	const py = scale(plot.y.min, plot.y.max, frame.bottom, frame.top);
	const span = plot.y.max - plot.y.min;
	const points = sampleXs(plot).map((x): [number, number | null] => {
		const y = plotLine.at(x, slider);
		return [px(x), Number.isFinite(y) && y >= plot.y.min - span && y <= plot.y.max + span ? py(y) : null];
	});
	const path = line<[number, number | null]>()
		.defined((p) => p[1] !== null)
		.x((p) => p[0])
		.y((p) => p[1] ?? 0);
	return path(points) ?? "";
}

/** The line's last drawn value (its key sits level with it), or null. */
export function lineEnd(plot: Plot, plotLine: PlotLine, slider: number): number | null {
	if (plotLine.points) {
		const last = plotLine.points.findLast((p) => Number.isFinite(p[1]));
		return last ? Math.min(plot.y.max, Math.max(plot.y.min, last[1])) : null;
	}
	const xs = sampleXs(plot);
	for (let i = xs.length - 1; i >= 0; i--) {
		const y = plotLine.at(xs[i]!, slider);
		if (Number.isFinite(y)) return Math.min(plot.y.max, Math.max(plot.y.min, y));
	}
	return null;
}

/** Each key's top: its label level with `wanted` (the line's end, px), at
 *  least `gap` px under the key above it, inside `top` to `bottom`. */
export function keyTops(wanted: readonly number[], top: number, bottom: number, gap: number, lift: number): number[] {
	const order = wanted.map((_, i) => i).sort((a, b) => wanted[a]! - wanted[b]!);
	const out = new Array<number>(wanted.length);
	let next = top;
	for (const i of order) {
		out[i] = Math.max(next, wanted[i]! - lift);
		next = out[i] + gap;
	}
	// Pushed past the bottom: move the stack up, keeping the gaps.
	for (let k = order.length - 1, limit = bottom; k >= 0; k--) {
		const i = order[k]!;
		out[i] = Math.min(out[i]!, limit);
		limit = out[i] - gap;
	}
	return out;
}

/** What a screen reader hears after each move: every shown formula line at
 *  the x range's ends and middle, every point of a shown points line. */
export function liveText(plot: Plot, slider: number, open: boolean): string {
	const xs = [plot.x.min, (plot.x.min + plot.x.max) / 2, plot.x.max];
	const listed = (values: number[]) => values.map(formatNumber).join(", ");
	const said: string[] = [];
	let formulasSaid = false;
	for (const shown of plot.lines.filter((l) => open || !l.hidden)) {
		if (shown.points) {
			const told = shown.points.filter((p) => Number.isFinite(p[1]));
			said.push(`${plot.x.name} = ${listed(told.map((p) => p[0]))}: ${shown.label} ${listed(told.map((p) => p[1]))}.`);
			continue;
		}
		if (!formulasSaid && plot.slider) said.push(`At ${sliderText(plot.slider, slider)}, ${plot.x.name} = ${listed(xs)}:`);
		formulasSaid = true;
		said.push(`${shown.label} ${listed(xs.map((x) => shown.at(x, slider)))}.`);
	}
	return said.join(" ");
}

/** The slider's value for a screen reader: "lambda 1.5". */
export function sliderText(slider: Slider, value: number): string {
	return `${slider.name} ${formatNumber(Number(value.toPrecision(3)))}`;
}

/** A label cut into plain words and $math$. An unmatched $ stays a plain
 *  dollar. */
export function labelPieces(text: string): { math: boolean; text: string }[] {
	const out: { math: boolean; text: string }[] = [];
	let math = false;
	let piece = "";
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (c === "\\" && text[i + 1] === "$") {
			piece += math ? "\\$" : "$";
			i++;
		} else if (c === "$") {
			if (piece) out.push({ math, text: piece });
			piece = "";
			math = !math;
		} else piece += c;
	}
	if (math) return [{ math: false, text: text.replaceAll("\\$", "$") }];
	if (piece) out.push({ math: false, text: piece });
	return out;
}
