import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fromEarlierAsk } from "../../src/frontend/components/lesson/from-earlier-ask-model.ts";

const idle = { waiting: true, open: false, shown: false, sending: false, busy: false };

describe("fromEarlierAsk", () => {
	it("with no agent, Keep going at a stop asks again once its go-ahead starts a turn", () => {
		const atStop = fromEarlierAsk(idle);
		const keptGoing = fromEarlierAsk({ ...idle, busy: true });
		assert.notEqual(atStop, null);
		assert.notEqual(keptGoing, null);
		assert.notEqual(keptGoing, atStop, "a new key, so a new ask");
	});

	it("never asks while something is open, shown or on its way, or outside a wait", () => {
		for (const over of [{ waiting: false }, { open: true }, { shown: true }, { sending: true }]) {
			assert.equal(fromEarlierAsk({ ...idle, busy: true, ...over }), null, JSON.stringify(over));
		}
	});
});
