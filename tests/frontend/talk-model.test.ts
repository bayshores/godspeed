import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LhViewMessage } from "../../src/shared/core/view.ts";
import { readEarlier, talkError, talkLines } from "../../src/frontend/components/teacher/talk-model.ts";
import { STREAM_DROPPED } from "../../src/frontend/components/session-core.ts";

const text = (value: string) => ({ type: "text", text: value });
const you = (id: string, ...parts: LhViewMessage["parts"]): LhViewMessage => ({ id, role: "user", parts });
const teacher = (id: string, ...parts: LhViewMessage["parts"]): LhViewMessage => ({ id, role: "assistant", parts });

describe("the thread's lines", () => {
	it("puts the earlier words first, then each message in order", () => {
		const earlier = readEarlier([
			{ role: "user", text: "what is a limit" },
			{ role: "assistant", text: "A limit is where a function heads." },
		]);
		const lines = talkLines([you("m1", text("and a derivative?")), teacher("m2", text("A slope."))], earlier, false);
		assert.deepEqual(
			lines.map((l) => [l.who, l.text]),
			[
				["you", "what is a limit"],
				["teacher", "A limit is where a function heads."],
				["you", "and a derivative?"],
				["teacher", "A slope."],
			],
		);
		assert.ok(lines.every((l) => !l.writing), "earlier words are never being written");
	});

	it("keeps a learner line's files, and joins an assistant message's text parts", () => {
		const picture = { type: "data-image", data: { name: "graph.png" } };
		const lines = talkLines([you("m1", text("see this"), picture), teacher("m2", text("First."), { type: "tool-search_graph" }, text("Second."))], [], false);
		assert.deepEqual(lines[0]!.files, [picture]);
		assert.equal(lines[0]!.text, "see this");
		assert.equal(lines[1]!.text, "First.\n\nSecond.", "the tool call between them is not a line");
	});

	it("keeps a learner line that is only a file", () => {
		const lines = talkLines([you("m1", { type: "data-pdf", data: {} })], [], false);
		assert.equal(lines.length, 1);
		assert.equal(lines[0]!.text, "");
		assert.equal(lines[0]!.files.length, 1);
	});

	it("marks the newest assistant line as writing only while a reply is written", () => {
		const messages = [you("m1", text("hi")), teacher("m2", text("Hel"))];
		assert.deepEqual(talkLines(messages, [], true).map((l) => l.writing), [false, true]);
		assert.deepEqual(talkLines(messages, [], false).map((l) => l.writing), [false, false]);
		const earlierReply = [you("m0", text("a")), teacher("m1", text("b")), you("m2", text("c"))];
		assert.ok(talkLines(earlierReply, [], true).every((l) => !l.writing), "the newest message is the learner's: nothing is being written yet");
	});

	it("keeps a reply that has no words yet while it is written, and leaves out empty messages otherwise", () => {
		const started = [you("m1", text("hi")), teacher("m2")];
		const open = talkLines(started, [], true);
		assert.deepEqual(open.map((l) => [l.who, l.text, l.writing]), [["you", "hi", false], ["teacher", "", true]]);
		const settled = talkLines([you("m1", text("  ")), teacher("m2", { type: "tool-read_space" }), you("m3", text("ok"))], [], false);
		assert.deepEqual(settled.map((l) => l.text), ["ok"], "blank words and a step with no words are not lines");
	});

	it("gives a message with no id a key from its place", () => {
		const lines = talkLines([you("", text("hi"))], [], false);
		assert.equal(lines[0]!.key, "m:0");
	});
});

describe("the words a chat carried over", () => {
	it("keeps rows with a role and words, and nothing else", () => {
		assert.deepEqual(readEarlier(undefined), []);
		assert.deepEqual(readEarlier("words"), []);
		assert.deepEqual(
			readEarlier([{ role: "user", text: "a" }, { role: "system", text: "b" }, { role: "assistant", text: "" }, { role: "assistant", text: 4 }, null, { role: "assistant", text: "c" }]),
			[{ role: "user", text: "a" }, { role: "assistant", text: "c" }],
		);
	});
});

describe("the error row", () => {
	it("says a message that did not go through, with no key: Send sends it again", () => {
		assert.deepEqual(talkError("The send failed: 500"), { text: "Your message didn't go through.", retry: null });
		assert.deepEqual(talkError("Your input could not be saved"), { text: "Your message didn't go through.", retry: null });
	});

	it("says a lost connection, with a key that reads the reply again", () => {
		for (const message of [STREAM_DROPPED, "Failed to attach to the turn", "Failed to fetch"]) assert.deepEqual(talkError(message), { text: "The app lost its connection to the reply.", retry: "read" }, message);
	});

	it("says a reply that stopped, with a key that runs it again", () => {
		assert.deepEqual(talkError("The agent exited with code 1"), { text: "The reply stopped with an error.", retry: "again" });
	});
});
