/**
 * THE MOCK: one run of questions like the real thing a deadline is for.
 * The teacher writes every question before it starts, the learner answers
 * with no agent (against a time limit when one was picked, which pauses),
 * and the teacher grades everything once it ends. A code question names
 * one function and gives examples, so the learner can run them. The server
 * keeps and changes mocks; these are its shapes and what the pages read
 * from them. Pure and browser-safe.
 */

export type MockLanguage = "javascript" | "python";

/** The languages a code question can be answered (and run) in. */
export const MOCK_LANGUAGES: Record<MockLanguage, string> = { javascript: "JavaScript", python: "Python" };

export function isMockLanguage(v: unknown): v is MockLanguage {
	return typeof v === "string" && Object.hasOwn(MOCK_LANGUAGES, v);
}

/** One call of a code question's function, as JSON text: the arguments
 *  (a JSON array, one item per parameter) and what it should return. */
export interface MockExample {
	args: string;
	expected: string;
}

interface QuestionBase {
	/** "q1", "q2": its place in the mock. */
	id: string;
	/** The facts it was written from, when the deadline has some. */
	factIds?: string[];
	title: string;
	/** The whole question, in markdown. */
	statement: string;
}

export type MockQuestion =
	| (QuestionBase & { kind: "code"; fn: { name: string; params: string[] }; examples: MockExample[] })
	| (QuestionBase & { kind: "text" });

export type CodeQuestion = Extract<MockQuestion, { kind: "code" }>;

export interface MockAnswer {
	/** What is graded: the written answer, or a code question's code in
	 *  its picked language. */
	text: string;
	/** Code questions: the picked language. */
	language?: MockLanguage;
	/** Code questions: what is written in each language (the function's
	 *  first lines alone are left out), so switching loses nothing. */
	code?: Partial<Record<MockLanguage, string>>;
	/** Seconds spent with this question open. */
	seconds: number;
	submitted: boolean;
}

export type MockVerdict = "right" | "partly" | "wrong";

export interface MockGrade {
	verdict: MockVerdict;
	/** What was right, what was not, and the fix, in markdown. */
	feedback: string;
}

/** What one mock is: how many questions, and the time limit in minutes
 *  (absent: no time limit). */
export interface MockFormat {
	questions: number;
	minutes?: number;
}

/** A pause of a timed mock, from and to as ISO times. */
interface MockPause {
	from: string;
	to: string;
}

export interface Mock {
	/** "mock_" + 8 hex. */
	id: string;
	deadlineId: string;
	/** "Mock 1", "Mock 2": counts up per deadline. */
	n: number;
	format: MockFormat;
	createdAt: string;
	/** Written from what the deadline is like alone (it had no study facts). */
	fromAbout?: true;
	/** Empty until the teacher has written them. */
	questions: MockQuestion[];
	/** By question id. */
	answers: Record<string, MockAnswer>;
	startedAt?: string;
	/** A timed mock while it runs: when its time is up (wall clock). */
	endsAt?: string;
	/** A timed mock while it is paused: since when, and the seconds left. */
	paused?: { at: string; left: number };
	/** Every pause that ended. */
	pauses: MockPause[];
	endedAt?: string;
	/** By question id; absent until the teacher has graded it. */
	grades?: Record<string, MockGrade>;
}

/** writing: the teacher is writing the questions. ready: written, not
 *  started. running: being answered. paused: a timed one, stopped by the
 *  learner. grading: ended, the teacher is grading. graded: results are in. */
export type MockState = "writing" | "ready" | "running" | "paused" | "grading" | "graded";

export function mockState(mock: Pick<Mock, "questions" | "startedAt" | "paused" | "endedAt" | "grades">): MockState {
	if (mock.questions.length === 0) return "writing";
	if (!mock.startedAt) return "ready";
	if (!mock.endedAt) return mock.paused ? "paused" : "running";
	return mock.grades ? "graded" : "grading";
}

/** Whole seconds left on a timed mock (0 once it is over); null with no
 *  time limit. A paused one keeps the seconds it had. */
export function secondsLeft(mock: Pick<Mock, "format" | "endsAt" | "paused">, nowMs: number): number | null {
	if (mock.format.minutes === undefined) return null;
	if (mock.paused) return mock.paused.left;
	if (!mock.endsAt) return mock.format.minutes * 60;
	return Math.max(0, Math.ceil((Date.parse(mock.endsAt) - nowMs) / 1000));
}

/** How often and how long an ended mock was paused, in whole seconds. */
export function pauseTotal(mock: Pick<Mock, "pauses">): { times: number; seconds: number } {
	const seconds = mock.pauses.reduce((sum, p) => sum + Math.max(0, Date.parse(p.to) - Date.parse(p.from)), 0) / 1000;
	return { times: mock.pauses.length, seconds: Math.round(seconds) };
}

/** Whole minutes an ended mock was answered, pauses left out (at least 1,
 *  at most its time limit); null before it ends. */
export function minutesUsed(mock: Pick<Mock, "startedAt" | "endedAt" | "format" | "pauses">): number | null {
	if (!mock.startedAt || !mock.endedAt) return null;
	const ms = Date.parse(mock.endedAt) - Date.parse(mock.startedAt) - pauseTotal(mock).seconds * 1000;
	const minutes = Math.max(1, Math.ceil(ms / 60_000));
	return mock.format.minutes === undefined ? minutes : Math.min(mock.format.minutes, minutes);
}

/** What the editor starts with for a code question. */
export function starterCode(fn: CodeQuestion["fn"], language: MockLanguage): string {
	const params = fn.params.join(", ");
	return language === "python" ? `def ${fn.name}(${params}):\n    pass\n` : `function ${fn.name}(${params}) {\n\t\n}\n`;
}

/** How one question went: its grade's verdict, or "blank" when nothing was
 *  written for it. Null before the mock is graded. */
export function questionResult(mock: Pick<Mock, "grades">, questionId: string): MockVerdict | "blank" | null {
	if (!mock.grades) return null;
	return mock.grades[questionId]?.verdict ?? "blank";
}

/** How many questions a graded mock got right. */
export function solvedCount(mock: Pick<Mock, "questions" | "grades">): number {
	return mock.questions.filter((q) => questionResult(mock, q.id) === "right").length;
}

/** A mock as a row on its deadline's page (GET /api/spaces/:id/mocks?deadline=), newest first. */
export interface MockSummary {
	id: string;
	n: number;
	state: MockState;
	format: MockFormat;
	createdAt: string;
	startedAt?: string;
	endsAt?: string;
	paused?: { at: string; left: number };
	endedAt?: string;
	/** Graded: how many questions were right. */
	solved?: number;
	/** The teacher is writing or grading it now. */
	working: boolean;
	/** Why the last write or grading failed. */
	error?: string;
}

/** A mock as its own page shows it (GET /api/spaces/:id/mocks/:mockId). */
export interface MockView {
	spaceId: string;
	deadlineId: string;
	/** Its deadline's name, for the way back. */
	deadlineName: string;
	mock: Mock;
	/** The teacher is writing or grading it now. */
	working: boolean;
	/** Why the last write or grading failed. */
	error?: string;
}
