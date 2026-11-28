/** A pixel icon is drawn a whole number of points per grid pixel, the nearest to the height asked for. */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

const { PixelGrid, PixelIcon } = await import("../../src/frontend/components/ui/pixel-icon.tsx");

/** The grid (from the view box) and the drawn size (from the inline style) of a rendered icon. */
function drawn(html: string) {
	const [, columns, rows] = html.match(/viewBox="0 0 (\d+) (\d+)"/)!.map(Number);
	const [, width, height] = html.match(/style="width:(\d+(?:\.\d+)?)px;height:(\d+(?:\.\d+)?)px"/)!.map(Number);
	return { columns: columns!, rows: rows!, width: width!, height: height! };
}

describe("a pixel icon", () => {
	it("snaps every asked height to a whole multiple of its grid, the nearest one", () => {
		for (const name of ["chevron", "close", "check", "plus", "folder", "pencil", "crystal", "more"] as const) {
			for (const size of [3, 5, 7, 8, 9, 10, 10.5, 11, 12, 13, 14, 15, 18, 20, 27]) {
				const { columns, rows, width, height } = drawn(renderToStaticMarkup(<PixelIcon name={name} size={size} />));
				const scale = height / rows;
				assert.ok(Number.isInteger(scale) && scale >= 1, `${name} at ${size}: ${scale} points per pixel`);
				assert.equal(width, columns * scale, `${name} at ${size}: square pixels`);
				const best = Math.max(1, Math.round(size / rows));
				assert.equal(scale, best, `${name} at ${size}: the nearest whole scale`);
			}
		}
	});

	it("without a size it is drawn near 11 points, set inline where a sizing class cannot win", () => {
		const html = renderToStaticMarkup(<PixelGrid rows={["#.#", ".#.", "#.#"]} className="h-4 w-8" />);
		assert.deepEqual(drawn(html), { columns: 3, rows: 3, width: 12, height: 12 });
	});
});
