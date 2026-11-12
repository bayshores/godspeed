/**
 * THE MOCK'S TWO REQUESTS, each one work item on the single-submit seam
 * (runSubmitAgent): the questions before it starts ("Mock 1: questions")
 * and the grades after it ends ("Mock 1: grading"). Nothing is asked while
 * the clock runs.
 *
 * Only the model talks here; what the app sends and keeps is
 * server/mocks.ts.
 */
import { Type, type Static } from "typebox";
import type { MockFormat } from "../../../shared/core/contracts.ts";
import { takeQuestions, withGrades, type Mock, type MockQuestion, type WrittenGrade, type WrittenQuestion } from "../../../shared/core/mock.ts";
import type { PiEngine } from "../models.ts";
import { runSubmitAgent } from "./submit-agent.ts";

const MOCK_QUESTIONS_INSTRUCTIONS = `You write one practice run (a mock) for someone getting ready for the thing the request names. Reply with one write_mock_questions call.

- Write exactly the number of questions asked for, like the real thing in kind and difficulty, and doable in the time given. If the real thing gets harder as it goes, so does this.
- Cover what the real thing covers, leaning on the topics that most need work. Give each question the topic_id of the topic it tests most.
- Never repeat a question from an earlier mock.
- kind "code": the answer is one function, checked by calling it. Give function_name (one plain name used in both JavaScript and Python), params, and 2 to 4 examples. It takes and returns only JSON values (numbers, strings, true/false, null, arrays, objects) and behaves the same in both languages. An example's args is a JSON array with one item per parameter, expected is the JSON value it returns. Work each example out by hand: a wrong one costs the learner the question.
- kind "text": anything answered in words (explain, design, a behavioral question, a choice with its reason).
- statement, in markdown: what to do, what the function takes and returns, the limits on the input. The app shows the examples under it, so don't repeat them. No hints and no solution.
- No em-dashes.`;

const questionsSchema = Type.Object({
	questions: Type.Array(
		Type.Object({
			title: Type.String({ minLength: 1, description: "A few words." }),
			statement: Type.String({ minLength: 1, description: "The whole question, in markdown." }),
			kind: Type.Union([Type.Literal("code"), Type.Literal("text")]),
			topic_id: Type.Optional(Type.String({ description: "The id of the sheet topic it tests most." })),
			function_name: Type.Optional(Type.String({ description: "Code questions: the one function to write." })),
			params: Type.Optional(Type.Array(Type.String(), { description: "Code questions: its parameter names, in order." })),
			examples: Type.Optional(
				Type.Array(
					Type.Object({
						args: Type.String({ description: 'A JSON array with one item per parameter: "[[2,7,11,15], 9]".' }),
						expected: Type.String({ description: 'The JSON value it returns: "[0,1]".' }),
					}),
					{ description: "Code questions: 2 to 4 calls and what each returns." },
				),
			),
		}),
		{ minItems: 1 },
	),
});

/** Write a mock's questions. Throws when the agent never sends usable ones. */
export async function writeMockQuestions(input: {
	/** "Mock 1": the work item's label. */
	label: string;
	prompt: string;
	format: MockFormat;
	/** The prep's topic ids. */
	topicIds: ReadonlySet<string>;
	engine: PiEngine | undefined;
	signal: AbortSignal;
}): Promise<MockQuestion[]> {
	let questions: MockQuestion[] = [];
	await runSubmitAgent<WrittenQuestion[]>({
		toolName: "write_mock_questions",
		toolDescription: "Send every question of the mock, in order.",
		parameters: questionsSchema,
		fill: (raw: Static<typeof questionsSchema>) => raw.questions,
		validate: (written) => {
			const taken = takeQuestions(written, input.format, input.topicIds);
			if (typeof taken === "string") return taken;
			questions = taken;
			return null;
		},
		systemPrompt: MOCK_QUESTIONS_INSTRUCTIONS,
		prompt: input.prompt,
		taskLabel: `${input.label}: questions`,
		engine: input.engine,
		signal: input.signal,
		onStep: () => {},
		neverSubmitted: "the agent never sent the questions",
	});
	return questions;
}

const GRADE_MOCK_INSTRUCTIONS = `You grade one finished practice run (a mock). The request has every question, what the learner wrote, and how long each took. Reply with one grade_mock call.

- Grade every answered question. Skip the ones marked blank.
- A code answer: decide whether it is correct for every input the question allows, not only its examples. If you can run code, run it on the edge cases (empty input, one item, repeats, the largest sizes). right: correct, and fast enough for the limits. partly: the idea is right but some inputs fail or it is too slow. wrong: anything else.
- A written answer: right when it would pass in the real thing, partly when the core is there with real gaps, wrong otherwise.
- feedback, to the learner as "you", under 120 words, in markdown: what was right, the first thing that breaks it (name an input that fails), and what to fix. Don't write out the full solution: they can go over it with you after.
- No em-dashes.`;

const gradesSchema = Type.Object({
	grades: Type.Array(
		Type.Object({
			question: Type.String({ description: 'The question\'s id: "q1".' }),
			verdict: Type.Union([Type.Literal("right"), Type.Literal("partly"), Type.Literal("wrong")]),
			feedback: Type.String({ minLength: 1, description: "Under 120 words, markdown." }),
		}),
	),
});

/** Grade an ended mock: the mock with its grades. Throws when the agent
 *  never sends usable ones. */
export async function gradeMock(input: { label: string; prompt: string; mock: Mock; engine: PiEngine | undefined; signal: AbortSignal }): Promise<Mock> {
	let graded = input.mock;
	await runSubmitAgent<WrittenGrade[]>({
		toolName: "grade_mock",
		toolDescription: "Send the grade of every answered question.",
		parameters: gradesSchema,
		fill: (raw: Static<typeof gradesSchema>) => raw.grades,
		validate: (written) => {
			const taken = withGrades(input.mock, written);
			if (typeof taken === "string") return taken;
			graded = taken;
			return null;
		},
		systemPrompt: GRADE_MOCK_INSTRUCTIONS,
		prompt: input.prompt,
		taskLabel: `${input.label}: grading`,
		engine: input.engine,
		signal: input.signal,
		onStep: () => {},
		neverSubmitted: "the agent never sent the grades",
	});
	return graded;
}
