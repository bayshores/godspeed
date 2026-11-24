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

/** The width the figure's root declares in px, the size it is shown at; null when it declares
 *  none (%, em, "auto", missing), and the figure then takes the full width. */
export function figureWidth(svg: string): number | null {
	const value = /<svg\b[^>]*?\bwidth\s*=\s*["']([^"']+)["'][^>]*>/i.exec(svg)?.[1]?.trim();
	const px = value === undefined ? null : /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value);
	const n = px ? Number.parseFloat(px[1]!) : Number.NaN;
	return Number.isFinite(n) && n > 0 ? n : null;
}
