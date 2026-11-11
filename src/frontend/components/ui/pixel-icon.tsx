import { cn } from "@/frontend/lib/utils";

/** Each icon as rows of a pixel grid: "#" is a filled pixel. */
const ICONS = {
	chevron: ["#....", ".#...", "..#..", "...#.", "..#..", ".#...", "#...."],
	play: ["#....", "##...", "###..", "####.", "###..", "##...", "#...."],
	plus: ["..#..", "..#..", "#####", "..#..", "..#.."],
	minus: [".....", ".....", "#####", ".....", "....."],
	check: ["......#", ".....#.", "#...#..", ".#.#...", "..#...."],
	close: ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],
} as const;

/** A small icon drawn in square pixels, in the text's color. Decorative:
 *  the control it sits in carries the name. */
export function PixelIcon({ name, className }: { name: keyof typeof ICONS; className?: string }) {
	const rows = ICONS[name];
	return (
		<svg aria-hidden viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" fill="currentColor" className={cn("h-[11px] w-auto shrink-0", className)}>
			{rows.flatMap((row, y) => [...row].map((cell, x) => (cell === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null)))}
		</svg>
	);
}
