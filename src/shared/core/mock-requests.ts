/**
 * What the teacher is asked about a mock: the request for its questions
 * and the request for its grades. Pure.
 */
import type { MockFormat } from "./contracts.ts";
import { MOCK_LANGUAGES, isAnswered, minutesUsed, type Mock, type MockQuestion } from "./mock.ts";
import type { RunOutcome } from "./mock-run.ts";
import type { PrepTopicProgress } from "./prep.ts";
import { weakestFirst } from "./prep.ts";
import type { TopicStatus } from "./progress.ts";

const STATUS_NOTE: Record<TopicStatus, string> = { weak: "weak", shaky: "shaky", untested: "not tested yet", strong: "strong" };

/** The request for a mock's questions: what it is for, its size, the
 *  sheet's topics with how each is going, and what earlier mocks asked. */
export function mockRequestText(input: {
	goal: string;
	about: string;
	format: MockFormat;
	topics: readonly PrepTopicProgress[];
	/** Question titles of the prep's earlier mocks. */
	asked: readonly string[];
}): string {
	return [
		`They are preparing for: ${input.goal}`,
		"",
		"What it is like:",
		input.about,
		"",
		`Write a mock of exactly ${input.format.questions} ${input.format.questions === 1 ? "question" : "questions"} for ${input.format.minutes} minutes.`,
		...(input.topics.length > 0
			? ["", "The sheet's topics, the ones that most need work first (topic_id: name, how it is going):", ...weakestFirst(input.topics).map((t) => `- ${t.id}: ${t.name} (${STATUS_NOTE[t.status]})`)]
			: []),
		...(input.asked.length > 0 ? ["", "Earlier mocks asked these. Don't ask them again:", ...input.asked.map((title) => `- ${title}`)] : []),
	].join("\n");
}

const minutes = (seconds: number) => `${Math.max(1, Math.round(seconds / 60))} min`;

/** How the answer did on the question's own examples, in one line. */
function runLine(run: RunOutcome): string {
	if (run.error) return `It did not run on the examples here: ${run.error}`;
	const lines = run.examples.map((e, i) => `example ${i + 1} ${e.passed ? "passed" : e.error ? `threw ${e.error}` : `returned ${e.returned}`}`);
	return `Run on the examples here: ${lines.join(", ")}.`;
}

const BLANK_NOTE = "They left this blank. Don't grade it.";

function questionBlock(mock: Mock, q: MockQuestion, run: RunOutcome | undefined): string[] {
	const answer = mock.answers[q.id];
	const head = [`## ${q.id}: ${q.title} (${q.kind === "code" ? "code" : "written"})`, q.statement];
	if (q.kind === "code") {
		head.push(`Function: ${q.fn.name}(${q.fn.params.join(", ")}). Examples (arguments, then what it returns):`, ...q.examples.map((e) => `- ${e.args} returns ${e.expected}`));
	}
	if (!isAnswered(answer)) return [...head, BLANK_NOTE];
	const language = q.kind === "code" && answer.language ? answer.language : null;
	return [
		...head,
		`Their answer (${language ? `${MOCK_LANGUAGES[language]}, ` : ""}${minutes(answer.seconds)}${answer.submitted ? "" : ", never submitted"}):`,
		`\`\`\`${language ?? ""}`,
		answer.text,
		"```",
		...(run ? [runLine(run)] : []),
	];
}

/** What a session that goes over one graded question starts from: the
 *  question, the learner's answer and the grade. Null when the mock has
 *  no such question. */
export function goOverText(mock: Mock, questionId: string): string | null {
	const question = mock.questions.find((q) => q.id === questionId);
	if (!question) return null;
	const grade = mock.grades?.[questionId];
	return [
		`[Mock question] The learner wants to go over this question from Mock ${mock.n}. Start from what they wrote: say what was right, find the gap, and have them fix it themselves before anything new.`,
		"",
		...questionBlock(mock, question, undefined).filter((line) => line !== BLANK_NOTE),
		...(grade ? ["", `Your grade then: ${grade.verdict}. Your feedback then:`, grade.feedback] : ["", "They left it blank in the mock."]),
	].join("\n");
}

/** The request for an ended mock's grades: every question with what the
 *  learner wrote, and how each code answer did on its examples. */
export function gradeRequestText(input: { goal: string; mock: Mock; runs: Readonly<Record<string, RunOutcome>> }): string {
	const { mock } = input;
	const used = minutesUsed(mock);
	return [
		`They are preparing for: ${input.goal}`,
		`Mock ${mock.n}: ${mock.format.questions} ${mock.format.questions === 1 ? "question" : "questions"} in ${mock.format.minutes} minutes.${used === null ? "" : ` They used ${used} of them.`}`,
		...mock.questions.flatMap((q) => ["", ...questionBlock(mock, q, input.runs[q.id])]),
	].join("\n");
}
