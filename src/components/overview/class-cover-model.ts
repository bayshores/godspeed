/**
 * The class cover's numbers (pure): how much of the signature is inked
 * and where the progress line's label sits.
 */

/** Share of the class's facts studied, 0–1 (0 with no facts). */
export function studiedShare(facts: { studied: number; total: number }): number {
	return facts.total > 0 ? Math.min(1, Math.max(0, facts.studied / facts.total)) : 0;
}

/** The progress label hangs left of the line's end, except near the start
 *  where it would run off the cover. */
export function labelHangsLeft(share: number): boolean {
	return share >= 0.15;
}
