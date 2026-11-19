/**
 * Grading and answering a question, pure and deterministic. The browser
 * grades with these functions, then posts the verdict as the answer input
 * event, which becomes the call's native toolResult (newAnswerResult in
 * native-messages.ts):
 *   1. The teacher calls `quiz` (question + options + correctAnswer +
 *      explanation). No server execute → the call shows in the UI as a
 *      tool part in `input-available` state.
 *   2. The learner answers in the dock, which grades it with this module.
 *   3. The answer is sent as the toolResult: the model gets the compact
 *      learner-only record (never the explanation), and `details` keeps
 *      the full QuestionAnswerData.
 *
 * Because the pending question IS a persisted message part, a session can be
 * exited and resumed mid-question for free.
 */

import { stripModelValueDebris } from "./value-debris.ts";
import type { AnswerRequest, QuestionAnswerData, QuestionData, QuestionKind, QuizOption } from "./question-data.ts";

// ─── quiz grading ───────────────────────────────────────────────────────────

/** Preserve an exact option key before trying copy-syntax cleanup: a
 *  label's final period, quotes, or backticks can be CONTENT, not model
 *  debris. The actual option values are
 *  required so no caller can strip a valid answer before membership.
 *  Non-matches keep the debris heal (`[":parmenides"]`) and
 *  JSON-stringified multi-select coercion. Shared by boundary, display,
 *  and grading; canonical option keys are never rewritten. */
export function coerceCorrectAnswer(
	correctAnswer: string | string[],
	optionValues: readonly string[],
): string[] {
	const clean = (value: string): string => {
		const trimmed = value.trim();
		return optionValues.includes(trimmed) ? trimmed : stripModelValueDebris(value);
	};
	if (Array.isArray(correctAnswer)) return correctAnswer.map(clean);
	const trimmed = correctAnswer.trim();
	// An exact string key can itself look like a JSON array.
	if (optionValues.includes(trimmed)) return [trimmed];
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		try {
			const parsed = JSON.parse(trimmed);
			if (Array.isArray(parsed)) return parsed.map((v) => clean(String(v)));
		} catch {
			// not valid JSON — treat as a single literal value
		}
	}
	return [clean(correctAnswer)];
}

/** Resolve author-supplied value(s) to 1-based display indices. Keying by
 *  value (not position) makes a typo a hard error instead of a silent wrong
 *  grade. Must run AFTER shuffling. */
export function resolveCorrect(
	correctAnswer: string | string[] | undefined,
	options: QuizOption[],
): { indices: number[]; error?: string } {
	if (correctAnswer === undefined) return { indices: [], error: "correctAnswer is required" };
	const arr = coerceCorrectAnswer(correctAnswer, options.map((o) => o.value));
	if (arr.length === 0) return { indices: [], error: "correctAnswer is required" };
	const byValue = new Map(options.map((o, i) => [o.value, i + 1]));
	const indices: number[] = [];
	for (const raw of arr) {
		const v = typeof raw === "string" ? raw.trim() : raw;
		const idx = byValue.get(v);
		if (idx === undefined) {
			const known = options.map((o) => `"${o.value}"`).join(", ");
			return { indices: [], error: `correctAnswer "${v}" does not match any option value (${known})` };
		}
		indices.push(idx);
	}
	return { indices: Array.from(new Set(indices)).sort((a, b) => a - b) };
}

/** Exact-set match: same number of selections, same indices. */
export function isCorrect(selectedIndices: number[], correctIndices: number[]): boolean {
	if (selectedIndices.length !== correctIndices.length) return false;
	const a = [...selectedIndices].sort((x, y) => x - y);
	const b = [...correctIndices].sort((x, y) => x - y);
	return a.every((v, i) => v === b[i]);
}

// ─── arming + answering ─────────────────────────────────────────────────────

/**
 * Turn an AnswerRequest into the full answer record + the user message the
 * agent will see. Quiz answers are graded here; ask answers are not.
 */
