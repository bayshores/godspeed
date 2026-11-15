import type { PluginContext } from "@/frontend/components/plugins/plugin-frame-model";
import type { LhViewMessage } from "@/shared/core";

/** The lesson's open question as the chat holds it. */
interface OpenQuestion {
	toolCallId: string;
	input: unknown;
}

/** The teacher's last message as text; null when it has none. */
function teacherText(messages: readonly LhViewMessage[]): string | null {
	const last = messages.findLast((m) => m.role === "assistant");
	const text = (last?.parts ?? [])
		.flatMap((p) => (p.type === "text" && typeof p.text === "string" ? [p.text.trim()] : []))
		.filter(Boolean)
		.join("\n\n");
	return text || null;
}

/** What a plugin can read about the open question: its text and the labels of its options. */
function questionOf(open: OpenQuestion): { text: string; options: string[] } | null {
	const input = open.input;
	if (typeof input !== "object" || input === null) return null;
	const { question, options } = input as { question?: unknown; options?: unknown };
	if (typeof question !== "string") return null;
	const labels = Array.isArray(options) ? options.flatMap((o) => (typeof (o as { label?: unknown } | null)?.label === "string" ? [(o as { label: string }).label] : [])) : [];
	return { text: question, options: labels };
}

/**
 * What a plugin reads in a lesson. A question still behind "Check your
 * understanding" is not on screen yet, so it is left out. The answer goes in only
 * when the learner has seen it for that same open question.
 */
export function lessonPluginContext(lesson: {
	space: { id: string; name: string } | null;
	title: string;
	messages: readonly LhViewMessage[];
	pending: OpenQuestion | null;
	requiresReveal: boolean;
	/** The answer on screen and the question it belongs to. */
	answerSeen?: { toolCallId: string; answer: string };
}): PluginContext {
	const shown = lesson.pending && !lesson.requiresReveal ? questionOf(lesson.pending) : null;
	const seen = lesson.answerSeen && lesson.pending?.toolCallId === lesson.answerSeen.toolCallId ? lesson.answerSeen.answer : undefined;
	return {
		space: lesson.space,
		topic: lesson.title,
		question: shown && { ...shown, ...(seen === undefined ? {} : { answer: seen }) },
		teacherMessage: teacherText(lesson.messages),
	};
}
