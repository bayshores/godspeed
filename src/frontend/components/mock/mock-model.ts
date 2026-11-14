/** A mock's words and counts on its pages. Pure. */
import { isMockLanguage, secondsLeft, starterCode, type CodeQuestion, type ExampleRun, type Mock, type MockAnswer, type MockFormat, type MockLanguage, type MockQuestion, type MockState, type MockSummary, type MockVerdict, type SpaceDeadline, type SpaceFile } from "@/shared/core";
import { fileState } from "@/frontend/components/deadline/deadline-model";

export function mockHref(spaceId: string, mockId: string): string {
	return `/space/mock/${encodeURIComponent(spaceId)}/${encodeURIComponent(mockId)}`;
}

/** The clock: "48:12", or "1:08:12" with an hour or more left. */
export function clockText(seconds: number): string {
	const s = Math.max(0, Math.floor(seconds));
	const two = (n: number) => String(n).padStart(2, "0");
	const hours = Math.floor(s / 3600);
	return hours > 0 ? `${hours}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

/** Time spent on a question: "12 min", "under a minute". */
export function spentText(seconds: number): string {
	return seconds < 60 ? "under a minute" : `${Math.round(seconds / 60)} min`;
}

/** How a graded question went, in the results' words. */
export const RESULT_WORD: Record<MockVerdict | "blank", string> = { right: "right", partly: "partly right", wrong: "wrong", blank: "left blank" };

/** "5 questions, no time limit", "1 question in 45 minutes". */
export function formatLine(format: MockFormat): string {
	const questions = `${format.questions} ${format.questions === 1 ? "question" : "questions"}`;
	return format.minutes === undefined ? `${questions}, no time limit` : `${questions} in ${minutes(format.minutes)}`;
}

/** The deadline's unfinished mock, when it has one. */
export function openMock(mocks: readonly MockSummary[]): MockSummary | undefined {
	return mocks.find((m) => m.state !== "graded");
}

/** Where a mock is, in a few words: "4 of 5 right", "32 min left",
 *  "Paused, 31:12 left". */
export function mockLine(m: MockSummary, nowMs: number): string {
	switch (m.state) {
		case "writing":
			return m.working ? "being written" : "not written";
		case "ready":
			return "ready to start";
		case "running": {
			const left = secondsLeft(m, nowMs);
			return left === null ? "started" : `${Math.ceil(left / 60)} min left`;
		}
		case "paused":
			return `Paused, ${clockText(m.paused?.left ?? 0)} left`;
		case "grading":
			return m.working ? "being graded" : "not graded";
		case "graded":
			return `${m.solved ?? 0} of ${m.format.questions} right`;
	}
}

/** The button that opens an unfinished mock. */
export function openMockLabel(m: Pick<MockSummary, "n" | "state">): string {
	return m.state === "ready" ? `Start Mock ${m.n}` : `Continue Mock ${m.n}`;
}

/** Under an ended mock's score: "in 32 of 45 minutes", "in 12 minutes". */
export function usedLine(used: number, format: MockFormat): string {
	return format.minutes === undefined ? `in ${minutes(used)}` : `in ${used} of ${minutes(format.minutes)}`;
}

/** The mock ended because its time was up (the server ends it at its end
 *  time; the window asks at zero, a moment early by the server's clock). */
export function endedByTime(mock: Pick<Mock, "endsAt" | "endedAt">): boolean {
	return mock.endsAt !== undefined && mock.endedAt !== undefined && Date.parse(mock.endedAt) >= Date.parse(mock.endsAt) - 2000;
}

/** What a screen reader hears when a mock changes by itself (the teacher
 *  wrote or graded it, its time ran out); "" otherwise. */
export function mockAnnouncement(mock: Mock, state: MockState): string {
	if (state === "ready") return `Mock ${mock.n} is ready.`;
	if (state === "grading" && endedByTime(mock)) return `The time is up, so Mock ${mock.n} ended.`;
	if (state === "graded") return `Mock ${mock.n} is graded.`;
	return "";
}

/** "Paused 2 times, 14 minutes in total."; null when it never was. */
export function pauseLine(total: { times: number; seconds: number }): string | null {
	if (total.times === 0) return null;
	const times = total.times === 1 ? "once" : `${total.times} times`;
	const length = total.seconds < 60 ? "under a minute" : minutes(Math.round(total.seconds / 60));
	return `Paused ${times}, ${length} in total.`;
}

/** An example as a call: twoSum([2,7,11,15], 9). */
export function exampleCall(fn: CodeQuestion["fn"], args: string): string {
	let list: unknown;
	try {
		list = JSON.parse(args);
	} catch {
		list = null;
	}
	return `${fn.name}(${Array.isArray(list) ? list.map((a) => JSON.stringify(a)).join(", ") : args})`;
}

/** How one example went: "returned 3", "returned 2, should be 1", or its error. */
export function exampleLine(run: ExampleRun, expected: string): string {
	if (run.error !== undefined) return run.error;
	return run.passed ? `returned ${run.returned}` : `returned ${run.returned}, should be ${expected}`;
}

/** Where Submit and Skip go next: the next question after `from` that
 *  isn't submitted, wrapping around; null when every one is. */
export function nextOpen(submitted: readonly boolean[], from: number): number | null {
	for (let step = 1; step <= submitted.length; step++) {
		const i = (from + step) % submitted.length;
		if (!submitted[i]) return i;
	}
	return null;
}

/** End mock's question opens with this: "Both answers are submitted.",
 *  "1 of 3 is not submitted.". */
export function submittedLine(total: number, notSubmitted: number): string {
	if (notSubmitted > 0) return `${notSubmitted} of ${total} ${notSubmitted === 1 ? "is" : "are"} not submitted.`;
	if (total === 1) return "Your answer is submitted.";
	return total === 2 ? "Both answers are submitted." : `All ${total} answers are submitted.`;
}

/** Why a mock was written from what the deadline is like: it has no study
 *  files, or the ones it has weren't read when the mock was written. */
export function fromAboutLine(files: readonly Pick<SpaceFile, "id" | "name" | "kind" | "status">[], deadline: Pick<SpaceDeadline, "fileIds">): string {
	const lead = "It was written from what it's like, since";
	const study = files.filter((f) => f.kind !== "info" && deadline.fileIds.includes(f.id));
	const unread = study.filter((f) => fileState(f) === "failed" || fileState(f) === "reading");
	if (study.length === 0) return `${lead} this deadline has no study files yet.`;
	if (unread.length === 0) return `${lead} its study files hadn't been read yet.`;
	if (unread.length > 1) return `${lead} ${unread.length} of its study files haven't been read yet.`;
	const file = unread[0]!;
	return `${lead} ${file.name} ${fileState(file) === "failed" ? "couldn't be read" : "hasn't been read yet"}.`;
}

