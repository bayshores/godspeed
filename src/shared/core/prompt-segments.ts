
/** One segment of one agent's composed prompt. */
export interface PromptSegmentInfo {
	/** The override/store key — mirrors the source layout ("system-prompt.md",
	 *  "shared/30-learner-files.md", "teacher/20-teaching.md"). Stable across
	 *  agents: the base and shared/ fragments use the SAME path in both
	 *  agents' lists. */
	path: string;
	/** The source text (what the segment runs without an override). */
	sourceText: string;
	/** The learner's saved version (used in place of the source), or null. */
	overrideText: string | null;
	/** True for segments BOTH agents compose — the base and shared/ fragments. */
	shared: boolean;
}

