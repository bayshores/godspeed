/** The app's half tones: hard 2-point cells from one ordered dither, never a soft gradient. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DITHER_BAND, DITHER_VARS, HALF_TONE, ditherEnds } from "../../src/frontend/lib/dither.ts";

/** The cells an SVG mask image keeps, as "x,y" pairs. */
function cells(maskImage: string): string[] {
	const svg = decodeURIComponent(/data:image\/svg\+xml,([^"]+)"/.exec(maskImage)![1]!);
	return [...svg.matchAll(/M(\d+) (\d+)h2v2h-2z/g)].map((m) => `${m[1]},${m[2]}`);
}

describe("the dither", () => {
	it("a box's ends dissolve over the band and nowhere is the mask a soft gradient", () => {
		for (const ends of ["start", "end", "both"] as const) {
			const mask = ditherEnds(ends);
			assert.doesNotMatch(String(mask.maskImage), /linear-gradient\((?!#000, #000\))/, ends);
			assert.match(String(mask.maskSize), new RegExp(`8px ${DITHER_BAND}px`), ends);
		}
		assert.equal(String(ditherEnds("both").maskImage).split("url(").length - 1, 2, "both ends dissolve");
	});

	it("an end thins toward its edge: its last row keeps the fewest cells", () => {
		const foot = cells(String(ditherEnds("end").maskImage));
		const row = (y: number) => foot.filter((c) => c.endsWith(`,${y}`)).length;
		assert.ok(row(DITHER_BAND - 2) < row(0), "fewer cells at the foot than at the top of the band");
	});

	it("a side's band thins toward its own edge, as the top's and the foot's do", () => {
		const column = (image: string, x: number) => cells(image).filter((c) => c.startsWith(`${x},`)).length;
		assert.ok(column(DITHER_VARS["--lh-dither-left"], 0) < column(DITHER_VARS["--lh-dither-left"], DITHER_BAND - 2), "the left band is thinnest at the left");
		assert.ok(column(DITHER_VARS["--lh-dither-right"], DITHER_BAND - 2) < column(DITHER_VARS["--lh-dither-right"], 0), "the right band is thinnest at the right");
	});

	it("the half tone is a checker of 2-point cells: half of each row, never two side by side", () => {
		const kept = cells(String(HALF_TONE.maskImage));
		assert.equal(kept.length, 8, "half of a 4 by 4 tile");
		for (const c of kept) {
			const [x, y] = c.split(",").map(Number);
			assert.ok(!kept.includes(`${x! + 2},${y}`) && !kept.includes(`${x},${y! + 2}`), `${c} has no kept neighbour`);
		}
	});
});
