/**
 * Source marks in teacher text. The teacher writes `[[<passage id>]]` or
 * `[[<web address>]]` after a sentence. The server checks each mark and
 * keeps a class file's as `[[<file id>/<place>/<file name>]]`, which still
 * points at the right place after the file's passages are renumbered.
 */
import { readContentSpans } from "./content-reader.ts";

/** A checked source: a place in a class file, or a web page. */
export type Cite = { kind: "file"; fileId: string; range: string; name: string } | { kind: "web"; url: string };

/** A mark as written: a passage id still to be checked, or a source. */
export type CiteMark = { kind: "passage"; passageId: string } | Cite;

/** The tag a mark becomes on its way into the Markdown renderer. */
export const CITE_TAG = "lh-cite";

const MARK = /\[\[([^[\]\n]{1,400})\]\]/g;
const PASSAGE = /^f_[0-9a-f]{12}:\d+$/;
const FILE = /^(f_[0-9a-f]{12})\/([^/]+)\/(.+)$/;

function readMark(body: string): CiteMark | null {
	if (PASSAGE.test(body)) return { kind: "passage", passageId: body };
	const file = FILE.exec(body);
	if (file) return { kind: "file", fileId: file[1]!, range: file[2]!, name: file[3]! };
	if (/^https?:\/\/\S+$/.test(body) && URL.canParse(body)) return { kind: "web", url: body };
	return null;
}

/** A class file's source as the mark that is stored. Characters in the
 *  name that would end the mark or open code or math become spaces. */
export function fileCiteMark(fileId: string, range: string, name: string): string {
	return `[[${fileId}/${range}/${name.replace(/[[\]\n`$]/g, " ")}]]`;
}

/** The text with each source mark swapped for what `swap` returns. Code and
 *  math are left alone, and so is anything in brackets that isn't a mark. */
export function replaceCiteMarks(text: string, swap: (mark: CiteMark) => string): string {
	if (!text.includes("[[")) return text;
	return readContentSpans(text)
		.map((span) => (span.kind === "prose" ? span.raw.replace(MARK, (raw, body: string) => { const mark = readMark(body); return mark ? swap(mark) : raw; }) : span.raw))
		.join("");
}

const sameCite = (a: Cite, b: Cite) =>
	a.kind === "file" ? b.kind === "file" && a.fileId === b.fileId && a.range === b.range : b.kind === "web" && a.url === b.url;

/** Teacher text ready to render: each mark is a numbered tag, and `cites`
 *  lists the sources in the order they first appear (tag n is cites[n-1]).
 *  A passage id that was never checked shows nothing. */
export function citeView(text: string): { text: string; cites: Cite[] } {
	const cites: Cite[] = [];
	const shown = replaceCiteMarks(text, (mark) => {
		if (mark.kind === "passage") return "";
		let at = cites.findIndex((c) => sameCite(c, mark));
		if (at < 0) at = cites.push(mark) - 1;
		return `<${CITE_TAG} n="${at + 1}"></${CITE_TAG}>`;
	});
	return { text: shown, cites };
}

/** How a source reads in a line of text: "Week 6 slides.pdf, p. 12". */
export function citeLabel(cite: Cite): string {
	if (cite.kind === "file") return `${cite.name}, ${cite.range}`;
	const url = new URL(cite.url);
	return `${url.host.replace(/^www\./, "")}${url.pathname === "/" ? "" : url.pathname}`;
}

/** The text with each mark written out in words, for readers that show
 *  plain text (the Markdown export, fact extraction). */
export function citesInWords(text: string): string {
	return replaceCiteMarks(text, (mark) => (mark.kind === "passage" ? "" : ` (${mark.kind === "file" ? citeLabel(mark) : mark.url})`));
}

/** The text with every mark taken out, for places a mark can't show. */
export function withoutCiteMarks(text: string): string {
	return replaceCiteMarks(text, () => "");
}
