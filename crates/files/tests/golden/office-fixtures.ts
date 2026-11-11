// Small zip, Word and PowerPoint files for the office golden cases, the same bytes every time.
import { constants, deflateRawSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf: Buffer): number {
	let c = 0xffffffff;
	for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

export interface Part {
	name: string | Buffer;
	data?: string | Buffer;
	method?: number;
	flags?: number;
	/** Written as the part's stored bytes, whatever `data` is. */
	raw?: Buffer;
	/** deflateRawSync options for method 8. */
	deflate?: { level?: number; strategy?: number };
	/** Added to the central directory's size, to make it lie. */
	sizeDelta?: number;
	badCrc?: boolean;
	extra?: Buffer;
	/** Added to the central directory's local header offset. */
	offsetDelta?: number;
}

export interface ZipOptions {
	/** Added to the entry count in the end record. */
	countDelta?: number;
	comment?: Buffer;
	prefix?: Buffer;
}

export function zip(parts: Part[], options: ZipOptions = {}): Buffer {
	const prefix = options.prefix ?? Buffer.alloc(0);
	const chunks: Buffer[] = [prefix];
	const central: Buffer[] = [];
	let offset = prefix.length;
	for (const p of parts) {
		const name = Buffer.isBuffer(p.name) ? p.name : Buffer.from(p.name, "utf8");
		const data = Buffer.from(p.data ?? "", "utf8");
		const method = p.method ?? 8;
		const stored = p.raw ?? (method === 8 ? deflateRawSync(data, p.deflate ?? { level: 9 }) : data);
		const extra = p.extra ?? Buffer.alloc(0);
		const flags = p.flags ?? 0;
		const crc = p.badCrc ? 0xdeadbeef : crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(flags, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(stored.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(extra.length, 28);
		const cd = Buffer.alloc(46);
		cd.writeUInt32LE(0x02014b50, 0);
		cd.writeUInt16LE(20, 4);
		cd.writeUInt16LE(20, 6);
		cd.writeUInt16LE(flags, 8);
		cd.writeUInt16LE(method, 10);
		cd.writeUInt32LE(crc, 16);
		cd.writeUInt32LE(Math.max(0, stored.length + (p.sizeDelta ?? 0)), 20);
		cd.writeUInt32LE(data.length, 24);
		cd.writeUInt16LE(name.length, 28);
		cd.writeUInt16LE(extra.length, 30);
		cd.writeUInt32LE(offset + (p.offsetDelta ?? 0), 42);
		central.push(cd, name, extra);
		chunks.push(local, name, extra, stored);
		offset += 30 + name.length + extra.length + stored.length;
	}
	const directory = Buffer.concat(central);
	const comment = options.comment ?? Buffer.alloc(0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(parts.length + (options.countDelta ?? 0), 8);
	end.writeUInt16LE(parts.length + (options.countDelta ?? 0), 10);
	end.writeUInt32LE(directory.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(comment.length & 0xffff, 20);
	return Buffer.concat([...chunks, directory, end, comment]);
}

const TYPES: Part = { name: "[Content_Types].xml", data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' };

/** `<w:p>` with runs; each run is raw XML. */
export const wp = (...runs: string[]) => `<w:p>${runs.join("")}</w:p>`;
export const wt = (text: string) => `<w:r><w:t>${text}</w:t></w:r>`;

export function docx(body: string, extra: Part[] = [], deflate?: Part["deflate"]): Buffer {
	return zip([TYPES, { name: "word/document.xml", data: `<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`, deflate }, ...extra]);
}

export const ap = (...runs: string[]) => `<a:p>${runs.join("")}</a:p>`;
export const at = (text: string) => `<a:r><a:t>${text}</a:t></a:r>`;

const slideXml = (body: string) => `<p:sld xmlns:a="a"><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;

export interface Slide {
	file: number;
	body: string;
	/** Notes paragraphs; the slide number field is added like PowerPoint does. */
	notes?: string;
	/** Replaces the slide's relationships file. */
	rels?: string;
}

export interface PptxOptions {
	/** Slide files in presentation order; null leaves the list out. */
	order?: number[] | null;
	presentation?: boolean;
	/** Replaces the presentation's relationships file. */
	presentationRels?: string;
	extra?: Part[];
}

export function pptx(slides: Slide[], options: PptxOptions = {}): Buffer {
	const order = options.order === undefined ? slides.map((s) => s.file) : options.order;
	const parts: Part[] = [TYPES];
	if (options.presentation !== false) {
		const list = (order ?? []).map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join("");
		parts.push({ name: "ppt/presentation.xml", data: `<p:presentation xmlns:p="p" xmlns:r="r">${order ? `<p:sldIdLst>${list}</p:sldIdLst>` : ""}</p:presentation>` });
		const rels = slides.map((s) => `<Relationship Id="rId${s.file}" Type="slide" Target="slides/slide${s.file}.xml"/>`).join("");
		parts.push({ name: "ppt/_rels/presentation.xml.rels", data: options.presentationRels ?? `<Relationships>${rels}</Relationships>` });
	}
	for (const s of slides) {
		parts.push({ name: `ppt/slides/slide${s.file}.xml`, data: slideXml(s.body) });
		if (s.notes !== undefined) {
			parts.push({ name: `ppt/notesSlides/notesSlide${s.file}.xml`, data: slideXml(`${ap('<a:fld id="x" type="slidenum"><a:t>' + s.file + "</a:t></a:fld>")}${s.notes}`) });
		}
		const rels = s.rels ?? (s.notes !== undefined ? `<Relationships><Relationship Id="rId1" Type="notesSlide" Target="../notesSlides/notesSlide${s.file}.xml"/></Relationships>` : undefined);
		if (rels !== undefined) parts.push({ name: `ppt/slides/_rels/slide${s.file}.xml.rels`, data: rels });
	}
	return zip([...parts, ...(options.extra ?? [])]);
}

export const STRATEGIES = {
	"level 0": { level: 0 },
	"level 1": { level: 1 },
	"level 6": { level: 6 },
	"level 9": { level: 9 },
	fixed: { level: 6, strategy: constants.Z_FIXED },
	"huffman only": { level: 6, strategy: constants.Z_HUFFMAN_ONLY },
	rle: { level: 6, strategy: constants.Z_RLE },
};
