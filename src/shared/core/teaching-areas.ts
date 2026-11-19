/**
 * The Teaching section's six areas: each groups the prompt parts, switches
 * and learner rules for one part of the teacher's job, and the limits and
 * one-line cleanup a rule gets before it is sent. The server cleans it again.
 * Browser-safe: pure data and string building.
 */

export type AreaId = "voice" | "teaching" | "questions" | "facts" | "demos" | "files";

export interface TeachingArea {
	id: AreaId;
	label: string;
	/** "{teacher}" is replaced with the teacher's name in the window. */
	about: string;
	/** Prompt segment paths, in the order the panel shows them. */
	parts: readonly string[];
}

export const TEACHING_AREAS: readonly TeachingArea[] = [
	{ id: "voice", label: "Voice", about: "How {teacher} talks: plain, direct, no praise", parts: ["shared/10-voice.md", "shared/11-learner-first.md"] },
	{
		id: "teaching",
		label: "Lesson flow",
		about: "Planning the lesson, one step at a time, predict then check",
		parts: [
			"system-prompt.md",
			"teacher/05-method.md",
			"teacher/10-planning.md",
			"teacher/20-teaching.md",
			"teacher/28-predictions.md",
			"shared/16-mental-model.md",
			"shared/35-work-plan.md",
		],
	},
	{
		id: "questions",
		label: "Questions",
		about: "How {teacher} checks what you know",
		parts: ["teacher/30-question-principles.md", "shared/20-question-tools.md", "shared/25-confidence.md", "prober/10-probe-doctrine.md"],
	},
	{
		id: "facts",
		label: "Facts and research",
		about: "Never guessing, checking on the web and in what you learned before",
		parts: ["shared/15-accuracy.md", "teacher/40-jobs.md"],
	},
	{ id: "demos", label: "Demos and figures", about: "Interactive demos and exact diagrams", parts: ["teacher/50-demos.md"] },
	{
		id: "files",
		label: "Your files and formatting",
		about: "Reading your PDFs and laying out answers",
		parts: ["shared/30-learner-files.md", "shared/40-formatting.md", "shared/12-space-context.md", "shared/14-deadline-changes.md", "shared/13-source-marks.md"],
	},
];

/** The plain name each prompt part shows under in the window. */
export const PART_NAMES: Readonly<Record<string, string>> = {
	"shared/10-voice.md": "Voice",
	"shared/11-learner-first.md": "Your question first",
	"system-prompt.md": "The goal",
	"teacher/05-method.md": "Teaching method",
	"teacher/10-planning.md": "Planning",
	"teacher/20-teaching.md": "Step by step",
	"teacher/28-predictions.md": "Predict, then check",
	"shared/16-mental-model.md": "Thinking out loud",
	"shared/35-work-plan.md": "Work plan",
	"teacher/30-question-principles.md": "Good check questions",
	"shared/20-question-tools.md": "Question tools",
	"shared/25-confidence.md": "Confidence",
	"prober/10-probe-doctrine.md": "Finding your level",
	"shared/15-accuracy.md": "Accuracy",
	"teacher/40-jobs.md": "Research",
	"teacher/50-demos.md": "Demos and figures",
	"shared/30-learner-files.md": "Your files",
	"shared/40-formatting.md": "Formatting",
	"shared/12-space-context.md": "Space context",
	"shared/14-deadline-changes.md": "Deadline changes",
	"shared/13-source-marks.md": "Showing sources",
};

export const RULE_MAX_CHARS = 200;
/** Per area and per space: rules ride every turn's prompt, so they stay short. */
export const RULES_MAX = 20;

/** One line, no control characters, at most `max` characters. */
export function oneLine(raw: string, max: number): string {
	const line = raw.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();
	return [...line].slice(0, max).join("").trim();
}

export type AreaRules = Partial<Record<AreaId, string[]>>;
