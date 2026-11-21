/**
 * A lesson's problem list: a homework lesson's assignment problems (worked
 * one at a time with hints only) or a lesson on files' first file's. The
 * agent posts the problems (post_problems), opens one (problem) and marks it
 * done when the learner's own work is right (conclude). Pure and
 * browser-safe: the server saves the list on its file (a homework's on the
 * deadline when it has no assignment file), the lesson screen folds the same
 * calls over its messages.
 */
import type { SpaceDeadline, FileProblem } from "./contracts/space.ts";

/** A problem as the agent posts it; done is the app's to keep. */
type PostedProblem = Omit<FileProblem, "done">;

/** A lesson's problem list when the page loaded. */
export interface LessonProblemList {
	problems: FileProblem[];
}

/** A file the lesson's Document panel shows: `name` as lessons show it, `path` on disk (the
 *  desktop opens it), and for a PDF that opens its page count and its first page's width over
 *  its height. */
export interface LessonDocument {
	id: string;
	name: string;
	path: string | null;
	pdf: boolean;
	pages?: number;
	aspect?: number;
}

/** What a lesson's Document panel shows (GET /api/chats/{id}/documents): its files, and the file
 *  its problem list is printed in, null once that file has left the space. */
export interface LessonDocuments {
	documents: LessonDocument[];
	listFileId: string | null;
}

/** The kinds of deadline that have problems to work on. */
export function hasProblems(kind: SpaceDeadline["kind"]): boolean {
	return kind === "homework" || kind === "project";
}

/** The posted list, each problem keeping its done mark by number. */
function mergeProblems(previous: readonly FileProblem[], posted: readonly PostedProblem[]): FileProblem[] {
	const done = new Map(previous.map((p) => [p.number, p.done]));
	return posted.map((p) => ({ ...p, done: done.get(p.number) ?? false }));
}

const SOLVED = new Set(["solved", "solvedWithHints"]);

/** Whether a conclude outcome marks the problem done. */
function concludeMarksDone(outcome: unknown): boolean {
	return typeof outcome === "string" && SOLVED.has(outcome);
}

type ViewMessage = { parts: ReadonlyArray<{ type: string; state?: string; input?: unknown; toolCallId?: string }> };

/** The problems as a lesson sees them: its list when the page loaded, then
 *  every post_problems and done mark in the messages since, the number of
 *  the problem open now and the part marked in it. */
export function lessonProblems(
	initial: readonly FileProblem[],
	messages: readonly ViewMessage[],
): { problems: FileProblem[]; open: string | null; part: string | null } {
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

