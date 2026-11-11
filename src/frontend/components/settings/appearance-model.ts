/**
 * Appearance → CSS variables. The background is the one chosen color;
 * panels, edges, text and the accent tint derive from it here. Paper, the
 * default, is the one light background and is hand-picked. Any other pick
 * is dark: a light one is made dark first, and the text takes a hint of
 * the background's color while staying readable (core/ink.ts).
 */

import { darkBackground, inkFor, readableAccent, resolveSettings, shiftHex, tintFor, type AppearanceSettings, type EffectiveAppearance } from "@/shared/core";

/** The resolved appearance (delta over factory), through the core resolver. */
export function resolveAppearance(delta: AppearanceSettings | undefined): EffectiveAppearance {
	return resolveSettings(delta === undefined ? null : { version: 1, appearance: delta }).appearance;
}

/** Paper, the stylesheet's background when none is chosen. */
export const PAPER = "#c9c7bd";

/** The background presets. Paper is the factory (stored as null). */
export const BACKGROUND_PRESETS: ReadonlyArray<{ name: string; color: string | null }> = [
	{ name: "Paper", color: null },
	{ name: "Night", color: "#1b1b19" },
	{ name: "Black", color: "#000000" },
	{ name: "Graphite", color: "#161616" },
	{ name: "Midnight", color: "#0d1320" },
	{ name: "Forest", color: "#0e1712" },
];

/** Bold/italic color presets; each is kept readable on the background. */
export const INK_PRESETS: readonly string[] = ["#f2c14e", "#7fb7ff", "#8bd3a0", "#f08a8a"];

/** The app's status colors (right, wrong, delete, the confidence and topic
 *  ramps) before a palette adjusts them. Every palette keeps each one
 *  readable as text on its background and panels, so a fill of one carries
 *  text-background. */
const STATUS_COLORS: Record<string, string> = {
	"--lh-ans-right": "#6f9a7e",
	"--lh-ans-wrong": "#b3665c",
	"--destructive": "#b3665c",
	"--lh-conf-1": "#b3665c",
	"--lh-conf-2": "#c0875a",
	"--lh-conf-3": "#c2aa5c",
	"--lh-conf-4": "#8e9467",
	"--lh-conf-5": "#6f9a7e",
	"--lh-ramp-1": "#b3665c",
	"--lh-ramp-2": "#c0875a",
	"--lh-ramp-3": "#c2aa5c",
	"--lh-ramp-4": "#8e9467",
	"--lh-ramp-5": "#6f9a7e",
};

/** The surfaces and text a background implies. Dark: +8 panel, +20
 *  tooltip, +22 tone, +39 a hovered row in a pop-up, +47 edge, a top bar
 *  12 below, text by contrast. Paper: picked by hand, with an ink top bar. */
function surfacesOf(background: string) {
	if (background === PAPER) {
		return {
			card: "#d7d5cb",
			tip: "#dddbd1",
			accent: "#cfcdc3",
			tipHover: "#cfcdc3",
			border: "#a9a79d",
			edge: "#6d6b62",
			bar: "#24231f",
			barInk: "#d7d5cb",
			highlight: "#d8cb8e",
			fg: "#24231f",
			body: "#33322c",
			muted: "#4f4d45",
			quiet: "#535149",
			max: "#000000",
			tint: "#24231f",
			line: "#24231f",
			wash: "#ffffff",
		};
	}
	const at = (n: number) => shiftHex(background, n);
	const [card, accent, tipHover] = [at(8), at(22), at(39)];
	const panels = [card, accent, tipHover];
	const fg = inkFor(background, "text", panels);
	const quiet = inkFor(background, "faint", [card, accent]);
	return {
		card,
		tip: at(20),
		accent,
		tipHover,
		border: at(47),
		edge: inkFor(background, "edge", [card]),
		bar: at(-12),
		barInk: fg,
		highlight: "#5a5332",
		fg,
		body: inkFor(background, "body", panels),
		muted: inkFor(background, "muted", panels),
		quiet,
		max: "#ffffff",
		tint: tintFor(background),
		line: quiet,
		wash: "#000000",
	};
}

