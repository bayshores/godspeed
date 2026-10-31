import type { AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { loadAgentCore, loadedAgentCore } from "../engine-load.ts";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { APP_IDENTITY, agentEngine, type PiEngine } from "../models.ts";
import { forgetConversation, labelConversation } from "../agent-bridge.ts";

/**
 * The shared sub-agent runner: the researcher, demo-builder, extractor and
 * topic grouper (via submit-agent) and the compaction summarizer run on it —
 * a stateless pi Agent built per call, driven to completion, with the seams
 * the job runner and usage reporting need.
 *
 * Provider/loop failures THROW (pi encodes them in the stream; this helper
 * surfaces them), and an abort throws an AbortError so callers'
 * `signal.aborted` early-returns work.
 */

interface SubagentRunOptions {
	/** The runner's or a test's engine; without one, the outside agent runs it. */
	engine?: PiEngine;
	systemPrompt: string;
	prompt: string;
	/** Max model calls (a safety net). */
	maxTurns: number;
	/** Abort mid-model-call (the real-kill semantics). */
	abortSignal?: AbortSignal;
	/** Token usage: one call per model request. */
	onUsage?: (usage: Usage) => void;
	/** Activity line per tool execution (job record progress). */
	onToolStart?: (toolName: string, args: unknown) => void;
	/** Per completed assistant message (extraction's step log). */
	onAssistantMessage?: (message: AssistantMessage, step: number) => void;
	/** Extra stop rule (extractor: stop after a clean submit). */
	shouldStop?: (message: AssistantMessage, toolResults: ToolResultMessage[]) => boolean;
	/** A short name for the task ("Topic grouping · CSE 21"). An outside
	 *  agent (MCP) sees it on the run's work items, so it can tell which
	 *  background job it is answering. */
	taskLabel?: string;
}

interface SubagentRunResult {
	/** The messages this run added (assistant + tool results). */
	newMessages: AgentMessage[];
	/** The final assistant text (the deliverable). */
	text: string;
}

export async function runSubagent(tools: AgentTool<any, any>[], opts: SubagentRunOptions): Promise<SubagentRunResult> {
	// The engine loads on the first run only. Once loaded, no await happens
	// here: everything from the abort listener on stays synchronous with
	// the caller (an await here would let an abort slip past).
	let core = loadedAgentCore();
	if (!core) core = await loadAgentCore();
	// Cancelled before the run started (or while the engine loaded): an
	// aborted signal never fires "abort" again, so end now, before any call.
	if (opts.abortSignal?.aborted) {
		const err = new Error("aborted");
		err.name = "AbortError";
		throw err;
	}
	const { Agent } = core;
	const engine = opts.engine ?? agentEngine();
	let turns = 0;
	// One unsaved conversation per invocation, stable through every turn.
	const sessionId = randomUUID();
	if (opts.taskLabel) labelConversation(sessionId, opts.taskLabel);
	const agent = new Agent({
		identity: APP_IDENTITY,
		sessionId,
		initialState: {
			systemPrompt: opts.systemPrompt,
			model: engine.model,
			tools,
			messages: [],
		},
		streamFn: engine.streamFn,
		// "end" exits before the steering poll.
		finishTurn: (turn) => {
			turns++;
			return turns >= opts.maxTurns || opts.shouldStop?.(turn.message, turn.toolResults) === true
				? { action: "end" }
				: undefined;
		},
	});

	const onAbort = () => agent.abort();
	opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

	let step = 0;
	let errorMessage: string | undefined;
	let aborted = false;

	try {
		agent.subscribe((event: AgentEvent) => {
			switch (event.type) {
				case "message_end":
					if ((event.message as { role?: string }).role === "assistant") {
						const m = event.message as AssistantMessage;
						if (m.stopReason === "aborted") {
							// The call was cancelled: no completed step and no usage
							// (the abort path asserts zero steps).
								aborted = true;
							break;
						}
						step++;
						opts.onUsage?.(m.usage);
						opts.onAssistantMessage?.(m, step);
						if (m.stopReason === "error") errorMessage = m.errorMessage;
					}
					break;
				case "tool_execution_start":
					opts.onToolStart?.(event.toolName, event.args);
					break;
			}
		});
		await agent.prompt({ role: "user", content: opts.prompt, timestamp: Date.now() });
	} finally {
		opts.abortSignal?.removeEventListener("abort", onAbort);
		forgetConversation(sessionId);
	}

	if (aborted || opts.abortSignal?.aborted) {
		const err = new Error("aborted");
		err.name = "AbortError";
		throw err;
	}
	if (errorMessage !== undefined) throw new Error(errorMessage);

	// Drop the seeded leading SystemMessage.
	const newMessages = agent.state.messages.filter((m) => (m as { role?: string }).role !== "system");
	const assistants = newMessages.filter((m) => (m as { role?: string }).role === "assistant") as AssistantMessage[];
	const last = assistants[assistants.length - 1];
	const text = last
		? last.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("")
		: "";
	return { newMessages, text };
}