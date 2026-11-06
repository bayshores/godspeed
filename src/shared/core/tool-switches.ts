/** The tools a user may toggle off in settings: the sub-agent JOB tools
 *  only. Deliberately NOT toggleable: quiz + ask_user_question (assessment
 *  and teaching are built on graded verification), the learner-filesystem
 *  set, plan tools, and probe_done (a prober that can never conclude is a
 *  lockout). The write side validates against this list
 *  (settings-body.ts); the read-side sanitizer stays lenient. The names
 *  are the MODEL-FACING tool names. */
export const TOGGLEABLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

export type ToggleableTool = (typeof TOGGLEABLE_TOOLS)[number];

/** The keys the settings WRITE side accepts in agent.tools: the plain
 *  toggleables PLUS the quizzing-mechanics switch (`explain: true` arms
 *  free-recall quizzing and drops the MC quiz — see quizMechanics in
 *  agent/tools.ts). `quiz` itself stays unwritable:
 *  mechanics-managed, never individually toggleable. */
export const WRITABLE_TOOL_KEYS = [...TOGGLEABLE_TOOLS, "explain"] as const;

/** The resolved settings → factory seam shape: a partial record keyed by
 *  tool name. Absent key / undefined = enabled. Any explicit `false`
 *  removes that tool from the registry, whatever its name. */
export type EnabledTools = Partial<Record<string, boolean>>;

/** Drop every tool the resolved settings mark as disabled. The single
 *  filtering site every factory shares (prober/teacher/practice). */
export function filterEnabledTools<T>(tools: Record<string, T>, enabled?: EnabledTools): Record<string, T> {
	if (!enabled) return tools;
	const out: Record<string, T> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (enabled[name] === false) continue;
		out[name] = tool;
	}
	return out;
}

/** The switch names Settings shows. The prompt note uses the same ones so
 *  the model and the learner call each tool the same thing. */
export const TOOL_SWITCH_LABELS: Record<ToggleableTool, string> = {
	research: "Web research",
	demo: "Demos",
	visual: "Figures",
	pdf: "PDF reading",
};

/** One system-prompt line naming the agent's switched-off tools, so the
 *  doctrine's mentions of them don't send the model planning around a
 *  tool it no longer has. "" when none of `carried` is off. */
export function switchedOffToolsNote(enabled: EnabledTools | undefined, carried: readonly ToggleableTool[]): string {
	const off = carried.filter((tool) => enabled?.[tool] === false).map((tool) => `${TOOL_SWITCH_LABELS[tool]} (\`${tool}\`)`);
	if (off.length === 0) return "";
	if (off.length === 1) {
		return `The learner switched off ${off[0]} in Settings, so that tool is gone. Don't plan around it or offer it.`;
	}
	const names = `${off.slice(0, -1).join(", ")} and ${off.at(-1)}`;
	return `The learner switched off ${names} in Settings, so those tools are gone. Don't plan around them or offer them.`;
}