/** The palette a background implies. Text must read on the background and
 *  on every surface it sits on. */
export function derivedPalette(background: string): Record<string, string> {
	const s = surfacesOf(background);
	const status = Object.entries(STATUS_COLORS).map(([name, color]) => [name, readableAccent(color, background, [s.card, s.accent])]);
	return {
		"--background": background,
		"--card": s.card,
		"--popover": s.card,
		"--secondary": s.card,
		"--muted": s.card,
		"--accent": s.accent,
		"--lh-tip": s.tip,
		"--lh-tip-hover": s.tipHover,
		"--border": s.border,
		"--input": s.border,
		"--lh-edge": s.edge,
		"--lh-bar": s.bar,
		"--lh-bar-ink": s.barInk,
		"--lh-highlight": s.highlight,
		"--foreground": s.fg,
		"--card-foreground": s.fg,
		"--popover-foreground": s.fg,
		"--secondary-foreground": s.fg,
		"--accent-foreground": s.fg,
		"--primary": s.fg,
		"--primary-foreground": background,
		"--muted-foreground": s.muted,
		"--ring": s.muted,
		"--lh-ink-3": s.quiet,
		"--lh-ink-body": s.body,
		"--lh-ink-max": s.max,
		"--lh-tint": s.tint,
		"--lh-line": s.line,
		"--lh-class-wash": s.wash,
		...Object.fromEntries(status),
	};
}

/** A picked background made dark enough that secondary text reads on
 *  every surface it implies (a light or mid color like #f4f1ea or #777777
 *  can't hold the app's light text). */
export function readableBackground(color: string): string {
	return darkBackground(color, (b) => [shiftHex(b, 8), shiftHex(b, 22), shiftHex(b, 39)]);
}

/** Resolved appearance → the CSS variables to set on <html>. Absent
 *  entries leave the stylesheet value in place. */
export function appearanceVars(a: EffectiveAppearance): Record<string, string> {
	const vars: Record<string, string> = {};
	// The palette follows a background text can read on (the saved choice stays as picked).
	const background = a.background === null ? PAPER : readableBackground(a.background);
	if (a.background !== null) Object.assign(vars, derivedPalette(background));
	if (a.fontFamily !== null) {
		vars["--font-prose"] = `"${a.fontFamily}", var(--font-literata), Georgia, serif`;
	}
	// One reading-size variable: prose, inputs and lesson titles all read it.
	vars["--lh-prose-size"] = `${a.proseFontSize}px`;
	vars["--lh-heading-weight"] = String(a.mdRendering.headingWeight);
	// A bold or italic color is kept readable on the background (the saved choice stays as picked).
	if (a.mdRendering.boldColor !== null) vars["--lh-ink-strong"] = readableAccent(a.mdRendering.boldColor, background);
	if (a.mdRendering.italicColor !== null) vars["--lh-ink-italic"] = readableAccent(a.mdRendering.italicColor, background);
	return vars;
}

/** Names applied before but absent now: removed so the stylesheet value
 *  returns (a reset or a toggle back would otherwise stick). */
export function staleVarNames(prevNames: readonly string[], nextVars: Record<string, string>): string[] {
	return prevNames.filter((n) => !(n in nextVars));
}

/** Heading weights the slider steps through, with their names. */
export const HEADING_WEIGHTS: ReadonlyArray<{ weight: number; name: string }> = [
	{ weight: 400, name: "Regular" },
	{ weight: 500, name: "Medium" },
	{ weight: 600, name: "Semibold" },
	{ weight: 700, name: "Bold" },
	{ weight: 800, name: "Extra bold" },
	{ weight: 900, name: "Black" },
];
