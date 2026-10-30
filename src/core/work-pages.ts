/**
 * Outside agents cap each tool result: Codex keeps about 12k tokens and
 * drops the middle, and Claude Code moves text over 50k characters into a
 * file. A long work item therefore goes out in pages that each fit both.
 */
export const WORK_PAGE_CHARS = 24_000;

/** Split text into pages of at most `maxChars`. A page ends at a line
 *  break when one falls in its second half, and never between the two
 *  halves of a surrogate pair. */
export function splitPages(text: string, maxChars = WORK_PAGE_CHARS): string[] {
	const pages: string[] = [];
	let rest = text;
	while (rest.length > maxChars) {
		let cut = rest.lastIndexOf("\n", maxChars - 1) + 1;
		if (cut <= maxChars / 2) cut = maxChars;
		const code = rest.charCodeAt(cut - 1);
		if (code >= 0xd800 && code <= 0xdbff) cut--;
		pages.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	pages.push(rest);
	return pages;
}
