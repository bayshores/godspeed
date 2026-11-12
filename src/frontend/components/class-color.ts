import type { ClassColor } from "@/shared/core";

/** The class colors by number, named for screen readers. */
export const CLASS_COLOR_NAMES: readonly string[] = ["Blue", "Plum", "Green", "Red", "Yellow", "Teal", "Olive", "Clay"];

/** The CSS color of a class color (dark text reads on every one). */
export function classColorVar(color: ClassColor): string {
	return `var(--lh-class-${color})`;
}

/** The class color washed pale, for a surface that carries dark text. */
export function paleClassColor(color: ClassColor): string {
	return `color-mix(in srgb, ${classColorVar(color)} 57%, var(--lh-class-wash))`;
}
