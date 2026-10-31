/**
 * MODEL-VALUE DEBRIS STRIP: weak models emit values like
 * `correctAnswer: [":parmenides"]` (the JSON colon glued on) or
 * `type: "\"predict\""` (quotes baked in), and retry the same mistake.
 * Membership fields (correctAnswer against option values, quiz type
 * against the literal pair, practice targets against proposition ids)
 * are copied by the model from its own context, and the copy picks up
 * surrounding syntax: colons, periods, quotes, backticks, whitespace.
 *
 * THE SEAM: strip at every MEMBERSHIP comparison — never on free text
 * (statements, questions, explanations may legitimately carry any of
 * these characters). Pure + browser-safe: shared by the call boundary
 * (quizInputProblems), the display parse (tool-parts), and grading
 * (question-dock) — the three consumers the tool-parts law keeps in
 * lockstep. Idempotent by construction.
 */

/** Strip the copy-syntax debris a model glues onto a membership value:
 * any run of surrounding whitespace, colons, periods, double/single
 * quotes, and backticks, in any interleaving (`":value"`, `: value`,
 * `` `value` ``). The interior is untouched. A period can be real content
 * (a label's last word), which is why coerceCorrectAnswer checks exact
 * option keys first. */
export function stripModelValueDebris(value: string): string {
	return value.replace(/^[\s:."'`]+/, "").replace(/[\s:."'`]+$/, "");
}
