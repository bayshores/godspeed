/**
 * The lesson's error banner: a plain sentence for each known failure, and
 * what its Try again does. The raw text stays in the banner's hover tip.
 * Pure.
 */
import { STREAM_DROPPED } from "@/frontend/components/session-core";

/** send: the learner's input didn't go through (it is back where they typed
 *  it). reply: the teacher's reply failed. sync: a change he made didn't
 *  save, or the window lost track of the lesson; it should read it again. */
type LessonErrorKind = "send" | "reply" | "sync";

export function lessonError(message: string): { text: string; kind: LessonErrorKind } {
	if (/^(The send failed|The steer failed|Your input could not be saved)/.test(message)) return { text: "Your message didn't go through.", kind: "send" };
	if (message.startsWith("A turn is already running")) return { text: "The teacher was still busy, so your message didn't go through.", kind: "send" };
	if (message.startsWith("The dismissal failed")) return { text: "Discarding didn't save.", kind: "sync" };
	if (message.startsWith("Keep going failed")) return { text: "Keep going didn't save.", kind: "sync" };
	if (message.startsWith("The kept change failed")) return { text: "That change didn't save.", kind: "sync" };
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

/** What Try again does: send the writing box again, run the failed reply
 *  again from the record (the learner's line stays the one line it is), or
 *  read the lesson again. */
export function retryAction(kind: LessonErrorKind, s: { boxHasText: boolean }): { type: "send-box" } | { type: "continue" } | { type: "resync" } {
	if (kind !== "sync" && s.boxHasText) return { type: "send-box" };
	if (kind === "reply") return { type: "continue" };
	return { type: "resync" };
}
