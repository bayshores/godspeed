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

/** Where an open problem is in the assignment: "from hw4.pdf, page 2". */
export function problemSource(assignment: { name: string } | null, page: number | undefined): string | null {
	if (!assignment) return null;
	return `from ${assignment.name}${page ? `, page ${page}` : ""}`;
}

/** The kinds of deadline that have problems to work on. */
export function hasProblems(kind: SpaceDeadline["kind"]): boolean {
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
interface HomeworkSession {
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
function concludeMarksDone(outcome: unknown): boolean {
	return typeof outcome === "string" && SOLVED.has(outcome);
}

type ViewMessage = { parts: ReadonlyArray<{ type: string; state?: string; input?: unknown; toolCallId?: string }> };

/** The problems as a homework lesson sees them: the deadline's list when
 *  the page loaded, then every post_problems and done mark in the messages
 *  since, the number of the problem open now, the part marked in it, and
 *  each problem's first card (its `problem` call) by number. */
export function homeworkProblems(
	initial: readonly HomeworkProblem[],
	messages: readonly ViewMessage[],
): { problems: HomeworkProblem[]; open: string | null; part: string | null; cards: Record<string, string> } {
	let problems = [...initial];
	const cards: Record<string, string> = {};
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
				if (open !== null && call.toolCallId && !(open in cards)) cards[open] = call.toolCallId;
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
	return { problems, open, part, cards };
}

/** What the teacher knows when a homework session starts (a hidden
 *  message at its top). */
export function homeworkContextText(
	spaceId: string,
	deadline: Pick<SpaceDeadline, "id" | "name" | "kind" | "date" | "time">,
	assignment: { id: string; name: string; path: string | null } | null,
	problems: readonly HomeworkProblem[],
): string {
	const lines = [`[Homework] The learner is working on ${deadline.name} (${deadline.kind}), due ${deadline.date}${deadline.time ? ` ${deadline.time}` : ""}.`];
	lines.push(
		assignment
			? `Its assignment is the space file ${assignment.name} (file id ${assignment.id})${assignment.path ? `, at ${assignment.path}` : ""}.`
			: `No assignment file is attached yet. Find it in the space files (search_space_files) and attach it with update_space_deadline (space_id ${spaceId}, deadline_id ${deadline.id}, assignment_file_id) before you post its problems. Ask the learner only when you can't find it, or work from the problems they paste.`,
	);
	if (problems.length > 0) {
		lines.push("Its problems, posted before:", ...problems.map((p) => `- ${p.number}: ${p.title}${p.done ? " (done)" : ""}`), "Open the first one not done unless the learner picks another.");
	} else {
		lines.push("No problems are posted yet. Read the assignment and post them all with post_problems first.");
	}
	return lines.join("\n");
}
