/**
 * The teacher panel's chat as the window draws it: the thread's lines from the chat's messages,
 * the words a chat carried over from the terminal said before it came here, and the error row's
 * sentence and key. Pure.
 */
import { isAttachmentPart, type LhViewMessage, type LhViewPart } from "@/shared/core";
import { lessonError } from "@/frontend/components/lesson/lesson-error-model";

/** A line of the thread before it is drawn: the learner's words and files, or the teacher's words. */
interface TalkLine {
	key: string;
	who: "you" | "teacher";
	text: string;
	files: readonly LhViewPart[];
	/** The teacher's words being written now. */
	writing: boolean;
}

/** What a chat carried over from the terminal said there, oldest first (the chat's read, `earlier`). */
interface EarlierWord {
	role: "user" | "assistant";
	text: string;
}

/** The earlier words made safe to use. */
export function readEarlier(raw: unknown): EarlierWord[] {
	if (!Array.isArray(raw)) return [];
	return raw.flatMap((w): EarlierWord[] => {
		const { role, text } = (w ?? {}) as { role?: unknown; text?: unknown };
		return (role === "user" || role === "assistant") && typeof text === "string" && text !== "" ? [{ role, text }] : [];
	});
}

/** The words of a message's text parts. */
const words = (m: LhViewMessage, joiner: string) =>
	m.parts
		.filter((p) => p.type === "text" && (p.text ?? "").trim() !== "")
		.map((p) => p.text ?? "")
		.join(joiner);

/**
 * The thread's lines: the earlier words first, then each message the learner or the teacher wrote.
 * The teacher's steps and tool calls are left out: the desk shows them while the reply is written,
 * and Activity keeps what they changed. `writing`: the newest message is being written now.
 */
export function talkLines(messages: readonly LhViewMessage[], earlier: readonly EarlierWord[], writing: boolean): TalkLine[] {
	const before = earlier.map((w, i): TalkLine => ({ key: `earlier:${i}`, who: w.role === "user" ? "you" : "teacher", text: w.text, files: [], writing: false }));
	const now = messages.flatMap((m, i): TalkLine[] => {
		const key = m.id || `m:${i}`;
		if (m.role === "user") {
			const files = m.parts.filter(isAttachmentPart);
			const text = words(m, "\n");
			return text || files.length > 0 ? [{ key, who: "you", text, files, writing: false }] : [];
		}
		const last = writing && i === messages.length - 1;
		const text = words(m, "\n\n");
		return text || last ? [{ key, who: "teacher", text, files: [], writing: last }] : [];
	});
	return [...before, ...now];
}

/** The error row: its sentence, and what its key does (none: Send sends the message again). */
export function talkError(message: string): { text: string; retry: "again" | "read" | null } {
	switch (lessonError(message).kind) {
		case "send":
			return { text: "Your message didn't go through.", retry: null };
		case "sync":
			return { text: "The app lost its connection to the reply.", retry: "read" };
		case "reply":
			return { text: "The reply stopped with an error.", retry: "again" };
	}
}
