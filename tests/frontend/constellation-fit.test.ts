/**
 * How big the Graph picture is drawn
 * (src/frontend/components/graph/constellation-fit.ts): never above full
 * size, always inside its box, and names hidden exactly when they would be
 * drawn under 11 px.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAME_PX, fitPicture, namesHidden } from "../../src/frontend/components/graph/constellation-fit.ts";
import { layoutSky } from "../../src/frontend/components/graph/constellation-layout.ts";
import { course, measure, one, sixty, type Space } from "../constellation-fixture.ts";

const fit = (sp: Space, width: number, height: number) => fitPicture((w) => layoutSky(sp.topics, sp.links, sp.facts, w, measure), { width, height });

const BOXES: [number, number][] = [
	[1192, 584],
	[1052, 384],
	[836, 584],
	[592, 300],
	[400, 160],
];

describe("fitting the graph picture to its box", () => {
	for (const [name, make] of [
		["one topic", one],
		["the course", course],
		["60 topics", sixty],
	] as const)
		it(`keeps ${name} at most full size and inside every box`, () => {
			for (const [w, h] of BOXES) {
				const { sky, scale } = fit(make(), w, h);
				assert.ok(scale > 0 && scale <= 1, `scale ${scale} at ${w} by ${h}`);
				assert.ok(sky.width * scale <= w + 0.001, `${sky.width * scale} wide in ${w}`);
				assert.ok(sky.height * scale <= h + 0.001, `${sky.height * scale} tall in ${h}`);
			}
		});

	it("draws a picture that already fits at full size, laid out at the box's width", () => {
		const sp = one();
		const { sky, scale } = fit(sp, 1192, 2000);
		assert.equal(scale, 1);
		assert.equal(sky.width, 1192);
	});

	it("shrinks 60 topics in a short box, and the shrunk picture fills most of the box", () => {
		const { sky, scale } = fit(sixty(), 1052, 384);
		assert.ok(scale < 1);
		const used = Math.max((sky.width * scale) / 1052, (sky.height * scale) / 384);
		assert.ok(used > 0.9, `uses ${used} of the box`);
	});

	it("hides names exactly when they would be drawn under 11 px", () => {
		assert.equal(namesHidden(1), false);
		assert.equal(namesHidden(11 / NAME_PX), false);
		assert.equal(namesHidden(11 / NAME_PX - 0.001), true);
		assert.equal(namesHidden(0.5), true);
	});
});
