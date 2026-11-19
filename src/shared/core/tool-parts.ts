/**
 * The UI parse seam: parse, don't cast. The Rust server validates a tool
 * call before it runs, but the live wire streams raw input while the model
 * is still typing, and the transcript keeps the input of rejected calls, so
 * the UI sees unvalidated input. Model-authored input is read only through
 * these parsers; a failure renders the quiet fallback, never a crash.
 * Server- and learner-authored output stays trusted.
 */

import { Value } from "typebox/value";
import type { TSchema } from "typebox";
import { quizDisplayInputSchema, askInputSchema, askOptionProblems, quizInputProblems, explainInputProblems, explainDisplayInputSchema, type AskToolInput, type QuizDisplayInput, type ExplainDisplayInput } from "./question-core.ts";
import { healEncodedArguments } from "./argument-heal.ts";
import { probeDoneInputSchema, type ProbeDoneInput } from "./contracts/probe.ts";
import { writeCodeInputProblems, writeCodeInputSchema, type WriteCodeInput } from "./code-question.ts";

/** The pi-boundary parse step, mirrored here: pi-ai's
 *  validateToolArguments runs TypeBox's Value.Convert on the model's raw
 *  arguments before Value.Check — a correctAnswer sent as the NUMBER 17
 *  converts to "17" at the boundary, so the tool poses the quiz fine. But the persisted record keeps
 *  the RAW arguments, so a parse seam that skips Convert would reject the
 *  exact input the boundary accepted — an invisible pending quiz and a
 *  learner lockout. Every display parse converts first, exactly like the
 *  boundary; Convert mutates, so the input is cloned before touching. */
function boundaryParse<T>(schema: TSchema, input: unknown): T | undefined {
	if (typeof input !== "object" || input === null) return undefined;
	const converted = structuredClone(input);
	Value.Convert(schema, converted);
	if (!Value.Check(schema, converted)) return undefined;
	return Value.Clean(schema, converted) as T;
}

/**
 * Quiz parse for DISPLAY: the shared authoring base, then the grading
 * refinement (quizInputProblems), so an input that could never have been
 * posed (e.g. `correctAnswer: undefined`, which Convert widens to "")
 * renders as a quiet fallback, not a broken quiz. The teacher-only `nodeId`
 * is an unknown key Value.Clean strips.
 *
 * Shape parsing never repairs authored text. The dock builds its answer
 * data from this source copy; recovery belongs exclusively to presentation
 * (ToolContentResponse), never option identities, grading, or snapshots.
 */
export function parseQuizInput(input: unknown): QuizDisplayInput | undefined {
	// quizDisplayInputSchema: base + the OPTIONAL `type` — teach-phase
	// records carry predict|check and the dock renders/gates by it; old and
	// probe records carry none. nodeId stays an unknown key Value.Clean
	// strips.
	// The display mirror of the boundary heal: the record keeps RAW
	// arguments, so a `type: "\"predict\""` wobble must heal HERE too or a
	// posed quiz renders invisible.
	const healedInput = healEncodedArguments(input, quizDisplayInputSchema);
	const cleaned = boundaryParse<QuizDisplayInput>(quizDisplayInputSchema, healedInput);
	if (!cleaned) return undefined;
	if (quizInputProblems(cleaned).length > 0) return undefined;
	return cleaned;
}

/**
 * Ask parse for DISPLAY: the full ask schema (options optional — free-text
 * mode is the options-less shape), plus the option-sanity refinement the
 * boundary enforced (askOptionProblems — duplicate values break the dock's
 * keying, so they parse to undefined).
 * Every display parse heals first, like the boundary does, because the
 * record keeps the raw arguments.
 */
export function parseAskInput(input: unknown): AskToolInput | undefined {
	const cleaned = boundaryParse<AskToolInput>(askInputSchema, healEncodedArguments(input, askInputSchema));
	if (!cleaned) return undefined;
	if (askOptionProblems(cleaned.options ?? []).length > 0) return undefined;
	return cleaned;
}

/** Explain parse for DISPLAY: the display schema (base + OPTIONAL
 *  lenient `type`, exactly the quiz pattern; the commitment refinement
 *  (explainInputProblems) mirrors the boundary chain). Both explain
 *  variants share the same fields; the teacher's nodeId is an unknown
 *  key Value.Clean strips, same as the quiz seam. */
export function parseExplainInput(input: unknown): ExplainDisplayInput | undefined {
	const cleaned = boundaryParse<ExplainDisplayInput>(explainDisplayInputSchema, healEncodedArguments(input, explainDisplayInputSchema));
	if (!cleaned) return undefined;
	if (explainInputProblems(cleaned).length > 0) return undefined;
	return cleaned;
}

/** write_code parse for DISPLAY: the tool's own schema and refinement. */
export function parseWriteCodeInput(input: unknown): WriteCodeInput | undefined {
	const cleaned = boundaryParse<WriteCodeInput>(writeCodeInputSchema, healEncodedArguments(input, writeCodeInputSchema));
	if (!cleaned) return undefined;
	if (writeCodeInputProblems(cleaned).length > 0) return undefined;
	return cleaned;
}

/** probe_done parse — the core-owned schema the tool itself declares. */
export function parseProbeDoneInput(input: unknown): ProbeDoneInput | undefined {
	return boundaryParse<ProbeDoneInput>(probeDoneInputSchema, healEncodedArguments(input, probeDoneInputSchema));
}