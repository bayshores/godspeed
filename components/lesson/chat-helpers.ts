/**
 * Pure helpers for the lesson view (split out of components/chat.tsx in
 * the redesign; chat.tsx re-exports them for existing imports and tests).
 */
import { isProviderNotConnectedRefusal, type LhViewMessage, type ModelSlotName } from "@/src/core";

/** The BYOK refusal envelope from the transport's error text: the 503
 *  body rides the thrown error message verbatim, so the machine-readable
 *  {code, missing} shape survives to here. Any other text reads as null
 *  and keeps the honest error banner. */
export function parseModelsRefusal(message: string | undefined): ModelSlotName[] | null {
	if (!message) return null;
	try {
		const body = JSON.parse(message) as { code?: unknown; missing?: unknown };
		if (body.code === "models_not_configured" && Array.isArray(body.missing)
			&& body.missing.every((s) => typeof s === "string")) {
			return body.missing as ModelSlotName[];
		}
		return null;
	} catch {
		return null;
	}
}

/** The connection refusal twin of parseModelsRefusal: the envelope's own
 *  matcher (core) decides, so the wording never drifts client-side. */
export function parseProviderNotConnectedRefusal(message: string | undefined): boolean {
	if (!message) return false;
	try {
		const body = JSON.parse(message) as { code?: unknown; error?: unknown };
		return body.code === "provider_not_connected" && typeof body.error === "string" && isProviderNotConnectedRefusal(body.error);
	} catch {
		return false;
	}
}

/** The layered-Esc ruling (owner, 2026-10-04): an open overlay claims Esc
 *  — closing itself — before the abort chain may open its confirm.
 *  Priority is stacking order: the abort confirm (claims via its own
 *  dialog), the session overlays (mermaid above plan), setup (closes
 *  itself — the gate must only not fire), then question → problem → turn. */
export type EscAbortTarget = "mermaid" | "plan" | "setup" | "question" | "problem" | "turn" | null;

export function escAbortTarget(s: {
	abortAsk: boolean;
	mermaidFocus: boolean;
	planOpen: boolean;
	setupOpen: boolean;
	pending: boolean;
	/** An active practice problem: Esc opens the discard confirm — below a
	 *  pending question, above the turn abort. */
	problem: boolean;
	busy: boolean;
}): EscAbortTarget {
	if (s.abortAsk) return null; // the popup's own Esc — claimed by the dialog
	if (s.mermaidFocus) return "mermaid";
	if (s.planOpen) return "plan";
	if (s.setupOpen) return "setup";
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

/** How a teach-phase check lands (owner ruling, 2026-09-25): behind the
 *  "Check your understanding" invitation when it follows the composer —
 *  the learner reads the teaching first — but open when it follows
 *  another question (the reading already happened). */
export function revealArrival(wasQuestion: boolean): { expanded: boolean; revealed: boolean } {
	return wasQuestion ? { expanded: true, revealed: true } : { expanded: false, revealed: false };
}

/** A wake-pipeline steer: a user-role delivery whose metadata marks a
 *  sub-agent result — rendered as an artifact card, never a bubble. */
export function isSubagentSteer(m: LhViewMessage): boolean {
	return (m.metadata as { subagentResult?: unknown } | undefined)?.subagentResult != null;
}
