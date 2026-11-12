// Mocks: the teacher's questions taken or refused, answers and grades kept, saved mocks read
// back (odd and broken ones too), the clock, the program that runs the examples and how its
// output is read, and the texts the teacher is sent.
import { endMock, minutesUsed, mockAnswers, mockState, mockSummary, newMock, parseMock, questionResult, secondsLeft, solvedCount, startMock, starterCode, takeQuestions, withAnswer, withGrades, type Mock, type MockQuestion, type WrittenQuestion } from "../../../../src/shared/core/mock.ts";
import { readRun, runnerSource } from "../../../../src/shared/core/mock-run.ts";
import { goOverText, gradeRequestText, mockRequestText } from "../../../../src/shared/core/mock-requests.ts";
import type { PrepTopicProgress } from "../../../../src/shared/core/prep.ts";

const FORMAT = { questions: 2, minutes: 45 };
const TOPICS = new Set(["pt_lists", "pt_maps"]);

const code = (change: Partial<WrittenQuestion> = {}): WrittenQuestion => ({
	title: "  Pair   sums\n",
	statement: "  Return the indexes of two numbers that add up to `target`.  ",
	kind: "code",
	topic_id: "pt_lists",
	function_name: "pairSum",
	params: ["nums", "target"],
	examples: [
		{ args: " [[2,7,11], 9] ", expected: " [0,1] " },
		{ args: "[[1,1], 2]", expected: "[0,1]" },
	],
	...change,
});
const text = (change: Partial<WrittenQuestion> = {}): WrittenQuestion => ({ title: "Hash maps", statement: "When is a hash map slow?", kind: "text", topic_id: "pt_maps", ...change });

export const takeCases: Array<{ written: WrittenQuestion[]; format?: { questions: number; minutes: number } }> = [
	{ written: [code(), text()] },
	{ written: [code({ topic_id: "pt_other" }), text({ topic_id: "" })] },
	{ written: [code()] },
	{ written: [code(), text(), text()], format: { questions: 3, minutes: 60 } },
	{ written: [code({ title: "\u0007 " }), text()] },
	{ written: [code({ statement: " \n " }), text()] },
	{ written: [code({ statement: "x".repeat(6005) }), text()] },
	{ written: [code({ title: "A very long title ".repeat(8) }), text()] },
	{ written: [code({ function_name: undefined }), text()] },
	{ written: [code({ function_name: "pair_sum2" }), text()] },
	{ written: [code({ function_name: "2pair" }), text()] },
	{ written: [code({ function_name: "__init__" }), text()] },
	{ written: [code({ function_name: "exports" }), text()] },
	{ written: [code({ function_name: "yield" }), text()] },
	{ written: [code({ function_name: "nonlocal" }), text()] },
	{ written: [code({ function_name: "print" }), text()] },
	{ written: [code({ params: undefined, examples: [{ args: "[]", expected: "1" }, { args: "[]", expected: "2" }] }), text()] },
	{ written: [code({ params: ["a", "b", "c", "d", "e", "f", "g"] }), text()] },
	{ written: [code({ params: ["nums", "lambda"] }), text()] },
	{ written: [code({ params: ["nums", "nums"] }), text()] },
	{ written: [code({ examples: undefined }), text()] },
	{ written: [code({ examples: Array(7).fill({ args: "[[1], 1]", expected: "0" }) }), text()] },
	{ written: [code({ examples: [{ args: "[[1], 1, 2]", expected: "0" }, { args: "[[1], 1]", expected: "0" }] }), text()] },
	{ written: [code({ examples: [{ args: "{}", expected: "0" }, { args: "[[1], 1]", expected: "0" }] }), text()] },
	{ written: [code({ examples: [{ args: "[[1], 1]", expected: "nope" }, { args: "[[1], 1]", expected: "0" }] }), text()] },
	{ written: [code({ examples: [{ args: "[[1], 1]", expected: `"${"é".repeat(2001)}"` }, { args: "[[1], 1]", expected: "0" }] }), text()] },
	{ written: [code({ examples: [{ args: "[[1], 1", expected: "0" }, { args: "[[1], 1]", expected: "0" }] }), text()] },
	{ written: [code({ kind: "text" }), code({ kind: "code", function_name: "count", params: ["s"], examples: [{ args: '["a"]', expected: "1" }, { args: '[""]', expected: "0" }] })] },
];

