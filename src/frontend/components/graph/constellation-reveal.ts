/**
 * When each part of the Graph picture inks in as the tab opens: clusters
 * left to right as laid out, a cluster's rim a beat after its core, a line
 * once both its ends are in. The same length for any number of topics.
 */
import type { Seg, Sky } from "./constellation-layout.ts";

/** From the leftmost cluster to the rightmost, in ms. */
const SWEEP = 420;
/** A cluster's rim after its core, and its name after its core. */
export const RIM_AFTER = 70;
export const NAME_AFTER = 40;
/** A line starts this long after the later of its two ends. */
const LINE_AFTER = 200;
/** A line's draw: .lh-reveal-line in globals.css. */
const LINE_DRAW = 240;
/** Room for a late frame before the reveal's classes come off, so no line is cut short. */
const SLACK = 40;
/** The whole reveal: the rightmost cluster's lines are the last to finish. */
export const REVEAL_MS = SWEEP + LINE_AFTER + LINE_DRAW + SLACK;

/** One opening's reveal: when it started, and each topic's start, set by
 *  the first picture drawn and kept, so a re-fit or a remount never moves an
 *  animation already running or replays one already in. */
export interface Reveal {
	start: number;
	at: Map<string, number> | null;
}

/** Each topic's start, by its cluster's place from left to right. */
function clusterDelays(sky: Sky): Map<string, number> {
	const xs = sky.clusters.map((k) => k.cx);
	const x0 = Math.min(...xs);
	const span = Math.max(1, Math.max(...xs) - x0);
	return new Map(sky.clusters.map((k) => [k.topic.id, Math.round(((k.cx - x0) / span) * SWEEP)]));
}

/** The opening's topic starts, taken from `sky` the first time only. */
export function frozenDelays(reveal: Reveal, sky: Sky): Map<string, number> {
	reveal.at ??= clusterDelays(sky);
	return reveal.at;
}

export function lineDelay(g: Seg, delays: ReadonlyMap<string, number>): number {
	return Math.max(delays.get(g.from) ?? 0, delays.get(g.to) ?? 0) + LINE_AFTER;
}
