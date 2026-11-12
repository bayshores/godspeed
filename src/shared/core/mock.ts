/**
 * THE MOCK: one timed run of questions like the real thing a prep is for.
 * The teacher writes every question before it starts, the clock then runs
 * with no agent, and the teacher grades everything once it ends. A code
 * question names one function and gives examples, so the learner can run
 * them while the clock runs. Pure and browser-safe.
 */
import type { MockFormat } from "./contracts.ts";
import type { AnswerOutcome } from "./progress.ts";
import { oneLine } from "./teaching-areas.ts";

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
	/** The prep topic it tests, when it tests one. */
	topicId?: string;
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

export interface Mock {
	/** "mock_" + 8 hex. */
	id: string;
	/** "Mock 1", "Mock 2": counts up in its prep. */
	n: number;
	format: MockFormat;
	createdAt: string;
	/** Empty until the teacher has written them. */
	questions: MockQuestion[];
	/** By question id. */
	answers: Record<string, MockAnswer>;
	startedAt?: string;
	endedAt?: string;
	/** By question id; absent until the teacher has graded it. */
	grades?: Record<string, MockGrade>;
}

/** The record format this build writes, stamped as "version". */
export const MOCK_FORMAT_VERSION = 1;

const TITLE_MAX = 80;
const STATEMENT_MAX = 6000;
export const ANSWER_MAX = 20000;
const FEEDBACK_MAX = 2000;
const MAX_EXAMPLES = 6;
const MAX_PARAMS = 6;
/** Longest an example's JSON text may be. */
const EXAMPLE_MAX = 2000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Names Node gives every file to run: calling one runs something the
 *  learner didn't write. */
const NODE_FILE_NAMES = new Set(["require", "module", "exports"]);
/** Words JavaScript or Python keep for themselves: as a name they break the
 *  starter code or the runner ("def f(graph, from, to):"). */
const KEYWORDS = new Set([
	...["await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if"],
	...["implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public", "return", "static", "super", "switch", "this", "throw"],
	...["true", "try", "typeof", "var", "void", "while", "with", "yield", "arguments", "eval"],
	...["False", "None", "True", "and", "as", "assert", "async", "def", "del", "elif", "except", "from", "global", "is", "lambda", "nonlocal", "not", "or", "pass", "raise"],
]);

/** One name that works in both languages. */
const isPlainName = (name: string) => IDENTIFIER.test(name) && !KEYWORDS.has(name);

/** A code question's function name: a plain name that can only be the
 *  learner's own function (no dunder or Node file name). */
function isFunctionName(name: string): boolean {
	return isPlainName(name) && !name.startsWith("__") && !NODE_FILE_NAMES.has(name);
}

const areParams = (params: readonly string[]) => params.length <= MAX_PARAMS && params.every(isPlainName) && new Set(params).size === params.length;

export function isMockId(id: unknown): id is string {
	return typeof id === "string" && /^mock_[a-f0-9]{8}$/.test(id);
}

export function newMock(id: string, n: number, format: MockFormat, now: string): Mock {
	return { id, n, format, createdAt: now, questions: [], answers: {} };
}

// ─── where a mock is ────────────────────────────────────────────────────────

/** writing: the teacher is writing the questions. ready: written, not
 *  started. running: the clock runs. grading: ended, the teacher is
 *  grading. graded: results are in. */
export type MockState = "writing" | "ready" | "running" | "grading" | "graded";

export function mockState(mock: Mock): MockState {
	if (mock.questions.length === 0) return "writing";
	if (!mock.startedAt) return "ready";
	if (!mock.endedAt) return "running";
	return mock.grades ? "graded" : "grading";
}

/** Whole seconds left on a running mock's clock (0 once it is over). */
export function secondsLeft(mock: Pick<Mock, "startedAt" | "format">, nowMs: number): number {
	if (!mock.startedAt) return mock.format.minutes * 60;
	const end = Date.parse(mock.startedAt) + mock.format.minutes * 60_000;
	return Math.max(0, Math.ceil((end - nowMs) / 1000));
}

// ─── the teacher's questions ────────────────────────────────────────────────

