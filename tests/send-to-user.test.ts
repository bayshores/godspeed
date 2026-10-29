/** Old lesson records can hold send_to_user calls: closed-network synthetic
 * fixtures only. Native history stays native; UI, extraction, and Markdown
 * read the same prose. No agent registers the tool any more. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { PiEngine } from "../src/agent/models.ts";
import type { AgentBuildOptions } from "../src/agent/teacher-agent.ts";
import type { LhMessage } from "../src/core/native-messages.ts";
// The agent engine loads on first use in the app; agent-building tests load it up front.
await (await import("../src/agent/engine-load.ts")).loadAgentCore();

// Set the data/auth seams BEFORE importing app modules. Do not read local
// keys, recordings, or learner sessions, even if a dev server is running.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lh-send-to-user-"));
const originalEnv = process.env;
const originalFetch = globalThis.fetch;
process.env = {
	...(originalEnv.NODE_TEST_CONTEXT ? { NODE_TEST_CONTEXT: originalEnv.NODE_TEST_CONTEXT } : {}),
	...(originalEnv.NODE_OPTIONS ? { NODE_OPTIONS: originalEnv.NODE_OPTIONS } : {}),
	NODE_ENV: "test",
	LH_DATA_DIR: path.join(scratch, "data"),
	LH_CREDENTIALS_DIR: scratch,
	HOME: path.join(scratch, "home"),
};
globalThis.fetch = async () => { throw new Error("CLOSED: unexpected network request"); };
after(() => {
	process.env = originalEnv;
	globalThis.fetch = originalFetch;
	fs.rmSync(scratch, { recursive: true, force: true });
});

const { createProberAgent, createTeacherAgent, createPracticeAgent } = await import("../src/agent/teacher-agent.ts");
const { SEND_TO_USER_TOOL, sendToUserText, userFacingTextOf } = await import("../src/core/native-messages.ts");
const { coverageOf, messageFingerprint, messageViewLines } = await import("../src/core/coverage.ts");
const { projectView } = await import("../src/core/view.ts");
const { sessionMarkdown } = await import("../src/core/session-markdown.ts");
const { transcriptView } = await import("../src/agent/subagents/extraction.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { jobStore } = await import("../src/store/jobs.ts");

function engineFor(provider: string, id: string): PiEngine {
	const faux = createFauxCore({ provider, models: [{ id }] });
	return { model: faux.getModel(), streamFn: faux.streamSimple };
}

const chatId = chatStore.createChat("Synthetic output gate").id;
const factories = {
	prober: (opts: AgentBuildOptions) => createProberAgent({ chatId, chatStore, jobStore, deliver: () => {}, spawn: () => {} }, opts),
	teacher: (opts: AgentBuildOptions) => createTeacherAgent({ chatId, chatStore, jobStore, spawn: () => {} }, opts),
	practice: (opts: AgentBuildOptions) => createPracticeAgent({ chatId, chatStore }, opts),
};

function outputCall(message: string | number | null = "An explanation.", id = "send-1") {
	return { type: "toolCall" as const, id, name: SEND_TO_USER_TOOL, arguments: { message } };
}
function assistant(content: unknown[], id = "a1"): LhMessage {
	return { ...fauxAssistantMessage(""), content, id } as LhMessage;
}
function ack(callId = "send-1", isError = false): LhMessage {
	return {
		id: `result-${callId}`, role: "toolResult", toolCallId: callId, toolName: SEND_TO_USER_TOOL,
		content: [{ type: "text", text: isError ? "Invalid tool input" : "Message received for display." }],
		details: null, isError, timestamp: 1,
	};
}
function prose(messages: ReturnType<typeof projectView>): string[] {
	return messages.filter((m) => m.role === "assistant").flatMap((m) => m.parts.filter((p) => p.type === "text").map((p) => p.text!));
}

describe("send_to_user registration", () => {
	for (const [provider, id] of [["agent", "outside-agent"], ["anthropic", "claude-opus-5-5"]] as const) {
		it(`${provider}/${id}: no conversation agent registers the tool`, () => {
			for (const [kind, factory] of Object.entries(factories)) {
				const agent = factory({ engine: engineFor(provider, id) });
				assert.ok(!agent.state.tools.some((tool) => tool.name === SEND_TO_USER_TOOL), kind);
			}
		});
	}
});

describe("send_to_user text", () => {
	it("only extracts the output tool's nonblank message, without modifying it", () => {
		const message = "  **Keep spacing and math** $x$\n";
		assert.equal(sendToUserText(outputCall(message)), message);
		for (const block of [null, {}, { type: "text", text: "ordinary" }, outputCall(2), outputCall("  "), { ...outputCall(), name: "other" }]) {
			assert.equal(sendToUserText(block), undefined);
		}
		assert.deepEqual(userFacingTextOf([null, fauxThinking("Not lesson prose."), fauxText("First"), outputCall(message), fauxToolCall("quiz", { question: "Q?" })]), ["First", message]);
	});
});

describe("send_to_user transcript projection", () => {
	it("renders in place as prose, with thinking unchanged and no tool/ack duplication", () => {
		const messages = [assistant([
			fauxText("Before."), outputCall("**The lesson.** $x = 1$"),
			fauxThinking("Private reasoning."), fauxToolCall("quiz", { question: "Q?" }, { id: "quiz-1" }),
			fauxText("After."),
		]), ack()];
		const before = structuredClone(messages);
		const view = projectView(messages);
		assert.deepEqual(view[0]!.parts.map((p) => p.type), ["step-start", "reasoning", "text", "text", "tool-quiz", "text"]);
		assert.deepEqual(prose(view), ["Before.", "**The lesson.** $x = 1$", "After."]);
		assert.equal(view[0]!.parts.find((p) => p.type === "reasoning")!.text, "Private reasoning.");
		assert.deepEqual(view[0]!.parts.filter((p) => p.type === "text").map((p) => p.id), ["a1-t0", "a1-t1", "a1-t2"]);
		assert.deepEqual(messages, before, "projection never rewrites native content");
		assert.deepEqual(projectView(JSON.parse(JSON.stringify(messages))), view, "reload is identical, without consulting a provider gate");
	});

	it("streams available arguments as replacing prose, never as a live tool card", () => {
		const live = { inFlight: true, streamingIds: new Set(["a1"]), executions: new Map() };
		for (const text of ["A", "A growing", "A growing explanation."]) {
			const view = projectView([assistant([outputCall(text)])], live);
			assert.deepEqual(prose(view), [text]);
			assert.ok(!view[0]!.parts.some((p) => p.type.startsWith("tool-")));
		}
		const empty = projectView([assistant([{ ...outputCall(), arguments: {} }])], live);
		assert.deepEqual(prose(empty), []);
		assert.ok(!empty[0]!.parts.some((p) => p.type.startsWith("tool-")));
	});

	it("malformed messages contain no prose; failures keep the existing error path live and after reload", () => {
		assert.deepEqual(prose(projectView([assistant([outputCall(3)])])), []);
		const messages = [assistant([outputCall("Incomplete teaching.")]), ack("send-1", true)];
		const settled = projectView(messages);
		assert.deepEqual(prose(settled), []);
		assert.equal(settled[0]!.parts[1]!.type, "tool-send_to_user");
		assert.equal(settled[0]!.parts[1]!.state, "output-error");
		const live = projectView(messages.slice(0, 1), {
			inFlight: true, streamingIds: new Set(["a1"]),
			executions: new Map([["send-1", { isError: true, errorText: "Invalid tool input" }]]),
		});
		assert.deepEqual(prose(live), []);
		assert.equal(live[0]!.parts[1]!.state, "output-error");
	});
});

describe("send_to_user extraction and Markdown", () => {
	it("selects output prose once and in order, preserving old fingerprints", () => {
		const message = assistant([fauxText("First."), outputCall("Second."), fauxThinking("Hidden."), outputCall("Third.", "send-2")]);
		const messages = [message, ack(), ack("send-2")];
		assert.deepEqual(messageViewLines(message, "a1"), ["TEACHER [a1] First.", "TEACHER [a1] Second.", "TEACHER [a1] Third."]);
		assert.equal(coverageOf(messages, [], "fixture").uncoveredCount, 1);
		const md = sessionMarkdown(messages, { anchors: false });
		assert.equal(md, "### Teacher\n\nFirst.\n\n### Teacher\n\nSecond.\n\n### Teacher\n\nThird.");
		const record = chatStore.createChat("Synthetic extraction");
		assert.equal(transcriptView({ ...record, messages }), "# Synthetic extraction\n\nTEACHER [a1] First.\n\nTEACHER [a1] Second.\n\nTEACHER [a1] Third.");
		const legacy = assistant([fauxText("Old text."), fauxThinking("Old thinking.")], "legacy");
		const oldFingerprint = createHash("sha256").update(JSON.stringify(["assistant", ["TEACHER [legacy] Old text."]])).digest("hex");
		assert.equal(messageFingerprint(legacy), oldFingerprint, "no re-extraction/migration of legacy prose");
	});

	it("does not extract/export failed output calls, including partial calls from truncated responses", () => {
		const message = assistant([fauxText("Keep this."), outputCall("Do not treat this as delivered.")]);
		const messages = [message, ack("send-1", true)];
		assert.equal(sessionMarkdown(messages, { anchors: false }), "### Teacher\n\nKeep this.");
		const record = chatStore.createChat("Failed output fixture");
		assert.ok(!transcriptView({ ...record, messages }).includes("Do not treat"));
		const coverage = coverageOf([assistant([outputCall()]), ack("send-1", true)], [], "fixture");
		assert.equal(coverage.uncoveredCount, 0);
		assert.equal(coverage.uncoveredTokens, 0);
	});
});

describe("send_to_user interrupted generations", () => {
	for (const stopReason of ["error", "aborted"] as const) {
		it(`${stopReason} without a tool result never becomes delivered teaching; ordinary text stays unchanged`, () => {
			const message = { ...assistant([fauxText("Keep ordinary text."), outputCall("Unfinished output.")]), stopReason };
			const messages = [message];
			assert.deepEqual(prose(projectView(messages)), ["Keep ordinary text."]);
			assert.deepEqual(prose(projectView(JSON.parse(JSON.stringify(messages)))), ["Keep ordinary text."]);
			assert.deepEqual(messageViewLines(message, message.id), ["TEACHER [a1] Keep ordinary text."]);
			assert.equal(sessionMarkdown(messages, { anchors: false }), "### Teacher\n\nKeep ordinary text.");
			const onlyOutput = { ...assistant([outputCall("Unfinished output.")]), stopReason };
			assert.equal(coverageOf([onlyOutput], [], "fixture").uncoveredCount, 0);
		});
	}
});