function ready(): Mock {
	return { ...newMock("mock_a1b2c3d4", 3, FORMAT, "2026-11-12T08:00:00.000Z"), questions: takeQuestions([code(), text()], FORMAT, TOPICS) as MockQuestion[] };
}

function running(): Mock {
	return startMock(ready(), "2026-11-12T09:00:00.000Z");
}

const answers = [
	["q1", { text: "ignored", language: "python", code: { python: "def pairSum(nums, target):\n    return [0, 1]\n", javascript: "" }, seconds: 90.5, submitted: true }],
	["q1", { text: "x", language: "javascript", code: { javascript: "  \n", python: "py" }, seconds: -3, submitted: false }],
	["q1", { text: "x", code: { javascript: "js" }, seconds: 2.5, submitted: true }],
	["q1", { text: "x", code: {}, seconds: 1, submitted: true }],
	["q2", { text: "y".repeat(20005), language: "python", code: { python: "z" }, seconds: 12.49, submitted: false }],
	["q2", { text: "Words.", seconds: 1e21, submitted: true }],
	["q3", { text: "nothing", seconds: 1, submitted: true }],
] as const;

function graded(): Mock {
	const answered = withAnswer(withAnswer(running(), "q1", { text: "", language: "javascript", code: { javascript: "function pairSum() { return [0, 1]; }" }, seconds: 600, submitted: true }), "q2", { text: "When keys collide.", seconds: 125, submitted: false });
	return withGrades(endMock(answered, "2026-11-12T09:31:20.000Z"), [
		{ question: "q2", verdict: "partly", feedback: "  Collisions, yes; resizing too.  " },
		{ question: "q1", verdict: "wrong", feedback: "It always returns [0, 1]." },
		{ question: "q1", verdict: "right", feedback: "Ignored: the first one counts." },
	]) as Mock;
}

const record = (change: Record<string, unknown>) => ({ version: 1, ...JSON.parse(JSON.stringify(graded())), ...change });

export const parseCases: unknown[] = [
	record({}),
	record({ version: 2 }),
	record({ version: "2" }),
	record({ version: 0, extra: true }),
	record({ id: "mock_A1B2C3D4" }),
	record({ n: "3" }),
	record({ createdAt: 5 }),
	record({ format: { questions: 2 } }),
	record({ format: [2, 45] }),
	record({ questions: "none" }),
	record({ questions: [null, { id: "q1", title: "t", statement: "s", kind: "essay" }, { id: "q2", title: "t", statement: "s", kind: "text", topicId: "", extra: 1 }, { id: "q3", title: "t", statement: "s", kind: "code", fn: { name: "f", params: ["a", 3, "b"] }, examples: [{ args: "[1,2]", expected: "3" }, "x", { args: 1, expected: "2" }] }] }),
	record({ questions: [{ id: "q1", title: "t", statement: "s", kind: "code", fn: { name: "f", params: ["a", "a"] }, examples: [] }, { id: "q2", title: "t", statement: "s", kind: "code", fn: { name: "constructor", params: [] }, examples: [] }, { id: "q3", title: "t", statement: "s", kind: "code", fn: { name: "f", params: "a" }, examples: [] }] }),
	record({ answers: { q1: { text: "a", language: "ruby", code: { ruby: "x", python: 3, javascript: "js" }, seconds: -1, submitted: "yes" }, q2: { text: 5 }, q3: "x", q4: { text: "b", code: "nope", seconds: 7.25, submitted: true } } }),
	record({ answers: [] }),
	record({ startedAt: "", endedAt: 7 }),
	record({ grades: { q1: { verdict: "great", feedback: "x" }, q2: { verdict: "right" }, q3: { verdict: "wrong", feedback: "" } } }),
	record({ grades: "none" }),
	"mock",
	null,
	[],
];

