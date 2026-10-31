import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import type { SaveRuleResult } from "../../core/agent-rules.ts";
import { RULE_MAX_CHARS, TEACHING_AREAS, type AreaId } from "../../core/teaching-areas.ts";

/**
 * save_rule: the teacher saves a lasting teaching rule on its own when the
 * learner states a preference. The learner sees it in the chat and can
 * undo or edit it. Returns the saved rule, or the refusal as text.
 */
export type SaveRule = (rule: string, scope: "every_lesson" | "this_class", area: AreaId | undefined) => SaveRuleResult | string;

const saveRuleInput = Type.Object({
	rule: Type.String({ minLength: 1, maxLength: RULE_MAX_CHARS, description: 'One line, an instruction to yourself in plain words, e.g. "Use Python for code examples."' }),
	for: Type.Union([Type.Literal("every_lesson"), Type.Literal("this_class")], {
		description: '"every_lesson", or "this_class" when it only matters in this lesson\'s class.',
	}),
	area: Type.Optional(
		Type.Union(
			TEACHING_AREAS.map((a) => Type.Literal(a.id)),
			{
				description:
					'With every_lesson, the part of teaching it is about: "voice" (how you talk), "teaching" (planning and steps, the default), "questions" (checks and quizzes), "facts" (accuracy and research), "demos" (demos and figures), "files" (the learner\'s files, formatting and code).',
			},
		),
	),
});

export function ruleTools(saveRule: SaveRule): Record<string, AgentTool<any>> {
	return {
		save_rule: {
			name: "save_rule",
			label: "save_rule",
			description:
				"Save a rule about how to teach this learner, when they tell you a preference that should hold in later lessons too (\"use Python from now on\", \"shorter answers please\"). " +
				"It joins the learner's rules and applies from your next turn. Don't use it for a one-off request, for facts about the learner, or for a rule they already have. " +
				"Don't ask first: the learner sees it in the chat and can undo or edit it, so just mention it in a few words.",
			parameters: saveRuleInput,
			execute: serverExecute("save_rule", saveRuleInput, async (input): Promise<SaveRuleResult | string> => saveRule(input.rule, input.for, input.area)),
		},
	};
}
