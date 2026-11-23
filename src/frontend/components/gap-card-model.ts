/** Which gap's card shows, on which page. Pure. */
import { isRhythmGap, type SpaceGap } from "@/shared/core";

/** The Deadlines tab of the active space. */
const DEADLINES_TAB = /^\/space\/deadlines\/?$/;

/**
 * The one gap whose card shows now: the first of `gaps` whose space is in `known`, that the
 * learner has not sent to the teacher already (`updated`, by key), and that this page does not
 * draw itself. A rhythm gap is an outline on Home's week and on its own space's Deadlines tab, so
 * it has no card there; any other gap shows on every page.
 */
export function gapToShow(gaps: readonly SpaceGap[], page: { pathname: string; active: string | null }, known: ReadonlySet<string>, updated: ReadonlySet<string>): SpaceGap | null {
	const drawnHere = (g: SpaceGap) => isRhythmGap(g) && (page.pathname === "/" || (DEADLINES_TAB.test(page.pathname) && g.spaceId === page.active));
	return gaps.find((g) => known.has(g.spaceId) && !updated.has(g.key) && !drawnHere(g)) ?? null;
}
