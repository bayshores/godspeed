/**
 * The zoomed-in Graph picture's top and bottom edges dissolve in the app's
 * dither (lib/dither.ts), so it never ends in a hard cut where nothing is
 * drawn. Its sides need none: they run to the window's edges.
 */
import type { ReactNode } from "react";
import { ditherEnds } from "@/frontend/lib/dither";
import type { Bleed } from "./constellation-camera.ts";

/**
 * A CSS mask rather than an SVG one: it is one fixed image the browser keeps
 * while the camera moves, where an SVG mask is drawn again on every frame.
 */
const EDGES = ditherEnds("both");

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
