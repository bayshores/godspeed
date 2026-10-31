import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Static, TSchema } from "typebox";
import { CONCLUDE_ACK_TEXT } from "../core/contracts/chat.ts";

/**
 * The execution machinery every server-side tool shares. Tools are
 * pi-agent-core AgentTools (TypeBox parameters, native execute); this
 * module adds:
 *
 * - the per-call timeout + abort cascade (runWithAbortGuard),
 * - the authoring-refinement failure shape (invalidInputResult, an
 *   isError result the model retries on; `details` keeps the problems),
 * - the result mapping (string verbatim / object JSON / images to native
 *   content parts; details carries the record-facing value),
 * - the question-tool placeholder (quiz / ask_user_question): a synthetic
 *   "question posed" result that is never persisted; the learner's answer
 *   re-enters the next turn as this call's result. terminate: true ends
 *   single-question batches; the finishTurn hook (teacher-agent.ts)
 *   covers mixed batches.
 *
 * Structural validation is not here: pi's loop validates arguments
 * against the TypeBox parameters before execute runs. Refinements no
 * schema can carry (quizInputProblems, the live-tree nodeId check) run at
 * the top of the tool's own execute.
 */

/**
 * Per-call timeout: pi's AbortSignal only lands at a step boundary, so a
 * long-running local tool could hold the turn hostage. The guard races
 * every execute against the run's signal and this timeout, rejecting with
 * pi's own wording ("Operation aborted") on abort and a clear timeout
 * message otherwise; pi turns the throw into an error result the model sees.
 */
const TOOL_TIMEOUT_MS = 30_000;
/** Test seam. */
export const toolTimeoutMs = { current: TOOL_TIMEOUT_MS };

/** How long an aborted/timed-out call may take to settle on its own before
 *  the hard reject lands — cooperative tools poll the signal and return
 *  partial results within a tick or two (the fs tools check per file). */
const TOOL_ABORT_GRACE_MS = 250;

function runWithAbortGuard<T>(
	toolName: string,
	run: (signal: AbortSignal) => T | Promise<T>,
	parent: AbortSignal | undefined,
): Promise<T> {
	const controller = new AbortController();
	const forwardAbort = () => controller.abort();
	if (parent) {
		if (parent.aborted) controller.abort();
		else parent.addEventListener("abort", forwardAbort, { once: true });
	}
	const timeoutMs = toolTimeoutMs.current;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const humanTimeout = timeoutMs >= 1_000 ? `${Math.round(timeoutMs / 1000)}s` : `${timeoutMs}ms`;
	let graceTimer: ReturnType<typeof setTimeout> | undefined;
	const cleanup = () => {
		clearTimeout(timer);
		if (graceTimer) clearTimeout(graceTimer);
		parent?.removeEventListener("abort", forwardAbort);
	};
	return new Promise<T>((resolve, reject) => {
		const settle = (fn: () => void) => {
			controller.signal.removeEventListener("abort", onAbort);
			if (graceTimer) clearTimeout(graceTimer);
			fn();
		};
		const onAbort = () => {
			// Cooperative tools poll the signal and settle with partial
			// results within a tick or two (the fs tools check per file) —
			// give them a brief grace to deliver those before the hard
			// reject, so abort KILLS a stuck tool without racing away a
			// graceful one's partial result.
			graceTimer = setTimeout(
				() =>
					reject(
						new Error(
							parent?.aborted
								? "Operation aborted"
								: `Tool "${toolName}" timed out after ${humanTimeout} — the result was discarded`,
						),
					),
				TOOL_ABORT_GRACE_MS,
			);
		};
		controller.signal.addEventListener("abort", onAbort, { once: true });
		if (controller.signal.aborted) onAbort(); // an already-aborted signal never fires listeners
		Promise.resolve()
			.then(() => run(controller.signal))
			.then(
				(v) => settle(() => resolve(v)),
				(e) => settle(() => reject(e)),
			);
	})
		.finally(cleanup);
}

/** The authoring-failure result: an isError result (pi's convention) so
 *  the model sees a retryable problem list and `details` keeps the
 *  problems as data for the record and the UI. */
export function invalidInputResult(
	toolName: string,
	problems: string[],
): AgentToolResult<{ tool: string; problems: string[] }> {
	return {
		content: [
			{
				type: "text",
				text: `Invalid tool input for tool "${toolName}":\n${problems.map((p) => `- ${p}`).join("\n")}`,
			},
		],
		isError: true,
		details: { tool: toolName, problems },
	};
}

