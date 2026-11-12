import type { SpaceColor } from "@/shared/core";

/** The space colors by number, named for screen readers. */
export const SPACE_COLOR_NAMES: readonly string[] = ["Blue", "Plum", "Green", "Red", "Yellow", "Teal", "Olive", "Clay"];

/** The CSS color of a space color (dark text reads on every one). */
export function spaceColorVar(color: SpaceColor): string {
	return `var(--lh-space-${color})`;
}

/** The space color washed pale, for a surface that carries dark text. */
export function paleSpaceColor(color: SpaceColor): string {
	return `color-mix(in srgb, ${spaceColorVar(color)} 57%, var(--lh-space-wash))`;
}
