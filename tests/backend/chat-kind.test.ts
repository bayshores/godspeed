/**
 * SESSION-KIND PINS (practice sessions): ChatRecord.kind
 * is ABSENT-BY-DEFAULT — absence reads as teach, so pre-practice records
 * never migrate; "practice" marks an adaptive-practice session (the
 * practice agent + its two tools from turn 1, no extraction, no graph
 * writes). The store normalizes at the summary projection; createChat
 * stamps the marker only for practice. Runs under an isolated LH_DATA_DIR
 * (the chat-birth-stamp discipline: the seam is set before any
 * config-loading import, so every app-module import is dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

// ── the seam, BEFORE any config-loading import ──────────────────────────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chat-kind-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../../src/backend/store/chats.ts");
type LhMessage = import("../../src/shared/core/native-messages.ts").LhMessage;

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

describe("session kind (practice sessions)", () => {
	it("createChat default carries NO kind field — absence reads as teach", () => {
		const chat = chatStore.createChat("plain session");
		assert.equal("kind" in chat, false, "teach records carry no kind marker");
	});

	it("createChat(kind: 'practice') stamps the marker on record + list", () => {
		const chat = chatStore.createChat("practice session", "practice");
		assert.equal(chat.kind, "practice");
		const listed = chatStore.listChats().find((c) => c.id === chat.id);
		assert.equal(listed?.kind, "practice");
	});

	it("the summary projection NORMALIZES: absent record field reads as teach", () => {
		const chat = chatStore.createChat("another plain one");
		const listed = chatStore.listChats().find((c) => c.id === chat.id);
		assert.equal(listed?.kind, "teach");
	});

	it("a study session's summary starts at teach", () => {
		const chat = chatStore.createChat("study session", "study");
		const listed = chatStore.listChats().find((c) => c.id === chat.id);
		assert.equal(listed?.kind, "study");
		assert.equal(listed?.phase, "teach");
	});

	it("pendingProblem: a posed problem waits for the learner until it is concluded", () => {
		const chat = chatStore.createChat("problem waiting", "study");
		const pose = [
			{ id: "a1", role: "assistant", content: [{ type: "toolCall", id: "p1", name: "problem", arguments: {} }], timestamp: 1 },
			{ id: "r1", role: "toolResult", toolCallId: "p1", toolName: "problem", content: [{ type: "text", text: "posed" }], isError: false, timestamp: 2 },
		] as unknown as LhMessage[];
		chatStore.saveMessages(chat.id, pose);
		assert.equal(chatStore.listChats().find((c) => c.id === chat.id)?.pendingProblem, true);
		const concluded = [
			...pose,
			{ id: "a2", role: "assistant", content: [{ type: "toolCall", id: "c1", name: "conclude", arguments: {} }], timestamp: 3 },
			{ id: "r2", role: "toolResult", toolCallId: "c1", toolName: "conclude", content: [{ type: "text", text: "done" }], isError: false, timestamp: 4 },
		] as unknown as LhMessage[];
		chatStore.saveMessages(chat.id, concluded);
		assert.equal(chatStore.listChats().find((c) => c.id === chat.id)?.pendingProblem, false);
	});
});
