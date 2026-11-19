/**
 * The letters of a choice list and the message a problem's picks make. Pure.
 */

/** The letter a choice is shown with: A, B, C, ... */
export const choiceLetter = (index: number): string => String.fromCharCode(65 + index);

/** The picked letters in order, joined as words: "A", "A and C", "A, B and C". */
function pickedLetters(picked: ReadonlySet<number>): string {
	const letters = [...picked].sort((a, b) => a - b).map(choiceLetter);
	return letters.length < 2 ? (letters[0] ?? "") : `${letters.slice(0, -1).join(", ")} and ${letters.at(-1)}`;
}

/** What a problem's Send sends: the picks as a sentence, then a blank line and the work when there is any. */
export function problemMessage(picked: ReadonlySet<number>, work: string): string {
	const text = work.trim();
	if (picked.size === 0) return text;
	const sentence = `I picked ${pickedLetters(picked)}.`;
	return text ? `${sentence}\n\n${text}` : sentence;
}
