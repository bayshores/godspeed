/**
 * Text colors for any background (core/ink.ts): light or dark text by
 * contrast, each level readable on the background and its panels, a hint
 * of the background's hue, and bold/italic colors kept readable.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contrast, inkFor, readableAccent, shiftHex, wantsDarkText, type InkLevel } from "../src/core/ink.ts";

const MINIMUM: Record<InkLevel, number> = { text: 7, body: 6, muted: 4.5, faint: 3 };
const LEVELS = Object.keys(MINIMUM) as InkLevel[];

function rgb(hex: string): number[] {
	return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

describe("contrast and the light-or-dark choice", () => {
	it("measures WCAG contrast", () => {
		assert.equal(contrast("#000000", "#ffffff"), 21);
		assert.equal(contrast("#777777", "#777777"), 1);
	});

	it("picks the text that reads better", () => {
		for (const bg of ["#000000", "#161616", "#0d1320", "#2050c0", "#3a7d44"]) assert.equal(wantsDarkText(bg), false, bg);
		for (const bg of ["#f4f1ea", "#ffffff", "#ffeb3b", "#ff0000", "#e07020", "#808080"]) assert.equal(wantsDarkText(bg), true, bg);
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
	it("keeps the default grays on black and white", () => {
		assert.deepEqual(LEVELS.map((l) => inkFor("#000000", l)), ["#e6e6e6", "#cfcfcf", "#8d8d8d", "#6e6e6e"]);
		assert.deepEqual(LEVELS.map((l) => inkFor("#ffffff", l)), ["#1a1a1a", "#2b2b2b", "#5f5f5f", "#7b7b7b"]);
	});

	it("meets every level's minimum on the background and its panels, where any color can", () => {
		const panels: Record<string, string> = { "#161616": "#2c2c2c", "#0e1712": "#242d28", "#2a0f16": "#40252c", "#f4f1ea": "#dedbd4", "#dbe8ff": "#c5d2e9", "#ffeb3b": "#e9d525" };
		for (const [bg, panel] of Object.entries(panels)) {
			for (const level of LEVELS) {
				const ink = inkFor(bg, level, [panel]);
				assert.ok(Math.min(contrast(ink, bg), contrast(ink, panel)) >= MINIMUM[level], `${level} on ${bg}: ${ink}`);
			}
		}
	});

	it("goes all the way to black or white when nothing reads better", () => {
		assert.equal(inkFor("#808080", "text"), "#000000");
		assert.equal(inkFor("#3a7d44", "text"), "#ffffff");
		assert.equal(inkFor("#e07020", "text"), "#000000");
	});

	it("takes a hint of the background's hue", () => {
		const [r, g, b] = rgb(inkFor("#2a0f16", "text"));
		assert.ok(r! > g! && r! > b! - 10, "text on wine leans warm");
		const [r2, , b2] = rgb(inkFor("#dbe8ff", "text"));
		assert.ok(b2! > r2!, "text on sky leans blue");
		const [nr, ng, nb] = rgb(inkFor("#161616", "muted"));
		assert.ok(nr === ng && ng === nb, "a gray background gives gray text");
	});
});

describe("readableAccent", () => {
	it("leaves a readable color alone", () => {
		assert.equal(readableAccent("#f2c14e", "#000000"), "#f2c14e");
	});

	it("moves an unreadable color lighter or darker until it reads", () => {
		const onBlack = readableAccent("#2f5fb3", "#000000");
		assert.ok(contrast(onBlack, "#000000") >= 4.5);
		const [r, , b] = rgb(onBlack);
		assert.ok(b! > r!, "still blue");
		const onOrange = readableAccent("#2f5fb3", "#e07020");
		assert.ok(contrast(onOrange, "#e07020") >= 4.5);
	});
});
