/**
 * Homework sessions: an assignment's problems, worked one at a time in the
 * lesson with hints only. The agent posts the problems (post_problems), opens
 * one (problem) and marks it done when the learner's own work is right
 * (conclude). Pure and browser-safe: the server saves the list on the
 * deadline, the lesson screen folds the same calls over its messages.
 */
import type { ClassDeadline, HomeworkProblem } from "./contracts/class.ts";

/** A problem as the agent posts it; done is the app's to keep. */
export type PostedProblem = Omit<HomeworkProblem, "done">;

/** What a homework lesson shows of its deadline: its name, its problems
 *  when the page loaded and its assignment file (the path opens it on the
 *  desktop). */
export interface HomeworkView {
	name: string;
	problems: HomeworkProblem[];
	assignment: { name: string; path: string | null } | null;
}

/** A problem's short name: "Q3" for a bare number, else as the assignment writes it. */
export function problemLabel(number: string): string {
	return /^\d/.test(number) ? `Q${number}` : number;
}

/** Where an open problem is in the assignment: "from hw4.pdf, page 2". */
export function problemSource(assignment: { name: string } | null, page: number | undefined): string | null {
	if (!assignment) return null;
	return `from ${assignment.name}${page ? `, page ${page}` : ""}`;
}

/** The kinds of deadline that have problems to work on. */
export function hasProblems(kind: ClassDeadline["kind"]): boolean {
	return kind === "homework" || kind === "project";
}

/** The posted list, each problem keeping its done mark by number. */
export function mergeProblems(previous: readonly HomeworkProblem[], posted: readonly PostedProblem[]): HomeworkProblem[] {
	const done = new Map(previous.map((p) => [p.number, p.done]));
	return posted.map((p) => ({ ...p, done: done.get(p.number) ?? false }));
}

/** How many problems are done; null with none posted. */
export function problemsDone(problems: readonly HomeworkProblem[] | undefined): { done: number; total: number } | null {
	if (!problems || problems.length === 0) return null;
	return { done: problems.filter((p) => p.done).length, total: problems.length };
}

/** A homework session on a deadline. */
export interface HomeworkSession {
	chatId: string;
	deadlineId: string;
	createdAt: string;
}

/** The latest homework session on a deadline, which Work on reopens. */
export function latestHomework(deadlineId: string, sessions: readonly HomeworkSession[]): string | null {
	let latest: HomeworkSession | null = null;
	for (const s of sessions) if (s.deadlineId === deadlineId && (!latest || s.createdAt > latest.createdAt)) latest = s;
	return latest?.chatId ?? null;
}

const SOLVED = new Set(["solved", "solvedWithHints"]);

/** Whether a conclude outcome marks the problem done. */
export function concludeMarksDone(outcome: unknown): boolean {
	return typeof outcome === "string" && SOLVED.has(outcome);
}

type ViewMessage = { parts: ReadonlyArray<{ type: string; state?: string; input?: unknown }> };

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

/** What the teacher knows when a homework session starts (a hidden
 *  message at its top). */
export function homeworkContextText(
	deadline: Pick<ClassDeadline, "name" | "kind" | "date" | "time">,
	assignment: { id: string; name: string; path: string | null } | null,
	problems: readonly HomeworkProblem[],
): string {
	const lines = [`[Homework] The learner is working on ${deadline.name} (${deadline.kind}), due ${deadline.date}${deadline.time ? ` ${deadline.time}` : ""}.`];
	lines.push(
		assignment
			? `Its assignment is the class file ${assignment.name} (file id ${assignment.id})${assignment.path ? `, at ${assignment.path}` : ""}.`
			: "No assignment file is attached yet. Ask the learner which class file it is and attach it with update_class_deadline (assignment_file_id), or work from the problems they paste.",
	);
	if (problems.length > 0) {
		lines.push("Its problems, posted before:", ...problems.map((p) => `- ${p.number}: ${p.title}${p.done ? " (done)" : ""}`), "Open the first one not done unless the learner picks another.");
	} else {
		lines.push("No problems are posted yet. Read the assignment and post them all with post_problems first.");
	}
	return lines.join("\n");
}