/** A question as the teacher sends it. */
export interface WrittenQuestion {
	title: string;
	statement: string;
	kind: "code" | "text";
	/** The id of the prep topic it tests. */
	topic_id?: string;
	/** Code questions: the one function to write. */
	function_name?: string;
	params?: string[];
	examples?: MockExample[];
}

function isJson(text: string): boolean {
	try {
		JSON.parse(text);
		return true;
	} catch {
		return false;
	}
}

function exampleProblem(e: MockExample, params: number): string | null {
	if (e.args.length > EXAMPLE_MAX || e.expected.length > EXAMPLE_MAX) return "an example is too long";
	let args: unknown;
	try {
		args = JSON.parse(e.args);
	} catch {
		return `example args ${JSON.stringify(e.args)} is not JSON`;
	}
	if (!Array.isArray(args) || args.length !== params) return `example args ${e.args} must be a JSON array with one item per parameter (${params})`;
	if (!isJson(e.expected)) return `example expected ${JSON.stringify(e.expected)} is not JSON`;
	return null;
}

/**
 * The teacher's questions as the mock keeps them, or why they can't be
 * kept (said back to the teacher). There must be exactly as many as the
 * mock's format asks for. A topic id the prep doesn't have is dropped.
 */
export function takeQuestions(written: readonly WrittenQuestion[], format: MockFormat, topicIds: ReadonlySet<string>): MockQuestion[] | string {
	if (written.length !== format.questions) return `Write exactly ${format.questions} questions (got ${written.length}).`;
	const out: MockQuestion[] = [];
	for (const [i, w] of written.entries()) {
		const at = `Question ${i + 1}`;
		const title = oneLine(w.title, TITLE_MAX);
		const statement = w.statement.trim().slice(0, STATEMENT_MAX);
		if (!title) return `${at}: title is empty.`;
		if (!statement) return `${at}: statement is empty.`;
		const base = { id: `q${i + 1}`, ...(w.topic_id && topicIds.has(w.topic_id) ? { topicId: w.topic_id } : {}), title, statement };
		if (w.kind === "text") {
			out.push({ ...base, kind: "text" });
			continue;
		}
		const name = w.function_name ?? "";
		const params = w.params ?? [];
		const examples = w.examples ?? [];
		if (!isFunctionName(name)) return `${at}: function_name must be one plain name (letters, digits, _, not starting with __) that works in JavaScript and Python: not a keyword of either, and not require, module or exports.`;
		if (!areParams(params)) {
			return `${at}: params must be up to ${MAX_PARAMS} different plain names, none a keyword in JavaScript or Python (say start and end, not from and to).`;
		}
		if (examples.length < 2 || examples.length > MAX_EXAMPLES) return `${at}: give 2 to ${MAX_EXAMPLES} examples.`;
		for (const e of examples) {
			const problem = exampleProblem(e, params.length);
			if (problem) return `${at}: ${problem}.`;
		}
		out.push({ ...base, kind: "code", fn: { name, params: [...params] }, examples: examples.map((e) => ({ args: e.args.trim(), expected: e.expected.trim() })) });
	}
	return out;
}

/** What the editor starts with for a code question. */
export function starterCode(fn: CodeQuestion["fn"], language: MockLanguage): string {
	const params = fn.params.join(", ");
	return language === "python" ? `def ${fn.name}(${params}):\n    pass\n` : `function ${fn.name}(${params}) {\n\t\n}\n`;
}

// ─── taking it ──────────────────────────────────────────────────────────────

export function startMock(mock: Mock, now: string): Mock {
	return mockState(mock) === "ready" ? { ...mock, startedAt: now } : mock;
}

/** A code answer's code by language, from anything: strings in known
 *  languages only, each cut to the longest answer. */
export function parseMockCode(raw: unknown): Partial<Record<MockLanguage, string>> {
	const out: Partial<Record<MockLanguage, string>> = {};
	if (!isRecord(raw)) return out;
	for (const [language, code] of Object.entries(raw)) if (isMockLanguage(language) && typeof code === "string") out[language] = code.slice(0, ANSWER_MAX);
	return out;
}

/** A running mock with one question's answer saved (unknown questions and
 *  mocks that aren't running are left alone). A code answer's text is its
 *  code in the picked language, so what is graded is what was picked. */
