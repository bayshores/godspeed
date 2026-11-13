/**
 * Source marks (core/citations.ts): reading each kind of mark, leaving
 * look-alikes alone, the stored form, numbering and the plain-text readers.
 * Quoted marks are read in the shared cases (citations-quotes-golden.test.ts).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CITE_TAG, citeLabel, citesInWords, citeView, fileCiteMark, replaceCiteMarks, withoutCiteMarks, type CiteMark } from "../../src/shared/core/citations.ts";

const PASSAGE = "[[f_1a2b3c4d5e6f:7]]";
const FILE = "[[f_1a2b3c4d5e6f/p. 12/Week 6 slides.pdf]]";
const WEB = "[[https://example.com/page]]";

function marks(text: string): CiteMark[] {
	const found: CiteMark[] = [];
	replaceCiteMarks(text, (mark) => { found.push(mark); return ""; });
	return found;
}

describe("replaceCiteMarks reads each kind of mark", () => {
	it("reads a passage id, a stored file mark and a web address", () => {
		assert.deepEqual(marks(`A ${PASSAGE} B ${FILE} C ${WEB}`), [
			{ kind: "passage", passageId: "f_1a2b3c4d5e6f:7" },
			{ kind: "file", fileId: "f_1a2b3c4d5e6f", range: "p. 12", name: "Week 6 slides.pdf" },
			{ kind: "web", url: "https://example.com/page" },
		]);
	});

	it("puts what swap returns in place of the mark and keeps the rest", () => {
		assert.equal(replaceCiteMarks(`Sorting is n log n. ${PASSAGE} Done.`, () => "<X>"), "Sorting is n log n. <X> Done.");
	});

	it("a file name may hold slashes after the range", () => {
		assert.deepEqual(marks("[[f_1a2b3c4d5e6f/p. 3/a/b.pdf]]"), [{ kind: "file", fileId: "f_1a2b3c4d5e6f", range: "p. 3", name: "a/b.pdf" }]);
	});
});

describe("brackets that are not marks are left alone", () => {
	it("a matrix, a wiki link, a short id and a bad address stay as written", () => {
		for (const text of ["[[1,2],[3,4]]", "see [[note]]", "[[f_1a2b:7]]", "[[f_1a2b3c4d5e6f]]", "[[ftp://example.com/a]]", "[[https://]]", "[[https://a b]]"]) {
			assert.deepEqual(marks(text), [], text);
			assert.equal(replaceCiteMarks(text, () => "X"), text);
		}
	});

	it("a mark across a line break is not a mark", () => {
		assert.deepEqual(marks("[[f_1a2b3c4d5e6f:7\n]]"), []);
	});

	it("marks inside inline code, a code fence and math are not read", () => {
		assert.deepEqual(marks(`Write \`${PASSAGE}\` like this.`), []);
		assert.deepEqual(marks(`\`\`\`\n${PASSAGE}\n\`\`\``), []);
		assert.deepEqual(marks(`The set $${PASSAGE}$ is odd.`), []);
		assert.deepEqual(marks(`$$\n${PASSAGE}\n$$`), []);
		assert.deepEqual(marks(`Real one ${PASSAGE} and \`${WEB}\``), [{ kind: "passage", passageId: "f_1a2b3c4d5e6f:7" }]);
	});
});

describe("fileCiteMark is the stored form", () => {
	it("round-trips through the reader", () => {
		const mark = fileCiteMark("f_1a2b3c4d5e6f", "p. 12", "Week 6 slides.pdf");
		assert.equal(mark, FILE);
		assert.deepEqual(marks(mark), [{ kind: "file", fileId: "f_1a2b3c4d5e6f", range: "p. 12", name: "Week 6 slides.pdf" }]);
	});

	it("a file name with square brackets still reads back", () => {
		const mark = fileCiteMark("f_1a2b3c4d5e6f", "p. 2", "Notes [draft] [[v2]].pdf");
		const [read] = marks(mark);
		assert.equal(read?.kind, "file");
		assert.equal(citeView(`Yes. ${mark}`).cites.length, 1);
	});

	it("a file name with a dollar sign or a backtick can't open math or code around the mark", () => {
		for (const name of ["HW$2 notes.pdf", "week`3.pdf"]) {
			const view = citeView(`It frees memory. ${fileCiteMark("f_1a2b3c4d5e6f", "p. 3", name)} Then $x+1$ and \`free\`.`);
			assert.equal(view.cites.length, 1, name);
			assert.ok(!view.text.includes("[["), name);
		}
	});
});

describe("citeView", () => {
	it("turns each mark into a numbered tag, numbered by first appearance", () => {
		const view = citeView(`One ${WEB} two ${FILE} three.`);
		assert.equal(view.text, `One <${CITE_TAG} n="1"></${CITE_TAG}> two <${CITE_TAG} n="2"></${CITE_TAG}> three.`);
		assert.deepEqual(view.cites, [
			{ kind: "web", url: "https://example.com/page" },
			{ kind: "file", fileId: "f_1a2b3c4d5e6f", range: "p. 12", name: "Week 6 slides.pdf" },
		]);
	});

	it("reuses the number for the same source", () => {
		const view = citeView(`A ${FILE} B ${WEB} C ${FILE} D ${WEB}`);
		assert.equal(view.cites.length, 2);
		assert.deepEqual([...view.text.matchAll(/n="(\d)"/g)].map((m) => m[1]), ["1", "2", "1", "2"]);
	});

	it("the same file at another place is another source", () => {
		const view = citeView(`${FILE} [[f_1a2b3c4d5e6f/p. 13/Week 6 slides.pdf]]`);
		assert.equal(view.cites.length, 2);
	});

	it("marks of one place are one source, which keeps the first quote any of them has", () => {
		const at = (tail: string) => `[[f_1a2b3c4d5e6f/p. 14/Lecture 6.pdf${tail}]]`;
		const view = citeView(`A ${at("|degree 12")} B ${at("|15 training points")} C ${at("")}`);
		assert.deepEqual(view.cites, [{ kind: "file", fileId: "f_1a2b3c4d5e6f", range: "p. 14", name: "Lecture 6.pdf", quote: "degree 12" }]);
		assert.deepEqual([...view.text.matchAll(/n="(\d)"/g)].map((m) => m[1]), ["1", "1", "1"]);
		assert.equal(citeLabel(view.cites[0]!), "Lecture 6.pdf, p. 14");
		assert.deepEqual(citeView(`A ${at("")} B ${at("|degree 12")}`).cites, view.cites);
	});

	it("a passage id that was never checked shows nothing", () => {
		assert.deepEqual(citeView(`Claim. ${PASSAGE}`), { text: "Claim. ", cites: [] });
	});

	it("text without a mark comes back unchanged", () => {
		const text = "Plain $x^2$ and `code` and [[1,2],[3,4]].";
		assert.deepEqual(citeView(text), { text, cites: [] });
	});
});

describe("citeLabel", () => {
	it("a file reads as its name and place", () => {
		assert.equal(citeLabel({ kind: "file", fileId: "f_1a2b3c4d5e6f", range: "p. 12", name: "Week 6 slides.pdf" }), "Week 6 slides.pdf, p. 12");
	});

	it("a web page reads as its host and path, without www", () => {
		assert.equal(citeLabel({ kind: "web", url: "https://www.example.com/a/b" }), "example.com/a/b");
		assert.equal(citeLabel({ kind: "web", url: "https://example.com" }), "example.com");
		assert.equal(citeLabel({ kind: "web", url: "https://example.com/" }), "example.com");
		assert.equal(citeLabel({ kind: "web", url: "https://docs.example.com/guide" }), "docs.example.com/guide");
	});
});

describe("plain-text readers", () => {
	it("citesInWords writes a source in words and drops an unchecked id", () => {
		assert.equal(citesInWords(`A ${FILE} B ${WEB} C ${PASSAGE}`), "A  (Week 6 slides.pdf, p. 12) B  (https://example.com/page) C ");
	});

	it("withoutCiteMarks removes every mark", () => {
		assert.equal(withoutCiteMarks(`A ${FILE} B ${WEB} C ${PASSAGE}.`), "A  B  C .");
	});

	it("both leave text without a mark unchanged", () => {
		const text = "Nothing here, only [[1,2],[3,4]] and `[[x]]`.";
		assert.equal(citesInWords(text), text);
		assert.equal(withoutCiteMarks(text), text);
	});
});
