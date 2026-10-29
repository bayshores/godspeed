/** Pure helpers for the lesson view (src/components/chat.tsx). */
import type { LhViewMessage } from "@/core";

/** The layered-Esc ruling (owner, 2026-10-04): an open overlay claims Esc
 *  — closing itself — before the abort chain may open its confirm.
 *  Priority is stacking order: the abort confirm (claims via its own
 *  dialog), the session overlays (mermaid above plan), then question →
 *  problem → turn. */
type EscAbortTarget = "mermaid" | "plan" | "question" | "problem" | "turn" | null;

export function escAbortTarget(s: {
	abortAsk: boolean;
	mermaidFocus: boolean;
	planOpen: boolean;
	pending: boolean;
	/** An active practice problem: Esc opens the discard confirm — below a
	 *  pending question, above the turn abort. */
	problem: boolean;
	busy: boolean;
}): EscAbortTarget {
	if (s.abortAsk) return null; // the popup's own Esc — claimed by the dialog
	if (s.mermaidFocus) return "mermaid";
	if (s.planOpen) return "plan";
	if (s.pending) return "question";
	if (s.problem) return "problem";
	if (s.busy) return "turn";
	return null;
}

/** Does the ?prompt topic still owe its first send? "No real conversation
 *  yet" (no user/assistant message) — not emptiness: a session started
 *  with map picks carries a context MARKER as message[0], and that
 *  scaffolding must never swallow the first send. */
export function initialPromptOwed(messages: readonly { role: string }[], prompt: string | undefined): boolean {
	if (!prompt) return false;
	return !messages.some((m) => m.role === "user" || m.role === "assistant");
}

/** A wake-pipeline steer: a user-role delivery whose metadata marks a
 *  sub-agent result — rendered as an artifact card, never a bubble. */
export function isSubagentSteer(m: LhViewMessage): boolean {
	return (m.metadata as { subagentResult?: unknown } | undefined)?.subagentResult != null;
}
