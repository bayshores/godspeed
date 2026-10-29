/**
 * Appearance → CSS variables. The background is the one chosen color;
 * panels, edges and text derive from it here. A light background flips the
 * text to dark and the derived surfaces step darker instead of lighter, so
 * any color works.
 */

import { resolveSettings, type AppearanceSettings, type EffectiveAppearance } from "@/core";

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

/** Bold/italic color presets that read well on each kind of background. */
export const INK_PRESETS = {
	dark: ["#f2c14e", "#7fb7ff", "#8bd3a0", "#f08a8a"],
	light: ["#b4541e", "#2f5fb3", "#2e7d4f", "#b3261e"],
} as const;

function channels(hex: string): [number, number, number] {
	const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1, 7);
	return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Every channel moved by `delta`, clamped to 0..255. */
function shift(hex: string, delta: number): string {
	return `#${channels(hex).map((c) => Math.min(255, Math.max(0, c + delta)).toString(16).padStart(2, "0")).join("")}`;
}

/** True when dark text reads better than light text on this color. */
export function isLight(hex: string): boolean {
	const linear = (c: number) => {
		const s = c / 255;
		return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
	};
	const [r, g, b] = channels(hex);
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) > 0.4;
}

/** The palette a background implies. Dark: surfaces step up (+8 panel,
 *  +22 tone, +47 edge), matching the hand-picked default; light: they step
 *  down, and the text set flips to dark. */
export function derivedPalette(background: string): Record<string, string> {
	const light = isLight(background);
	const step = light ? -1 : 1;
	const card = shift(background, 8 * step);
	const accent = shift(background, 22 * step);
	const border = shift(background, 47 * step);
	const text = light
		? { fg: "#1a1a1a", muted: "#5f5f5f", quiet: "#7b7b7b", body: "#2b2b2b" }
		: { fg: "#e6e6e6", muted: "#8d8d8d", quiet: "#6e6e6e", body: "#cfcfcf" };
	return {
		"color-scheme": light ? "light" : "dark",
		"--background": background,
		"--card": card,
		"--popover": card,
		"--secondary": card,
		"--muted": card,
		"--accent": accent,
		"--lh-tip": shift(background, 20 * step),
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
	if (a.mdRendering.boldColor !== null) vars["--lh-ink-strong"] = a.mdRendering.boldColor;
	if (a.mdRendering.italicColor !== null) vars["--lh-ink-italic"] = a.mdRendering.italicColor;
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
