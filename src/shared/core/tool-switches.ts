/** The tools a user may toggle off in settings: the sub-agent JOB tools
 *  only. Deliberately NOT toggleable: quiz + ask_user_question (assessment
 *  and teaching are built on graded verification), the learner-filesystem
 *  set, plan tools, and probe_done (a prober that can never conclude is a
 *  lockout). The write side validates against this list
 *  (settings-body.ts); the read-side sanitizer stays lenient. The names
 *  are the MODEL-FACING tool names. */
export const TOGGLEABLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

export type ToggleableTool = (typeof TOGGLEABLE_TOOLS)[number];

/** The switch names Settings shows. The prompt note uses the same ones so
 *  the model and the learner call each tool the same thing. */
export const TOOL_SWITCH_LABELS: Record<ToggleableTool, string> = {
	research: "Web research",
	demo: "Demos",
	visual: "Figures",
	pdf: "PDF reading",
};

