/**
 * These scans read VIEW messages (core/view.ts LhViewMessage — the
 * client's grouped transcript). A tool part is structural: `tool-` prefix +
 * toolCallId. The server-side record scans (danglingQuestionOf over native
 * LhMessage[]) live in native-messages.ts.
 */
import type { QuestionKind } from "./question-core.ts";

interface UIMessage {
	role?: string;
	parts: Array<Record<string, unknown> & { type: string }>;
}

function isToolUIPart(part: UIMessage["parts"][number]): boolean {
	return part.type.startsWith("tool-") && typeof part.toolCallId === "string";
}

/**
 * The pending-question gate: an unanswered question tool part (QUESTION_TOOLS)
 * blocks the composer — one question at a time, mirroring the teacher's
 * prompt contract. Derived client state; the server enforces nothing.
 *
 * Scan order: MESSAGES newest-first (a later turn's live question supersedes
 * an older dangling one), but PARTS forward within a message — the model's
 * FIRST unanswered question is the dock subject. Parallel question calls
 * (pi executes them in one batch) are thus answered in the same order they
 * were asked, saved, and rendered as cards.
 *
 * Job tool parts (research/demo/visual) never pend client-side — the async
 * protocol resolves them server-side with an immediate ack (see
 * contracts/jobs.ts "THE ASYNC PROTOCOL"), so job tools are NOT returned
 * here. This file carries only the question gate.
 */
interface PendingToolCall {
	toolCallId: string;
	tool: string;
	/** Tool input (the question tool's args) — lets the composer pick note vs answer mode. */
	input: unknown;
}

/** Tools that render in the question dock and gate the composer. The
 *  probe-phase names (probe/recall) join their teach
 *  twins — old records keep the teach names; new probe-phase calls carry
 *  the phase names. */
export const QUESTION_TOOLS = [
	"quiz",
	"probe",
	"ask_user_question",
	"explain",
	"recall",
	"write_code",
] as const;

/** The tool→kind map (the dock's own fold, named once — the dismissal
 *  path and the dock must never disagree on what a tool is). The probe
 *  names fold onto their teach kinds — the dock is kind-driven. */
export function toolQuestionKind(tool: string): QuestionKind {
	if (tool === "quiz" || tool === "probe") return "quiz";
	if (tool === "explain" || tool === "recall") return "explain";
	return tool === "write_code" ? "code" : "ask";
}

// ─── Tool availability (settings seam) ──────────────────────────────────────

/** The tools a user may toggle off in settings: the sub-agent JOB tools
 *  only. Deliberately NOT toggleable: quiz + ask_user_question (assessment
 *  and teaching are built on graded verification), the learner-filesystem
 *  set, plan tools, and probe_done (a prober that can never conclude is a
 *  lockout). The write side validates against this list
 *  (settings-body.ts); the read-side sanitizer stays lenient. The names
 *  are the MODEL-FACING tool names. */
export const TOGGLEABLE_TOOLS = ["research", "demo", "visual", "pdf"] as const;

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
 *  filtering site every factory shares (prober/teacher). */
export function filterEnabledTools<T>(tools: Record<string, T>, enabled?: EnabledTools): Record<string, T> {
	if (!enabled) return tools;
	const out: Record<string, T> = {};
	for (const [name, tool] of Object.entries(tools)) {
		if (enabled[name] === false) continue;
		out[name] = tool;
	}
	return out;
}

export function findPendingToolCall(messages: UIMessage[]): PendingToolCall | null {
	for (let m = messages.length - 1; m >= 0; m--) {
		const msg = messages[m]!;
		for (let p = 0; p < msg.parts.length; p++) {
			const part = msg.parts[p]!;
			if (isToolUIPart(part) && part.state === "input-available") {
				const tool = part.type.slice("tool-".length);
				if ((QUESTION_TOOLS as readonly string[]).includes(tool)) {
					return { toolCallId: part.toolCallId as string, tool, input: part.input };
				}
			}
		}
	}
	return null;
}

// ─── Turn activity label ─────────────────────────────────────────────────────

/**
 * What the teacher is doing RIGHT NOW, per tool. A tool part sits in
 * `input-streaming` for its whole execution, so the label must name the
 * actual tool: a generic "Writing a question…" would mislabel long greps.
 */
const ACTIVITY_LABELS: Record<string, string> = {
	read: "Reading a file…",
	ls: "Listing a directory…",
	find: "Finding files…",
	grep: "Searching file contents…",
	research: "Dispatching research…",
	demo: "Building a demo…",
	visual: "Making a visual…",
	pdf: "Reading a PDF…",
	plan_init: "Drawing up the plan…",
	probe_done: "Concluding the assessment…",
};

/** The activity label for ONE running tool, shown inline on the live
 *  tool-input card. Question tools render in the dock, never a live
 *  card. */
export function toolActivityLabel(tool: string): string {
	if ((QUESTION_TOOLS as readonly string[]).includes(tool)) return "Writing a question…";
	return ACTIVITY_LABELS[tool] ?? "Working…";
}
