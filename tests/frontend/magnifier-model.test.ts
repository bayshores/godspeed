import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { centerOn, keepInRoom, panBy, pinchAt, shownPart, UNMAGNIFIED } from "../../src/frontend/components/magnifier/magnifier-model.ts";

const room = { w: 1000, h: 800 };

describe("magnifier", () => {
	it("magnifies at the pointer, keeping what is under it still", () => {
		const cam = pinchAt(UNMAGNIFIED, 2, { x: 300, y: 200 }, room);
		assert.deepEqual(cam, { x: -300, y: -200, zoom: 2 });
		// The page point under the pointer (300, 200) is still drawn at (300, 200).
		assert.deepEqual([300 * cam.zoom + cam.x, 200 * cam.zoom + cam.y], [600 - 300, 400 - 200]);
	});

	it("stops at 400%, and pinching out to 100% or less turns the lens off", () => {
		assert.equal(pinchAt(UNMAGNIFIED, 10, { x: 0, y: 0 }, room).zoom, 4);
		const cam = pinchAt(UNMAGNIFIED, 2, { x: 500, y: 400 }, room);
		assert.deepEqual(pinchAt(cam, 0.4, { x: 500, y: 400 }, room), UNMAGNIFIED);
		assert.deepEqual(pinchAt(UNMAGNIFIED, 0.8, { x: 500, y: 400 }, room), UNMAGNIFIED);
	});

	it("never shows past the room's edges", () => {
		assert.deepEqual(keepInRoom({ x: 50, y: -5000, zoom: 2 }, room), { x: 0, y: -800, zoom: 2 });
		const corner = pinchAt(UNMAGNIFIED, 2, { x: 1000, y: 800 }, room);
		assert.deepEqual(corner, { x: -1000, y: -800, zoom: 2 });
	});

	it("a scroll moves the shown part, and at the edge the scroll goes to the page", () => {
		const cam = { x: -500, y: -400, zoom: 2 };
		assert.deepEqual(panBy(cam, 100, 50, room), { x: -600, y: -450, zoom: 2 });
		assert.deepEqual(panBy(cam, 0, 1000, room), { x: -500, y: -800, zoom: 2 });
		assert.equal(panBy({ x: -500, y: -800, zoom: 2 }, 0, 40, room), null);
		assert.equal(panBy(UNMAGNIFIED, 0, 40, room), null);
	});

	it("the mini map's box is the shown part, and a click on the map centers it there", () => {
		assert.deepEqual(shownPart({ x: -500, y: -400, zoom: 2 }, room), { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
		assert.deepEqual(centerOn({ x: 0, y: 0, zoom: 2 }, 0.5, 0.5, room), { x: -500, y: -400, zoom: 2 });
		assert.deepEqual(centerOn({ x: 0, y: 0, zoom: 2 }, 1, 1, room), { x: -1000, y: -800, zoom: 2 });
	});
});
