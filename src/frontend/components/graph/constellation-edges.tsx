/**
 * The zoomed-in Graph picture's top and bottom edges: the picture dissolves
 * over BAND screen points in hard 2-point pixels, thinning in steps toward
 * the edge (an ordered dither, like the dark side of a moon), so it never
 * ends in a hard cut where nothing is drawn. Its sides need none: they run
 * to the window's edges.
 */
import type { ReactNode } from "react";
import type { Bleed } from "./constellation-camera.ts";

/** How tall each dissolving edge is. */
export const BAND = 24;
/** The dither's cell, and the share of cells kept (in sixteenths) in each step from the edge inward. */
const CELL = 2;
const STEPS = [2, 4, 8, 12];
/** A 4 by 4 ordered dither: a cell is kept when its rank is below the step's share. */
const RANK = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
];
const TILE = 4 * CELL;

/** One edge's kept cells as an image TILE wide and BAND tall, repeated across; `bottom` counts its steps up from its lower edge. */
function band(bottom: boolean): string {
	let d = "";
	for (let r = 0; r < BAND / CELL; r++) {
		const share = STEPS[Math.floor((r * CELL * STEPS.length) / BAND)]!;
		const y = bottom ? BAND - (r + 1) * CELL : r * CELL;
		for (let i = 0; i < 4; i++) if (RANK[r % 4]![i]! < share) d += `M${i * CELL} ${y}h${CELL}v${CELL}h-${CELL}z`;
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${BAND}" shape-rendering="crispEdges"><path d="${d}"/></svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/**
 * A CSS mask rather than an SVG one: it is one fixed image the browser keeps
 * while the camera moves, where an SVG mask is drawn again on every frame.
 */
const EDGES = {
	maskImage: `${band(false)}, linear-gradient(#000, #000), ${band(true)}`,
	maskRepeat: "repeat-x, no-repeat, repeat-x",
	maskPosition: `0 0, 0 ${BAND}px, 0 100%`,
	maskSize: `${TILE}px ${BAND}px, 100% calc(100% - ${2 * BAND}px), ${TILE}px ${BAND}px`,
};

/**
 * The picture's SVG: `w` by `h` at rest; zoomed in (`out` past the box on
 * each side) drawn further out, its top and bottom edges dissolving.
 */
export function PictureSvg({ w, h, out, children }: { w: number; h: number; out: Bleed | null; children: ReactNode }) {
	const o = out ?? { left: 0, right: 0, top: 0, bottom: 0 };
	return (
		<svg
			aria-hidden
			width={w + o.left + o.right}
			height={h + o.top + o.bottom}
			className="pointer-events-none absolute overflow-visible"
			style={{ left: -o.left, top: -o.top, ...(out && EDGES) }}
		>
			<g transform={`translate(${o.left} ${o.top})`}>{children}</g>
		</svg>
	);
}
