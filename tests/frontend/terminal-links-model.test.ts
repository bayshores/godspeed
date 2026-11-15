import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rowLinks, screenLinks, type LinkFile, type Row } from "../../src/frontend/components/terminal/terminal-links-model.ts";

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

/** Rows as the screen shows them, `+` at the start for a row the terminal wrapped. */
const rows = (...lines: string[]): Row[] =>
	lines.map((line) => {
		const wrapped = line.startsWith("+");
		return { cells: [...(wrapped ? line.slice(1) : line)].map((chars) => ({ chars, width: 1 })), wrapped };
	});
const parts = (links: ReturnType<typeof rowLinks>) => links.map((l) => `${l.text} -> ${l.link.file.id} ${l.parts.map((p) => `${p.row}:${p.from}-${p.to}`).join(" ")}`);

describe("rowLinks", () => {
	it("links a path the terminal wrapped onto the next row", () => {
		const found = rowLinks(rows("Open spaces/Lab Algebra/", "+Lectures/notes.pdf now"), 4, FILES);
		assert.deepEqual(parts(found), ["spaces/Lab Algebra/Lectures/notes.pdf -> f_0123456789ab 4:6-24 5:1-18"]);
	});

	it("links a name broken inside itself, with the next row's indent dropped", () => {
		const found = rowLinks(rows("  See spaces/Lab Algebra/Lectures/week 3 no", "  tes.pdf first."), 0, FILES);
		assert.deepEqual(parts(found), ["spaces/Lab Algebra/Lectures/week 3 notes.pdf -> f_aaaaaaaaaaaa 0:7-43 1:3-9"]);
	});

	it("keeps names that end a row and start the next one apart", () => {
		const found = rowLinks(rows("Read week 3", "notes.pdf and notes.pdf"), 0, FILES);
		assert.deepEqual(parts(found), ["week 3 notes.pdf -> f_aaaaaaaaaaaa 0:6-11 1:1-9", "notes.pdf -> f_0123456789ab 1:15-23"]);
		assert.deepEqual(parts(rowLinks(rows("Then open", "notes.pdf"), 0, FILES)), ["notes.pdf -> f_0123456789ab 1:1-9"]);
	});

	it("gives each piece its screen columns, skipping a wide character's right half", () => {
		const wide: Row[] = [{ cells: [{ chars: "表", width: 2 }, { chars: "", width: 0 }, { chars: " ", width: 1 }, ...[..."notes.pdf"].map((chars) => ({ chars, width: 1 }))], wrapped: false }];
		assert.deepEqual(parts(rowLinks(wide, 0, FILES)), ["notes.pdf -> f_0123456789ab 0:4-12"]);
	});
});
