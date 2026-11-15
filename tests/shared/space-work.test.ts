/**
 * SPACE WORK (core/space-work.ts): which space files are still waiting.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWaitingFile } from "../../src/shared/core/space-work.ts";
import type { SpaceFile, SpaceFileStatus } from "../../src/shared/core/contracts.ts";

const file = (id: string, status: SpaceFileStatus, kind: "study" | "info" = "study"): SpaceFile => ({
	id,
	origin: "copied",
	name: `${id}.pdf`,
	path: `${id}.pdf`,
	kind,
	contentFp: "",
	status,
	addedAt: "2026-11-01T00:00:00.000Z",
});

describe("isWaitingFile", () => {
	it("is a study file that is pending or being read", () => {
		assert.equal(isWaitingFile(file("a", "pending")), true);
		assert.equal(isWaitingFile(file("a", "extracting")), true);
		assert.equal(isWaitingFile(file("a", "ready")), false);
		assert.equal(isWaitingFile(file("a", "failed")), false);
		assert.equal(isWaitingFile(file("a", "pending", "info")), false);
	});
});
