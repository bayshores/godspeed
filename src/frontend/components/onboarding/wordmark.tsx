import { cn } from "@/frontend/lib/utils";

/** The logo's pixel g, one string per row. */
const G = [".####.#", "#....#.", "#....#.", "#....#.", ".####..", "#......", ".#####.", "#.....#", "#.....#", ".#####."];
/** One cell of the g, in the mark's 132-unit box. */
const CELL = 8;
const G_PATH = G.flatMap((row, r) => [...row].map((dot, q) => (dot === "#" ? `M${32 + q * CELL},${20 + r * CELL}h${CELL}v${CELL}h${-CELL}z` : ""))).join("");

/** A checkerboard of 3-unit squares: how e-ink draws grey. */
function checks(x: number, y: number, w: number, h: number): string {
	let d = "";
	for (let r = 0; r * 3 < h; r++) for (let q = 0; q * 3 < w; q++) if ((q + r) % 2 === 0) d += `M${x + q * 3},${y + r * 3}h3v3h-3z`;
	return d;
}
/** The tile's hard shadow, its far edge dithered. */
const SHADOW = `M6,6h120v120h-120z${checks(126, 12, 6, 120)}${checks(12, 126, 114, 6)}`;

/** The logo: the pixel g on a paper tile, the app's name and a red seal dot.
 *  The welcome screen and the first-run intro show it. */
export function Wordmark({ className }: { className?: string }) {
	return (
		<div className={cn("relative flex items-end gap-[18px]", className)}>
			<svg aria-hidden viewBox="0 0 132 132" shapeRendering="crispEdges" className="size-[66px] shrink-0">
				<path className="fill-ink" d={SHADOW} />
				<rect className="fill-ink" width="120" height="120" />
				<rect className="fill-panel" x="3" y="3" width="114" height="114" />
				<path className="fill-ink" d={G_PATH} />
			</svg>
			<h1 className="font-count text-[64px] leading-none font-normal text-ink">godspeed</h1>
			<span aria-hidden className="mb-[52px] -ml-2 size-2 shrink-0 bg-stamp" />
		</div>
	);
}
