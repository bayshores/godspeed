/** The motion tokens are written twice, in globals.css for the style sheet and in presence.ts for code. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { DUR_MS, EASE_IN, EASE_OUT, FAST_MS, PAGE_MS } from "../../src/frontend/components/presence.ts";

const css = fs.readFileSync("src/frontend/globals.css", "utf-8");
const token = (name: string) => css.match(new RegExp(`^\\t--lh-${name}: (.+);$`, "m"))?.[1];

describe("the motion tokens", () => {
	it("are the same in code as in the style sheet", () => {
		assert.equal(token("dur-fast"), `${FAST_MS}ms`);
		assert.equal(token("dur"), `${DUR_MS}ms`);
		assert.equal(token("dur-page"), `${PAGE_MS}ms`);
		assert.equal(token("ease-out"), EASE_OUT);
		assert.equal(token("ease-in"), EASE_IN);
	});
});
