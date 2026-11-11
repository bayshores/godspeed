// What the TypeScript class-file code gives for the inputs gs-files copies: office text, caption
// cleanup, text sniffing, reading rules, folder walks and fingerprints. Folder and file cases write
// real files, so the case output carries the layout for the Rust test to rebuild.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import {
	RecordingNeedsTranscriptError,
	fileToText,
	fingerprintFile,
	isReadableClassFile,
	looksLikeText,
	transcriptToText,
	walkLinkedFolder,
} from "../../../../src/backend/server/class-files.ts";
import { officeText } from "../../../../src/backend/server/office-text.ts";
import { STRATEGIES, ap, at, docx, pptx, wp, wt, zip } from "./office-fixtures.ts";

const hex = (b: Buffer | string) => Buffer.from(b).toString("hex");
const unhex = (h: string) => Buffer.from(h, "hex");

async function inTempDir<T>(run: (dir: string) => Promise<T> | T): Promise<T> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-files-golden-"));
	try {
		return await run(dir);
	} finally {
		for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
			if (entry.isDirectory()) fs.chmodSync(path.join(entry.parentPath, entry.name), 0o755);
		}
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// ── captions ──
const CAPTIONS = [
	"WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello <c.colorE5E5E5>there</c>\n\n2\n00:00:03.000 --> 00:00:05.000\nHello <c>there</c>\nsecond line\n",
	"1\r\n00:00:01,000 --> 00:00:03,000\r\nLine one\r\n\r\n2\r\n00:00:03,000 --> 00:00:05,000\r\nLine one\r\nLine two\r\n",
	"WEBVTT - with a title\nKind: captions\nNOTE a note\nNOTEBOOK is dropped too\nSTYLE\n::cue { color: red }\n\nWEBVTTX\n00:00:00.000 --> 00:00:01.000 align:start\nWEBVTT\n12\n  padded   ﻿\n",
	"a\rb\r\rc\n\n\nc\nc\n<b></b>\n<i> </i>\n 42 \n4 2\n-->\nx --> y\n",
	"<v Roger>Hi</v> <00:00:01.500><c>there</c> a<b\nmid>tag</b> 1<2>3 <",
	"",
	"\n\n\n",
	"élève 日本語 😀 emoji\nélève 日本語 😀 emoji\n separator ",
	"same\nSame\nsame\nsame\nsame",
	"٣\n123\n1_2\n１２",
];

// ── sniffing ──
const lcg = (seed: number) => () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) >>> 24;

function sniffInputs(): Buffer[] {
	const fixed = [
		Buffer.alloc(0),
		Buffer.from([0]),
		Buffer.from("plain text\n"),
		Buffer.from("héllo 日本語 😀"),
		Buffer.from([0xef, 0xbb, 0xbf, 0x61]),
		Buffer.from([0x61, 0xc3]),
		Buffer.from([0x61, 0xe2, 0x82]),
		Buffer.from([0x61, 0xf0, 0x9f, 0x98]),
		Buffer.from([0x61, 0xc3, 0x28]),
		Buffer.from([0xc0, 0x80]),
		Buffer.from([0xc1, 0xbf]),
		Buffer.from([0xe0, 0x80, 0x80]),
		Buffer.from([0xe0, 0xa0]),
		Buffer.from([0xe0, 0x80]),
		Buffer.from([0xed, 0xa0, 0x80]),
		Buffer.from([0xed, 0xa0]),
		Buffer.from([0xf0, 0x80, 0x80, 0x80]),
		Buffer.from([0xf4, 0x90, 0x80, 0x80]),
		Buffer.from([0xf4, 0x8f]),
		Buffer.from([0xf5, 0x80]),
		Buffer.from([0xff]),
		Buffer.from([0x80]),
		Buffer.from([0x61, 0, 0x62]),
		// Cut inside a character at the 8192-byte limit, valid just past it.
		Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from("é")]),
		Buffer.concat([Buffer.alloc(8190, 0x61), Buffer.from("😀")]),
		Buffer.concat([Buffer.alloc(8189, 0x61), Buffer.from("😀")]),
		// A NUL or a bad byte only after the limit is not seen.
		Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0])]),
		Buffer.concat([Buffer.alloc(8192, 0x61), Buffer.from([0xff, 0xff])]),
		Buffer.concat([Buffer.alloc(8191, 0x61), Buffer.from([0xff])]),
		Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "latin1"),
	];
	const next = lcg(7);
	const random: Buffer[] = [];
	for (let i = 0; i < 400; i++) {
		const len = 1 + (next() % 6);
		random.push(Buffer.from(Array.from({ length: len }, () => [0x61, 0x7f, 0x80, 0xbf, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, next()][next() % 13]!)));
	}
	return [...fixed, ...random];
}

