/**
 * Outside agents cap each tool result: Codex keeps about 12k tokens and
 * drops the middle, and Claude Code moves text over 50k characters into a
 * file. A long work item therefore goes out in pages that each fit both.
 * Pages are measured in UTF-8 bytes, because Codex counts tokens from
 * bytes: a page of Chinese or Japanese text holds about a third as many
 * characters as an English one.
 */
export const WORK_PAGE_BYTES = 24_000;

/** Split text into pages of at most `maxBytes` of UTF-8. A page ends at a
 *  line break when one falls in its second half, and never inside a
 *  character. */
export function splitPages(text: string, maxBytes = WORK_PAGE_BYTES): string[] {
	const pages: string[] = [];
	let rest = text;
	for (let limit = fitting(rest, maxBytes); limit < rest.length; limit = fitting(rest, maxBytes)) {
		let cut = rest.lastIndexOf("\n", limit - 1) + 1;
		if (cut <= limit / 2) cut = limit;
		pages.push(rest.slice(0, cut));
		rest = rest.slice(cut);
	}
	pages.push(rest);
	return pages;
}

/** How many UTF-16 units from the start of `text` fit in `maxBytes` of UTF-8. */
function fitting(text: string, maxBytes: number): number {
	let bytes = 0;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		const pair = code >= 0xd800 && code <= 0xdbff && i + 1 < text.length;
		const size = code < 0x80 ? 1 : code < 0x800 ? 2 : pair ? 4 : 3;
		if (bytes + size > maxBytes) return i;
		bytes += size;
		if (pair) i++;
	}
	return text.length;
}
