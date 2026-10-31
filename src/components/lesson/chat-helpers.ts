/** Pure helpers for the lesson view (src/components/chat.tsx). */
import type { LhViewMessage } from "@/core";

/** Layered Esc: an open overlay claims Esc
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

/** Text a send or steer could not deliver goes back in its box, ahead
 *  of anything typed since, so the learner never loses it. */
export function restoreUnsent(unsent: string, draft: string): string {
	return draft.trim() ? `${unsent}\n${draft}` : unsent;
}

/** Why the message box can't take text right now (the demo's Send to
 *  teacher shows it as a tip), or null when it can. */
export function sendBlockedReason(s: { pending: boolean; problem: boolean; compacting: boolean }): string | null {
	if (s.pending) return "Answer or skip the waiting question first.";
	if (s.problem) return "Finish or discard the practice problem first.";
	if (s.compacting) return "Wait until the lesson finishes summarizing.";
	return null;
}

/** An agent's claim on the lesson's request counts as stuck after this long. */
const STUCK_CLAIM_MINUTES = 3;

/** Whole minutes since an agent took the lesson's request without
 *  answering, once that is at least STUCK_CLAIM_MINUTES; otherwise null. */
export function stuckClaimMinutes(claimedAt: string | undefined, now: number): number | null {
	if (!claimedAt) return null;
	const minutes = Math.floor((now - Date.parse(claimedAt)) / 60_000);
	return Number.isFinite(minutes) && minutes >= STUCK_CLAIM_MINUTES ? minutes : null;
}
