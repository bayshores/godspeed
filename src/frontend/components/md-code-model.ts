/** Whether a code block numbers its own lines ("1. if n == 0:"), as class
 *  pseudocode often does. Then the gutter's numbers would disagree with the
 *  ones the teacher cites, so the block shows none. Pure. */
export function numbersOwnLines(source: string): boolean {
	const lines = source.split("\n").filter((l) => l.trim() !== "");
	const numbers = lines.flatMap((l) => {
		const m = /^\s*(\d+)[.):]\s/.exec(l);
		return m ? [Number(m[1])] : [];
	});
	return numbers.length >= 2 && numbers.length * 2 >= lines.length && numbers.every((n, i) => i === 0 || n > numbers[i - 1]!);
}