export function withAnswer(mock: Mock, questionId: string, answer: MockAnswer): Mock {
	const question = mock.questions.find((q) => q.id === questionId);
	if (!question || mockState(mock) !== "running") return mock;
	const seconds = Math.max(0, Math.round(answer.seconds));
	let kept: MockAnswer;
	if (question.kind === "code") {
		const code = parseMockCode(answer.code);
		const language = answer.language;
		kept = { text: (language && code[language]) ?? "", ...(language ? { language } : {}), code, seconds, submitted: answer.submitted };
	} else kept = { text: answer.text.slice(0, ANSWER_MAX), seconds, submitted: answer.submitted };
	return { ...mock, answers: { ...mock.answers, [questionId]: kept } };
}

export function endMock(mock: Mock, now: string): Mock {
	return mockState(mock) === "running" ? { ...mock, endedAt: now } : mock;
}

/** Something was written for the question. */
export const isAnswered = (a: MockAnswer | undefined): a is MockAnswer => a !== undefined && a.text.trim().length > 0;

// ─── the teacher's grades ───────────────────────────────────────────────────

/** A grade as the teacher sends it. */
export interface WrittenGrade {
	/** "q1", "q2". */
	question: string;
	verdict: MockVerdict;
	feedback: string;
}

/** The ended mock with its grades, or why they can't be kept: every
 *  answered question needs one (blank ones are never graded). */
export function withGrades(mock: Mock, written: readonly WrittenGrade[]): Mock | string {
	const grades: Record<string, MockGrade> = {};
	for (const q of mock.questions) {
		if (!isAnswered(mock.answers[q.id])) continue;
		const grade = written.find((g) => g.question === q.id);
		if (!grade) return `No grade for ${q.id}: grade every answered question.`;
		const feedback = grade.feedback.trim().slice(0, FEEDBACK_MAX);
		if (!feedback) return `The feedback for ${q.id} is empty.`;
		grades[q.id] = { verdict: grade.verdict, feedback };
	}
	return { ...mock, grades };
}

/** How one question went: its grade's verdict, or "blank" when nothing was
 *  written for it. Null before the mock is graded. */
export function questionResult(mock: Mock, questionId: string): MockVerdict | "blank" | null {
	if (!mock.grades) return null;
	return mock.grades[questionId]?.verdict ?? "blank";
}

/** A graded mock's questions as answers for the prep's topics, given when
 *  it ended: right is right, a blank one is "I don't know", anything else
 *  is wrong. */
export function mockAnswers(mock: Mock): Array<{ nodeId?: string; outcome: AnswerOutcome; answeredAt: string }> {
	return mock.questions.flatMap((q) => {
		const result = questionResult(mock, q.id);
		if (result === null || !mock.endedAt) return [];
		const outcome: AnswerOutcome = result === "right" ? "right" : result === "blank" ? "dontKnow" : "wrong";
		return [{ ...(q.topicId ? { nodeId: q.topicId } : {}), outcome, answeredAt: mock.endedAt }];
	});
}

/** Whole minutes an ended mock took, at most its format's; null before it ends. */
export function minutesUsed(mock: Pick<Mock, "startedAt" | "endedAt" | "format">): number | null {
	if (!mock.startedAt || !mock.endedAt) return null;
	const minutes = Math.ceil((Date.parse(mock.endedAt) - Date.parse(mock.startedAt)) / 60_000);
	return Math.min(mock.format.minutes, Math.max(1, minutes));
}

/** How many questions a graded mock got right. */
export function solvedCount(mock: Mock): number {
	return mock.questions.filter((q) => questionResult(mock, q.id) === "right").length;
}

// ─── what the pages show ────────────────────────────────────────────────────

/** A mock as a row on its prep's pages. */
export interface MockSummary {
	id: string;
	n: number;
	state: MockState;
	format: MockFormat;
	createdAt: string;
	startedAt?: string;
	endedAt?: string;
	/** Graded: how many questions were right. */
	solved?: number;
	/** The teacher is writing or grading it now. */
	working: boolean;
	/** Why the last write or grading failed. */
	error?: string;
}

