/**
 * The write_code question: the learner writes code in an editor and the
 * teacher grades it by reading (and may compile and run it with its own
 * tools). The app never grades or runs code. Pure: the tool's input
 * contract, the answer record, and the fenced block every display uses.
 */

import { Type, type Static } from "typebox";
import type { QuestionAnswerData } from "./question-core.ts";

export const writeCodeInputSchema = Type.Object({
	question: Type.String({
		description:
			"The task, in markdown: what to write, its signature and any rules. ONE question per turn: ask, then end your turn. His answer determines the next.",
	}),
	language: Type.Optional(
		Type.String({
			description:
				'The language he writes in, as a lowercase name: "c" (the default when omitted), "cpp", or any other language name (the editor shows it as plain text, without highlighting).',
		}),
	),
	starter: Type.Optional(
		Type.String({
			description:
				"Optional code the editor starts with (a signature, a skeleton, includes). Omit for an empty editor. Newlines as \\n.",
		}),
	),
});

export type WriteCodeInput = Static<typeof writeCodeInputSchema>;

/** The authoring contract: a task must exist. */
export function writeCodeInputProblems(input: { question: string }): string[] {
	return input.question.trim().length === 0 ? ["question is empty: write the task he should code."] : [];
}

/** The language a call names, as one lowercase word; C when absent. */
export function codeLanguage(raw: string | undefined): string {
	const name = raw?.trim().toLowerCase() ?? "";
	if (name === "") return "c";
	return name === "c++" ? "cpp" : name;
}

/** What the learner sends from the code panel. */
interface CodeAnswerRequest {
	code: string;
	dontKnow: boolean;
	thinking?: string;
}

/** The answer record. "I don't know" sends no code: he declined, like the
 *  quiz's choice clears the pick. Trailing whitespace is trimmed; leading
 *  indentation is part of the code. */
export function buildCodeAnswer(input: WriteCodeInput, req: CodeAnswerRequest, tool: string): QuestionAnswerData {
	const code = req.code.trimEnd();
	return {
		kind: "code",
		tool,
		questionText: input.question,
		dontKnow: req.dontKnow,
		answers: [],
		...(!req.dontKnow && code ? { code } : {}),
		language: codeLanguage(input.language),
		thinking: req.thinking?.trim() || undefined,
		answeredAt: new Date().toISOString(),
	};
}

/** A markdown code block that holds any code: the fence is longer than
 *  the longest backtick run inside it. */
export function fencedCode(code: string, language: string): string {
	const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(Math.max(3, longest + 1));
	return `${fence}${language}\n${code}\n${fence}`;
}
