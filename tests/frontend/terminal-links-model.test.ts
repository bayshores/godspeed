import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lineText, screenLinks, type LinkFile } from "../../src/frontend/components/terminal/terminal-links-model.ts";

const NOTES: LinkFile = { id: "f_0123456789ab", name: "notes.pdf", spaceId: "spc_a" };
const WEEK: LinkFile = { id: "f_aaaaaaaaaaaa", name: "week 3 notes.pdf", spaceId: "spc_a" };
const README: LinkFile = { id: "f_bbbbbbbbbbbb", name: "README", spaceId: "spc_b" };
const FILES = [NOTES, WEEK, README];

/** Each link as the words it covers and what it opens. */
const shown = (text: string) => screenLinks(text, FILES).map((l) => `${text.slice(l.start, l.end)} -> ${l.file.id}${l.passage === undefined ? "" : `:${l.passage}`}`);

describe("screenLinks", () => {
	it("links a space file's name standing alone, longer names first", () => {
		assert.deepEqual(shown("Read notes.pdf, then week 3 notes.pdf."), ["notes.pdf -> f_0123456789ab", "week 3 notes.pdf -> f_aaaaaaaaaaaa"]);
		assert.deepEqual(shown('"notes.pdf" (notes.pdf)'), ["notes.pdf -> f_0123456789ab", "notes.pdf -> f_0123456789ab"]);
	});

	it("leaves a name inside a longer word, and names without an extension", () => {
		assert.deepEqual(shown("mynotes.pdf notes.pdfx README"), []);
	});

	it("links a whole shortcut path, and no other path", () => {
		assert.deepEqual(shown("Open spaces/Lab Algebra/Lectures/notes.pdf now"), ["spaces/Lab Algebra/Lectures/notes.pdf -> f_0123456789ab"]);
		assert.deepEqual(shown("~/godspeed/spaces/Closed/Old/Week 1/notes.pdf"), ["spaces/Closed/Old/Week 1/notes.pdf -> f_0123456789ab"]);
		assert.deepEqual(shown("/Users/me/Downloads/notes.pdf"), []);
	});

	it("links passage ids of known files only", () => {
		assert.deepEqual(shown("A heap is a tree (f_0123456789ab:7)."), ["f_0123456789ab:7 -> f_0123456789ab:7"]);
		assert.deepEqual(shown("f_cccccccccccc:2 xf_0123456789ab:3"), []);
	});
});

describe("lineText", () => {
	it("gives each UTF-16 unit its screen column, skipping a wide character's right half", () => {
		const cells = [{ chars: "a", width: 1 }, { chars: "", width: 1 }, { chars: "表", width: 2 }, { chars: "", width: 0 }, { chars: "😀", width: 2 }, { chars: "", width: 0 }, { chars: "b", width: 1 }];
		const { text, columns } = lineText(cells);
		assert.equal(text, "a 表😀b");
		assert.deepEqual(columns, [1, 2, 3, 5, 5, 7]);
	});
});
