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
	for (let at = cutAt(rest, maxBytes); at < rest.length; at = cutAt(rest, maxBytes)) {
		pages.push(rest.slice(0, at));
		rest = rest.slice(at);
	}
	pages.push(rest);
	return pages;
}

/** Pack text blocks into pages of at most `maxBytes` of UTF-8 in all. A
 *  block too long for what is left of a page fills it when at least half a
 *  page is left, and goes on on the next pages, cut as splitPages cuts. */
export function pageBlocks(blocks: readonly string[], maxBytes = WORK_PAGE_BYTES): string[][] {
	const pages: string[][] = [];
	let page: string[] = [];
	let room = maxBytes;
	for (const block of blocks) {
		let rest = block;
		for (;;) {
			const at = cutAt(rest, room);
			if (at === rest.length) {
				page.push(rest);
				room -= Buffer.byteLength(rest, "utf8");
				break;
			}
			if (page.length === 0 || room >= maxBytes / 2) {
				page.push(rest.slice(0, at));
				rest = rest.slice(at);
			}
			pages.push(page);
			page = [];
			room = maxBytes;
		}
	}
	pages.push(page);
	return pages;
}

/** Where a page of `text` ends: all of it when it fits, else at a line
 *  break in the page's second half, else at the limit. */
function cutAt(text: string, maxBytes: number): number {
	const limit = fitting(text, maxBytes);
	if (limit >= text.length) return text.length;
	const cut = text.lastIndexOf("\n", limit - 1) + 1;
	return cut <= limit / 2 ? limit : cut;
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
