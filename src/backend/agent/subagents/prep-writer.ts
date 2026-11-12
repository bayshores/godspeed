/**
 * THE PREP SHEET WRITER: one request on the single-submit seam
 * (runSubmitAgent), so the connected agent gets it as one labeled work
 * item ("Prep sheet: Backend phone screen"). The agent looks the thing up with
 * its own web search, reads any files the learner attached, and answers
 * with one write_prep_sheet call.
 *
 * Only the model talks here; what the app sends and keeps is
 * server/preps.ts.
 */
import { Type, type Static } from "typebox";
import type { PiEngine } from "../models.ts";
import { MAX_PREP_TOPICS, MOCK_MINUTES, MOCK_QUESTIONS, TOPIC_NAME_MAX, sheetProblem, type WrittenSheet } from "../../../shared/core/prep.ts";
import { runSubmitAgent } from "./submit-agent.ts";

const PREP_SHEET_INSTRUCTIONS = `You help someone get ready for one thing they named: an interview round, an online assessment, a test. They often don't know what it is like or what to study. Find out, then reply with one write_prep_sheet call.

- Look it up online with your own web search before you write: the exact format (how many questions, how long, what kinds), what it tests, how it is scored, what is allowed. Read any files they attached first (a job posting, an email, a resume): they say which role, level and stack this is.
- about: what it is like, for someone who has never seen it. Plain words, short paragraphs or a short list, under 200 words. Only what you found; where sources disagree or you could not find something, say so in one line. No pep talk.
- sources: the pages you actually read, each with its title and full URL. Never make one up.
- topics: what to study, in the order to study it: the most likely to come up and the most basic first. Each is one skill a study session can cover ("Arrays and strings", "Promises and async"), not a whole field. why: one line on where it shows up.
- mock: how many questions in how many minutes one practice run should be, matching the real thing as closely as a single sitting allows.
- name: a short name for this prep, a few words ("Backend phone screen").
- When the request lists topics the sheet already has, keep a topic's exact name where it still fits, so their progress on it stays.
- No em-dashes.`;

const sheetSchema = Type.Object({
	name: Type.String({ minLength: 1, description: 'A short name for this prep, a few words ("Backend phone screen").' }),
	about: Type.String({ minLength: 1, description: "What it is like: format, timing, what it tests, how it is scored. Markdown, under 200 words." }),
	sources: Type.Array(Type.Object({ title: Type.String(), url: Type.String({ description: "The full URL, starting with https://" }) }), { description: "The pages you read." }),
	topics: Type.Array(
		Type.Object({
			name: Type.String({ minLength: 1, maxLength: TOPIC_NAME_MAX, description: "One skill to study." }),
			why: Type.Optional(Type.String({ description: "One line: where it shows up." })),
		}),
		{ minItems: 1, maxItems: MAX_PREP_TOPICS, description: "What to study, in order." },
	),
	mock: Type.Object(
		{
			questions: Type.Integer({ minimum: MOCK_QUESTIONS.min, maximum: MOCK_QUESTIONS.max }),
			minutes: Type.Integer({ minimum: MOCK_MINUTES.min, maximum: MOCK_MINUTES.max }),
		},
		{ description: "One practice run: how many questions in how many minutes." },
	),
});

/** Write one prep's sheet. Throws when the agent never sends a usable one. */
export async function writePrepSheet(input: {
	/** The learner's words: the work item's label. */
	goal: string;
	/** The request (server/preps.ts). */
	prompt: string;
	engine: PiEngine | undefined;
	signal?: AbortSignal;
}): Promise<WrittenSheet> {
	return runSubmitAgent<WrittenSheet>({
		toolName: "write_prep_sheet",
		toolDescription: "Send the prep sheet: what it is like, your sources, the topics in order and the mock's format.",
		parameters: sheetSchema,
		fill: (raw: Static<typeof sheetSchema>) => raw,
		validate: sheetProblem,
		systemPrompt: PREP_SHEET_INSTRUCTIONS,
		prompt: input.prompt,
		taskLabel: `Prep sheet: ${input.goal}`,
		engine: input.engine,
		signal: input.signal,
		onStep: () => {},
		neverSubmitted: "the agent never sent the sheet",
	});
}