export function buildAnswer(qd: QuestionData, req: AnswerRequest, tool?: string): QuestionAnswerData {
	const base: QuestionAnswerData = {
		kind: qd.kind,
		...(tool ? { tool } : {}),
		questionType: qd.questionType,
		questionText: qd.question,
		options: qd.options.map((o, i) => ({ index: i + 1, label: o.label })),
		dontKnow: req.dontKnow === true,
		answers: [],
		thinking: req.thinking?.trim() || undefined,
		readingThinking: req.readingThinking?.trim() || undefined,
		answeredAt: new Date().toISOString(),
	};
	// resolve selected option values → OptionAnswer (in display order)
	if (req.values && req.values.length > 0) {
		const byValue = new Map(qd.options.map((o, i) => [o.value, { ...o, index: i + 1 }]));
		for (const v of req.values) {
			const opt = byValue.get(v);
			if (!opt) continue; // unknown value — ignore
			base.answers.push({ label: opt.label, value: opt.value, index: opt.index });
		}
		base.answers.sort((a, b) => a.index - b.index);
	}
	if (req.other?.trim()) base.other = req.other.trim();
	if (req.text?.trim()) base.text = req.text.trim();

	if (qd.kind === "quiz") {
		base.correctIndices = qd.correctIndices ?? [];
		base.explanation = qd.explanation;
		base.correct = base.dontKnow ? false : isCorrect(base.answers.map((a) => a.index), qd.correctIndices ?? []);
		// The confidence slider rides on real quiz answers only — never on
		// "I don't know" (no answer, no probability). Clamped defensively;
		// the dock snaps to the grid, the record accepts any integer.
		if (!base.dontKnow && req.confidence !== undefined) {
			base.confidence = Math.max(0, Math.min(100, Math.round(req.confidence)));
		}
	}
	if (qd.kind === "explain") {
		// No client grading — the model grades in its reply, against the
		// commitment. The commitment snapshots for the reveal + rendering.
		base.committed = qd.committedAnswer;
	}
	return base;
}

export const DONT_KNOW = "I don't know";

/** "I don't know" as the answer to a waiting question, with the box's text
 *  as the reasoning. A graded question records the gap; an ask has no right
 *  answer, so it is answered in those words. */
export function dontKnowRequest(qd: QuestionData, thinking: string): AnswerRequest {
	if (qd.kind !== "ask") return { dontKnow: true, thinking };
	return qd.mode === "text" ? { text: DONT_KNOW, thinking } : { other: DONT_KNOW, thinking };
}

/** The sound a submitted answer makes. Only quiz answers are graded on
 *  submit; "I don't know", ask and explain answers stay silent, and so does
 *  a prediction, since a guess is never marked. */
export function answerSound(answer: QuestionAnswerData): "right" | "wrong" | null {
	if (answer.kind !== "quiz" || answer.dontKnow || answer.questionType === "predict") return null;
	return answer.correct ? "right" : "wrong";
}

/** The dismissal record (ESC-abort from a pending question): the minimum
 *  honest answer. The model sees {kind, dismissed:true}; the answered card
 *  renders the question text + "skipped". */
export function dismissedAnswer(kind: QuestionKind, questionText: string): QuestionAnswerData {
	return {
		kind,
		questionText,
		dontKnow: false,
		answers: [],
		dismissed: true,
		answeredAt: new Date().toISOString(),
	};
}

/** The MODEL-VISIBLE answer record. The tool call already carries
 *  everything the model authored, so this returns only what the learner
 *  added. The full QuestionAnswerData rides `details` for the record and
 *  the UI. */
export function compactAnswerForModel(ad: QuestionAnswerData): Record<string, unknown> {
	if (ad.dismissed) return { kind: ad.kind, dismissed: true };
	const out: Record<string, unknown> = { kind: ad.kind };
	if (ad.dontKnow) out.dontKnow = true;
	// Array.isArray: the seam is called with `unknown` answers (test
	// fixtures, foreign records) — degrade to omission, never crash.
	if (Array.isArray(ad.answers) && ad.answers.length > 0)
		out.answers = ad.answers.map((a) => ({ index: a.index, label: a.label }));
	if (ad.text) out.text = ad.text;
	if (ad.other) out.other = ad.other;
	if (ad.code) out.code = ad.code;
	if (ad.language) out.language = ad.language;
	// The verdict + stated confidence are the learner's PERFORMANCE — new
	// information the model needs for its next move. (dontKnow implies
	// incorrect and carries no confidence: both stay implicit.)
	if (ad.correct !== undefined && !ad.dontKnow) out.correct = ad.correct;
	if (ad.confidence !== undefined) out.confidence = ad.confidence;
	// Two DISTINCT thinking channels, clearly keyed so the model never
	// conflates them: reasoning on the question vs
	// thinking while reading the teaching. `note` is the pre-rename key —
	// old records replay through here too, so both feed `thinking`.
	const thinking = ad.thinking ?? ad.note;
	if (thinking) out.thinking = thinking;
	if (ad.readingThinking) out.thinkingWhileReading = ad.readingThinking;
	return out;
}
