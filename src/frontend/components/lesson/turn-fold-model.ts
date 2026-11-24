/**
 * The open problem folded where it is pinned over the lesson text: a long problem would leave
 * the teacher's reply a sliver, so it shows its first lines until the learner asks for all of
 * it. Pure.
 */

/** Three lines of a problem's text: the least a folded problem keeps. */
const FOLD_MIN = 96;

/** Whether the problem is folded: as the learner chose for this problem, else once he has sent
 *  something, because a reply is coming. A new problem is whole, to be read. */
export function problemFolded(sent: boolean, whole: boolean | null): boolean {
	return whole === null ? sent : !whole;
}

/** The height a folded problem gets: half of what is left of the room under the step line, so
 *  the text's window gets the other half. `rest` is all that stands in that room beside the
 *  window and the problem (the pin's keys and padding, the writing row). */
export function foldRoom(room: number, rest: number): number {
	return Math.max(FOLD_MIN, Math.floor((room - rest) / 2));
}
