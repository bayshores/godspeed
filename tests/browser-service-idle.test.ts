/**
 * SPEED PLAN PIN (owner-approved 2026-10-27), fix 5 — the helper browser
 * closes after it has been idle (5 minutes in the app), never mid-job, and
 * a new job before the deadline keeps it open.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { createIdleCloser } from "../src/agent/subagents/headless.ts";

describe("createIdleCloser", () => {
	it("closes once after the last job ends and the delay passes", async () => {
		let closes = 0;
		const idle = createIdleCloser(30, () => closes++);
		idle.busy();
		await sleep(60);
		assert.equal(closes, 0, "never closes while a job runs");
		idle.done();
		await sleep(60);
		assert.equal(closes, 1);
	});

	it("a job that starts before the deadline cancels the countdown", async () => {
		let closes = 0;
		const idle = createIdleCloser(40, () => closes++);
		idle.busy();
		idle.done();
		await sleep(15);
		idle.busy();
		await sleep(60);
		assert.equal(closes, 0);
		idle.done();
		await sleep(70);
		assert.equal(closes, 1);
	});

	it("overlapping jobs: the countdown starts only when the last one ends", async () => {
		let closes = 0;
		const idle = createIdleCloser(30, () => closes++);
		idle.busy();
		idle.busy();
		idle.done();
		await sleep(60);
		assert.equal(closes, 0);
		idle.done();
		await sleep(60);
		assert.equal(closes, 1);
	});
});
