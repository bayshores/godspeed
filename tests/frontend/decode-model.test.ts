import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeFrame } from "../../src/frontend/components/ui/decode-model.ts";

describe("decodeFrame", () => {
	it("settles left to right; spaces stay spaces", () => {
		const half = decodeFrame("PS3 Set", 0.5, 0);
		assert.equal(half.slice(0, 3), "PS3");
		assert.equal(half[3], " ");
		assert.match(half.slice(4), /^[░▒▓█]{3}$/);
	});
	it("is the plain text at the end, all noise at the start", () => {
		assert.equal(decodeFrame("PS3", 1, 4), "PS3");
		assert.match(decodeFrame("PS3", 0, 4), /^[░▒▓█]{3}$/);
	});
});