const runExamples = [
	{ args: "[[2,7,11], 9]", expected: "[0,1]" },
	{ args: '["é \\"q\\"", {"a": [1, null]}]', expected: '{"b": 2.5, "a": [true]}' },
	{ args: "[1e3, -0]", expected: "1000.0000000001" },
];

export const readCases: Array<{ stdout: string; stderr: string }> = [
	{ stdout: '\n@@[{"returned":"[0, 1]"},{"returned":"{\\"a\\": [true], \\"b\\": 2.5}"},{"returned":"1000"}]\n', stderr: "" },
	{ stdout: 'hi\n  there  \n@@[{"returned":"[1,0]"},{"error":"ZeroDivisionError: division by zero"}]\nafter', stderr: "" },
	{ stdout: '@@[{"returned":"not json"},{"returned":5},7]', stderr: "" },
	{ stdout: '@@{"returned":"1"}', stderr: "boom" },
	{ stdout: "@@[1,2", stderr: "  File \"solution.py\", line 2\n    return [\n           ^\nSyntaxError: '[' was never closed\n" },
	{ stdout: "x".repeat(2100), stderr: "" },
	{ stdout: "@@[]\n@@[{\"returned\":\"[0,1]\"}]", stderr: "" },
	{ stdout: "", stderr: Array.from({ length: 15 }, (_, i) => `line ${i}`).join("\n") + "\n    at Object.<anonymous> (node:internal/x:1:1)\nNode.js v24.1.0\n" },
	{ stdout: "", stderr: "\n\n   \n" },
	{ stdout: "é😀 before\r\n@@[]", stderr: "" },
];

const topic = (id: string, name: string, status: PrepTopicProgress["status"]) => ({ id, name, status, answered: 0, right: 0, rate: null }) as PrepTopicProgress;

const at = "2026-11-12T09:00:00.000Z";

