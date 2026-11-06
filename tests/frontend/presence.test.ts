import assert from "node:assert/strict";
import { describe, it } from "node:test";

const query = { matches: false };
let built = 0;
(globalThis as Record<string, unknown>).window = {
	matchMedia: () => {
		built++;
		return query;
	},
};

const { prefersReducedMotion } = await import("../../src/frontend/components/presence.ts");

describe("prefersReducedMotion", () => {
	it("builds the media query once and follows its live value", () => {
		assert.equal(prefersReducedMotion(), false);
		query.matches = true;
		assert.equal(prefersReducedMotion(), true);
		assert.equal(built, 1);
	});
});
