/**
 * The Graph slip's motion, pure: how long it takes to travel in and out, and
 * when each of its parts steps in.
 */

/** How a panel came: with the page (nothing moves), into an empty slip, or replacing another in an open slip. */
export type PanelMotion = "still" | "open" | "swap";

/** The shortest and longest travel each way, and the time each point of travel adds. */
const IN_MS = { shortest: 220, longest: 320, aPoint: 0.25 };
const OUT_MS = { shortest: 110, longest: 160, aPoint: 0.125 };

/** How long the slip takes to travel `points` in (as it arrives) or out (as it leaves). */
export function travelMs(points: number, way: "in" | "out"): number {
	const ms = way === "in" ? IN_MS : OUT_MS;
	return Math.round(Math.min(ms.longest, ms.shortest + Math.max(0, points) * ms.aPoint));
}

/** The last of a row of steps starts by this, so a long row does not trail. */
const LAST_BY_MS = 160;
/** Link chips and a topic's moons step in this far apart, left to right. */
export const CHIP_GAP_MS = 20;
export const MOON_GAP_MS = 15;
/** A replaced panel's blocks step in this far apart, top to bottom, as `.lh-set` does. */
const BLOCK_GAP_MS = 30;

/** When the `index`th of a row of steps starts, `gapMs` apart. */
export function stepDelay(index: number, gapMs: number): number {
	return Math.min(Math.max(0, index) * gapMs, LAST_BY_MS);
}

/** When a panel's `block`th block (from the top) steps in: only a panel that replaced another steps its blocks; null, it is simply there. */
export function blockDelay(motion: PanelMotion, block: number): number | null {
	return motion === "swap" ? block * BLOCK_GAP_MS : null;
}

/** When a row in a panel's `block`th block starts stepping in: with the panel as it arrives, or with its block as it replaces another; null, it is simply there. */
export function rowStart(motion: PanelMotion, block: number): number | null {
	return motion === "still" ? null : motion === "open" ? 0 : block * BLOCK_GAP_MS;
}

/** How many steps a group of `count` link chips takes with `shown` of them showing: its label, the chips, and the "N more" chip. */
export function chipSteps(count: number, shown: number): number {
	return count === 0 ? 0 : 1 + shown + (shown < count ? 1 : 0);
}
