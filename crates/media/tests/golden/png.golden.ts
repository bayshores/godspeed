import { crc32, deflateSync } from "node:zlib";
import { providerSafePng } from "../../../../src/backend/agent/subagents/headless.ts";

const SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function chunk(type: Buffer | string, data: Buffer, crc?: number): Buffer {
	const out = Buffer.alloc(12 + data.length);
	out.writeUInt32BE(data.length, 0);
	if (typeof type === "string") out.write(type, 4, "ascii");
	else type.copy(out, 4);
	data.copy(out, 8);
	out.writeUInt32BE(crc ?? crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

function ihdr(width: number, height: number): Buffer {
	const data = Buffer.alloc(13);
	data.writeUInt32BE(width, 0);
	data.writeUInt32BE(height, 4);
	data[8] = 8;
	data[9] = 2;
	return data;
}

/** A real width x height RGB image, its compressed stream cut into `pieces` IDAT chunks. */
function image(width: number, height: number, pieces: number): Buffer[] {
	const rows = Buffer.alloc((width * 3 + 1) * height);
	for (let i = 0; i < rows.length; i++) rows[i] = (i * 37) & 0xff;
	const z = deflateSync(rows);
	const size = Math.ceil(z.length / pieces);
	const idats: Buffer[] = [];
	for (let at = 0; at < z.length; at += size) idats.push(chunk("IDAT", z.subarray(at, at + size)));
	return [chunk("IHDR", ihdr(width, height)), ...idats, chunk("IEND", Buffer.alloc(0))];
}

function png(...chunks: Buffer[]): Buffer {
	return Buffer.concat([SIGNATURE, ...chunks]);
}

function run(input: Buffer) {
	return { input: input.toString("base64"), output: providerSafePng(input).toString("base64") };
}

const highBit = (type: string, bits: number[]) => Buffer.from(type, "ascii").map((b, i) => b | (bits.includes(i) ? 0x80 : 0));
const text = chunk("tEXt", Buffer.from("Comment\0hello"));
const [head, ...rest] = image(40, 30, 5);
const tail = rest.pop()!;

export default {
	"split into five": () => run(png(head!, ...rest, tail)),
	"split into two with text between": () => run(png(head!, rest[0]!, text, rest[1]!, tail)),
	"single IDAT passes through": () => run(png(...image(8, 8, 1))),
	"a real picture merges to the same stream": () => run(png(...image(64, 48, 9))),
	"empty IDAT chunks": () => run(png(head!, chunk("IDAT", Buffer.alloc(0)), rest[0]!, chunk("IDAT", Buffer.alloc(0)), tail)),
	"not a PNG": () => run(Buffer.from("just some text that is long enough to pass the length check")),
	"too short": () => run(png(chunk("IEND", Buffer.alloc(0)))),
	"signature only": () => run(SIGNATURE),
	"wrong CRCs are fixed": () => run(png(head!, chunk("IDAT", Buffer.from([1, 2, 3]), 12345), chunk("IDAT", Buffer.from([4]), 99), tail)),
	"truncated tail is dropped": () => {
		const whole = png(head!, rest[0]!, rest[1]!, tail);
		return run(Buffer.concat([whole, chunk("IDAT", Buffer.alloc(50)).subarray(0, 30)]));
	},
	"bytes after IEND are dropped": () => run(Buffer.concat([png(head!, rest[0]!, rest[1]!, tail), Buffer.from("trailing")])),
	"fewer than twelve trailing bytes": () => run(Buffer.concat([png(head!, rest[0]!, rest[1]!), Buffer.from([1, 2, 3, 4, 5])])),
	"length runs past the end": () => {
		const bad = Buffer.alloc(12);
		bad.writeUInt32BE(1000, 0);
		bad.write("IDAT", 4, "ascii");
		return run(Buffer.concat([png(head!, rest[0]!, rest[1]!), bad]));
	},
	"chunk types lose their top bit": () =>
		run(png(head!, chunk(highBit("IDAT", [0]), Buffer.from([1, 2])), chunk(highBit("IDAT", [3]), Buffer.from([3])), chunk(highBit("abcd", [1, 2]), Buffer.from([9])), tail)),
	"ancillary chunks keep their place": () => run(png(head!, chunk("gAMA", Buffer.from([0, 0, 0xb1, 0x8f])), rest[0]!, chunk("pHYs", Buffer.alloc(9)), rest[1]!, tail)),
};
