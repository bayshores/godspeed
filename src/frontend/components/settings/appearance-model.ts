/**
 * Appearance → CSS variables. The background is the one chosen color;
 * panels, edges, text and the accent tint derive from it here. The app is
 * dark only: a light pick is made dark first, and the text takes a hint of
 * the background's color while staying readable (core/ink.ts), so any
 * color works.
 */

import { darkBackground, inkFor, readableAccent, resolveSettings, shiftHex, tintFor, type AppearanceSettings, type EffectiveAppearance } from "@/shared/core";

/** The resolved appearance (delta over factory), through the core resolver. */
export function resolveAppearance(delta: AppearanceSettings | undefined): EffectiveAppearance {
	return resolveSettings(delta === undefined ? null : { version: 1, appearance: delta }).appearance;
}

/** The background presets. Black is the factory (stored as null). */
export const BACKGROUND_PRESETS: ReadonlyArray<{ name: string; color: string | null }> = [
	{ name: "Black", color: null },
	{ name: "Graphite", color: "#161616" },
	{ name: "Midnight", color: "#0d1320" },
	{ name: "Forest", color: "#0e1712" },
];

/** The stylesheet's background when none is chosen (Black). */
const DEFAULT_BACKGROUND = "#000000";

/** Bold/italic color presets that read well on the dark backgrounds. */
export const INK_PRESETS: readonly string[] = ["#f2c14e", "#7fb7ff", "#8bd3a0", "#f08a8a"];

/** The app's only colors (right, wrong, delete, the confidence and topic
 *  ramps) as drawn on black. Every palette keeps each one readable as text
 *  on its background and panels, so a fill of one carries text-background. */
const STATUS_COLORS: Record<string, string> = {
	"--lh-ans-right": "#10b981",
	"--lh-ans-wrong": "#ef4444",
	"--destructive": "#ff6467",
	"--lh-conf-1": "#ef4444",
	"--lh-conf-2": "#f97316",
	"--lh-conf-3": "#eab308",
	"--lh-conf-4": "#84cc16",
	"--lh-conf-5": "#10b981",
	"--lh-ramp-1": "#f2545b",
	"--lh-ramp-2": "#f59e4c",
	"--lh-ramp-3": "#e8c547",
	"--lh-ramp-4": "#9bd35a",
	"--lh-ramp-5": "#3dd68c",
};

/** The surfaces a background implies: +8 panel, +20 tooltip, +22 tone,
 *  +39 a hovered row in a pop-up, +47 edge, matching the hand-picked
 *  default. */
function surfacesOf(background: string) {
	const at = (n: number) => shiftHex(background, n);
	return { card: at(8), tip: at(20), accent: at(22), tipHover: at(39), border: at(47) };
}

/** The palette a background implies. Text must read on the background and
 *  on every surface it sits on. */
export function derivedPalette(background: string): Record<string, string> {
	const { card, tip, accent, tipHover, border } = surfacesOf(background);
	const panels = [card, accent, tipHover];
	const text = {
		fg: inkFor(background, "text", panels),
		body: inkFor(background, "body", panels),
		muted: inkFor(background, "muted", panels),
		quiet: inkFor(background, "faint", [card, accent]),
	};
	const status = Object.entries(STATUS_COLORS).map(([name, color]) => [name, readableAccent(color, background, [card, accent])]);
	return {
		"--background": background,
		"--card": card,
		"--popover": card,
		"--secondary": card,
		"--muted": card,
		"--accent": accent,
		"--lh-tip": tip,
		"--lh-tip-hover": tipHover,
		"--border": border,
		"--input": border,
		"--lh-edge": inkFor(background, "edge", [card]),
		"--foreground": text.fg,
		"--card-foreground": text.fg,
		"--popover-foreground": text.fg,
		"--secondary-foreground": text.fg,
		"--accent-foreground": text.fg,
		"--primary": text.fg,
		"--primary-foreground": background,
		"--muted-foreground": text.muted,
		"--ring": text.muted,
		"--lh-ink-3": text.quiet,
		"--lh-ink-body": text.body,
		"--lh-tint": tintFor(background),
		...Object.fromEntries(status),
	};
}

/** A picked background made dark enough that secondary text reads on
 *  every surface it implies (a light or mid color like #f4f1ea or #777777
 *  can't hold the app's light text). */
export function readableBackground(color: string): string {
	return darkBackground(color, (b) => {
		const { card, accent, tipHover } = surfacesOf(b);
		return [card, accent, tipHover];
	});
}

/** Resolved appearance → the CSS variables to set on <html>. Absent
 *  entries leave the stylesheet value in place. */
export function appearanceVars(a: EffectiveAppearance): Record<string, string> {
	const vars: Record<string, string> = {};
	// The palette follows a background text can read on (the saved choice stays as picked).
	const background = a.background === null ? DEFAULT_BACKGROUND : readableBackground(a.background);
	if (a.background !== null) Object.assign(vars, derivedPalette(background));
	if (a.fontFamily !== null) {
		vars["--font-prose"] = `"${a.fontFamily}", var(--font-atkinson), ui-monospace, monospace`;
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