// ── names for the reading rules ──
const READABLE_NAMES = [
	"notes.md", "Notes.TXT", "a.py", "lec.PDF", "deck.pptx", "doc.docx", "cap.vtt", "cap.srt", "talk.mp3", "talk.MOV", "Makefile", "README", ".env", "archive.tar.gz", "plan.gdoc", "sheet.xlsx", "photo.png", "name.", "a.b.c", "dir.d/file", "dir.d\\file", "x.longextension123", "x.tar-gz", "", ".", ".pdf",
];

// ── office files ──
const BREAKS = `${wp(wt("Load factor"), "<w:r><w:tab/></w:r>", wt("alpha"))}${wp(wt("one"), "<w:r><w:br/></w:r>", wt("two"), "<w:r><w:cr/></w:r>", wt("three"), '<w:r><w:br w:type="page"/></w:r>', wt("four"), '<w:r><w:br w:type="tab"/></w:r>', wt("five"))}`;
const ENTITIES = [
	"caf&#233; &#x41; &#X42; &amp; &lt;b&gt; &quot;q&quot; &apos;a&apos; &nbsp; &#1114112; &#xZZ; &#; &x; &#x110000; &#99999999999999999999999; &#0065;",
	"&AMP; &amp;amp; &amp &#x1F600; &#128512; &#xD83D;&#xDE00; &#xD800; &#xDFFF; &#55357;&#56832; &#xD83D; text",
	"&constructor; &__proto__; &toString; &valueOf; &hasOwnProperty; &isPrototypeOf; &propertyIsEnumerable; &toLocaleString; &__defineGetter__; &__lookupSetter__; &Constructor; &length;",
];
const WORDS = (() => {
	const next = lcg(99);
	return Array.from({ length: 400 }, (_, i) => wp(wt(`Paragraph ${i}: ${Array.from({ length: 12 }, () => String.fromCharCode(97 + (next() % 26), 97 + (next() % 26), 97 + (next() % 26))).join(" ")}`))).join("");
})();

