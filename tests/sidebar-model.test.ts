import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toggledSidebar } from "../src/components/sidebar-model.ts";

describe("toggledSidebar", () => {
	it("while narrow, a toggle always opens and widens the window", () => {
		assert.deepEqual(toggledSidebar(false, true), { open: true, expand: true });
		assert.deepEqual(toggledSidebar(true, true), { open: true, expand: true });
	});

	it("otherwise it flips and leaves the window alone", () => {
		assert.deepEqual(toggledSidebar(true, false), { open: false, expand: false });
		assert.deepEqual(toggledSidebar(false, false), { open: true, expand: false });
	});
});
