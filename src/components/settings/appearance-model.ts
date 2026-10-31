/**
 * Appearance → CSS variables. The background is the one chosen color;
 * panels, edges and text derive from it here. Where dark text reads better
 * the derived surfaces step darker instead of lighter, and the text takes a
 * hint of the background's color while staying readable (core/ink.ts), so
 * any color works.
 */

import { inkFor, readableAccent, resolveSettings, shiftHex, wantsDarkText, type AppearanceSettings, type EffectiveAppearance } from "@/core";

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

/** The palette a background implies. Light text: surfaces step up (+8
 *  panel, +22 tone, +47 edge), matching the hand-picked default; dark text:
 *  they step down. Text must read on the background and on its panels. */
export function derivedPalette(background: string): Record<string, string> {
	const light = wantsDarkText(background);
	const step = light ? -1 : 1;
	const card = shiftHex(background, 8 * step);
	const accent = shiftHex(background, 22 * step);
	const border = shiftHex(background, 47 * step);
	const panels = [card, accent];
	const text = {
		fg: inkFor(background, "text", panels),
		body: inkFor(background, "body", panels),
		muted: inkFor(background, "muted", panels),
		quiet: inkFor(background, "faint", panels),
	};
	return {
		"color-scheme": light ? "light" : "dark",
		"--background": background,
		"--card": card,
		"--popover": card,
		"--secondary": card,
		"--muted": card,
		"--accent": accent,
		"--lh-tip": shiftHex(background, 20 * step),
		"--border": border,
		"--input": border,
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
	};
}

/** Resolved appearance → the CSS variables to set on <html>. Absent
 *  entries leave the stylesheet value in place. */
export function appearanceVars(a: EffectiveAppearance): Record<string, string> {
	const vars: Record<string, string> = {};
	if (a.background !== null) Object.assign(vars, derivedPalette(a.background));
	if (a.fontFamily !== null) {
		vars["--font-prose"] = `"${a.fontFamily}", var(--font-sans3), ui-sans-serif, system-ui, sans-serif`;
	}
	// One reading-size variable: prose, inputs and lesson titles all read it.
	vars["--lh-prose-size"] = `${a.proseFontSize}px`;
	// Every title uses .font-title, so swapping the variable covers them all.
	if (!a.sessionNameSerif) vars["--font-title"] = "var(--font-prose)";
	vars["--lh-heading-weight"] = String(a.mdRendering.headingWeight);
	// A bold or italic color is kept readable on the background (the saved choice stays as picked).
	const background = a.background ?? DEFAULT_BACKGROUND;
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
