/**
 * MOCKS — the one writer of a prep's mocks (store/mocks.ts).
 *
 * A mock asks the teacher twice: for its questions when it is made, and
 * for its grades when it ends (agent/subagents/mock-writer.ts). In between
 * the clock runs with no agent: answers are saved as the learner types,
 * and a code answer's examples run on this computer (mock-runner.ts).
 * Ending one and its grades are in mock-end.ts. One unfinished mock per
 * prep. Every change goes out as "prep-changed", except a saved answer:
 * its page already has it.
 */
import { randomUUID } from "node:crypto";
import { emit } from "../../shared/core/events.ts";
import { isMockLanguage, mockState, newMock, startMock, withAnswer, type Mock, type MockAnswer, type MockLanguage, type MockView } from "../../shared/core/mock.ts";
import { mockRequestText } from "../../shared/core/mock-requests.ts";
import type { RunOutcome } from "../../shared/core/mock-run.ts";
import { agentEngine } from "../agent/models.ts";
import { writeMockQuestions } from "../agent/subagents/mock-writer.ts";
import { listMocks, readMock, removeMock, writeMock } from "../store/mocks.ts";
import { askGrades, currentMocks, endIfOver, finish, isOver, mockLabel } from "./mock-end.ts";
import { runExamples } from "./mock-runner.ts";
import { cancelRun, isRunning, mockRunKey, prepSeams, runError, startRun } from "./prep-runs.ts";
import { done, fail, prepOf, prepView, type Outcome } from "./preps.ts";

const changed = (spaceId: string) => emit("prep-changed", { spaceId });

function mockOf(spaceId: string, mockId: string): Outcome<Mock> {
	const prep = prepOf(spaceId);
	if (!prep.ok) return prep;
	const mock = readMock(spaceId, mockId);
	return mock ? { ok: true, value: mock } : fail(404, "No such mock");
}

/** Make the prep's next mock and ask the teacher for its questions. */
export function createMock(spaceId: string): Outcome<{ mockId: string }> {
	const prep = prepOf(spaceId);
	if (!prep.ok) return prep;
	const format = prep.value.prep.mock;
	if (!format) return fail(409, "The prep sheet doesn't say what a mock is yet. Write the sheet first.");
	const mocks = currentMocks(spaceId);
	const open = mocks.find((m) => mockState(m) !== "graded");
	if (open) return fail(409, `Finish Mock ${open.n} first.`);
	const mock = newMock(`mock_${randomUUID().replace(/-/g, "").slice(0, 8)}`, Math.max(0, ...mocks.map((m) => m.n)) + 1, format, new Date().toISOString());
	writeMock(spaceId, mock);
	askQuestions(spaceId, mock);
	return { ok: true, value: { mockId: mock.id } };
}

function askQuestions(spaceId: string, mock: Mock): void {
	const view = prepView(spaceId);
	if (!view.ok) return;
	const { prep, topics } = view.value;
	const prompt = mockRequestText({
		goal: prep.goal,
		about: prep.about,
		format: mock.format,
		topics,
		asked: listMocks(spaceId).flatMap((m) => m.questions.map((q) => q.title)),
	});
	startRun(spaceId, mockRunKey(spaceId, mock.id), async (signal) => {
		const questions = await writeMockQuestions({ label: mockLabel(mock), prompt, format: mock.format, topicIds: new Set(topics.map((t) => t.id)), engine: prepSeams.engine ?? agentEngine(), signal });
		// The learner may have deleted the mock meanwhile.
		const now = readMock(spaceId, mock.id);
		if (now && mockState(now) === "writing") writeMock(spaceId, { ...now, questions });
	});
}

export function mockView(spaceId: string, mockId: string): Outcome<MockView> {
	const prep = prepOf(spaceId);
	if (!prep.ok) return prep;
	const saved = readMock(spaceId, mockId);
	if (!saved) return fail(404, "No such mock");
	const mock = endIfOver(spaceId, saved);
	const key = mockRunKey(spaceId, mockId);
	const error = runError(key);
	return {
		ok: true,
		value: {
			spaceId,
			prepName: prep.value.name,
			mock,
			topics: prep.value.prep.topics.map((t) => ({ id: t.id, name: t.name })),
			working: isRunning(key),
			...(error ? { error } : {}),
		},
	};
}

/** What the learner does on a mock's page. */
type MockAction =
	| { action: "start" }
	| { action: "answer"; questionId: string; answer: MockAnswer }
	| { action: "end" }
	/** Ask the teacher again after a failed write or grading. */
	| { action: "retry" };

/** A running mock reached past its time: it ends now, and what came is refused. */
function timeIsUp(spaceId: string, mock: Mock): { ok: false; status: number; error: string } {
	finish(spaceId, mock);
	return fail(409, "Time is up.");
}

export function changeMock(spaceId: string, mockId: string, change: MockAction): Outcome<null> {
	const found = mockOf(spaceId, mockId);
	if (!found.ok) return found;
	const mock = found.value;
	const state = mockState(mock);
	switch (change.action) {
		case "start":
			if (state !== "ready") return fail(409, "This mock can't be started.");
			writeMock(spaceId, startMock(mock, new Date().toISOString()));
			changed(spaceId);
			return done;
		case "answer":
			if (state !== "running") return fail(409, "This mock isn't running.");
			if (isOver(mock)) return timeIsUp(spaceId, mock);
			writeMock(spaceId, withAnswer(mock, change.questionId, change.answer));
			return done;
		case "end":
			if (state !== "running") return fail(409, "This mock isn't running.");
			finish(spaceId, mock);
			return done;
		case "retry":
			if (isRunning(mockRunKey(spaceId, mockId))) return fail(409, "Your agent is still working on this mock.");
			if (state === "writing") askQuestions(spaceId, mock);
			else if (state === "grading") askGrades(spaceId, mock);
			else return fail(409, "There is nothing to try again.");
			return done;
	}
}

export function deleteMock(spaceId: string, mockId: string): Outcome<null> {
	const found = mockOf(spaceId, mockId);
	if (!found.ok) return found;
	cancelRun(mockRunKey(spaceId, mockId));
	removeMock(spaceId, mockId);
	changed(spaceId);
	return done;
}

/** Run a code question's examples on the learner's code, while the mock
 *  runs; `signal` stops the run when its request goes away. */
export async function runMockExamples(spaceId: string, mockId: string, input: { questionId: string; code: string; language: unknown }, signal?: AbortSignal): Promise<Outcome<RunOutcome>> {
	const found = mockOf(spaceId, mockId);
	if (!found.ok) return found;
	if (mockState(found.value) !== "running") return fail(409, "This mock isn't running.");
	if (isOver(found.value)) return timeIsUp(spaceId, found.value);
	const question = found.value.questions.find((q) => q.id === input.questionId);
	if (!question || question.kind !== "code") return fail(404, "No such code question");
	if (!isMockLanguage(input.language)) return fail(400, "Pick JavaScript or Python.");
	const language: MockLanguage = input.language;
	return { ok: true, value: await runExamples(question, input.code, language, signal) };
}
