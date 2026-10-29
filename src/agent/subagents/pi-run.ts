import type { AgentEvent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { loadAgentCore, loadedAgentCore } from "../engine-load.ts";
import type { AssistantMessage, ToolResultMessage, Usage } from "@earendil-works/pi-ai";
import { randomUUID } from "node:crypto";
import { APP_IDENTITY, agentEngine, type PiEngine } from "../models.ts";
import type { ModelRole } from "../../config.ts";
import { labelConversation, unlabelConversation } from "../agent-bridge.ts";

/**
 * The shared sub-agent runner (docs/pi-engine-swap.md §6): one helper every
 * background agent (researcher, demo-builder, visual-maker, extractor,
 * topic grouper) runs on — a stateless pi Agent built per call, driven to
 * completion, with the seams the job runner and the money channel need.
 *
 * Error semantics mirror the old ToolLoopAgent.generate: provider/loop
 * failures THROW (pi encodes them in the stream; this helper surfaces
 * them), and an abort throws an AbortError so every existing
 * `signal.aborted` early-return keeps working unchanged.
 */

interface SubagentRunOptions {
	/** The role whose engine (model + thinking level) this run uses. */
	role: ModelRole;
	/** Test seam: a scripted engine replaces the role's production one. */
	engine?: PiEngine;
	systemPrompt: string;
	/** Initial transcript (continuation semantics: ends user / toolResult). */
	messages?: AgentMessage[];
	/** Fresh-run prompt text (mutually exclusive with a continuation). */
	prompt?: string;
	/** Max model calls (the old stepCountIs safety net). */
	maxTurns: number;
	/** Abort mid-model-call (the real-kill semantics). */
	abortSignal?: AbortSignal;
	/** Money channel: one call per model request. */
	onUsage?: (usage: Usage) => void;
	/** Activity line per tool execution (job record progress). */
	onToolStart?: (toolName: string, args: unknown) => void;
	/** Per completed assistant message (extraction's step log). */
	onAssistantMessage?: (message: AssistantMessage, step: number) => void;
	/** Extra stop rule (extractor: stop after a clean submit). */
	shouldStop?: (message: AssistantMessage, toolResults: ToolResultMessage[]) => boolean;
	/** The job's chat, when the run belongs to one. */
	chatId?: string;
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

function subagentEngine(role: ModelRole, override?: PiEngine): PiEngine {
	// The runner injects the engine; without one, the outside agent runs it.
	void role;
	return override ?? agentEngine();
}

export async function runSubagent(tools: AgentTool<any, any>[], opts: SubagentRunOptions): Promise<SubagentRunResult> {
	// The engine loads on the first run only. Once loaded, no await happens
	// here: everything from the abort listener on stays synchronous with
	// the caller, exactly as before (an await here let an abort slip past).
	let core = loadedAgentCore();
	if (!core) {
		core = await loadAgentCore();
		// Cancelled while the engine loaded: end as an abort, before any call.
		if (opts.abortSignal?.aborted) {
			const err = new Error("aborted");
			err.name = "AbortError";
			throw err;
		}
	}
	const { Agent } = core;
	const engine = subagentEngine(opts.role, opts.engine);
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
			thinkingLevel: engine.level,
			tools,
			messages: opts.messages ?? [],
		},
		streamFn: engine.streamFn,
		// 0.87.1: shouldStopAfterTurn → finishTurn (same call point; "end"
		// exits before the steering poll, exactly the old boolean-true).
		finishTurn: (turn) => {
			turns++;
			return turns >= opts.maxTurns || opts.shouldStop?.(turn.message, turn.toolResults) === true
				? { action: "end" }
				: undefined;
		},
	});

	const onAbort = () => agent.abort();
	opts.abortSignal?.addEventListener("abort", onAbort, { once: true });

	const before = opts.messages?.length ?? 0;
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
							// The call was cancelled — no completed step, no billed
							// usage (the abort path asserts zero steps).
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
		if (opts.prompt !== undefined) await agent.prompt({
			role: "user",
			content: opts.prompt,
			timestamp: Date.now(),
		});
		else await agent.continue();
	} finally {
		opts.abortSignal?.removeEventListener("abort", onAbort);
		if (opts.taskLabel) unlabelConversation(sessionId);
	}

	if (aborted || opts.abortSignal?.aborted) {
		const err = new Error("aborted");
		err.name = "AbortError";
		throw err;
	}
	if (errorMessage !== undefined) throw new Error(errorMessage);

	// 0.87.1: drop the seeded leading SystemMessage (transcript rework —
	// see ui-stream's settleWith) before slicing past the input count, or
	// the seed displaces the slice and the last INPUT message leaks in.
	const newMessages = agent.state.messages
		.filter((m) => (m as { role?: string }).role !== "system")
		.slice(before);
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