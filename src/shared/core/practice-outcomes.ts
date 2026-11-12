/**
 * Each practice problem that was concluded, paired with how it ended. A
 * problem counts once its `problem` call went through, and ends at the
 * next `conclude` that went through. Pure.
 */
import type { LhMessage } from "./native-messages.ts";

export type ConcludeOutcome = "solved" | "solvedWithHints" | "movedOn" | "surrendered" | "dismissed";

export interface PracticeOutcome {
	/** The assistant message that posed it. */
	messageId: string;
	problemCallId: string;
	statement: string;
	/** The fact ids it exercises (absent on untagged problems). */
	targets: string[];
	/** The plan node it is about (study problems name one). */
	nodeId?: string;
	outcome: ConcludeOutcome;
	/** When it was concluded, ISO. */
	at: string;
}

const OUTCOMES = new Set<string>(["solved", "solvedWithHints", "movedOn", "surrendered", "dismissed"]);

export function practiceOutcomes(messages: readonly LhMessage[]): PracticeOutcome[] {
	const calls = new Map<string, { messageId: string; name: string; args: Record<string, unknown> }>();
	const out: PracticeOutcome[] = [];
	let open: { messageId: string; id: string; args: Record<string, unknown> } | null = null;
	for (const m of messages) {
		if (m.role === "assistant") {
			for (const block of m.content) {
				if (block.type === "toolCall" && (block.name === "problem" || block.name === "conclude"))
					calls.set(block.id, { messageId: m.id, name: block.name, args: (block.arguments ?? {}) as Record<string, unknown> });
			}
			continue;
		}
		if (m.role !== "toolResult" || m.isError) continue;
		const call = calls.get(m.toolCallId);
		if (!call) continue;
		if (call.name === "problem") {
			open = { messageId: call.messageId, id: m.toolCallId, args: call.args };
			continue;
		}
		const outcome = call.args.outcome;
		if (!open || typeof outcome !== "string" || !OUTCOMES.has(outcome)) continue;
		const targets = Array.isArray(open.args.target) ? [...new Set(open.args.target.filter((t): t is string => typeof t === "string"))] : [];
		out.push({
			messageId: open.messageId,
			problemCallId: open.id,
			statement: typeof open.args.statement === "string" ? open.args.statement : "",
			targets,
			...(typeof open.args.nodeId === "string" && open.args.nodeId ? { nodeId: open.args.nodeId } : {}),
			outcome: outcome as ConcludeOutcome,
			at: new Date(m.timestamp).toISOString(),
		});
		open = null;
	}
	return out;
}
