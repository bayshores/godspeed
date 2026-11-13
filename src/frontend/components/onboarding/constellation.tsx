/**
 * The onboarding constellation: the intro and the setup screens'
 * backdrop. One SVG drawn in a 1440×900 space and cropped to the window.
 * Under it all, a faint dot grid. In the intro and on the welcome screen
 * topic dots appear from the bottom-left outward and link up, then dim to
 * a faint backdrop that stays behind every setup step. Pure SVG + CSS animation (src/frontend/globals.css,
 * "Onboarding"); with reduced motion every element simply shows its final
 * state.
 */

/** Topic dots: center x, y, side of the square. */
const DOTS: readonly (readonly [number, number, number])[] = [
	[150, 820, 8],
	[260, 700, 5.5],
	[200, 600, 5.5],
	[380, 640, 8],
	[330, 520, 5.5],
	[470, 560, 5.5],
	[520, 440, 8],
	[420, 400, 5.5],
	[620, 470, 5.5],
	[600, 330, 8],
	[760, 380, 5.5],
	[700, 250, 5.5],
	[880, 300, 8],
	[820, 520, 5.5],
	[960, 420, 5.5],
	[1080, 300, 8],
	[1020, 560, 5.5],
	[1200, 400, 5.5],
	[1160, 220, 8],
	[1300, 520, 5.5],
];

/** Links between dots (indexes into DOTS). */
const LINKS: readonly (readonly [number, number])[] = [
	[0, 1], [2, 1], [1, 3], [2, 4], [4, 3], [3, 5], [4, 7], [5, 6], [7, 6],
	[6, 8], [7, 9], [8, 10], [9, 10], [9, 11], [10, 12], [11, 12], [8, 13],
	[13, 14], [12, 14], [14, 15], [14, 16], [15, 17], [15, 18], [17, 19],
	[16, 19], [18, 17],
];

/** Where the dots start and the middle of the sky. */
const START: readonly [number, number] = [130, 752];
const STOP: readonly [number, number] = [740, 400];

/** When a dot pops up (seconds into the intro): left to right up to the
 *  middle, then faster outward. */
function dotDelay(x: number): number {
	if (x <= STOP[0]) return 0.6 + 0.7 * Math.max(0, (x - START[0]) / (STOP[0] - START[0]));
	return 1.3 + 0.4 * Math.min(1, (x - STOP[0]) / (1300 - STOP[0]));
}

export type ConstellationMode = "intro" | "welcome" | "backdrop" | "bright" | "gone";

export function Constellation({ mode }: { mode: ConstellationMode }) {
	return (
		<svg
			aria-hidden
			data-testid="onboarding-constellation"
			data-mode={mode}
			className="ob-sky pointer-events-none absolute inset-0 size-full"
			viewBox="0 0 1440 900"
			preserveAspectRatio="xMidYMid slice"
		>
			<g className="ob-stars">
				{LINKS.map(([a, b]) => {
					const [ax, ay] = DOTS[a]!;
					const [bx, by] = DOTS[b]!;
					const delay = Math.max(dotDelay(ax), dotDelay(bx)) + 0.15;
					return (
						<line
							key={`${a}-${b}`}
							className="ob-link"
							x1={ax}
							y1={ay}
							x2={bx}
							y2={by}
							pathLength={1}
							style={{ "--d": `${delay.toFixed(2)}s` } as React.CSSProperties}
						/>
					);
				})}
				{DOTS.map(([x, y, size], i) => (
					<rect
						key={i}
						className="ob-dot fill-ink-2"
						x={x - size / 2}
						y={y - size / 2}
						width={size}
						height={size}
						style={{ "--d": `${dotDelay(x).toFixed(2)}s` } as React.CSSProperties}
					/>
				))}
			</g>
		</svg>
	);
}