export function mockSummary(mock: Mock, working: boolean, error: string | undefined): MockSummary {
	const state = mockState(mock);
	return {
		id: mock.id,
		n: mock.n,
		state,
		format: mock.format,
		createdAt: mock.createdAt,
		...(mock.startedAt ? { startedAt: mock.startedAt } : {}),
		...(mock.endedAt ? { endedAt: mock.endedAt } : {}),
		...(state === "graded" ? { solved: solvedCount(mock) } : {}),
		working,
		...(error ? { error } : {}),
	};
}

/** A mock as its own page shows it. */
export interface MockView {
	spaceId: string;
	/** Its prep's name. */
	prepName: string;
	mock: Mock;
	/** The prep's topics, for naming what to fix. */
	topics: Array<{ id: string; name: string }>;
	/** The teacher is writing or grading it now. */
	working: boolean;
	/** Why the last write or grading failed. */
	error?: string;
}

// ─── reading a saved one ────────────────────────────────────────────────────

function parseQuestion(raw: unknown): MockQuestion | null {
	if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.title !== "string" || typeof raw.statement !== "string") return null;
	const base = { id: raw.id, ...(typeof raw.topicId === "string" ? { topicId: raw.topicId } : {}), title: raw.title, statement: raw.statement };
	if (raw.kind === "text") return { ...base, kind: "text" };
	if (raw.kind !== "code" || !isRecord(raw.fn) || typeof raw.fn.name !== "string" || !Array.isArray(raw.fn.params) || !Array.isArray(raw.examples)) return null;
	const params = raw.fn.params.filter((p): p is string => typeof p === "string");
	// The name and params go into the program that runs the learner's code.
	if (!isFunctionName(raw.fn.name) || !areParams(params)) return null;
	const examples = raw.examples.flatMap((e): MockExample[] => (isRecord(e) && typeof e.args === "string" && typeof e.expected === "string" ? [{ args: e.args, expected: e.expected }] : []));
	return { ...base, kind: "code", fn: { name: raw.fn.name, params }, examples };
}

function parseAnswers(raw: unknown): Record<string, MockAnswer> {
	const out: Record<string, MockAnswer> = {};
	if (!isRecord(raw)) return out;
	for (const [id, a] of Object.entries(raw)) {
		if (!isRecord(a) || typeof a.text !== "string") continue;
		out[id] = {
			text: a.text,
			...(isMockLanguage(a.language) ? { language: a.language } : {}),
			...(isRecord(a.code) ? { code: parseMockCode(a.code) } : {}),
			seconds: typeof a.seconds === "number" && a.seconds >= 0 ? a.seconds : 0,
			submitted: a.submitted === true,
		};
	}
	return out;
}

function parseGrades(raw: unknown): Record<string, MockGrade> | undefined {
	if (!isRecord(raw)) return undefined;
	const out: Record<string, MockGrade> = {};
	for (const [id, g] of Object.entries(raw)) {
		if (!isRecord(g) || typeof g.feedback !== "string" || (g.verdict !== "right" && g.verdict !== "partly" && g.verdict !== "wrong")) continue;
		out[id] = { verdict: g.verdict, feedback: g.feedback };
	}
	return out;
}

/** A saved mock; "newer" when a newer build saved it, null when it isn't one. */
export function parseMock(raw: unknown): Mock | "newer" | null {
	if (!isRecord(raw)) return null;
	if (typeof raw.version === "number" && raw.version > MOCK_FORMAT_VERSION) return "newer";
	const format = raw.format;
	if (!isMockId(raw.id) || typeof raw.n !== "number" || typeof raw.createdAt !== "string") return null;
	if (!isRecord(format) || typeof format.questions !== "number" || typeof format.minutes !== "number") return null;
	const questions = (Array.isArray(raw.questions) ? raw.questions : []).flatMap((q) => parseQuestion(q) ?? []);
	const grades = parseGrades(raw.grades);
	return {
		id: raw.id,
		n: raw.n,
		format: { questions: format.questions, minutes: format.minutes },
		createdAt: raw.createdAt,
		questions,
		answers: parseAnswers(raw.answers),
		...(typeof raw.startedAt === "string" ? { startedAt: raw.startedAt } : {}),
		...(typeof raw.endedAt === "string" ? { endedAt: raw.endedAt } : {}),
		...(grades ? { grades } : {}),
	};
}
