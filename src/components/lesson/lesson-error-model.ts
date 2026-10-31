/**
 * The lesson's error banner: a plain sentence for each known failure, and
 * what its Try again does. The raw text stays in the banner's hover tip.
 * Pure.
 */
import type { LhMessage } from "@/core";
import { STREAM_DROPPED } from "@/components/session-core";

/** send: the learner's input didn't go through (it is back where they typed
 *  it). reply: the teacher's reply failed. sync: the window lost track of
 *  the lesson and should read it again. */
type LessonErrorKind = "send" | "reply" | "sync";

export function lessonError(message: string): { text: string; kind: LessonErrorKind } {
	if (/^(The send failed|The steer failed|Your input could not be saved)/.test(message)) return { text: "Your message didn't go through.", kind: "send" };
	if (message.startsWith("A turn is already running")) return { text: "The teacher was still busy, so your message didn't go through.", kind: "send" };
	if (message.startsWith("The dismissal failed")) return { text: "Skipping or discarding didn't save.", kind: "sync" };
	if (
		message === STREAM_DROPPED ||
		message.startsWith("Failed to attach") ||
		message.startsWith("The turn stream body is empty") ||
		/failed to fetch|load failed|networkerror/i.test(message)
	) {
		return { text: "The app lost its connection to the teacher's reply.", kind: "sync" };
	}
	return { text: "The teacher's reply stopped with an error.", kind: "reply" };
}

/** The learner's message the failed reply was answering, when it was a
 *  plain text message (so Try again can send it again). */
export function lastLearnerText(messages: readonly LhMessage[]): string | null {
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; stopReason?: string; content?: unknown };
		if (m.role === "assistant" && m.stopReason === "error") continue;
		if (m.role !== "user") return null;
		if (typeof m.content === "string") return m.content.trim() || null;
		if (!Array.isArray(m.content)) return null;
		const text = (m.content as Array<{ type?: string; text?: string }>).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
		return text || null;
	}
	return null;
}

/** What Try again does: send the message box again, send the learner's
 *  last message again, run a failed reply to anything else (an answer)
 *  again, or read the lesson again. */
export function retryAction(
	kind: LessonErrorKind,
	s: { boxHasText: boolean; lastText: string | null },
): { type: "send-box" } | { type: "resend"; text: string } | { type: "continue" } | { type: "resync" } {
	if (kind !== "sync" && s.boxHasText) return { type: "send-box" };
	if (kind === "reply") return s.lastText ? { type: "resend", text: s.lastText } : { type: "continue" };
	return { type: "resync" };
}
