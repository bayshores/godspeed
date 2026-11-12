/**
 * A MOCK'S END, by End mock or by its clock, and the request for its
 * grades. A mock whose time ran out while nobody was looking is ended the
 * next time it or its prep is read, so it never shows as running, takes
 * answers or holds back the next mock past its time.
 */
import { emit } from "../../shared/core/events.ts";
import { endMock, isAnswered, mockState, secondsLeft, type Mock } from "../../shared/core/mock.ts";
import { gradeRequestText } from "../../shared/core/mock-requests.ts";
import type { RunOutcome } from "../../shared/core/mock-run.ts";
import { agentEngine } from "../agent/models.ts";
import { gradeMock } from "../agent/subagents/mock-writer.ts";
import { listMocks, readMock, writeMock } from "../store/mocks.ts";
import { runExamples } from "./mock-runner.ts";
import { mockRunKey, prepSeams, startRun } from "./prep-runs.ts";
import { stores } from "./stores.ts";

/** How long past its time a running mock still takes the page's last save. */
const LATE_SAVE_MS = 10_000;

export const mockLabel = (mock: Mock) => `Mock ${mock.n}`;

/** Ask the teacher for an ended mock's grades. With nothing answered
 *  there is nothing to ask. */
export function askGrades(spaceId: string, mock: Mock): void {
	const prep = stores.spaceStore.getSpace(spaceId)?.prep;
	if (!prep) return;
	const answered = mock.questions.filter((q) => isAnswered(mock.answers[q.id]));
	if (answered.length === 0) {
		writeMock(spaceId, { ...mock, grades: {} });
		emit("prep-changed", { spaceId });
		return;
	}
	startRun(spaceId, mockRunKey(spaceId, mock.id), async (signal) => {
		const runs: Record<string, RunOutcome> = {};
		for (const q of answered) {
			// Deleted meanwhile: the learner's programs need not run.
			if (signal.aborted) return;
			const answer = mock.answers[q.id]!;
			if (q.kind === "code" && answer.language) runs[q.id] = await runExamples(q, answer.text, answer.language, signal);
		}
		const graded = await gradeMock({ label: mockLabel(mock), prompt: gradeRequestText({ goal: prep.goal, mock, runs }), mock, engine: prepSeams.engine ?? agentEngine(), signal });
		if (readMock(spaceId, mock.id)) writeMock(spaceId, graded);
	});
}

/** End a running mock and ask for its grades. */
export function finish(spaceId: string, mock: Mock): Mock {
	// Never later than its time ran out.
	const latest = Date.parse(mock.startedAt!) + mock.format.minutes * 60_000;
	const ended = endMock(mock, new Date(Math.min(Date.now(), latest)).toISOString());
	writeMock(spaceId, ended);
	emit("prep-changed", { spaceId });
	askGrades(spaceId, ended);
	// With nothing answered it is graded already.
	return readMock(spaceId, mock.id) ?? ended;
}

/** A running mock whose time ran out, past the last save's grace. */
export const isOver = (mock: Mock) => mockState(mock) === "running" && secondsLeft(mock, Date.now() - LATE_SAVE_MS) === 0;

/** The mock, ended first when its time ran out. */
export const endIfOver = (spaceId: string, mock: Mock): Mock => (isOver(mock) ? finish(spaceId, mock) : mock);

/** The prep's mocks, oldest first, each ended first when its time ran out. */
export const currentMocks = (spaceId: string): Mock[] => listMocks(spaceId).map((m) => endIfOver(spaceId, m));
