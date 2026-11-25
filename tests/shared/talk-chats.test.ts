import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAgentModels } from "../../src/shared/core/contracts/agent-models.ts";
import { readTalkChats } from "../../src/shared/core/contracts/talk-chats.ts";

const chat = { id: "chat_1", title: "Limits proof", updatedAt: "2026-11-24T10:00:00.000Z", agent: "claude", model: "sonnet", running: true };

describe("the teacher panel's chats in a read of GET /api/chats?kind=talk", () => {
	it("keeps whole chats in the order sent", () => {
		const second = { ...chat, id: "chat_2", title: "Counting", agent: "codex" };
		assert.deepEqual(readTalkChats({ chats: [chat, second] }), [chat, second]);
	});

	it("gives a chat with no agent, model or running flag its quiet values", () => {
		assert.deepEqual(readTalkChats({ chats: [{ id: "chat_3", title: "New", updatedAt: "2026-11-24T10:00:00.000Z" }] }), [
			{ id: "chat_3", title: "New", updatedAt: "2026-11-24T10:00:00.000Z", agent: null, model: null, running: false },
		]);
		assert.deepEqual(readTalkChats({ chats: [{ ...chat, agent: "gemini", model: "", running: "yes" }] }), [{ ...chat, agent: null, model: null, running: false }], "an agent that is not one of the two, an empty model and a non-true flag are not kept");
	});

	it("leaves out what is not a chat", () => {
		assert.deepEqual(readTalkChats(undefined), []);
		assert.deepEqual(readTalkChats([chat]), [], "the chats are in a list under chats");
		assert.deepEqual(readTalkChats({ chats: "none" }), []);
		const bad = [null, "chat", { ...chat, id: "" }, { ...chat, id: 7 }, { ...chat, title: "" }, { ...chat, updatedAt: undefined }];
		assert.deepEqual(readTalkChats({ chats: [...bad, chat] }), [chat]);
	});
});

describe("the agent's models in a read of GET /api/agent/models", () => {
	const sonnet = { id: "sonnet", name: "Sonnet 5.5", default: true };
	const opus = { id: "opus", name: "Opus", default: false };

	it("keeps whole models in the agent's order", () => {
		assert.deepEqual(readAgentModels({ agent: "claude", models: [sonnet, opus] }), { agent: "claude", models: [sonnet, opus] });
	});

	it("marks a model the default only when the agent says so", () => {
		assert.deepEqual(readAgentModels({ agent: "codex", models: [{ id: "opus", name: "Opus" }, { id: "x", name: "X", default: "yes" }] }).models, [
			{ id: "opus", name: "Opus", default: false },
			{ id: "x", name: "X", default: false },
		]);
	});

	it("leaves out what is not a model or an agent", () => {
		assert.deepEqual(readAgentModels(undefined), { agent: null, models: [] });
		assert.deepEqual(readAgentModels([sonnet]), { agent: null, models: [] }, "the models are in a list under models");
		assert.deepEqual(readAgentModels({ agent: "gemini", models: 3 }), { agent: null, models: [] });
		const bad = [null, "sonnet", { ...sonnet, id: "" }, { ...sonnet, id: 4 }, { ...sonnet, name: "" }, { id: "no-name" }];
		assert.deepEqual(readAgentModels({ models: [...bad, opus] }).models, [opus]);
	});
});
