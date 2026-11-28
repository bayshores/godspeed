import { cn } from "@/frontend/lib/utils";

/** Each icon as rows of a pixel grid: "#" is a filled pixel. */
const ICONS = {
	chevron: ["#..", ".#.", "..#", ".#.", "#.."],
	more: ["#.#.#"],
	plus: ["..#..", "..#..", "#####", "..#..", "..#.."],
	minus: [".....", ".....", "#####", ".....", "....."],
	check: ["......#", ".....#.", "#...#..", ".#.#...", "..#...."],
	close: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
	pages: ["..####", "..#..#", "####.#", "#..###", "#..#..", "####.."],
	search: [".##...", "#..#..", "#..#..", ".###..", "....#.", ".....#"],
	key: [".##......", "#..#.....", "#..######", "#..#.#.#.", ".##......"],
	folder: ["###......", "#########", "#.......#", "#.......#", "#.......#", "#########"],
	crystal: ["...#.....", "...###...", "..#.###..", "..#.#####", ".###.####", ".###.####", "#####.##.", "####.###.", ".###.###.", "..##.##..", "...###...", "....#...."],
	pencil: [".......#.", "......###", ".....###.", "....###..", "...###...", "..###....", ".#.#.....", ".##......", "#........"],
	// The pencil for a line of text: the one above is drawn 18 points tall or more.
	"pencil-small": ["....#.", "...###", "..###.", ".###..", "##....", "#....."],
} as const;

/** Rows of a pixel grid drawn as square pixels, in the text's color. `size` is the height asked
 *  for in points: the grid snaps to the nearest whole number of points per pixel, so no pixel
 *  falls between screen pixels. The size is set inline, so no class can stretch it.
 *  Decorative: the control it sits in carries the name. */
export function PixelGrid({ rows, size = 11, className }: { rows: readonly string[]; size?: number; className?: string }) {
	const columns = rows[0]?.length ?? 0;
	const scale = Math.max(1, Math.round(size / rows.length));
	return (
		<svg
			aria-hidden
			viewBox={`0 0 ${columns} ${rows.length}`}
			shapeRendering="crispEdges"
			fill="currentColor"
			style={{ width: columns * scale, height: rows.length * scale }}
			className={cn("shrink-0", className)}
		>
			{rows.flatMap((row, y) => [...row].map((cell, x) => (cell === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null)))}
		</svg>
	);
}

/** One of the app's small icons. */
export function PixelIcon({ name, size, className }: { name: keyof typeof ICONS; size?: number; className?: string }) {
	return <PixelGrid rows={ICONS[name]} size={size} className={className} />;
}
