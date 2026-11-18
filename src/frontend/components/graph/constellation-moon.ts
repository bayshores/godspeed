/**
 * A fact's moon, close up: a pixel disc lit from the right by how many of its
 * last four answers were right, the lit part in ink when the latest answer
 * was right and in its outcome colour when not. A fact never asked is a dark
 * moon, with a centre pixel when a lesson taught it. Screen points. Pure.
 */
import { factMark, type FactProgress } from "@/shared/core";
import { PANEL_ANSWER_COLOR } from "./derive.ts";

/** A moon cell's side, and the moon's width in cells. */
const CELL = 2;
const N = 9;
const R = N / 2;
/** Half a moon's drawn size. */
export const MOON_HALF = (N * CELL) / 2;

/** A fact never asked: brighter once a lesson taught it than when it is only in a file. */
export const unaskedColor = (f: Pick<FactProgress, "inLessons">) => (f.inLessons ? "var(--lh-ink-3)" : "color-mix(in srgb, var(--foreground) 34%, var(--background))");
const DARK = "color-mix(in srgb, var(--foreground) 16%, var(--background))";
const RIM_ASKED = "color-mix(in srgb, var(--foreground) 45%, var(--background))";

type Cell = readonly [number, number];
const DISC: { c: Cell; dx: number; w: number }[] = [];
for (let j = 0; j < N; j++)
	for (let i = 0; i < N; i++) {
		const dx = i + 0.5 - R;
		const dy = j + 0.5 - R;
		if (dx * dx + dy * dy <= R * R + 0.3) DISC.push({ c: [i, j], dx, w: Math.sqrt(Math.max(0, R * R - dy * dy)) });
	}
const inDisc = new Set(DISC.map(({ c }) => `${c[0]},${c[1]}`));
const RIM = DISC.filter(({ c: [i, j] }) => [inDisc.has(`${i + 1},${j}`), inDisc.has(`${i - 1},${j}`), inDisc.has(`${i},${j + 1}`), inDisc.has(`${i},${j - 1}`)].includes(false)).map(({ c }) => c);
const onRim = new Set(RIM);
/** The dark side: every other cell inside the rim, like an e-ink grey. */
const DITHER = DISC.filter(({ c }) => (c[0] + c[1]) % 2 === 0 && !onRim.has(c)).map(({ c }) => c);

/** Cells as a path relative to the moon's corner, built once: a moon on screen only adds its `M x y`. */
function relative(cells: readonly Cell[]): string {
	let [px, py] = [0, 0];
	return cells
		.map(([i, j]) => {
			const step = `m${i * CELL - px} ${j * CELL - py}h${CELL}v${CELL}h-${CELL}z`;
			[px, py] = [i * CELL, j * CELL];
			return step;
		})
		.join("");
}

/** How many of the last four answers were right: the moon's phase, 0 (new) to 4 (full). */
export const moonPhase = (f: Pick<FactProgress, "answers">) => f.answers.slice(-4).filter((a) => a.outcome === "right").length;

/** Each phase's paths: the rim left dark, the lit cells (lit from the right, the edge an ellipse as on the real moon), the dark side left. */
const PHASES = [0, 1, 2, 3, 4].map((p) => {
	const lit = p === 4 ? DISC.map(({ c }) => c) : DISC.filter(({ dx, w }) => dx > w * (1 - p / 2)).map(({ c }) => c);
	const on = new Set(lit);
	return { rim: relative(RIM.filter((c) => !on.has(c))), lit: relative(lit), dark: relative(DITHER.filter((c) => !on.has(c))) };
});
const WHOLE_RIM = relative(RIM);
const WHOLE_DARK = relative(DITHER);
const MID = relative([[4, 4]]);

/** A moon centred on (x, y) as filled paths, one per colour. */
export function moonPaths(f: Pick<FactProgress, "answers" | "inLessons">, x: number, y: number): { fill: string; d: string }[] {
	const at = `M${Math.round(x - MOON_HALF)} ${Math.round(y - MOON_HALF)}`;
	const latest = factMark(f);
	if (!latest) {
		const rim = unaskedColor(f);
		const out = [
			{ fill: rim, d: at + WHOLE_RIM },
			{ fill: DARK, d: at + WHOLE_DARK },
		];
		if (f.inLessons) out.push({ fill: rim, d: at + MID });
		return out;
	}
	const colour = latest === "right" ? "var(--foreground)" : PANEL_ANSWER_COLOR[latest];
	const phase = moonPhase(f);
	// Asked but not right of late: no light; the rim itself takes the latest answer's colour.
	if (phase === 0)
		return [
			{ fill: colour, d: at + WHOLE_RIM },
			{ fill: DARK, d: at + WHOLE_DARK },
		];
	const p = PHASES[phase]!;
	return [
		{ fill: RIM_ASKED, d: at + p.rim },
		{ fill: colour, d: at + p.lit },
		{ fill: DARK, d: at + p.dark },
	];
}
