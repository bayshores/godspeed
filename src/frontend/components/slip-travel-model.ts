/**
 * A slip's travel, pure: how long a sheet takes to rise in from past its room's foot and to leave
 * the same way (the Graph's panel, Follow's slip at the page's foot).
 */

/** The shortest and longest travel each way, and the time each point of travel adds. */
const IN_MS = { shortest: 220, longest: 320, aPoint: 0.25 };
const OUT_MS = { shortest: 110, longest: 160, aPoint: 0.125 };

/** How long a slip takes to travel `points` in (as it arrives) or out (as it leaves). */
export function travelMs(points: number, way: "in" | "out"): number {
	const ms = way === "in" ? IN_MS : OUT_MS;
	return Math.round(Math.min(ms.longest, ms.shortest + Math.max(0, points) * ms.aPoint));
}
