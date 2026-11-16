/**
 * When the teacher's sound plays: only while the learner looks away. A
 * lesson's or cheat sheet's reply plays it while godspeed isn't the front
 * window; the teacher finishing a terminal answer, or stopping to ask the
 * learner something, also while its terminal is closed. Pure.
 */

export type DoneMoment = "reply" | "terminal";

/** Two moments this close together are one sound. */
export const DONE_GAP_MS = 2_000;

export function donePlays(i: { moment: DoneMoment; focused: boolean; panelOpen: boolean; lastAt: number | null; now: number }): boolean {
	if (i.lastAt !== null && i.now - i.lastAt < DONE_GAP_MS) return false;
	return !i.focused || (i.moment === "terminal" && !i.panelOpen);
}