function officeFiles(): { name: string; file: string; bytes: Buffer }[] {
	const good = docx(wp(wt("A real document")) + wp(wt("With some text.")));
	const goodPptx = pptx([
		{ file: 1, body: ap(at("Graph traversal")) + ap(at("Breadth first search")), notes: ap(at("Say that BFS finds shortest paths.")) },
		{ file: 2, body: ap(at("Dynamic programming")) + ap(at("Store answers"), "<a:br/>", at("so each is solved once.")) + ap(at("Fibonacci &amp; knapsack &lt;examples&gt;")) },
		{ file: 3, body: ap(at("Binary search trees")), notes: ap(at("Draw an unbalanced tree.")) + ap(at("Ask what the height is.")) },
	], { order: [3, 1, 2] });
	const out: { name: string; file: string; bytes: Buffer }[] = [];
	const add = (name: string, bytes: Buffer, file = "f.docx") => out.push({ name, file, bytes });
	const addSlides = (name: string, bytes: Buffer) => add(name, bytes, "f.pptx");

	add("good docx", docx(wp(wt("Hash tables")) + wp(wt("A hash table maps keys & handles collisions.")) + BREAKS + wp() + wp() + wp() + wp(wt("Trailing spaces   ")) + wp(wt("x   "), "<w:r><w:br/></w:r>", wt("y")) + wp('<w:r><w:t xml:space="preserve">Attribute run</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t> and bold run</w:t></w:r>')));
	ENTITIES.forEach((text, i) => add(`entities ${i + 1}`, docx(wp(wt(text)))));
	add("empty docx", docx(wp() + wp()));
	add("run shapes", docx(`<w:p><w:t/><w:t></w:t><w:t >spaced</w:t ><w:tbl>no</w:tbl><w:t>a<b>c</w:t><w:tab/><w:tab /><w:br/><w:brx/></w:p><w:p><w:t\n>newline attr</w:t></w:p>`));
	add("stored parts", zip([{ name: "word/document.xml", data: `<w:document><w:body>${wp(wt("Stored parts"))}${wp(wt("No compression."))}</w:body></w:document>`, method: 0 }]));
	for (const [label, options] of Object.entries(STRATEGIES)) add(`compression ${label}`, docx(WORDS, [], options));
	add("bom and bad bytes", zip([{ name: "word/document.xml", data: Buffer.concat([Buffer.from("﻿<w:p><w:t>caf"), Buffer.from([0xe9]), Buffer.from("</w:t></w:p><w:p><w:t>"), Buffer.from([0xe2, 0x82]), Buffer.from("</w:t></w:p>")]) }]));
	add("bad crc", zip([{ name: "word/document.xml", data: wp(wt("Checksum is wrong")), badCrc: true }]));
	add("extra fields", zip([{ name: "word/document.xml", data: wp(wt("With an extra field")), extra: Buffer.from("abcdefgh") }]));
	add("central size too big", zip([{ name: "word/document.xml", data: wp(wt("Size claims more")), sizeDelta: 40 }]));
	add("central size too small", zip([{ name: "word/document.xml", data: wp(wt("Size claims less")), sizeDelta: -4 }]));
	add("stored size too big", zip([{ name: "word/document.xml", data: wp(wt("Stored size is off")), method: 0, sizeDelta: 400 }]));
	add("duplicate part", zip([{ name: "word/document.xml", data: wp(wt("first")) }, { name: "other.xml", data: "<x/>" }, { name: "word/document.xml", data: wp(wt("second")) }]));
	add("archive comment", zip([{ name: "word/document.xml", data: wp(wt("Has a comment")) }], { comment: Buffer.from("a comment after the end record") }));
	add("long archive comment", zip([{ name: "word/document.xml", data: wp(wt("Comment too long")) }], { comment: Buffer.alloc(65_600, 0x20) }));
	add("prefix before archive", zip([{ name: "word/document.xml", data: wp(wt("Prefixed")) }], { prefix: Buffer.from("PREFIX-BYTES") }));
	add("bad local header", zip([{ name: "word/document.xml", data: wp(wt("x")), offsetDelta: 3 }]));
	add("local offset past end", zip([{ name: "word/document.xml", data: wp(wt("x")), offsetDelta: 100_000 }]));
	add("part name not utf8", zip([{ name: Buffer.from([0x77, 0x6f, 0x72, 0x64, 0x2f, 0xff]), data: "<x/>" }, { name: "word/document.xml", data: wp(wt("Named parts")) }]));
	add("more parts than directory", zip([{ name: "word/document.xml", data: wp(wt("x")) }], { countDelta: 4 }));
	add("fewer parts than directory", zip([{ name: "[Content_Types].xml", data: "<Types/>" }, { name: "word/document.xml", data: wp(wt("x")) }], { countDelta: -1 }));
	add("bomb", zip([{ name: "word/document.xml", raw: deflateRawSync(Buffer.alloc(64 * 1024 * 1024 + 1, 0x20), { level: 9 }) }]));
	add("part just under the limit", zip([{ name: "word/document.xml", raw: deflateRawSync(Buffer.alloc(64 * 1024 * 1024, 0x20), { level: 9 }) }]));
	add("not a zip", Buffer.from("This is just text that was renamed to .docx.\n"));
	add("ole locked", Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]));
	add("ole short", Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
	add("encrypted part", zip([{ name: "word/document.xml", data: "<w:document/>", flags: 1 }]));
	add("encrypted other part", zip([{ name: "word/document.xml", data: wp(wt("x")) }, { name: "other.xml", data: "<x/>", flags: 1 }]));
	add("no document part", zip([{ name: "[Content_Types].xml", data: "<Types/>" }]));
	add("damaged part", zip([{ name: "word/document.xml", data: "<w:document/>", raw: Buffer.from("this is not deflate data at all") }]));
	add("empty deflate", zip([{ name: "word/document.xml", data: "", raw: Buffer.alloc(0) }]));
	add("unknown method", zip([{ name: "word/document.xml", data: "<w:document/>", method: 12, raw: Buffer.from("BZh91AY&SY") }]));
	add("truncated", good.subarray(0, Math.floor(good.length / 2)));
	add("tiny", Buffer.from("PK"));
	add("zero bytes", Buffer.alloc(0));
	add("zero bytes pptx", Buffer.alloc(0), "f.pptx");
	add("docx as pptx", good, "f.pptx");
	add("pptx as docx", goodPptx, "f.docx");

	addSlides("good pptx", goodPptx);
	add("pptx upper case name", goodPptx, "DECK.PPTX");
	add("pptx hidden name", goodPptx, ".pptx");
	add("pptx without extension", goodPptx, "deck");
	addSlides("unlisted slides", pptx([{ file: 2, body: ap(at("Second file")) }, { file: 1, body: "", notes: ap(at("Only notes.")) }, { file: 10, body: ap(at("Tenth")) }, { file: 100, body: ap(at("Hundredth")) }], { order: null }));
	addSlides("no presentation part", pptx([{ file: 1, body: ap(at("Slide without a presentation part")) }], { presentation: false }));
	addSlides("empty presentation", pptx([], { order: [] }));
	addSlides("no slides listed but present", pptx([{ file: 2, body: ap(at("two")) }, { file: 1, body: ap(at("one")) }], { order: [] }));
	addSlides("list names a missing slide", pptx([{ file: 1, body: ap(at("one")) }], { order: [1, 7] }));
	addSlides("relative targets", pptx([{ file: 1, body: ap(at("moved")) }], { presentationRels: '<Relationships><Relationship Id="rId1" Target="./slides/../slides/slide1.xml"/></Relationships>' }));
	addSlides("absolute target", pptx([{ file: 1, body: ap(at("absolute")) }], { presentationRels: '<Relationships><Relationship Id="rId1" Target="/ppt/slides/slide1.xml"/></Relationships>' }));
	addSlides("repeated relationship id", pptx([{ file: 1, body: ap(at("one")) }, { file: 2, body: ap(at("two")) }], { presentationRels: '<Relationships><Relationship Id="rId1" Target="slides/slide2.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>' }));
	addSlides("relationship shapes", pptx([{ file: 1, body: ap(at("one")) }], { presentationRels: '<Relationships><Relationship Target="slides/slide1.xml" Id="rId1"/><Relationship Id="" Target="x"/><Relationship Id="rId2"/><Relationship\nId="rId9" Target="slides/slide9.xml"></Relationship></Relationships>' }));
	addSlides("notes missing from archive", pptx([{ file: 1, body: ap(at("one")), rels: '<Relationships><Relationship Id="rId1" Target="../notesSlides/notesSlide9.xml"/></Relationships>' }]));
	addSlides("notes with several relationships", pptx([{ file: 1, body: ap(at("one")), notes: ap(at("kept")), rels: '<Relationships><Relationship Id="rId2" Target="../media/x.png"/><Relationship Id="rId1" Target="../notesSlides/notesSlide1.xml"/></Relationships>' }]));
	addSlides("notes only a field", pptx([{ file: 1, body: ap(at("one")), notes: "" }]));
	add("encrypted slide", zip([{ name: "ppt/presentation.xml", data: "<p:presentation/>" }, { name: "ppt/slides/slide1.xml", data: "<x/>", flags: 1 }]), "f.pptx");
	addSlides("damaged presentation", zip([{ name: "ppt/presentation.xml", data: "<p:presentation/>", raw: Buffer.from("not deflate") }]));
	add("presentation only", zip([{ name: "ppt/presentation.xml", data: "<p:presentation/>" }]), "f.pptx");
	addSlides("many slides", pptx(Array.from({ length: 12 }, (_, i) => ({ file: i + 1, body: ap(at(`Slide body ${i + 1}`)), notes: i % 3 === 0 ? ap(at(`Note ${i + 1}`)) : undefined })), { order: [12, 3, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11] }));
	return out;
}

