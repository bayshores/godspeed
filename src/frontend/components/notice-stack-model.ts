/** Which corner notices show. Pure. */

/** At most this many notices show at once; the rest wait their turn. */
const MAX_SHOWN = 3;

/**
 * Each notice's `data-notice`, in the stack's order, to whether it shows:
 * "first" ones (update, restart) before the rest, which keep their order,
 * and one "quiet" (space) notice at a time, so quiet spaces never fill
 * the stack.
 */
export function shownNotices(kinds: readonly (string | null)[]): boolean[] {
	const ranked = [...kinds.keys()].sort((a, b) => Number(kinds[b] === "first") - Number(kinds[a] === "first"));
	const shown = kinds.map(() => false);
	let count = 0;
	let quiet = false;
	for (const i of ranked) {
		if (count === MAX_SHOWN) break;
		if (kinds[i] === "quiet") {
			if (quiet) continue;
			quiet = true;
		}
		shown[i] = true;
		count++;
	}
	return shown;
}
