import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";

/**
 * work_plan: the teacher's plan for the reply it is working on, shown to
 * the learner while it works (the lesson's "agent at work" view). Nothing
 * is stored; the call's own input in the transcript is the plan, and the
 * newest call wins.
 */
const workPlanInput = Type.Object({
	items: Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
		minItems: 3,
		maxItems: 6,
		description: "The steps for this reply, in order, each a few plain words the learner reads, e.g. 'Read Theorem 1 in Rosen 7.1'.",
	}),
	done: Type.Integer({ minimum: 0, description: "How many items, from the top, are finished." }),
});

export const workPlanTool: AgentTool<typeof workPlanInput> = {
	name: "work_plan",
	label: "work_plan",
	description:
		"Show the learner your plan for this reply while you work. Call it first when the reply needs more than one step, then call it again with the same items and a higher `done` as you finish each one. Skip it for a reply that is a single step.",
	parameters: workPlanInput,
	execute: serverExecute("work_plan", workPlanInput, async ({ items, done }) => {
		if (done > items.length) return { ok: false, error: `done (${done}) is more than the ${items.length} items` };
		return "Plan shown to the learner.";
	}),
};