function office(): unknown[] {
	return inTempDirSync((dir) =>
		officeFiles().map(({ name, file, bytes }) => {
			const target = path.join(dir, file);
			fs.writeFileSync(target, bytes);
			let result: { text: string } | { error: string };
			try {
				result = { text: officeText(target) };
			} catch (err) {
				result = { error: (err as Error).message };
			}
			return { name, file, hex: hex(bytes), ...result };
		}),
	);
}

function inTempDirSync<T>(run: (dir: string) => T): T {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs-files-golden-"));
	try {
		return run(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

// ── fileToText ──
interface ReadCase {
	name: string;
	file: string;
	bytes?: Buffer;
	/** Make a folder of this name instead of a file. */
	folder?: boolean;
}

const READ_CASES: ReadCase[] = [
	{ name: "text with CRLF", file: "notes.txt", bytes: Buffer.from("hello\r\nworld\r\n") },
	{ name: "markdown with BOM and bad bytes", file: "notes.MD", bytes: Buffer.from([0xef, 0xbb, 0xbf, 0x6f, 0x6b, 0xff, 0x0a]) },
	{ name: "empty text", file: "empty.txt", bytes: Buffer.alloc(0) },
	{ name: "no extension", file: "README", bytes: Buffer.from("plain readme\n") },
	{ name: "code", file: "stats.py", bytes: Buffer.from("def mean(xs):\n    return sum(xs) / len(xs)\n") },
	{ name: "webvtt", file: "lecture.vtt", bytes: Buffer.from(CAPTIONS[0]!) },
	{ name: "srt upper case", file: "lecture.SRT", bytes: Buffer.from(CAPTIONS[1]!) },
	{ name: "recording", file: "talk.mp3", bytes: Buffer.from("not audio") },
	{ name: "recording that is missing", file: "gone.mov" },
	{ name: "unsupported", file: "sheet.xlsx", bytes: Buffer.from("x") },
	{ name: "unsupported missing", file: "pic.png" },
	{ name: "dot file", file: ".env", bytes: Buffer.from("A=1") },
	{ name: "missing text", file: "gone.txt" },
	{ name: "missing no extension", file: "gone" },
	{ name: "missing transcript", file: "gone.vtt" },
	{ name: "folder named like text", file: "folder.txt", folder: true },
	{ name: "folder named like captions", file: "folder.srt", folder: true },
	{ name: "folder named like word", file: "folder.docx", folder: true },
	{ name: "missing word file", file: "gone.docx" },
	{ name: "word file", file: "good.docx", bytes: docx(wp(wt("Hello")) + wp(wt("World"))) },
	{ name: "broken word file", file: "bad.docx", bytes: Buffer.from("not a zip") },
	{ name: "powerpoint file", file: "deck.pptx", bytes: pptx([{ file: 1, body: ap(at("Title")), notes: ap(at("Say hi")) }]) },
	{ name: "hidden powerpoint name", file: ".pptx", bytes: pptx([{ file: 1, body: ap(at("Title")) }]) },
];

async function reads(): Promise<unknown[]> {
	return inTempDir(async (dir) => {
		const out: unknown[] = [];
		for (const c of READ_CASES) {
			const target = path.join(dir, c.file);
			if (c.folder) fs.mkdirSync(target);
			else if (c.bytes) fs.writeFileSync(target, c.bytes);
			let result: { text: string } | { error: string; needsTranscript: boolean };
			try {
				result = { text: await fileToText(target) };
			} catch (err) {
				result = { error: (err as Error).message.split(dir).join("<dir>"), needsTranscript: err instanceof RecordingNeedsTranscriptError };
			}
			out.push({ name: c.name, file: c.file, folder: !!c.folder, hex: c.bytes ? hex(c.bytes) : null, ...result });
		}
		return out;
	});
}

// ── folder walks ──
type Node = { p: string; hex?: string; dir?: boolean; link?: string; mode?: number; count?: number; ext?: string };

const text = (s: string) => hex(s);

const MIXED: Node[] = [
	{ p: "notes.md", hex: text("# notes") },
	{ p: "Notes 2.TXT", hex: text("two") },
	{ p: "Lec10.pdf" }, { p: "Lec9.pdf" }, { p: "lec2.PDF" },
	{ p: "alpha.txt" }, { p: "Zeta.txt" }, { p: "ä.txt" }, { p: "a b.txt" }, { p: "a-b.txt" }, { p: "a_b.txt" }, { p: "a.b.txt" }, { p: "A.txt" }, { p: "b.txt" },
	{ p: ".DS_Store", hex: "00" }, { p: "~$lock.docx" }, { p: "notes.md~" }, { p: ".hidden/x.txt" },
	{ p: "node_modules/x.txt" }, { p: "Library/x.txt" }, { p: ".git/x.txt" }, { p: ".Trash/x.txt" }, { p: "library/x.txt" },
	{ p: "nested/deep/file.py", hex: text("print(1)") },
	{ p: "nested/sub/Makefile", hex: text("all:\n\techo hi\n") },
	{ p: "nested/sub/binary", hex: "0001020304" },
	{ p: "nested/sub/emptyfile" },
	{ p: "README", hex: text("héllo wörld") },
	{ p: "weird", hex: "61ff62" },
	{ p: "cut", hex: "61c3" },
	{ p: "plan.gdoc", hex: text("{}") }, { p: "s.gsheet" }, { p: "x.GSLIDES" }, { p: "y.gform" }, { p: "report.doc" }, { p: "photo.png" }, { p: "data.json" }, { p: "z.gjam" },
	{ p: "link.txt", link: "notes.md" },
	{ p: "linkdir", link: "nested" },
	{ p: "dangling.txt", link: "nowhere.txt" },
	{ p: "Éclair/a.txt" },
	{ p: "talk.mp3" }, { p: "cap.vtt" }, { p: "deck.pptx" }, { p: "doc.docx" },
];

const SKIP_ORDER: Node[] = [
	{ p: "a.zip" }, { p: "b.zip" }, { p: "c.gdoc" }, { p: "d.zip" }, { p: "e.gsheet" }, { p: "f.txt" },
];

const walkCases: Record<string, Node[]> = {
	mixed: MIXED,
	"empty folder": [],
	"only skipped": SKIP_ORDER,
	"unreadable folder and file": [
		{ p: "a.txt" },
		{ p: "locked", dir: true, mode: 0 },
		{ p: "locked/inside.txt" },
		{ p: "b/c.txt" },
		{ p: "noaccess", hex: text("secret"), mode: 0 },
		{ p: "z.txt" },
	],
	"exactly 500": [{ p: "f", count: 500, ext: ".txt" }],
	"500 then a skipped file": [{ p: "f", count: 500, ext: ".txt" }, { p: "g.zip" }],
	"501": [{ p: "f", count: 501, ext: ".txt" }, { p: "zz.zip" }],
	"cap in the second folder": [{ p: "a/f", count: 300, ext: ".txt" }, { p: "b/f", count: 300, ext: ".txt" }, { p: "c/x.txt" }, { p: "d.zip" }],
	"cap with skipped before": [{ p: "a.zip" }, { p: "b/f", count: 500, ext: ".md" }, { p: "b/g", count: 3, ext: ".png" }, { p: "c.png" }],
};

function build(root: string, nodes: Node[]): void {
	const deferred: Node[] = [];
	for (const n of nodes) {
		const make = (rel: string) => {
			const target = path.join(root, rel);
			fs.mkdirSync(path.dirname(target), { recursive: true });
			if (n.dir) fs.mkdirSync(target, { recursive: true });
			else if (n.link !== undefined) fs.symlinkSync(n.link, target);
			else fs.writeFileSync(target, unhex(n.hex ?? ""));
		};
		if (n.count) for (let i = 0; i < n.count; i++) make(`${n.p}${String(i).padStart(3, "0")}${n.ext ?? ""}`);
		else make(n.p);
		if (n.mode !== undefined) deferred.push(n);
	}
	for (const n of deferred.reverse()) fs.chmodSync(path.join(root, n.p), n.mode!);
}

function walks(): unknown[] {
	return inTempDirSync((dir) => {
		const out: unknown[] = [];
		const run = (name: string, nodes: Node[]) => {
			const root = path.join(dir, `case-${out.length}`);
			fs.mkdirSync(root);
			build(root, nodes);
			const result = walkLinkedFolder(root);
			for (const n of nodes) if (n.mode !== undefined) fs.chmodSync(path.join(root, n.p), 0o755);
			out.push({ name, tree: nodes, result });
		};
		for (const [name, nodes] of Object.entries(walkCases)) run(name, nodes);

		const missing = path.join(dir, "missing");
		const asFile = path.join(dir, "a-file");
		fs.writeFileSync(asFile, "x");
		const locked = path.join(dir, "locked-root");
		fs.mkdirSync(locked, { mode: 0 });
		for (const [name, root] of [["root missing", missing], ["root is a file", asFile], ["root unreadable", locked]] as const) {
			try {
				walkLinkedFolder(root);
				out.push({ name, error: null });
			} catch (err) {
				out.push({ name, error: { message: (err as Error).message.split(dir).join("<dir>"), code: (err as NodeJS.ErrnoException).code } });
			}
		}
		fs.chmodSync(locked, 0o755);
		return out;
	});
}

// ── fingerprints ──
const pattern = (size: number) => Buffer.from(Array.from({ length: size }, (_, i) => i % 251));

async function fingerprints(): Promise<unknown[]> {
	return inTempDir(async (dir) => {
		const out: unknown[] = [];
		const files: [string, Buffer][] = [["empty", Buffer.alloc(0)], ["abc", Buffer.from("abc")], ["one chunk edge", pattern(65_536)], ["two chunks", pattern(65_537)], ["many chunks", pattern(300_001)]];
		for (const [name, bytes] of files) {
			const file = path.join(dir, "f.bin");
			fs.writeFileSync(file, bytes);
			out.push({ name, size: bytes.length, fp: await fingerprintFile(file) });
		}
		for (const [name, file] of [["missing", path.join(dir, "gone.bin")], ["folder", dir]] as const) {
			try {
				out.push({ name, fp: await fingerprintFile(file) });
			} catch (err) {
				out.push({ name, error: (err as Error).message.split(dir).join("<dir>") });
			}
		}
		return out;
	});
}

const cases: Record<string, () => unknown> = {
	transcripts: () => CAPTIONS.map((raw) => ({ raw, text: transcriptToText(raw) })),
	sniffing: () => sniffInputs().map((bytes) => ({ hex: hex(bytes), text: looksLikeText(bytes) })),
	"reading rules": () =>
		READABLE_NAMES.flatMap((name) => [true, false, null].map((isText) => ({ name, isText, readable: isReadableClassFile(name, () => isText) }))),
	office,
	"file to text": reads,
	walks,
	fingerprints,
};

export default cases;
