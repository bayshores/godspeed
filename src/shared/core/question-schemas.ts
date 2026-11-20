/**
 * The question tools' input contract. The TypeBox schemas parse stored tool
 * calls for display (the Rust server owns the tools' input contracts); the
 * problems functions are the authoring checks that mirror grading, plus the
 * labels a question shows.
 */

import { Type, type Static } from "typebox";
import { stripModelValueDebris } from "./value-debris.ts";
import { coerceCorrectAnswer } from "./question-grading.ts";
import type { QuizQuestionType } from "./question-data.ts";

// ─── tool input schemas (the question contract) ─────────────────────────────
// Parameter names mirror the prompt docs exactly — keep them in sync.

/** One quiz answer option. No `description` field: the model used it to
 *  leak correctness ("close but…"), making quizzes answerable by
 *  elimination. The option is a bare claim. */
const quizOptionProps = {
	label: Type.String({ description: "Display label for the answer option — a bare claim, no reasoning" }),
	value: Type.Optional(
		Type.String({
			description: "Optional machine-readable value returned for the option. Defaults to the label.",
		}),
	),
};

/** One ask answer option — keeps `description`: ask is ungraded preference
 *  collection, there is no correctness to leak. */
const askOptionProps = {
	...quizOptionProps,
	description: Type.Optional(
		Type.String({ description: "Optional extra detail shown below the option" }),
	),
};

// ─── cross-field authoring validation (tool-schema refinements) ──────────
// Enforced at the tool-call boundary (see the superRefines below): an invalid
// question NEVER reaches the learner — the SDK returns the validation error
// to the teacher as a tool result and the teacher retries. The rules mirror
// the grading path exactly (normalizeOptions / coerceCorrectAnswer /
// resolveCorrect), so schema-valid ⇔ gradeable.

/** Option sanity shared by quiz + ask: labels non-empty, resolved values
 *  (trimmed `value`, falling back to the trimmed label — exactly how
 *  normalizeOptions keys them) distinct. Returns the problems plus the
 *  resolved keys for the correctAnswer check. */
function optionProblems(
	options: Array<{ label: string; value?: string }>,
): { problems: string[]; keys: string[] } {
	const problems: string[] = [];
	const keys: string[] = [];
	options.forEach((option, i) => {
		const label = option.label.trim();
		if (label.length === 0) {
			problems.push(`options[${i}].label is empty — every option needs a label.`);
			return;
		}
		const key = option.value?.trim() || label;
		if (keys.includes(key)) {
			problems.push(`Two options resolve to the same value "${key}" — options must be distinct.`);
		}
		keys.push(key);
	});
	return { problems, keys };
}

/** ask options: the shared sanity, nothing more (ask is not graded). */
export function askOptionProblems(options: Array<{ label: string; value?: string }>): string[] {
	return optionProblems(options).problems;
}

/** The full quiz authoring contract: option sanity + correctAnswer must be
 *  gradeable. Empty result = a quiz the dock can arm and grade faithfully. */
export function quizInputProblems(input: {
	options: Array<{ label: string; value?: string }>;
	correctAnswer: string | string[];
	multiSelect?: boolean;
}): string[] {
	const { problems, keys } = optionProblems(input.options);

	// Preserve exact option keys before trying copy-syntax cleanup — the
	// same option-aware coercion runs at the display and grading seams.
	const entries = coerceCorrectAnswer(input.correctAnswer, keys);
	const unique = [...new Set(entries)];
	if (unique.length === 0 || unique.some((v) => v.length === 0)) {
		problems.push("correctAnswer is required — provide the value (or label) of the correct option(s).");
		return problems;
	}
	for (const v of unique) {
		if (!keys.includes(v)) {
			problems.push(
				`correctAnswer "${v}" does not match any option value. Valid values: ${keys.map((k) => `"${k}"`).join(", ")}. ` +
					"Copy the exact value (or label) of the intended option — never a paraphrase or slug.",
			);
		}
	}
	if (unique.length > 1 && input.multiSelect !== true) {
		problems.push(
				`correctAnswer lists ${unique.length} values but multiSelect is not true — a single-select question with several ` +
					"correct answers can never be answered correctly. Set multiSelect: true, or make exactly one option correct.",
		);
	}
	return problems;
}

