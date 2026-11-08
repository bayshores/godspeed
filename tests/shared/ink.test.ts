/**
 * Text colors for dark backgrounds (core/ink.ts): each level readable on
 * the background and its panels, a hint of the background's hue, a picked
 * color made dark enough, the accent tint, and bold/italic colors kept
 * readable.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrast, darkBackground, inkFor, inkReaches, readableAccent, shiftHex, tintFor, type InkLevel } from "../../src/shared/core/ink.ts";

const MINIMUM: Record<InkLevel, number> = { text: 7, body: 6, muted: 4.5, faint: 4.5, edge: 3 };
const LEVELS = Object.keys(MINIMUM) as InkLevel[];

function rgb(hex: string): number[] {
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

describe("contrast", () => {
	it("measures WCAG contrast", () => {
		assert.equal(contrast("#000000", "#ffffff"), 21);
		assert.equal(contrast("#777777", "#777777"), 1);
	});
});

describe("shiftHex", () => {
	it("moves every channel and clamps at the ends", () => {
		assert.equal(shiftHex("#000000", 8), "#080808");
		assert.equal(shiftHex("#ffffff", 8), "#ffffff");
		assert.equal(shiftHex("#fff", -8), "#f7f7f7");
		assert.equal(shiftHex("#102030", -20), "#000c1c");
	});
});

describe("inkFor", () => {
	it("keeps the default grays on black", () => {
		assert.deepEqual(LEVELS.map((l) => inkFor("#000000", l)), ["#e6e6e6", "#cfcfcf", "#8d8d8d", "#7a7a7a", "#5a5a5a"]);
	});

	it("meets every level's minimum on the background and its panels", () => {
		const panels: Record<string, string> = { "#161616": "#2c2c2c", "#0e1712": "#242d28", "#2a0f16": "#40252c", "#0d1320": "#232936" };
		for (const [bg, panel] of Object.entries(panels)) {
			for (const level of LEVELS) {
				const ink = inkFor(bg, level, [panel]);
				assert.ok(Math.min(contrast(ink, bg), contrast(ink, panel)) >= MINIMUM[level], `${level} on ${bg}: ${ink}`);
			}
		}
	});

	it("goes all the way to white when nothing else reads", () => {
		assert.equal(inkFor("#3a7d44", "text"), "#ffffff");
	});

	it("takes a hint of the background's hue", () => {
		const [r, g, b] = rgb(inkFor("#2a0f16", "text"));
		assert.ok(r! > g! && r! > b! - 10, "text on wine leans warm");
		const [nr, ng, nb] = rgb(inkFor("#161616", "muted"));
		assert.ok(nr === ng && ng === nb, "a gray background gives gray text");
	});
});

describe("inkReaches", () => {
	it("says whether a level can meet its minimum at all", () => {
		assert.equal(inkReaches("#000000", "text", ["#161616"]), true);
		assert.equal(inkReaches("#777777", "muted", ["#8e8e8e"]), false, "mid gray: white can't reach 4.5 on its tone");
	});
});

describe("darkBackground", () => {
	const none = () => [];
	it("leaves a dark color alone", () => {
		for (const bg of ["#000000", "#161616", "#0d1320", "#0e1712", "#1d1422"]) assert.equal(darkBackground(bg, none), bg);
	});

	it("darkens a light color and keeps its hue", () => {
		const paper = darkBackground("#f4f1ea", none);
		assert.ok(contrast("#ffffff", paper) >= 7, `${paper} holds light text`);
		const [r, , b] = rgb(darkBackground("#3366cc", none));
		assert.ok(b! > r!, "blue stays blue");
	});
});

describe("tintFor", () => {
	it("is a readable pale tint of the background's hue, gray on a gray background", () => {
		assert.equal(tintFor("#000000"), tintFor("#161616"));
		const [r, g, b] = rgb(tintFor("#000000"));
		assert.ok(r === g && g === b, "gray on black");
		const [fr, fg, fb] = rgb(tintFor("#0e1712"));
		assert.ok(fg! > fr! && fg! > fb!, "green on Forest");
		for (const bg of ["#000000", "#0d1320", "#0e1712", "#1d1422"]) assert.ok(contrast(tintFor(bg), bg) >= 7, bg);
	});
});

describe("readableAccent", () => {
	it("leaves a readable color alone", () => {
		assert.equal(readableAccent("#f2c14e", "#000000"), "#f2c14e");
	});

	it("moves an unreadable color lighter until it reads, keeping its hue", () => {
		const onBlack = readableAccent("#2f5fb3", "#000000");
		assert.ok(contrast(onBlack, "#000000") >= 4.5);
		const [r, , b] = rgb(onBlack);
		assert.ok(b! > r!, "still blue");
	});

	it("reads on the panels too", () => {
		const red = readableAccent("#ef4444", "#000000", ["#161616", "#2f2f2f"]);
		for (const s of ["#000000", "#161616", "#2f2f2f"]) assert.ok(contrast(red, s) >= 4.5, `${red} on ${s}`);
	});
});
