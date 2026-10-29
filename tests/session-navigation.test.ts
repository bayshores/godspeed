import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	firstSourceTextParts, messageAnchorId, messageIdFromHash, textPartMessageId,
} from "../src/core/session-navigation.ts";
import { projectView } from "../src/core/view.ts";
import type { LhMessage } from "../src/core/native-messages.ts";

function teacher(id: string, content: unknown[]): LhMessage {
	return { id, role: "assistant", content, stopReason: "stop", timestamp: 0, provider: "openrouter", model: "test" } as LhMessage;
}

describe("message anchors", () => {
	it("an encoded anchor hash round-trips the actual message ID", () => {
		const hash = `#${encodeURIComponent(messageAnchorId("msg /%#a"))}`;
		assert.equal(messageIdFromHash(hash), "msg /%#a");
	});

	it("recognizes only non-empty, well-formed message hashes", () => {
		assert.equal(messageAnchorId("msg_a"), "message-msg_a");
		assert.equal(messageIdFromHash("#message-msg_a"), "msg_a");
		for (const hash of ["", "#", "#message-", "#other-msg_a", "#message-%ZZ"]) {
			assert.equal(messageIdFromHash(hash), null, hash);
		}
	});
});

describe("native message anchors survive assistant grouping", () => {
	it("anchors each native teacher message, not only the group's first ID", () => {
		const messages = [
			teacher("msg_a", [{ type: "text", text: "First passage." }]),
			teacher("msg_b", [{ type: "thinking", thinking: "Noise" }, { type: "text", text: "Second passage." }]),
			teacher("msg_c", [{ type: "text", text: "Third passage." }]),
		];
		const view = projectView(messages);
		assert.equal(view.length, 1, "three native messages form one assistant group");
		assert.deepEqual([...firstSourceTextParts(view)], [
			["msg_a", "msg_a-t0"], ["msg_b", "msg_b-t0"], ["msg_c", "msg_c-t0"],
		]);
	});

	it("empty prose and tools do not steal the first non-empty prose anchor", () => {
		const view = projectView([teacher("msg_a", [
			{ type: "text", text: " \n " },
			{ type: "toolCall", id: "tool_a", name: "probe", arguments: {} },
			{ type: "text", text: "Actual source passage." },
			{ type: "text", text: "Later prose from the same message." },
		])]);
		assert.deepEqual([...firstSourceTextParts(view)], [["msg_a", "msg_a-t1"]]);
	});

	it("learner text and teacher messages without prose acquire no source anchor", () => {
		const view = projectView([
			{ id: "user_a", role: "user", content: "Learner text", timestamp: 1 } as LhMessage,
			teacher("msg_a", [{ type: "thinking", thinking: "Private reasoning" }]),
			teacher("msg_b", [{ type: "text", text: "\n\t" }]),
		]);
		assert.equal(firstSourceTextParts(view).size, 0);
	});

	it("reads the suffix only, preserving IDs containing hyphens or -t themselves", () => {
		assert.equal(textPartMessageId("msg_a-t12"), "msg_a");
		assert.equal(textPartMessageId("msg-a-t4-t12"), "msg-a-t4");
		for (const id of [undefined, "", "-t0", "msg_a-r0", "msg_a-twat"]) assert.equal(textPartMessageId(id), null);
	});
});