// The quiz authoring fields shared by the probe and teach tools. The
// prober's quiz has no nodeId (there is no map yet); the teacher's adds it.
// quizInputProblems runs in the tool's execute: TypeBox carries the structure, the problems function the
// cross-field rules.
//
// explanation sits right before correctAnswer because models emit args in
// schema order: reason first, then commit the answer.
const quizInputBase = Type.Object({
	question: Type.String({
		description:
			"The single quiz question to ask. ONE question per turn: ask, then end your turn — the answer determines the next question.",
	}),
	options: Type.Array(Type.Object(quizOptionProps), {
		minItems: 2,
		description:
			"REQUIRED. The answer options (2 or more) as a JSON ARRAY of option objects — never a " +
			"JSON-encoded string. Options only — there is no free-text mode. " +
			"Give each option a stable `value`; you reference the correct one by that value in correctAnswer. " +
			"Never add your own 'I don't know' option — that choice is added for you.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			description: "Set to true when more than one option is correct and the learner must select all of them.",
		}),
	),
	explanation: Type.String({
		description:
			"REQUIRED. Explanation revealed AFTER the learner answers (shown whether they got it right or wrong). " +
			"Use it to reinforce why the correct answer is correct. It is written BEFORE correctAnswer by design: " +
			"reason it out first, then commit the answer the reasoning supports.",
	}),
	correctAnswer: Type.Union([Type.String(), Type.Array(Type.String())], {
		description:
			"REQUIRED. The correct answer as the option value(s) — the `value` field of the option you intend. " +
			'Single-select: a single string (e.g. "mercury"). Multi-select: an array of strings (e.g. ["belize", "niue"]); ' +
			"the learner is only correct if their selection matches this set exactly. " +
			"Always pass the value, not a position number — this is self-checking and prevents miscounting. " +
			"A value that matches no option fails validation and the call is returned to you to fix.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
});


/** Normalize a persisted quiz `type` (display seam): old records carry
 *  none, and unhealable wobble degrades to undefined — callers render
 *  "Quiz" and the check-style card. The debris strip heals the recorded
 *  `"\"predict\""` wobble, so a raw persisted record displays its
 *  intended role. */
export function normalizeQuizType(raw: unknown): QuizQuestionType | undefined {
	if (typeof raw !== "string") return undefined;
	const v = stripModelValueDebris(raw);
	return v === "predict" ? "predict" : v === "check" ? "check" : undefined;
}

/** A question's kind label, shared by the waiting question and its answered
 *  card. The opening questions read "Warm-up" and "Recall"; a quiz reads
 *  "Quiz" ("Prediction" for a predict-type one), never "Check", which is
 *  the reveal button's word. */
export function questionKindLabel(tool: string, quizType: QuizQuestionType | undefined): string {
	if (tool === "probe") return "Warm-up";
	if (tool === "recall") return "Recall";
	if (tool === "quiz") return quizType === "predict" ? "Prediction" : "Quiz";
	if (tool === "explain") return "Explain";
	if (tool === "write_code") return "Code";
	return "Question";
}

/** The DISPLAY parse for persisted quiz calls (tool-parts.ts): the base
 *  + `type` as an OPTIONAL plain string (old records carry none, and
 *  Value.Clean keeps a key only when the schema knows it — the dock would
 *  otherwise lose the role it renders and gates by). Normalization is
 *  normalizeQuizType at the read seam; nodeId stays stripped (unknown
 *  key). */
export const quizDisplayInputSchema = Type.Object({
	...quizInputBase.properties,
	type: Type.Optional(Type.String()),
});

// ─── the explain tool (free-recall quizzing) ───────────────────────────────
//
// Quiz mechanics WITHOUT options: the learner answers in his own words.
// Against sycophancy, the model commits to the full correct answer BEFORE
// posing; the commitment is revealed on submit and restated in the answer
// result the model grades against. The client never grades free text.

const explainInputBase = Type.Object({
	question: Type.String({
		description:
			"The single question to ask. ONE question per turn: ask, then end your turn — the answer determines the next.",
	}),
	correctAnswer: Type.String({
		description:
			"REQUIRED. The full correct answer in your own words, reasoning included — COMMITTED before the learner " +
			"ever sees the question. The commitment is immutable: when his answer returns, grade it strictly against this " +
			"text — never revise the commitment after seeing his words, and never mark a wrong answer right to be kind. " +
			"It is shown to him on submit; your next reply grades the nuance of what he wrote.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
});

/** The DISPLAY parse for persisted explain calls (tool-parts.ts): the
 *  base + `type` as an OPTIONAL plain string — exactly the quiz display
 *  pattern. Old records carry none. nodeId stays stripped (unknown key). */
export const explainDisplayInputSchema = Type.Object({
	...explainInputBase.properties,
	type: Type.Optional(Type.String()),
});

/** The explain authoring contract: the commitment must exist. Empty
 *  result = an explain the dock can arm and the model can grade against. */
export function explainInputProblems(input: { correctAnswer: string }): string[] {
	if (input.correctAnswer.trim().length === 0) {
		return ["correctAnswer is required — commit to the full correct answer BEFORE posing the question."];
	}
	return [];
}

export const askInputSchema = Type.Object({
	// No `mode` param — the pi original has none: the mode is inferred from
	// whether options are present (the dock does exactly this). One less
	// knob for the model to misuse.
	question: Type.String({
		description:
			"The single question to ask the learner. ONE question per turn: ask, then end your turn — the answer determines the next question.",
	}),
	details: Type.Optional(
		Type.String({ description: "Optional extra context or instructions shown under the question." }),
	),
	options: Type.Optional(
		Type.Array(Type.Object(askOptionProps), {
			minItems: 2,
			description:
				"Optional multiple-choice options. Omit for free-form text input. " +
				"The learner can always choose 'Other' and type a custom answer when options are provided.",
		}),
	),
	multiSelect: Type.Optional(
		Type.Boolean({ description: "Set to true to allow multiple answers to the same question." }),
	),
});
// Ask's option sanity (labels non-empty, values distinct — ask is not
// graded, but duplicate values break the dock's value keying) runs at the
// call boundary in execute (askOptionProblems, above).

export type QuizDisplayInput = Static<typeof quizDisplayInputSchema>;
export type AskToolInput = Static<typeof askInputSchema>;
export type ExplainDisplayInput = Static<typeof explainDisplayInputSchema>;
