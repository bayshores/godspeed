/**
 * streamOnce (the hand-rolled loops' one model call): a failed call still
 * reports its usage before throwing; an aborted one reports none.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, type AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import { streamOnce } from "../src/agent/subagents/stream-once.ts";

function engineEmitting(event: AssistantMessageEvent): PiEngine {
	const faux = createFauxCore({});
	return {
		model: faux.getModel(),
		streamFn: (async function* () {
			yield event;
		}) as unknown as PiEngine["streamFn"],
	};
}

function failedMessage(stopReason: "error" | "aborted") {
	const message = fauxAssistantMessage("");
	return { ...message, stopReason, errorMessage: "provider exploded", usage: { ...message.usage, input: 1234 } };
}

describe("streamOnce usage", () => {
	it("reports a failed call's usage before throwing", async () => {
		const seen: number[] = [];
		const engine = engineEmitting({ type: "error", reason: "error", error: failedMessage("error") });
		await assert.rejects(
			streamOnce(engine, "system", [], [], "s1", undefined, (usage) => seen.push(usage.input)),
			/provider exploded/,
		);
		assert.deepEqual(seen, [1234]);
	});

	it("reports nothing for an aborted call", async () => {
		const seen: number[] = [];
		const engine = engineEmitting({ type: "error", reason: "aborted", error: failedMessage("aborted") });
		await assert.rejects(
			streamOnce(engine, "system", [], [], "s1", undefined, (usage) => seen.push(usage.input)),
			(err: Error) => err.name === "AbortError",
		);
		assert.deepEqual(seen, []);
	});
});
