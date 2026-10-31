/**
 * Unsent lesson drafts: what the learner typed but hasn't sent yet (the
 * message box, each waiting question's form and reading thoughts, each
 * practice problem's thinking). Saved per lesson so leaving the lesson or a
 * window reload never loses it. Pure.
 */
import { answeredCallIds, danglingQuestionOf, type LhMessage, type QuestionDraft, type QuestionFormDraft } from "@/core";
import { isLocalMessage } from "@/components/session-core";

export interface LessonDraft {
	composer: string;
	/** By question tool call id. */
	questions: Record<string, QuestionDraft>;
	/** By problem tool call id. */
	problems: Record<string, string>;
}

export const EMPTY_LESSON_DRAFT: LessonDraft = { composer: "", questions: {}, problems: {} };

export function lessonDraftKey(chatId: string): string {
	return `lh:lesson-draft:${chatId}`;
}

function formEmpty(f: QuestionFormDraft | undefined): boolean {
	if (!f) return true;
	const s = f.selection;
	return s.selected.size === 0 && !s.otherSelected && !s.dontKnow && !f.thinking.trim() && !f.other.trim() && !f.text.trim() && f.confidenceIndex === undefined;
}

function questionEmpty(q: QuestionDraft): boolean {
	return formEmpty(q.form) && !q.readingThinking?.trim();
}

export function withComposer(d: LessonDraft, text: string): LessonDraft {
	return d.composer === text ? d : { ...d, composer: text };
}

export function withQuestion(d: LessonDraft, id: string, patch: Partial<QuestionDraft>): LessonDraft {
	const next = { ...d.questions[id], ...patch };
	const questions = { ...d.questions };
	if (questionEmpty(next)) delete questions[id];
	else questions[id] = next;
	return { ...d, questions };
}

export function withProblem(d: LessonDraft, id: string, text: string): LessonDraft {
	if ((d.problems[id] ?? "") === text) return d;
	const problems = { ...d.problems };
	if (text.trim()) problems[id] = text;
	else delete problems[id];
	return { ...d, problems };
}

/** Drops what the lesson has moved past: a question whose answer the
 *  server saved (not just this window's optimistic copy), and a problem
 *  that is no longer the active one. Returns `d` itself when nothing goes. */
export function withoutSettled(d: LessonDraft, record: readonly LhMessage[], activeProblemId: string | null): LessonDraft {
	const questionIds = Object.keys(d.questions);
	const staleProblems = Object.keys(d.problems).filter((id) => id !== activeProblemId);
	if (questionIds.length === 0 && staleProblems.length === 0) return d;
	const confirmed = answeredCallIds(record.filter((m) => !isLocalMessage(m)));
	const settledQuestions = questionIds.filter((id) => confirmed.has(id));
	if (settledQuestions.length === 0 && staleProblems.length === 0) return d;
	const questions = { ...d.questions };
	for (const id of settledQuestions) delete questions[id];
	const problems = { ...d.problems };
	for (const id of staleProblems) delete problems[id];
	return { ...d, questions, problems };
}

/** Reading the drafts back keeps only the question the saved record still
 *  waits on: one answered, skipped or left behind by a stopped turn never
 *  comes back. Returns `d` itself when nothing goes. */
export function withoutEndedQuestions(d: LessonDraft, record: readonly LhMessage[]): LessonDraft {
	const waiting = danglingQuestionOf(record.filter((m) => !isLocalMessage(m)))?.toolCallId;
	const ended = Object.keys(d.questions).filter((id) => id !== waiting);
	if (ended.length === 0) return d;
	const questions = { ...d.questions };
	for (const id of ended) delete questions[id];
	return { ...d, questions };
}

/** Whether the learner has unsent text in what the lesson shows now. */
export function holdsDraft(d: LessonDraft, open: { questionId: string | null; problemId: string | null }): boolean {
	return (
		d.composer.trim().length > 0 ||
		(open.questionId !== null && d.questions[open.questionId] !== undefined) ||
		(open.problemId !== null && d.problems[open.problemId] !== undefined)
	);
}

/** The stored form, or null when there is nothing to keep. */
export function serializeLessonDraft(d: LessonDraft): string | null {
	const ids = Object.keys(d.questions);
	if (!d.composer.trim() && ids.length === 0 && Object.keys(d.problems).length === 0) return null;
	const questions = Object.fromEntries(
		ids.map((id) => {
			const q = d.questions[id]!;
			const form = q.form && { ...q.form, selection: { ...q.form.selection, selected: [...q.form.selection.selected] } };
			return [id, { ...q, ...(form ? { form } : {}) }];
		}),
	);
	return JSON.stringify({ composer: d.composer, questions, problems: d.problems });
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function parseForm(v: unknown): QuestionFormDraft | undefined {
	if (!isRecord(v) || !isRecord(v.selection)) return undefined;
	const sel = v.selection;
	const selected = Array.isArray(sel.selected) ? sel.selected.filter((i): i is number => Number.isInteger(i)) : [];
	return {
		selection: { selected: new Set(selected), otherSelected: sel.otherSelected === true, dontKnow: sel.dontKnow === true },
		thinking: str(v.thinking),
		other: str(v.other),
		text: str(v.text),
		...(Number.isInteger(v.confidenceIndex) ? { confidenceIndex: v.confidenceIndex as number } : {}),
	};
}

/** Reads the stored form back; anything unreadable is an empty draft. */
export function parseLessonDraft(raw: string | null): LessonDraft {
	if (!raw) return EMPTY_LESSON_DRAFT;
	let v: unknown;
	try {
		v = JSON.parse(raw);
	} catch {
		return EMPTY_LESSON_DRAFT;
	}
	if (!isRecord(v)) return EMPTY_LESSON_DRAFT;
	const questions: Record<string, QuestionDraft> = {};
	for (const [id, q] of Object.entries(isRecord(v.questions) ? v.questions : {})) {
		if (!isRecord(q)) continue;
		const form = parseForm(q.form);
		const draft: QuestionDraft = { ...(form ? { form } : {}), ...(typeof q.readingThinking === "string" ? { readingThinking: q.readingThinking } : {}) };
		if (!questionEmpty(draft)) questions[id] = draft;
	}
	const problems: Record<string, string> = {};
	for (const [id, t] of Object.entries(isRecord(v.problems) ? v.problems : {})) {
		if (typeof t === "string" && t.trim()) problems[id] = t;
	}
	return { composer: str(v.composer), questions, problems };
}
