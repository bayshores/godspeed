import sharp from "sharp";
import { storeAttachments } from "../../../../src/backend/server/attachments.ts";

type Rgba = [number, number, number, number];

const RED: Rgba = [220, 30, 30, 255];
const GREEN: Rgba = [30, 200, 40, 255];
const BLUE: Rgba = [40, 50, 220, 255];
const YELLOW: Rgba = [230, 220, 30, 255];

/** Four flat quadrants (top left, top right, bottom left, bottom right), so a turn or flip shows. */
function quadrants(width: number, height: number, colors: Rgba[] = [RED, GREEN, BLUE, YELLOW], channels: 1 | 3 | 4 = 4): Buffer {
	const raw = Buffer.alloc(width * height * channels);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const color = colors[(y < height / 2 ? 0 : 2) + (x < width / 2 ? 0 : 1)]!;
			const at = (y * width + x) * channels;
			for (let c = 0; c < channels; c++) raw[at + c] = color[c]!;
		}
	}
	return raw;
}

const picture = (width: number, height: number, channels: 1 | 3 | 4 = 4, colors?: Rgba[]) =>
	sharp(quadrants(width, height, colors, channels), { raw: { width, height, channels } });

/** What the Rust side compares: the stored picture's type, size and a few pixels. */
async function run(input: Buffer, mimeType = "image/png") {
	const data = input.toString("base64");
	try {
		const [part] = await storeAttachments([{ name: "pic", mimeType, data }], () => "");
		if (part?.type !== "image") throw new Error("not an image part");
		const out = Buffer.from(part.data, "base64");
		const meta = await sharp(out).metadata();
		const { data: pixels, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
		const samples = [0.25, 0.75].flatMap((fy) =>
			[0.25, 0.75].map((fx) => {
				const at = (Math.floor(info.height * fy) * info.width + Math.floor(info.width * fx)) * 4;
				return [...pixels.subarray(at, at + 4)];
			}),
		);
		return { input: data, mimeType: part.mimeType, width: info.width, height: info.height, channels: meta.channels, depth: meta.depth, samples };
	} catch (err) {
		return { input: data, error: err instanceof Error ? err.message : String(err) };
	}
}

const jpegWith = (orientation: number) => picture(300, 200, 3).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).withMetadata({ orientation }).toBuffer();

