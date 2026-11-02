/**
 * Appearance → CSS variables. The background is the one chosen color;
 * panels, edges and text derive from it here. Where dark text reads better
 * the derived surfaces step darker instead of lighter, and the text takes a
 * hint of the background's color while staying readable (core/ink.ts), so
 * any color works.
 */

import { inkFor, inkReaches, readableAccent, resolveSettings, shiftHex, wantsDarkText, type AppearanceSettings, type EffectiveAppearance } from "@/core";

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
	{ name: "Paper", color: "#f4f1ea" },
	{ name: "White", color: "#ffffff" },
];

/** The stylesheet's background when none is chosen (Black). */
const DEFAULT_BACKGROUND = "#000000";

/** Bold/italic color presets that read well on each kind of background. */
export const INK_PRESETS = {
	dark: ["#f2c14e", "#7fb7ff", "#8bd3a0", "#f08a8a"],
	light: ["#b4541e", "#2f5fb3", "#2e7d4f", "#b3261e"],
} as const;

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

/** The surfaces a background implies. Light text: they step up (+8 panel,
 *  +20 tooltip, +22 tone, +39 a hovered row in a pop-up, +47 edge),
 *  matching the hand-picked default; dark text: they step down. */
function surfacesOf(background: string) {
	const step = wantsDarkText(background) ? -1 : 1;
	const at = (n: number) => shiftHex(background, n * step);
	return { card: at(8), tip: at(20), accent: at(22), tipHover: at(39), border: at(47) };
}

/** The palette a background implies. Text must read on the background and
 *  on every surface it sits on. */
export function derivedPalette(background: string): Record<string, string> {
	const light = wantsDarkText(background);
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
		"color-scheme": light ? "light" : "dark",
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
		"--lh-ink-max": light ? "#000000" : "#ffffff",
		...Object.fromEntries(status),
	};
}

/** A picked background moved lighter (or darker, under light text) in
 *  small steps until secondary text reads on every surface it implies.
 *  A mid color (#777777, #3366cc) can't otherwise hold readable text. */
export function readableBackground(color: string): string {
	const lighter = wantsDarkText(color);
	let background = color;
	for (;;) {
		const { card, accent, tipHover } = surfacesOf(background);
		if (inkReaches(background, "muted", [card, accent, tipHover])) return background;
		background = shiftHex(background, lighter ? 4 : -4);
	}
}

/** Resolved appearance → the CSS variables to set on <html>. Absent
 *  entries leave the stylesheet value in place. */
export function appearanceVars(a: EffectiveAppearance): Record<string, string> {
	const vars: Record<string, string> = {};
	// The palette follows a background text can read on (the saved choice stays as picked).
	const background = a.background === null ? DEFAULT_BACKGROUND : readableBackground(a.background);
	if (a.background !== null) Object.assign(vars, derivedPalette(background));
	if (a.fontFamily !== null) {
		vars["--font-prose"] = `"${a.fontFamily}", var(--font-sans3), ui-sans-serif, system-ui, sans-serif`;
	}
	// One reading-size variable: prose, inputs and lesson titles all read it.
	vars["--lh-prose-size"] = `${a.proseFontSize}px`;
	// Every title uses .font-title, so swapping the variable covers them all.
	if (!a.sessionNameSerif) vars["--font-title"] = "var(--font-prose)";
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
