/** The color names a teacher's figure is drawn with, in the tool's order: ink, quiet ink, the one
 *  accent, and the sheet the figure lies on. */
export const FIGURE_COLORS = ["var(--ink)", "var(--soft)", "var(--accent)", "var(--paper)"] as const;

/** The figure with its color names as the theme's colors (`inks`, in the names' order), so it
 *  reads on any background. Null for a figure that names none: it brings its own colors and is
 *  drawn on white. */
export function themedFigure(svg: string, inks: readonly string[]): string | null {
	if (!FIGURE_COLORS.some((name) => svg.includes(name))) return null;
	return FIGURE_COLORS.reduce((out, name, i) => out.replaceAll(name, inks[i]!), svg);
}

/** A size the figure's root declares in px, or null when it declares none (%, em, "auto", missing). */
function rootPx(svg: string, side: "width" | "height"): number | null {
	const value = new RegExp(`<svg\\b[^>]*?\\s${side}\\s*=\\s*["']([^"']+)["'][^>]*>`, "i").exec(svg)?.[1]?.trim();
	const px = value === undefined ? null : /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value);
	const n = px ? Number.parseFloat(px[1]!) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** The size the figure is shown at: the width its root declares, with its height when it declares
 *  one, so the page keeps the figure's room before its image has loaded. Null when it declares no
 *  width, and the figure then takes the full width. */
export function figureSize(svg: string): { width: number; height: number | undefined } | null {
	const width = rootPx(svg, "width");
	return width === null ? null : { width, height: rootPx(svg, "height") ?? undefined };
}
