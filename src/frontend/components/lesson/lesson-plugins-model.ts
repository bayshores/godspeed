import type { PluginContext, PluginQuestion } from "@/frontend/components/plugins/plugin-frame-model";
import { answerForPresentation, isQuestionTool, type LhViewMessage, type QuestionAnswerData } from "@/shared/core";
import { isPrediction } from "@/frontend/components/answered-card-model";

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

/** The open question's text and option labels, from the call that asked it. Never its answer. */
function openQuestion(open: OpenQuestion): PluginQuestion | null {
	const input = open.input;
	if (typeof input !== "object" || input === null) return null;
	const { question, options } = input as { question?: unknown; options?: unknown };
	if (typeof question !== "string") return null;
	const labels = Array.isArray(options) ? options.flatMap((o) => (typeof (o as { label?: unknown } | null)?.label === "string" ? [(o as { label: string }).label] : [])) : [];
	return { id: open.toolCallId, text: question, options: labels };
}

/**
 * The last question the learner answered or skipped, as its answered card
 * shows it: the right answer is the quiz's marked options or the explain
 * question's committed answer, both in the card once answered. Right or
 * wrong only where the card says it: a graded quiz the learner answered
 * (never a prediction, an "I don't know" or a skip).
 */
function lastAnswered(messages: readonly LhViewMessage[]): PluginContext["lastAnswered"] {
	for (const message of messages.toReversed()) {
		for (const part of message.parts.toReversed()) {
			if (!part.type.startsWith("tool-") || !isQuestionTool(part.type.slice(5)) || part.state !== "output-available" || !part.toolCallId) continue;
			const saved = part.output as QuestionAnswerData | undefined;
			if (typeof saved?.questionText !== "string") continue;
			const shown = answerForPresentation(saved, part.input);
			const options = (shown.options ?? []).map((o) => o.label);
			const base = { id: part.toolCallId, text: shown.questionText, options };
			if (shown.dismissed) return base;
			const right = shown.kind === "quiz" ? (shown.options ?? []).filter((o) => shown.correctIndices?.includes(o.index)).map((o) => o.label) : [];
			const answer = right.length > 0 ? right.join(" and ") : shown.kind === "explain" ? shown.committed : undefined;
			const graded = shown.kind === "quiz" && !isPrediction(shown) && !shown.dontKnow && typeof shown.correct === "boolean";
			return { ...base, ...(answer ? { answer } : {}), ...(graded ? { correct: shown.correct } : {}) };
		}
	}
	return null;
}

/**
 * What a plugin reads in a lesson. A question still behind "Check your
 * understanding" is not on screen yet, so it is left out.
 */
export function lessonPluginContext(lesson: {
	space: { id: string; name: string } | null;
	title: string;
	messages: readonly LhViewMessage[];
	pending: OpenQuestion | null;
	requiresReveal: boolean;
}): PluginContext {
	return {
		space: lesson.space,
		topic: lesson.title,
		question: lesson.pending && !lesson.requiresReveal ? openQuestion(lesson.pending) : null,
		lastAnswered: lastAnswered(lesson.messages),
		teacherMessage: teacherText(lesson.messages),
	};
}