/**
 * Rich tool result: a tool whose result includes images (the read tool
 * reading an image file) returns this shape so toToolResult maps it to
 * pi's native content parts and the model actually sees the image.
 * `details` rides through to the record untouched.
 */
export interface ImageFileResult {
	text: string;
	images?: { data: string; mimeType: string }[];
	/** The record-facing result (client rendering / persistence). */
	details?: unknown;
}

function isImageResult(v: unknown): v is ImageFileResult {
	return (
		typeof v === "object" && v !== null && "text" in v && typeof (v as ImageFileResult).text === "string"
	);
}

/**
 * Map a tool body's return to the native AgentToolResult: strings pass
 * verbatim to the model, objects as JSON; `details` carries the raw value
 * (the record's tool part output reads it), and image results become
 * native content parts with details ?? null.
 */
export function toToolResult(result: unknown): AgentToolResult<unknown> {
	if (isImageResult(result)) {
		return {
			content: [
				{ type: "text", text: result.text },
				...(result.images ?? []).map((img) => ({
					type: "image" as const,
					data: img.data,
					mimeType: img.mimeType,
				})),
			],
			details: result.details ?? null,
		};
	}
	return {
		content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
		details: result,
	};
}

/** What a server-executed tool's body receives: the call id + the guard's
 *  combined signal (run abort + per-call timeout) for cooperative polling. */
export interface ToolExecuteContext {
	toolCallId: string;
	signal?: AbortSignal;
}

/**
 * Build a native AgentTool execute from a tool body: the guard (timeout +
 * abort cascade) plus the shared result mapping. Question tools do NOT use
 * this: their placeholder is instant (questionResult below) and their
 * refinement checks run before it.
 */
export function serverExecute<P extends TSchema>(
	toolName: string,
	_schema: P,
	run: (input: Static<P>, ctx: ToolExecuteContext) => unknown,
): AgentTool<any>["execute"] {
	// The returned execute is deliberately typed loose (params: unknown) so
	// it satisfies every AgentTool slot — heterogeneous registries type
	// AgentTool<any>, whose Static is unknown, and strictFunctionTypes
	// rejects a params-narrower function against it. The loop has already
	// validated arguments against the schema (runtime) and `run` keeps the
	// precise Static<P> input; `_schema` exists in the signature precisely so
	// P infers from the call site, not the loose surface.
	return async (toolCallId, input: unknown, signal) =>
		toToolResult(
			await runWithAbortGuard(toolName, (toolSignal) => run(input as Static<P>, { toolCallId, signal: toolSignal }), signal),
		);
}

/**
 * The synthetic question-tool result (in-memory only; the record's tool
 * part keeps no output until the learner answers). terminate: true ends
 * the batch natively (pi stops when every result in the batch
 * terminates); the finishTurn hook covers the mixed batch (question +
 * other calls in one message) that terminate alone would let run on.
 */
export function questionResult(): AgentToolResult<null> {
	return {
		content: [
			{
				type: "text",
				text: "Question posed — the turn ends here; the learner's graded answer arrives as this call's result.",
			},
		],
		details: null,
		terminate: true,
	};
}

/** The practice pose's ack: unlike
 *  a question, this result is FINAL — it persists (persistTurn filters
 *  only QUESTION_TOOLS placeholders), because the learner's submissions
 *  arrive as MESSAGES, never as this call's result. terminate: true ends
 *  the turn at the pose; the commitment rides the call's arguments. */
export function problemResult(): AgentToolResult<null> {
	return {
		content: [
			{
				type: "text",
				text: "Problem posed — the turn ends here; the learner's thinking traces and answer commits arrive as labeled messages.",
			},
		],
		details: null,
		terminate: true,
	};
}

/** The conclude ack: not terminate, so the agent can add closing words after
 *  it; the next pose waits for the learner's go-ahead. Text single-sourced in
 *  contracts (CONCLUDE_ACK_TEXT, shared with the dismissal-synthesized pair). */
export function concludeResult(): AgentToolResult<null> {
	return {
		content: [{ type: "text", text: CONCLUDE_ACK_TEXT }],
		details: null,
	};
}