export default {
	"take questions": () => takeCases.map((c) => ({ written: c.written, format: c.format ?? FORMAT, output: takeQuestions(c.written, c.format ?? FORMAT, TOPICS) })),
	"starter code": () => (["javascript", "python"] as const).map((l) => [starterCode({ name: "pairSum", params: [] }, l), starterCode({ name: "f", params: ["a", "b_2"] }, l)]),
	"states and clock": () => {
		const live = running();
		const over = endMock(live, "2026-11-12T09:20:00.000Z");
		const t0 = Date.parse(at);
		const mocks = [newMock("mock_a1b2c3d4", 1, FORMAT, "x"), ready(), live, over, withGrades(over, []) as Mock];
		const offsets = [0, 1, 999, 1000, 1001, 44 * 60_000 + 59_999, 45 * 60_000, 50 * 60_000];
		const ends = ["2026-11-12T09:20:00.000Z", at, "2026-11-12T11:00:00.000Z", "2026-11-12T09:00:00.001Z"];
		return {
			mocks,
			states: mocks.map(mockState),
			started: startMock(live, "later"),
			ended: endMock(over, "later"),
			offsets,
			left: offsets.map((ms) => secondsLeft(live, t0 + ms)),
			notStarted: secondsLeft(ready(), t0),
			ends,
			used: [minutesUsed(live), ...ends.map((end) => minutesUsed(endMock(live, end)))],
		};
	},
	"answers kept": () => answers.map(([id, answer]) => ({ mock: running(), id, answer, output: withAnswer(running(), id, answer as never) })),
	"answers refused": () => [ready(), endMock(running(), "2026-11-12T09:01:00.000Z")].map((mock) => ({ mock, output: withAnswer(mock, "q1", { text: "a", seconds: 1, submitted: true }) })),
	"grades": () => {
		const mock = graded();
		const over = endMock(withAnswer(withAnswer(running(), "q1", { text: "", language: "python", code: { python: "x" }, seconds: 5, submitted: true }), "q2", { text: " w ", seconds: 5, submitted: true }), "2026-11-12T09:05:00.000Z");
		const ended = endMock(withAnswer(withAnswer(running(), "q1", { text: "", language: "javascript", code: { javascript: "function pairSum() { return [0, 1]; }" }, seconds: 600, submitted: true }), "q2", { text: "When keys collide.", seconds: 125, submitted: false }), "2026-11-12T09:31:20.000Z");
		const blank = endMock(running(), "2026-11-12T09:05:00.000Z");
		const tries: Array<[Mock, Array<{ question: string; verdict: string; feedback: string }>]> = [
			[ended, [{ question: "q2", verdict: "partly", feedback: "  Collisions, yes; resizing too.  " }, { question: "q1", verdict: "wrong", feedback: "It always returns [0, 1]." }, { question: "q1", verdict: "right", feedback: "Ignored: the first one counts." }]],
			[over, []],
			[over, [{ question: "q1", verdict: "right", feedback: "ok" }]],
			[over, [{ question: "q1", verdict: "right", feedback: "ok" }, { question: "q2", verdict: "wrong", feedback: "\n \t" }]],
			[blank, [{ question: "q9", verdict: "right", feedback: "extra" }]],
		];
		return {
			tries: tries.map(([mock, written]) => ({ mock, written, output: withGrades(mock, written as never) })),
			mock,
			over,
			results: ["q1", "q2", "q3"].map((id) => questionResult(mock, id)),
			ungraded: questionResult(over, "q1"),
			answers: mockAnswers(mock),
			solved: solvedCount(mock),
			summaries: [mockSummary(mock, false, undefined), mockSummary(running(), true, "the agent never sent the questions"), mockSummary(ready(), false, "")],
			running: running(),
			ready: ready(),
		};
	},
	"parse": () => parseCases.map((raw) => ({ raw, output: parseMock(raw) })),
	"runner source": () =>
		(["javascript", "python"] as const).flatMap((language) => [
			runnerSource("def x():\n  pass", { name: "pairSum", params: ["nums", "target"] }, runExamples, language, "__godspeed_mark__"),
			runnerSource("", { name: "f", params: [] }, [], language, "M"),
		]),
	"read run": () => ({ examples: runExamples, cases: readCases.map((c) => ({ ...c, output: readRun(c.stdout, c.stderr, "@@", runExamples) })) }),
	"requests": () => {
		const mock = graded();
		const runs = { q1: { examples: [{ returned: "[0,1]", passed: true }, { error: "TypeError: x is not iterable", passed: false }, { passed: false }] } };
		const topics = [topic("pt_a", "A", "strong"), topic("pt_b", "B", "untested"), topic("pt_c", "C", "shaky"), topic("pt_d", "D", "weak"), topic("pt_e", "E", "weak")];
		const short = endMock(running(), "2026-11-12T09:00:30.000Z");
		const blankGraded = withGrades(endMock(running(), "2026-11-12T09:05:00.000Z"), []) as Mock;
		const timedOut = { q1: { examples: [], error: "Your code ran for more than 5 seconds and was stopped." } };
		return {
			topics,
			questions: [
				mockRequestText({ goal: "Backend intern online test", about: "Two coding questions.\nNo libraries.", format: { questions: 1, minutes: 45 }, topics, asked: ["Pair sums", "Hash maps"] }),
				mockRequestText({ goal: "g", about: "", format: { questions: 10, minutes: 240 }, topics: [], asked: [] }),
			],
			mock,
			runs,
			short,
			running: running(),
			timedOut,
			grades: [gradeRequestText({ goal: "Backend intern online test", mock, runs }), gradeRequestText({ goal: "g", mock: short, runs: {} }), gradeRequestText({ goal: "g", mock: running(), runs: timedOut })],
			blankGraded,
			goOver: [goOverText(mock, "q1"), goOverText(mock, "q2"), goOverText(blankGraded, "q2"), goOverText(mock, "q3")],
		};
	},
} as Record<string, () => unknown>;
