/** A mock's words and counts on its pages. Pure. */
import { isMockLanguage, secondsLeft, starterCode, type CodeQuestion, type ExampleRun, type Mock, type MockAnswer, type MockLanguage, type MockQuestion, type MockSummary, type MockVerdict } from "@/shared/core";

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

/** Time spent on a question: "12 min", "under a minute". */
export function spentText(seconds: number): string {
	return seconds < 60 ? "under a minute" : `${Math.round(seconds / 60)} min`;
}

/** How a graded question went, in the results' words. */
export const RESULT_WORD: Record<MockVerdict | "blank", string> = { right: "solved", partly: "partly right", wrong: "not solved", blank: "left blank" };

/** The prep's unfinished mock, when it has one. */
export function openMock(mocks: readonly MockSummary[]): MockSummary | undefined {
	return mocks.find((m) => m.state !== "graded");
}

/** Where a mock is, in a few words: "2 of 4 solved", "32 min left". */
export function mockLine(m: MockSummary, nowMs: number): string {
	switch (m.state) {
		case "writing":
			return m.working ? "being written" : "not written";
		case "ready":
			return "ready to start";
		case "running":
			return `${Math.ceil(secondsLeft(m, nowMs) / 60)} min left`;
		case "grading":
			return m.working ? "being graded" : "not graded";
		case "graded":
			return `${m.solved ?? 0} of ${m.format.questions} solved`;
	}
}

/** The button that opens an unfinished mock. */
export function openMockLabel(m: MockSummary): string {
	return m.state === "ready" ? `Start Mock ${m.n}` : m.state === "running" ? `Continue Mock ${m.n}` : `Open Mock ${m.n}`;
}

/** Under the sheet's mock button: "None taken yet." or how the last one went. */
export function lastMockLine(mocks: readonly MockSummary[]): string {
	const graded = mocks.filter((m) => m.state === "graded");
	const last = graded[graded.length - 1];
	return last ? `Mock ${last.n}: ${last.solved ?? 0} of ${last.format.questions} solved.` : "None taken yet.";
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

/** The topics of a graded mock's questions that weren't right, in question
 *  order, each once. */
export function fixFirst(mock: Pick<Mock, "questions" | "grades">, topics: ReadonlyArray<{ id: string; name: string }>): Array<{ id: string; name: string }> {
	const out: Array<{ id: string; name: string }> = [];
	for (const q of mock.questions) {
		if (mock.grades?.[q.id]?.verdict === "right") continue;
		const topic = topics.find((t) => t.id === q.topicId);
		if (topic && !out.some((o) => o.id === topic.id)) out.push(topic);
	}
	return out;
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
