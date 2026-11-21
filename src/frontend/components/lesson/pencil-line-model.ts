/**
 * The pencil's handwriting at the foot of the lesson text while the teacher works on a reply: a
 * line of made-up words as rows of a pixel grid. Pure.
 */

/** The line, one letter a character: "n" a short stroke, "l" one that reaches up, "g" one that reaches down. */
export const PENCIL_WORDS = ["nnnnn", "nnn", "lnnnlnn", "nl", "gngn", "nnnnn", "nln", "lnlln", "nnl", "nnnl"] as const;

/** The grid is nine rows high: strokes stand on row 6, tall ones start at row 0, deep ones end on row 8. */
const ROWS = 9;
const STROKE = { n: [3, 6], l: [0, 6], g: [3, 8] } as const;
/** Empty columns between two words. */
const WORD_GAP = 3;

/** The words as rows of a pixel grid ("#" is ink): each letter is a stroke and, inside a word, one pixel
 *  that joins it to the next, by turns at the stroke's foot and at its head. */
export function inkRows(words: readonly string[]): string[] {
	const columns: boolean[][] = [];
	const column = (from: number, to: number) => columns.push(Array.from({ length: ROWS }, (_, row) => row >= from && row <= to));
	words.forEach((word, w) => {
		if (w > 0) for (let gap = 0; gap < WORD_GAP; gap++) column(1, 0);
		[...word].forEach((letter, i) => {
			const [from, to] = STROKE[letter as keyof typeof STROKE] ?? STROKE.n;
			column(from, to);
			if (i < word.length - 1) column(i % 2 ? 3 : 6, i % 2 ? 3 : 6);
		});
	});
	return Array.from({ length: ROWS }, (_, row) => columns.map((cells) => (cells[row] ? "#" : ".")).join(""));
}

/** How many steps the pencil takes along a line this many columns wide: one for every three columns. */
export function pencilSteps(columns: number): number {
	return Math.max(1, Math.round(columns / 3));
}
