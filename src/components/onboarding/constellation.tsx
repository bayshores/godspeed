/**
 * The onboarding constellation (design: "Onboarding — pick an opening", row
 * D, and the setup screens' backdrop). One SVG drawn in a 1440×900 space
 * and cropped to the window. In the intro a comet streaks in from the
 * bottom-left and drops topic dots along its trail; they link up and light
 * red → green, then dim to a faint backdrop that stays behind every setup
 * step. Pure SVG + CSS animation (src/app/globals.css, "Onboarding"); with
 * reduced motion every element simply shows its final state.
 */

/** The confidence ramp, red → green (the app's only color). */
const RAMP = [
	"var(--color-ans-wrong)",
	"var(--color-conf-2)",
	"var(--color-conf-3)",
	"var(--color-conf-4)",
	"var(--color-ans-right)",
] as const;

/** Topic dots: center x, y, radius, ramp step (from the design). */
export const DOTS: readonly (readonly [number, number, number, number])[] = [
	[150, 820, 8, 0],
	[260, 700, 5.5, 2],
	[200, 600, 5.5, 4],
	[380, 640, 8, 1],
	[330, 520, 5.5, 3],
	[470, 560, 5.5, 0],
	[520, 440, 8, 2],
	[420, 400, 5.5, 4],
	[620, 470, 5.5, 1],
	[600, 330, 8, 3],
	[760, 380, 5.5, 0],
	[700, 250, 5.5, 2],
	[880, 300, 8, 4],
	[820, 520, 5.5, 1],
	[960, 420, 5.5, 3],
	[1080, 300, 8, 0],
	[1020, 560, 5.5, 2],
	[1200, 400, 5.5, 4],
	[1160, 220, 8, 1],
	[1300, 520, 5.5, 3],
];

/** Links between dots (indexes into DOTS). */
export const LINKS: readonly (readonly [number, number])[] = [
	[0, 1], [2, 1], [1, 3], [2, 4], [4, 3], [3, 5], [4, 7], [5, 6], [7, 6],
	[6, 8], [7, 9], [8, 10], [9, 10], [9, 11], [10, 12], [11, 12], [8, 13],
	[13, 14], [12, 14], [14, 15], [14, 16], [15, 17], [15, 18], [17, 19],
	[16, 19], [18, 17],
];

/** Where the comet enters and where it brakes (the intro's path). */
const START: readonly [number, number] = [130, 752];
const STOP: readonly [number, number] = [740, 400];

/** When a dot pops up (seconds into the intro): as the comet passes it on
 *  the way in, then — right of where it brakes — spreading outward. */
export function dotDelay(x: number): number {
	if (x <= STOP[0]) return 0.6 + 0.7 * Math.max(0, (x - START[0]) / (STOP[0] - START[0]));
	return 1.3 + 0.4 * Math.min(1, (x - STOP[0]) / (1300 - STOP[0]));
}

/** The comet's tail, from the app icon (build/icon.icon), head at 0,0. */
const TAIL = "M7.6,7.8 L-7.6,-7.8 Q-20.2,12.9 -37,36.3 Q-13.3,20 7.6,7.8 Z";

export type ConstellationMode = "intro" | "backdrop" | "bright" | "gone";

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
			<defs>
				<radialGradient id="ob-glow">
					<stop offset="0" stopColor="#fff" stopOpacity="0.16" />
					<stop offset="1" stopColor="#fff" stopOpacity="0" />
				</radialGradient>
				<linearGradient id="ob-tail" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="-37" y2="36">
					<stop offset="0" stopColor="#fff" stopOpacity="0.9" />
					<stop offset="1" stopColor="#fff" stopOpacity="0" />
				</linearGradient>
			</defs>
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
				{DOTS.map(([x, y, r, step], i) => (
					<circle
						key={i}
						className="ob-dot"
						cx={x}
						cy={y}
						r={r}
						style={{ fill: RAMP[step], "--d": `${dotDelay(x).toFixed(2)}s` } as React.CSSProperties}
					/>
				))}
			</g>
			<g className="ob-comet">
				<circle r="90" fill="url(#ob-glow)" />
				<path className="ob-tail" d={TAIL} fill="url(#ob-tail)" />
				<circle r="10.9" fill="#fff" />
			</g>
		</svg>
	);
}
