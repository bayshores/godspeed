import type { SpaceColor } from "@/shared/core";

/** The space colors by number, named for screen readers. */
export const SPACE_COLOR_NAMES: readonly string[] = ["Blue", "Plum", "Green", "Red", "Yellow", "Teal", "Olive", "Clay"];

/** The CSS color of a space color (dark text reads on every one). */
export function spaceColorVar(color: SpaceColor): string {
	return `var(--lh-space-${color})`;
}

/** A deadline's block color: its space's; grey for a space that has gone. */
export function blockColor(color: SpaceColor | undefined): string {
	return color ? spaceColorVar(color) : "var(--border)";
}

/** The space color as a line on the page (the dashes of a deadline that looks missing), mixed
 *  toward the ink as far as the background needs (--lh-space-line-mix). */
export function spaceLineColor(color: SpaceColor): string {
	return `color-mix(in srgb, ${spaceColorVar(color)} var(--lh-space-line-mix), var(--foreground))`;
}

/** The space color washed pale, for a surface that carries dark text. */
export function paleSpaceColor(color: SpaceColor): string {
	return `color-mix(in srgb, ${spaceColorVar(color)} 57%, var(--lh-space-wash))`;
}
