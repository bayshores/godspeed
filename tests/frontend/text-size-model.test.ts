import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { ZOOM_STOPS, zoomFactor, zoomIndex } from "../../src/frontend/components/settings/text-size-model.ts";
import { zoomLabel } from "../../src/frontend/lib/camera.ts";

describe("text size stops", () => {
	it("are the shell's zoom ladder", () => {
		const rust = readFileSync("crates/shell/src/zoom.rs", "utf8");
		const ladder = rust.match(/const LADDER: \[f64; \d+\] = \[([^\]]+)\]/)![1]!.split(",").map(Number);
		assert.deepEqual(Array.from({ length: ZOOM_STOPS }, (_, i) => zoomFactor(i)), ladder);
	});

	it("show as percents", () => {
		assert.deepEqual(Array.from({ length: ZOOM_STOPS }, (_, i) => zoomLabel(zoomFactor(i))), ["75%", "90%", "100%", "110%", "125%", "150%", "175%", "200%"]);
	});

	it("find the stop nearest a factor", () => {
		assert.equal(zoomIndex(1), 2);
		assert.equal(zoomIndex(2), 7);
		assert.equal(zoomIndex(0.5), 0);
		assert.equal(zoomIndex(1.3), 4);
	});
});
