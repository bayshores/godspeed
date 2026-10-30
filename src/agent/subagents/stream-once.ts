import type { AssistantMessage, Message, Tool, ToolResultMessage } from "@earendil-works/pi-ai";
// Subpath, not the package root: the root loads every provider.
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import type { PiEngine } from "../models.ts";

/**
 * One raw model call for the hand-rolled loops (pdf-reader, visual-maker):
 * they feed rendered images back between calls, which the agent loop's
 * execute-tool plumbing can't express. Drains the event stream to the final
 * AssistantMessage; provider errors and aborts throw.
 */
export async function streamOnce(
	engine: PiEngine,
	systemPrompt: string,
	messages: Message[],
	tools: Tool[],
	sessionId: string,
	abortSignal?: AbortSignal,
): Promise<AssistantMessage> {
	// Providers take a TranscriptContext (the prompt and tools fold into a
	// leading system message); normalizeContext is the only way to build one.
	const stream = engine.streamFn(engine.model, normalizeContext({ systemPrompt, messages, tools }), {
		sessionId,
		signal: abortSignal,
	} as never);
	for await (const event of stream) {
		if (event.type === "done") return event.message;
		if (event.type === "error") {
			if (event.reason === "aborted") {
				const err = new Error("aborted");
				err.name = "AbortError";
				throw err;
			}
			throw new Error(event.error.errorMessage ?? "the model call failed");
		}
	}
	throw new Error("the model stream ended without a result");
}

/** A text tool result; each loop decides which of its outputs are errors. */
export function toolText(toolCallId: string, toolName: string, value: string, isError: boolean): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text: value }],
		isError,
		timestamp: Date.now(),
	};
}
