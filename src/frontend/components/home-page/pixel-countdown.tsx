"use client";

/**
 * Home's big countdown to the next deadline. In its last 24h the clock is
 * drawn in square pixels ("04:08:33"); before that, and once overdue, it
 * is plain large text ("in 3 days", "Overdue"). The color is the
 * countdown's own (grey fading to red).
 */
import { countdown, dueAtMs } from "@/frontend/components/countdown-model";
import { useCountdown } from "@/frontend/components/countdown";
import { cn } from "@/frontend/lib/utils";

/** 5×7 digits; ":" and "." are one column wide. */
const GLYPHS: Record<string, readonly string[]> = {
	"0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
	"1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
	"2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
	"3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
	"4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
	"5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
	"6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
	"7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
	"8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
	"9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
	":": [".", ".", "#", ".", "#", ".", "."],
	".": [".", ".", ".", ".", ".", ".", "#"],
};

/** A pixel is 7 units with a 1-unit gap; glyphs sit one column apart. */
const PITCH = 8;

function pixels(text: string): { cells: Array<[number, number]>; cols: number } {
	const cells: Array<[number, number]> = [];
	let col = 0;
	for (const ch of text) {
		const glyph = GLYPHS[ch];
		if (!glyph) continue;
		glyph.forEach((row, y) => [...row].forEach((c, x) => c === "#" && cells.push([col + x, y])));
		col += glyph[0]!.length + 1;
	}
	return { cells, cols: Math.max(col - 1, 0) };
}

export function PixelCountdown({ due, now: fixedNow, className }: { due: { date: string; time?: string }; now?: number; className?: string }) {
	const live = useCountdown(due);
	const value = fixedNow !== undefined ? countdown(dueAtMs(due), fixedNow) : live;
	if (!value) return <span data-testid="pixel-countdown" className={className} />;
	if (value.mode === "days" || value.mode === "overdue") {
		return (
			<span data-testid="pixel-countdown" data-mode={value.mode} style={{ color: value.color }} className={cn("text-2xl font-bold whitespace-nowrap", className)}>
				{value.text.toLowerCase()}
			</span>
		);
	}
	const { cells, cols } = pixels(value.text);
	return (
		<svg
			data-testid="pixel-countdown"
			data-mode={value.mode}
			role="img"
			aria-label={value.text}
			viewBox={`0 0 ${cols * PITCH - 1} ${7 * PITCH - 1}`}
			shapeRendering="crispEdges"
			style={{ fill: value.color }}
			className={cn("block h-14 w-auto", className)}
		>
			{cells.map(([x, y]) => (
				<rect key={`${x}-${y}`} x={x * PITCH} y={y * PITCH} width={PITCH - 1} height={PITCH - 1} />
			))}
		</svg>
	);
}
