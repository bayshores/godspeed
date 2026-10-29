import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { recordRestart } = require("../electron/server-restarts.cjs");

test("allows three restarts within a minute and refuses the fourth", () => {
	let times: number[] = [];
	for (const now of [0, 1_000, 2_000]) times = recordRestart(times, now);
	assert.deepEqual(times, [0, 1_000, 2_000]);
	assert.equal(recordRestart(times, 59_999), null);
});

test("forgets restarts older than a minute", () => {
	assert.deepEqual(recordRestart([0, 1_000, 2_000], 60_000), [1_000, 2_000, 60_000]);
	assert.deepEqual(recordRestart([0, 1_000, 2_000], 200_000), [200_000]);
});