/** localStorage key: the language picked last, for the next code question. */
export const MOCK_LANGUAGE_KEY = "lh:mock-language";

/** The stored language; JavaScript by default. */
export function parseMockLanguage(raw: string | null): MockLanguage {
	return isMockLanguage(raw) ? raw : "javascript";
}

/** One question's answer while the mock runs. */
export interface Work {
	language: MockLanguage;
	/** A code question: what is typed in each language. */
	code: Record<MockLanguage, string>;
	/** A written question: what is typed. */
	text: string;
	/** Seconds spent with it open. */
	seconds: number;
	submitted: boolean;
}

/** A question's work from its saved answer; a language nothing was typed
 *  in starts from the function's first lines. */
export function workOf(q: MockQuestion, saved: MockAnswer | undefined, preferred: MockLanguage): Work {
	const code: Record<MockLanguage, string> =
		q.kind === "code" ? { javascript: starterCode(q.fn, "javascript"), python: starterCode(q.fn, "python"), ...saved?.code } : { javascript: "", python: "" };
	return {
		language: saved?.language ?? preferred,
		code,
		text: q.kind === "text" ? (saved?.text ?? "") : "",
		seconds: saved?.seconds ?? 0,
		submitted: saved?.submitted ?? false,
	};
}

/** The answer to save: a code question's code in every language it was
 *  written in (the first lines alone are no answer), graded in the picked one. */
export function answerOf(q: MockQuestion, work: Work): MockAnswer {
	if (q.kind === "text") return { text: work.text, seconds: work.seconds, submitted: work.submitted };
	const code: Partial<Record<MockLanguage, string>> = {};
	for (const language of Object.keys(work.code) as MockLanguage[]) if (work.code[language] !== starterCode(q.fn, language)) code[language] = work.code[language];
	return { text: code[work.language] ?? "", language: work.language, code, seconds: work.seconds, submitted: work.submitted };
}
