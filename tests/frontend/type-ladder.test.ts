/**
 * The type ladder: every size globals.css names is a size to the class merger too, and no
 * component sets an interface size of its own.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { cn } from "../../src/frontend/lib/utils.ts";

const css = fs.readFileSync("src/frontend/globals.css", "utf-8");
const sizes = [...css.matchAll(/^\t--text-([a-z0-9]+):/gm)].map((match) => match[1]);

describe("the type ladder", () => {
	it("names sizes in globals.css", () => {
		assert.ok(sizes.includes("ui") && sizes.includes("sm"), `read ${sizes.join(", ")}`);
	});

	it("keeps a named size beside a color, and lets a later size replace it", () => {
		for (const size of sizes) {
			assert.equal(cn(`text-${size}`, "text-ink"), `text-${size} text-ink`);
			assert.equal(cn(`text-${size}`, "text-xs"), "text-xs");
			assert.equal(cn("text-xs", `text-${size}`), `text-${size}`);
		}
	});

	it("reads a rung's size taken alone as a size", () => {
		assert.equal(cn("text-(length:--text-sm)", "text-ink"), "text-(length:--text-sm) text-ink");
		assert.equal(cn("text-xs", "text-(length:--text-sm)"), "text-(length:--text-sm)");
	});
});
