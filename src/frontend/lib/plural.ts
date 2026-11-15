/** "1 file", "3 files"; `many` for a plural that isn't `one` + "s". */
export function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}
