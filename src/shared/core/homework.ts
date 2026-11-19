/**
 * Homework sessions: an assignment's problems, worked one at a time in the
 * lesson with hints only. The agent posts the problems (post_problems), opens
 * one (problem) and marks it done when the learner's own work is right
 * (conclude). Pure and browser-safe: the server saves the list on the
 * deadline, the lesson screen folds the same calls over its messages.
 */
import type { SpaceDeadline, HomeworkProblem } from "./contracts/space.ts";

/** A problem as the agent posts it; done is the app's to keep. */
type PostedProblem = Omit<HomeworkProblem, "done">;

/** What a homework lesson shows of its deadline: its name, its problems
 *  when the page loaded and its assignment file (the path opens it on the
 *  desktop). */
export interface HomeworkView {
	name: string;
	problems: HomeworkProblem[];
	assignment: { name: string; path: string | null } | null;
}

/** The kinds of deadline that have problems to work on. */
export function hasProblems(kind: SpaceDeadline["kind"]): boolean {
	return kind === "homework" || kind === "project";
}

/** The posted list, each problem keeping its done mark by number. */
function mergeProblems(previous: readonly HomeworkProblem[], posted: readonly PostedProblem[]): HomeworkProblem[] {
	const done = new Map(previous.map((p) => [p.number, p.done]));
	return posted.map((p) => ({ ...p, done: done.get(p.number) ?? false }));
}

const SOLVED = new Set(["solved", "solvedWithHints"]);

/** Whether a conclude outcome marks the problem done. */
function concludeMarksDone(outcome: unknown): boolean {
	return typeof outcome === "string" && SOLVED.has(outcome);
}

type ViewMessage = { parts: ReadonlyArray<{ type: string; state?: string; input?: unknown; toolCallId?: string }> };

/** The problems as a homework lesson sees them: the deadline's list when
 *  the page loaded, then every post_problems and done mark in the messages
 *  since, the number of the problem open now and the part marked in it. */
export function homeworkProblems(
	initial: readonly HomeworkProblem[],
	messages: readonly ViewMessage[],
): { problems: HomeworkProblem[]; open: string | null; part: string | null } {
	let problems = [...initial];
	let open: string | null = null;
	let part: string | null = null;
	for (const m of messages) {
		for (const call of m.parts) {
			// A refused or still-streaming call changes nothing.
			if (call.state === "output-error" || call.state === "input-streaming") continue;
			const input = (call.input ?? {}) as { problems?: unknown; number?: unknown; outcome?: unknown; part?: unknown };
			if (call.type === "tool-post_problems" && Array.isArray(input.problems)) {
				problems = mergeProblems(problems, input.problems as PostedProblem[]);
			} else if (call.type === "tool-problem") {
				open = typeof input.number === "string" ? input.number : null;
				part = null;
			} else if (call.type === "tool-part") {
				if (open !== null && typeof input.part === "string" && input.part.trim()) part = input.part.trim();
			} else if (call.type === "tool-conclude") {
				if (open !== null && concludeMarksDone(input.outcome)) {
					const number = open;
					problems = problems.map((p) => (p.number === number ? { ...p, done: true } : p));
				}
				open = null;
				part = null;
			}
		}
	}
	return { problems, open, part };
}

