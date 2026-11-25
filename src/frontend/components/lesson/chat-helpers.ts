/** Pure helpers for the lesson view (src/frontend/components/chat.tsx). */
import type { LessonKind, LhMessage, LhViewMessage } from "@/shared/core";

/** Layered Esc: an open overlay claims Esc
 *  — closing itself — before the abort chain acts.
 *  Priority is stacking order: the abort confirm (claims via its own
 *  dialog), the session overlays (mermaid above plan), then question →
 *  problem → turn. Question and problem open their confirm; a turn stops
 *  at once. A turn running under a waiting question (a side reply) stops
 *  alone, so the question stays. */
type EscAbortTarget = "mermaid" | "question" | "problem" | "turn" | null;

export function escAbortTarget(s: {
	abortAsk: boolean;
	mermaidFocus: boolean;
	pending: boolean;
	/** An active practice problem: Esc opens the discard confirm — below a
	 *  pending question, above the turn abort. */
	problem: boolean;
	busy: boolean;
}): EscAbortTarget {
	if (s.abortAsk) return null; // the popup's own Esc — claimed by the dialog
	if (s.mermaidFocus) return "mermaid";
	if (s.pending) return s.busy ? "turn" : "question";
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

/** Text a send or steer could not deliver goes back in its box, ahead
 *  of anything typed since, so the learner never loses it. */
export function restoreUnsent(unsent: string, draft: string): string {
	return draft.trim() ? `${unsent}\n${draft}` : unsent;
}

/** Why the writing box can't take text right now (the demo's Send to
 *  teacher shows it as a tip), or null when it can. */
export function sendBlockedReason(pending: boolean): string | null {
	return pending ? "Answer or skip the waiting question first." : null;
}

/** Has the teacher posed a problem in this lesson? */
export function problemPosed(messages: readonly LhMessage[]): boolean {
	return messages.some((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "toolCall" && b.name === "problem"));
}

/** The go-ahead key's label in "Your turn", or null. Study offers Continue
 *  once the teacher has spoken, a lesson with a problem list its start label
 *  once the teacher has spoken, the other kinds "Next problem" once a problem was posed. When it
 *  shows is turnNext's to say. */
export function goAheadLabel(s: { kind: LessonKind; problemList: boolean; startLabel: string | null; teacherSpoke: boolean; posedAny: boolean }): string | null {
	if (s.problemList) return s.teacherSpoke ? s.startLabel : null;
	if (s.kind === "study") return s.teacherSpoke ? "Continue" : null;
	return s.posedAny ? "Next problem" : null;
}
