/**
 * The app's half tones, drawn as CSS masks in hard 2-point pixels from one
 * 4 by 4 ordered dither, so every faded edge thins in the same steps (like
 * the dark side of a moon) and never in a soft gradient.
 */
import type { CSSProperties } from "react";

/** How tall a dissolving end is. */
export const DITHER_BAND = 24;
/** The dither's cell, and the share of cells kept (in sixteenths) in each step from the edge inward. */
const CELL = 2;
const STEPS = [2, 4, 8, 12];
/** A cell is kept when its rank is below the step's share. */
const RANK = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
];
const TILE = 4 * CELL;

const url = (w: number, h: number, d: string) =>
	`url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges"><path d="${d}"/></svg>`)}")`;
const cell = (x: number, y: number) => `M${x} ${y}h${CELL}v${CELL}h-${CELL}z`;

/** One end's kept cells as an image DITHER_BAND deep and TILE along its edge, repeated along it; its steps count inward from the edge. */
function band(side: "top" | "foot" | "left" | "right"): string {
	const upright = side === "left" || side === "right";
	const far = side === "foot" || side === "right";
	let d = "";
	for (let r = 0; r < DITHER_BAND / CELL; r++) {
		const share = STEPS[Math.floor((r * CELL * STEPS.length) / DITHER_BAND)]!;
		const depth = far ? DITHER_BAND - (r + 1) * CELL : r * CELL;
		for (let i = 0; i < 4; i++) if (RANK[r % 4]![i]! < share) d += upright ? cell(depth, i * CELL) : cell(i * CELL, depth);
	}
	return upright ? url(DITHER_BAND, TILE, d) : url(TILE, DITHER_BAND, d);
}

const TOP = band("top");
const FOOT = band("foot");
/** The four ends by the names the stylesheet draws its own dissolving ends with (the lesson's window, a row of tabs). */
export const DITHER_VARS = { "--lh-dither-top": TOP, "--lh-dither-foot": FOOT, "--lh-dither-left": band("left"), "--lh-dither-right": band("right") };
const SOLID = "linear-gradient(#000, #000)";
const ROW = `${TILE}px ${DITHER_BAND}px`;

/** A box whose `start` (top), `end` (foot) or both ends dissolve over DITHER_BAND points. */
export function ditherEnds(ends: "start" | "end" | "both"): CSSProperties {
	if (ends === "start") return { maskImage: `${TOP}, ${SOLID}`, maskRepeat: "repeat-x, no-repeat", maskPosition: `0 0, 0 ${DITHER_BAND}px`, maskSize: `${ROW}, 100% calc(100% - ${DITHER_BAND}px)` };
	if (ends === "end") return { maskImage: `${SOLID}, ${FOOT}`, maskRepeat: "no-repeat, repeat-x", maskPosition: "0 0, 0 100%", maskSize: `100% calc(100% - ${DITHER_BAND}px), ${ROW}` };
	return {
		maskImage: `${TOP}, ${SOLID}, ${FOOT}`,
		maskRepeat: "repeat-x, no-repeat, repeat-x",
		maskPosition: `0 0, 0 ${DITHER_BAND}px, 0 100%`,
		maskSize: `${ROW}, 100% calc(100% - ${2 * DITHER_BAND}px), ${ROW}`,
	};
}

/** A share of a fill (in sixteenths): the dither's cells ranked below it. */
const tone = (share: number): CSSProperties => ({
	maskImage: url(TILE, TILE, RANK.flatMap((row, y) => row.map((rank, x) => (rank < share ? cell(x * CELL, y * CELL) : ""))).join("")),
	maskSize: `${TILE}px ${TILE}px`,
});
/** Half of a fill: the dither's middle step, a checker of 2-point cells. */
export const HALF_TONE = tone(8);
/** A quarter of a fill: 2-point dots on a 4-point grid (a progress bar's track). */
export const QUARTER_TONE = tone(4);
