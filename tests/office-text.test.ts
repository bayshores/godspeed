/**
 * Word and PowerPoint files → text: tiny zips built here, read by the
 * zip reader in src/server/office-text.ts.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { deflateRawSync } from "node:zlib";
import { officeText } from "../src/server/office-text.ts";

/** A zip of these files (deflated, or stored when `store`). The reader
 *  doesn't check CRCs, so they stay 0. */
function zip(files: Record<string, string>, store = false): Buffer {
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const [name, text] of Object.entries(files)) {
		const raw = Buffer.from(text);
		const data = store ? raw : deflateRawSync(raw);
		const nameBuf = Buffer.from(name);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(store ? 0 : 8, 8);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(store ? 0 : 8, 10);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(nameBuf.length, 28);
		central.writeUInt32LE(offset, 42);
		locals.push(local, nameBuf, data);
		centrals.push(central, nameBuf);
		offset += 30 + nameBuf.length + data.length;
	}
	const cd = Buffer.concat(centrals);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(files).length, 8);
	end.writeUInt16LE(Object.keys(files).length, 10);
	end.writeUInt32LE(cd.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, cd, end]);
}

function withFile(name: string, bytes: Buffer, run: (abs: string) => void): void {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-office-"));
	try {
		const abs = path.join(dir, name);
		fs.writeFileSync(abs, bytes);
		run(abs);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

const DOCX =
	'<?xml version="1.0"?><w:document xmlns:w="w"><w:body>' +
	'<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Week 3:</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">Counting &amp; </w:t></w:r><w:r><w:t>probability</w:t></w:r></w:p>' +
	"<w:p><w:r><w:t>P(A) &lt; 1</w:t><w:br/><w:t>&#8721; done</w:t></w:r></w:p>" +
	"</w:body></w:document>";

describe("officeText", () => {
	it("reads a Word file's paragraphs, tabs, breaks and entities", () => {
		withFile("notes.docx", zip({ "[Content_Types].xml": "<Types/>", "word/document.xml": DOCX }), (abs) => {
			assert.equal(officeText(abs), "Week 3:\tCounting & probability\nP(A) < 1\n∑ done");
		});
		withFile("stored.DOCX", zip({ "word/document.xml": DOCX }, true), (abs) => {
			assert.match(officeText(abs), /^Week 3:/);
		});
	});

	it("reads slides in presentation order with their speaker notes", () => {
		const slide = (text: string) => `<p:sld><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p><a:p><a:r><a:t>more</a:t></a:r></a:p></p:txBody></p:sld>`;
		const files = {
			"ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId id="257" r:id="rId3"/><p:sldId id="256" r:id="rId2"/></p:sldIdLst></p:presentation>',
			"ppt/_rels/presentation.xml.rels":
				'<Relationships><Relationship Id="rId2" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="slide" Target="slides/slide2.xml"/></Relationships>',
			"ppt/slides/slide1.xml": slide("Base case"),
			"ppt/slides/slide2.xml": slide("Recursion"),
			"ppt/slides/_rels/slide2.xml.rels": '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>',
			"ppt/notesSlides/notesSlide1.xml": '<p:notes><a:p><a:r><a:t>Draw the call tree</a:t></a:r></a:p><a:p><a:fld type="slidenum"><a:t>2</a:t></a:fld></a:p></p:notes>',
		};
		withFile("Lecture 9.pptx", zip(files), (abs) => {
			assert.equal(officeText(abs), "--- Slide 1 ---\nRecursion\nmore\nNotes:\nDraw the call tree\n\n--- Slide 2 ---\nBase case\nmore");
		});
	});

	it("keeps line breaks written as open and close tags, and leaves impossible entities alone", () => {
		const slide =
			'<p:sld><p:txBody><a:p><a:r><a:t>Intro to</a:t></a:r><a:br><a:rPr lang="en-US" dirty="0"/></a:br><a:r><a:t>Recursion</a:t></a:r></a:p></p:txBody></p:sld>';
		withFile("breaks.pptx", zip({ "ppt/presentation.xml": "<p:presentation/>", "ppt/slides/slide1.xml": slide }), (abs) => {
			assert.equal(officeText(abs), "--- Slide 1 ---\nIntro to\nRecursion");
		});
		const doc = '<w:document><w:body><w:p><w:r><w:t>a</w:t><w:br w:type="page"></w:br><w:t>b &#99999999; c</w:t></w:r></w:p></w:body></w:document>';
		withFile("breaks.docx", zip({ "word/document.xml": doc }), (abs) => assert.equal(officeText(abs), "a\nb &#99999999; c"));
	});

	it("refuses a part that unpacks too big or won't unpack, with the plain message", () => {
		const bomb = zip({ "word/document.xml": "<w:t>" + "x".repeat(65 * 1024 * 1024) + "</w:t>" });
		withFile("bomb.docx", bomb, (abs) => assert.throws(() => officeText(abs), /can't be opened as a Word or PowerPoint file/));
		// A stored entry marked as deflated: its bytes are not a deflate stream.
		const broken = zip({ "word/document.xml": "\u00ff\u00ff not deflate" }, true);
		broken.writeUInt16LE(8, 8);
		broken.writeUInt16LE(8, broken.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10);
		withFile("broken.docx", broken, (abs) => assert.throws(() => officeText(abs), /can't be opened as a Word or PowerPoint file/));
	});

	it("fails with a plain message on files that aren't Word or PowerPoint, or have a password", () => {
		withFile("fake.docx", Buffer.from("not a zip at all"), (abs) => assert.throws(() => officeText(abs), /can't be opened as a Word or PowerPoint file/));
		withFile("locked.docx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), (abs) => assert.throws(() => officeText(abs), /password-protected/));
		withFile("empty.docx", zip({ "other.xml": "<x/>" }), (abs) => assert.throws(() => officeText(abs), /can't be opened/));
	});
});
