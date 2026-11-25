import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { brownNoise } from "../../src/shared/core/brown-noise.ts";

/** The same numbers on every run. */
function seeded(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state * 1664525 + 1013904223) % 4294967296;
		return state / 4294967296;
	};
}

const LENGTH = 48000;
const largestStep = (samples: Float32Array) => samples.reduce((most, value, i) => (i === 0 ? most : Math.max(most, Math.abs(value - samples.at(i - 1)!))), 0);
/** How far the loop steps from its last sample to its first. */
const join = (samples: Float32Array) => Math.abs(samples.at(0)! - samples.at(-1)!);

describe("brown noise", () => {
	it("stays within what a speaker takes", () => {
		const samples = brownNoise(LENGTH, seeded(1));
		assert.equal(samples.length, LENGTH);
		assert.ok(samples.every((value) => value >= -1 && value <= 1));
	});

	it("is the same for the same random source", () => {
		assert.deepEqual(brownNoise(LENGTH, seeded(7)), brownNoise(LENGTH, seeded(7)));
		assert.notDeepEqual(brownNoise(LENGTH, seeded(7)), brownNoise(LENGTH, seeded(8)));
	});

	it("loops without a click: the last sample runs on into the first", () => {
		for (const seed of [1, 2, 3, 4, 5]) {
			const samples = brownNoise(LENGTH, seeded(seed));
			assert.ok(join(samples) <= largestStep(samples), `seed ${seed}: the join steps ${join(samples)}`);
		}
	});

	it("is heard: not silence, and carried by its low end", () => {
		const samples = brownNoise(LENGTH, seeded(1));
		const loud = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / LENGTH);
		assert.ok(loud > 0.05 && loud < 0.5, `loudness ${loud}`);
		// White noise steps about as far as it is loud; brown noise moves slowly.
		assert.ok(largestStep(samples) < loud);
	});

	it("a loop shorter than the blend still loops", () => {
		const samples = brownNoise(100, seeded(1));
		assert.ok(join(samples) <= largestStep(samples));
	});
});
