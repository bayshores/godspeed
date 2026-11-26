/**
 * When the teacher's sound plays: a reply (a lesson's, a cheat sheet's or the teacher panel's chat's)
 * plays it only while godspeed isn't the front window, once for replies close together. Pure.
 */

/** Two replies this close together are one sound. */
export const DONE_GAP_MS = 2_000;

export function donePlays(i: { focused: boolean; lastAt: number | null; now: number }): boolean {
	if (i.lastAt !== null && i.now - i.lastAt < DONE_GAP_MS) return false;
	return !i.focused;
}
