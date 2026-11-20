import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openChatGoesTo } from "../../src/frontend/components/teacher/teacher-chats-model.ts";

const chat = { id: "0f8fad5b-d9cb-469f-a165-70867728950e", agent: "claude" as const, name: "Practice Test 2", lesson: "chat_t2", at: 0, open: true };

describe("openChatGoesTo", () => {
	it("leads to the lesson the open chat teaches", () => {
		assert.equal(openChatGoesTo(chat, "/"), "/chat/chat_t2");
		assert.equal(openChatGoesTo(chat, "/chat/chat_other"), "/chat/chat_t2");
	});

	it("goes nowhere when that lesson is already the open page, or it taught none", () => {
		assert.equal(openChatGoesTo(chat, "/chat/chat_t2"), null);
		assert.equal(openChatGoesTo({ ...chat, lesson: null }, "/"), null);
	});
});
