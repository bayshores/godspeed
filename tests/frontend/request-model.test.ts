import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { requestDoing, requestFailedLine, type RequestState } from "../../src/frontend/components/deadline/request-model.ts";

describe("a deadline request in words", () => {
	it("says what the work frame shows while each kind runs", () => {
		assert.equal(requestDoing("coverage"), "working out what's on it");
		assert.equal(requestDoing("guide"), "writing a study guide");
		assert.equal(requestDoing("about"), "rewriting what it's like");
	});
	it("puts why a request changed nothing beside its own Ask only, and nothing while one runs", () => {
		const said: RequestState = { running: null, failed: { kind: "coverage", said: "The files don't say." } };
		assert.equal(requestFailedLine(said, null, "coverage", "Marco"), "Marco: The files don't say.");
		assert.equal(requestFailedLine(said, null, "guide", "Marco"), null);
		assert.equal(requestFailedLine({ ...said, running: "coverage" }, null, "coverage", "Marco"), null);
		const stopped: RequestState = { running: null, failed: { kind: "about", error: "aborted" } };
		assert.equal(requestFailedLine(stopped, null, "about", "Marco"), "Marco couldn't finish: aborted");
		assert.equal(requestFailedLine(null, null, "coverage", "Marco"), null);
	});
	it("shows a start that failed on its own Ask", () => {
		const busy = { kind: "guide" as const, error: "Your agent is still working on this deadline." };
		assert.equal(requestFailedLine(null, busy, "guide", "Marco"), busy.error);
		assert.equal(requestFailedLine(null, busy, "about", "Marco"), null);
	});
});