const cases: Record<string, () => Promise<unknown>> = {
	"jpeg upright": async () => run(await picture(800, 600, 3).jpeg({ quality: 95 }).toBuffer(), "image/jpeg"),
	"jpeg too big": async () => run(await picture(2000, 1500, 3).jpeg({ quality: 90 }).toBuffer(), "image/jpeg"),
	"jpeg tall and thin": async () => run(await picture(40, 4000, 3).jpeg().toBuffer(), "image/jpeg"),
	"jpeg grey": async () => run(await picture(300, 200, 1, [[60, 0, 0, 255], [200, 0, 0, 255], [120, 0, 0, 255], [30, 0, 0, 255]]).jpeg().toBuffer(), "image/jpeg"),
	"png opaque screenshot": async () => run(await picture(400, 300, 3).png().toBuffer()),
	"png opaque large but plain": async () => run(await picture(2000, 1300, 3).png().toBuffer()),
	"png with rgba but opaque": async () => run(await picture(400, 300, 4).png().toBuffer()),
	"png see-through": async () =>
		run(await picture(400, 300, 4, [[220, 30, 30, 0], [30, 200, 40, 128], [40, 50, 220, 255], [230, 220, 30, 255]]).png().toBuffer()),
	"png see-through and large": async () =>
		run(await picture(1800, 1200, 4, [[220, 30, 30, 0], [30, 200, 40, 128], [40, 50, 220, 255], [230, 220, 30, 255]]).png().toBuffer()),
	"png one faint pixel": async () => {
		const raw = quadrants(200, 100, [BLUE, BLUE, BLUE, BLUE], 4);
		raw[3] = 254;
		return run(await sharp(raw, { raw: { width: 200, height: 100, channels: 4 } }).png().toBuffer());
	},
	"png grey": async () => run(await picture(300, 200, 1, [[60, 0, 0, 255], [200, 0, 0, 255], [120, 0, 0, 255], [30, 0, 0, 255]]).png().toBuffer()),
	"png grey with alpha": async () =>
		run(await sharp(Buffer.from([10, 255, 90, 0, 200, 128, 250, 255, 10, 255, 90, 0, 200, 128, 250, 255]), { raw: { width: 4, height: 2, channels: 2 } }).png().toBuffer()),
	"png palette": async () => run(await picture(300, 200, 3).png({ palette: true, colours: 8 }).toBuffer()),
	"png palette with transparency": async () =>
		run(await picture(300, 200, 4, [[220, 30, 30, 0], [30, 200, 40, 255], [40, 50, 220, 255], [230, 220, 30, 255]]).png({ palette: true, colours: 8 }).toBuffer()),
	"png 16-bit": async () => run(await picture(300, 200, 3).toColourspace("rgb16").png().toBuffer()),
	"png 16-bit see-through": async () =>
		run(await picture(300, 200, 4, [[220, 30, 30, 0], [30, 200, 40, 128], [40, 50, 220, 255], [230, 220, 30, 255]]).toColourspace("rgb16").png().toBuffer()),
	"png one pixel": async () => run(await picture(1, 1, 3).png().toBuffer()),
	"png very wide": async () => run(await picture(20000, 10, 3).png().toBuffer()),
	"png turned by its EXIF": async () => run(await picture(300, 200, 3).png().withMetadata({ orientation: 6 }).toBuffer()),
	"png without its end chunk": async () => {
		const png = await picture(300, 200, 3).png().toBuffer();
		return run(png.subarray(0, png.length - 12));
	},
	// Five rows shrink to a few, and the two resize kernels blend rows differently, so the rows share a colour.
	"png side on a half rounds up": async () => run(await picture(3136, 5, 3, [RED, GREEN, RED, GREEN]).png().toBuffer()),
	"jpeg read at half size": async () => run(await picture(4704, 5, 3, [RED, GREEN, RED, GREEN]).jpeg().toBuffer(), "image/jpeg"),
	"webp side on a half rounds to even": async () =>
		run(await picture(3136, 5, 3, [RED, GREEN, RED, GREEN]).webp({ lossless: true }).toBuffer(), "image/webp"),
	"gif opaque": async () => run(await picture(300, 200, 3).gif().toBuffer(), "image/gif"),
	"gif see-through": async () =>
		run(await picture(300, 200, 4, [[220, 30, 30, 0], [30, 200, 40, 255], [40, 50, 220, 255], [230, 220, 30, 255]]).gif().toBuffer(), "image/gif"),
	"gif two frames": async () => {
		const first = await picture(300, 200, 3).png().toBuffer();
		const second = await picture(300, 200, 3, [BLUE, YELLOW, RED, GREEN]).png().toBuffer();
		return run(await sharp([first, second], { join: { animated: true } }).gif().toBuffer(), "image/gif");
	},
	"webp lossy opaque": async () => run(await picture(300, 200, 3).webp({ quality: 95 }).toBuffer(), "image/webp"),
	"webp lossless opaque": async () => run(await picture(300, 200, 3).webp({ lossless: true }).toBuffer(), "image/webp"),
	"webp lossy see-through": async () =>
		run(await picture(300, 200, 4, [[220, 30, 30, 0], [30, 200, 40, 255], [40, 50, 220, 255], [230, 220, 30, 255]]).webp({ quality: 95 }).toBuffer(), "image/webp"),
	"webp lossless see-through": async () =>
		run(await picture(300, 200, 4, [[220, 30, 30, 0], [30, 200, 40, 128], [40, 50, 220, 255], [230, 220, 30, 255]]).webp({ lossless: true }).toBuffer(), "image/webp"),
	"webp turned by its EXIF": async () => run(await picture(300, 200, 3).webp({ lossless: true }).withMetadata({ orientation: 8 }).toBuffer(), "image/webp"),
	"webp two frames": async () => {
		const first = await picture(300, 200, 3).png().toBuffer();
		const second = await picture(300, 200, 3, [BLUE, YELLOW, RED, GREEN]).png().toBuffer();
		return run(await sharp([first, second], { join: { animated: true } }).webp({ lossless: true }).toBuffer(), "image/webp");
	},
	"type says png, bytes are jpeg": async () => run(await picture(300, 200, 3).jpeg().toBuffer(), "image/png"),
	"empty file": async () => run(Buffer.alloc(0)),
	"plain text": async () => run(Buffer.from("this is not a picture at all")),
	"a pdf": async () => run(Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n"), "image/png"),
	"random bytes": async () => run(Buffer.from(Array.from({ length: 4000 }, (_, i) => (i * 7919 + 13) & 0xff))),
	"png cut short": async () => run((await picture(300, 200, 3).png().toBuffer()).subarray(0, 400)),
	"jpeg cut short": async () => run((await picture(800, 600, 3).jpeg({ quality: 95 }).toBuffer()).subarray(0, 1500), "image/jpeg"),
	"gif cut short": async () => run((await picture(300, 200, 3).gif().toBuffer()).subarray(0, 300), "image/gif"),
	"webp cut short": async () => run((await picture(300, 200, 3).webp({ lossless: true }).toBuffer()).subarray(0, 60), "image/webp"),
	"png header only": async () => run((await picture(300, 200, 3).png().toBuffer()).subarray(0, 33)),
};

for (let orientation = 1; orientation <= 8; orientation++) {
	cases[`jpeg exif orientation ${orientation}`] = async () => run(await jpegWith(orientation), "image/jpeg");
}

export default cases;
