import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { realHeadless } from "../../../../src/backend/agent/subagents/headless.ts";

const headless = new URL("../../../../src/backend/agent/subagents/headless.ts", import.meta.url);

/** svgViewport is not exported, so run its own source text. */
function loadSvgViewport(): (svg: string, opts: { width?: number; height?: number }) => { width: number; height: number } {
	const source = fs.readFileSync(headless, "utf8");
	const start = source.indexOf("function svgViewport");
	const end = source.indexOf("\n}\n", start) + 3;
	return new Function(`${stripTypeScriptTypes(source.slice(start, end))}\nreturn svgViewport;`)();
}

const svgViewport = loadSvgViewport();

const viewports: Record<string, [string, { width?: number; height?: number }]> = {
	"width and height": [`<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg"></svg>`, {}],
	"fractions round up": [`<svg width="320.2" height="240.9"></svg>`, {}],
	"single quotes": [`<svg width='320' height='240'></svg>`, {}],
	"spaces around equals": [`<svg width = "320" height\t=\n"240"></svg>`, {}],
	"no quotes": [`<svg width=320 height=240></svg>`, {}],
	"upper case tag": [`<SVG width="10" height="20"></SVG>`, {}],
	"upper case attribute names do not count": [`<svg WIDTH="10" HEIGHT="20"></svg>`, {}],
	"view box only": [`<svg viewBox="0 0 100 50"></svg>`, {}],
	"width only": [`<svg width="400"></svg>`, {}],
	"height only": [`<svg height="400"></svg>`, {}],
	"percentages are skipped": [`<svg width="100%" height="100%" viewBox="0 0 10 10"></svg>`, {}],
	"units are skipped": [`<svg width="10px" height="5em"></svg>`, {}],
	"stroke-width is not width": [`<svg stroke-width="3" data-width="4" height="30"></svg>`, {}],
	"a child's width is not the root's": [`<svg viewBox="0 0 1 1"><rect width="50" height="60"/></svg>`, {}],
	"zero size": [`<svg width="0" height="0"></svg>`, {}],
	"no svg tag": [`<div width="10" height="20"></div>`, {}],
	"empty": ["", {}],
	"leading text and a comment": [`<?xml version="1.0"?><!-- <svg width="1"> --><svg width="77" height="88"></svg>`, {}],
	"two numbers in a row": [`<svg width="10.5.3" height="12"></svg>`, {}],
	"huge": [`<svg width="99999999999999999999999999999999" height="10"></svg>`, {}],
	"greater than inside a value": [`<svg title="a>b" width="50" height="60"></svg>`, {}],
	"svgx is not svg": [`<svgx width="5" height="6"></svgx><svg width="7" height="8"></svg>`, {}],
	"options win": [`<svg width="320" height="240"></svg>`, { width: 640, height: 480 }],
	"options need both": [`<svg width="320" height="240"></svg>`, { width: 640 }],
	"options with a zero": [`<svg width="320" height="240"></svg>`, { width: 640, height: 0 }],
	"fractional options stay": [`<svg></svg>`, { width: 640.5, height: 100.25 }],
	"negative options stay": [`<svg></svg>`, { width: -5, height: 10 }],
};

const figures: Record<string, [string, { width?: number; height?: number }]> = {
	"blocks": [
		`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="60" height="40" fill="#dc1e1e"/><rect x="60" width="60" height="40" fill="#1ec828"/><rect y="40" width="60" height="40" fill="#2832dc"/><circle cx="90" cy="60" r="15" fill="#e6dc1e" fill-opacity="0.5"/></svg>`,
		{},
	],
	"blocks enlarged by a width option": [
		`<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="60" height="40" fill="#dc1e1e"/><circle cx="90" cy="60" r="15" fill="#2832dc"/></svg>`,
		{ width: 240, height: 160 },
	],
	"view box only uses 900 wide": [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 60"><path d="M0 0L90 0L45 60z" fill="#2832dc"/><line x1="0" y1="30" x2="90" y2="30" stroke="#000" stroke-width="2"/></svg>`,
		{},
	],
	"gradient and stroke": [
		`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><path d="M10 90 Q50 10 90 90" fill="none" stroke="#fff" stroke-width="6"/></svg>`,
		{},
	],
	"transparent figure sits on white": [`<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="10" fill-opacity="0.3"/></svg>`, {}],
	"uneven view box rounds the height to nearest": [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 4"><rect width="7" height="4" fill="#2832dc"/><circle cx="2" cy="2" r="1.5" fill="#dc1e1e"/></svg>`,
		{},
	],
	"fractional width and height scale together": [
		`<svg xmlns="http://www.w3.org/2000/svg" width="100.5" height="50.2"><rect width="50" height="50" fill="#1ec828"/></svg>`,
		{},
	],
	"fractional size rounds up": [`<svg xmlns="http://www.w3.org/2000/svg" width="100.4" height="60.6"><rect width="100" height="60" fill="#1ec828"/></svg>`, {}],
	"external picture is not fetched": [
		`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="60" height="40"><image xlink:href="https://example.com/a.png" width="60" height="40"/><rect width="10" height="10" fill="#f00"/></svg>`,
		{},
	],
	"text figure": [
		`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="10" y="40" font-size="30" fill="#000">Hello</text></svg>`,
		{},
	],
	"not an svg": [`<html><body>hello</body></html>`, {}],
	"broken xml": [`<svg width="10" height="10"><rect`, {}],
	"zero width": [`<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 10 10"></svg>`, {}],
};

/**
 * renderSvg falls back to a real browser when resvg throws, which a test must not start, so the
 * same resvg call is tried first and a throw is recorded as the answer.
 */
async function render(svg: string, opts: { width?: number; height?: number }) {
	try {
		const { width } = svgViewport(svg, opts);
		new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: true }, background: "#ffffff" }).render();
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
	const png = await realHeadless.renderSvg(svg, opts);
	const info = await sharp(png).metadata();
	return { png: png.toString("base64"), width: info.width, height: info.height };
}

export default {
	viewport: () => Object.entries(viewports).map(([name, [svg, opts]]) => ({ name, svg, opts, ...svgViewport(svg, opts) })),
	figures: async () => {
		const out = [];
		for (const [name, [svg, opts]] of Object.entries(figures)) out.push({ name, svg, opts, ...(await render(svg, opts)) });
		return out;
	},
};
