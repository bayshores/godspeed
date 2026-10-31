/**
 * Wave E stage 2: renderSvg is NATIVE FIRST — resvg
 * rasterizes in-process; the old Chrome path stays as fallback for
 * exotic-SVG parse failures. These tests pin the native path against real
 * SVGs: attribute-sized, viewBox-only (the 900px default), text-bearing
 * (system fonts), and the canonical single-IDAT PNG form.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { realHeadless } from "../src/agent/subagents/headless.ts";

function pngFacts(buf: Buffer): { w: number; h: number; idats: number } {
	assert.equal(buf.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
	const w = buf.readUInt32BE(16);
	const h = buf.readUInt32BE(20);
	let off = 8;
	let idats = 0;
	while (off < buf.length) {
		const len = buf.readUInt32BE(off);
		const type = buf.subarray(off + 4, off + 8).toString("ascii");
		if (type === "IDAT") idats++;
		off += 12 + len;
	}
	return { w, h, idats };
}

describe("native renderSvg (resvg in-process, browser fallback)", () => {
	it("renders an attribute-sized SVG at its intrinsic size", async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect width="240" height="160" fill="#3355aa"/></svg>';
		const png = await realHeadless.renderSvg(svg);
		const f = pngFacts(png);
		assert.equal(f.w, 240);
		assert.equal(f.h, 160);
		assert.equal(f.idats, 1, "single-IDAT canonical PNG");
	});

	it("viewBox-only SVG gets the 900px-wide default", async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><circle cx="150" cy="100" r="90" fill="#aa5533"/></svg>';
		const png = await realHeadless.renderSvg(svg);
		const f = pngFacts(png);
		assert.equal(f.w, 900, "svgViewport default width");
		assert.equal(f.h, 600, "aspect preserved from viewBox");
	});

	it("a viewBox-only root ignores child widths and stroke-width", async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 200"><line x1="0" y1="0" x2="300" y2="200" stroke="#000" stroke-width="2"/><rect width="100%" height="100%" fill="white"/></svg>';
		const f = pngFacts(await realHeadless.renderSvg(svg));
		assert.equal(f.w, 900);
	});

	it("a percentage root width falls back to the 900px default", async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 300 200"><circle cx="150" cy="100" r="90" fill="#aa5533"/></svg>';
		const f = pngFacts(await realHeadless.renderSvg(svg));
		assert.equal(f.w, 900);
	});

	it("width/height opts override for viewBox-only SVGs", async () => {
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100"><rect width="400" height="100" fill="#33aa55"/></svg>';
		const png = await realHeadless.renderSvg(svg, { width: 500, height: 125 });
		const f = pngFacts(png);
		assert.equal(f.w, 500);
	});

	it("text-bearing SVG renders with system fonts (non-trivial output)", async () => {
		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100">
  <rect width="300" height="100" fill="#ffffff"/>
  <text x="150" y="60" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="32" fill="#111111">Harness</text>
</svg>`;
		const png = await realHeadless.renderSvg(svg);
		const f = pngFacts(png);
		assert.equal(f.w, 300);
		// A blank 300x100 white PNG is ~300 bytes; glyphs push it well past.
		assert.ok(png.length > 1000, `text rendered (png ${png.length} bytes > 1000)`);
	});
});
