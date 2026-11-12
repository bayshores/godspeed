/** What today's pdf.js code answers for the fixtures; tests/golden.rs replays it on pdfium. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.LH_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "gs-pdf-golden-"));

const { parsePageSpec, pdfExtract, pdfInfo, pdfProbe, pdfSearch, pdfShape } = await import("../../../../src/backend/agent/subagents/pdf-ops.ts");
const { pdfTextOffThread } = await import("../../../../src/backend/server/space-files.ts");
const { realHeadless } = await import("../../../../src/backend/agent/subagents/headless.ts");

const root = path.resolve(import.meta.dirname, "../../../..");
const fixture = (name: string) => path.join(root, "crates/pdf/tests/fixtures", name);
const clean = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null).split(root).join("<root>"));
// Errors read the same on the Rust side once the checkout folder is cut out of them.
const run = <T>(fn: () => Promise<T>) => async () => {
	try {
		return clean(await fn());
	} catch (err) {
		throw new Error((err instanceof Error ? err.message : String(err)).split(root).join("<root>"));
	}
};

const readable = ["sample-3page.pdf", "two-lines.pdf", "lines.pdf", "image-only.pdf", "math.pdf", "rotated.pdf", "cropped.pdf", "hyphen.pdf", "spaces.pdf", "unicode.pdf", "zero-pages.pdf"];
const broken = ["encrypted.pdf", "truncated.pdf", "empty.pdf", "header-only.pdf", "not-a-pdf.txt", "missing.pdf", "."];
const specs = ["all", "ALL", " all ", "1", "2-3", "3-1", "0-2", "1,3,7", " 2 , 1 ", "1-", "-2", "a", "1-2-3", "2,2,1", "", ",", "1.5", "2x", "-1", "9-12", "1 - 2"];
const queries = ["force", "needle", "NEEDLE", "page 1 line", "alpha|beta", "zymurgy", "^Page 3", "line [1-2]$", "a.b", "$5", "(c)"];

const cases: Record<string, () => Promise<unknown>> = {};
for (const total of [0, 1, 3, 12]) {
	cases[`parsePageSpec total ${total}`] = async () => specs.map((spec) => ({ spec, pages: parsePageSpec(spec, total) }));
}
for (const name of [...readable, ...broken]) {
	cases[`text ${name}`] = run(() => pdfTextOffThread(fixture(name)));
	cases[`probe ${name}`] = run(() => pdfProbe(fixture(name)));
	cases[`shape ${name}`] = run(() => pdfShape(fixture(name)));
	cases[`info ${name}`] = run(() => pdfInfo(fixture(name)));
	for (const spec of ["all", "2", "1,3", "1-2", "7", "x"]) cases[`extract ${name} ${spec}`] = run(() => pdfExtract(fixture(name), spec));
}
// A page image's size, read from its header, and how many IDAT chunks it holds.
const facts = (png: Buffer) => {
	let idats = 0;
	for (let at = 8; at < png.length; at += 12 + png.readUInt32BE(at)) if (png.subarray(at + 4, at + 8).toString("ascii") === "IDAT") idats++;
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), idats };
};
for (const name of [...readable, "encrypted.pdf", "truncated.pdf", "empty.pdf", "not-a-pdf.txt", "missing.pdf", "."]) {
	for (const dpi of [undefined, 72, 144]) {
		cases[`render ${name} ${dpi ?? "default"}`] = run(async () => {
			const pages = await realHeadless.renderPdfPages(fixture(name), [0, 1, 2, 3, 99], dpi === undefined ? undefined : { dpi });
			return pages.map((p) => ({ page: p.page, ...facts(p.png) }));
		});
	}
}
// A dpi of 0 or less gets the canvas's default size; past 2 GiB of pixels Skia refuses the page.
const sizes: [string, number][] = [["tiny.pdf", 0], ["tiny.pdf", -72], ["tiny.pdf", 0.5], ["tiny.pdf", 166831.19], ["thin.pdf", 5040]];
for (const [name, dpi] of sizes) {
	cases[`render ${name} ${dpi}`] = run(async () => {
		const pages = await realHeadless.renderPdfPages(fixture(name), [0, 1, 2, 3, 99], { dpi });
		return pages.map((p) => ({ page: p.page, ...facts(p.png) }));
	});
}
for (const name of ["sample-3page.pdf", "lines.pdf", "math.pdf", "missing.pdf", "encrypted.pdf"]) {
	for (const query of queries) {
		for (const literal of [true, false]) {
			cases[`search ${name} ${JSON.stringify(query)} literal ${literal}`] = run(() => pdfSearch(fixture(name), query, { literal }));
		}
	}
}
for (const contextLines of [0, 1, 3, 20, 1.5, -1, Number.NaN]) {
	cases[`search lines.pdf context ${contextLines}`] = run(() => pdfSearch(fixture("lines.pdf"), "needle", { contextLines, literal: true }));
}
for (const query of ["([unclosed", "a)", "*a", "[a-", "\\", "(?<n", "a{2,1}", "[z-a]", "a**", "(?i)abc", "(?<a>x)(?<a>y)", "(?<n>a)\\k<m>", "a/b("]) {
	cases[`search invalid ${query}`] = run(() => pdfSearch(fixture("sample-3page.pdf"), query));
}

export default cases;
