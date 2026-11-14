/**
 * PROGRESS — every number the Overview and the topic Graph show. Nothing
 * here is saved: it is all
 * derived from what the app already records (lesson answers, graph facts
 * and chains, space files and deadlines) plus the topic grouper's snapshot.
 *
 *  - answers: every graded quiz/probe answer in a lesson
 *  - answer → facts: the facts made from the lesson message that asked it
 *    (fact provenance (chatId, messageId))
 *  - topic score / status / overconfidence, arrows between topics, columns
 *  - coverage per study file and "Next up"
 *  - how each lesson went, calibration per confidence level
 *  - per deadline: days left, ready %, its topics, where you're at, "Work on next"
 *
 * Pure and browser-safe: no node builtins. The server assembles the inputs for GET /api/progress.
 */
import type { DeadlineKind, LessonKind, TopicMaterial } from "./contracts.ts";
import { type ContinueStudy } from "./continue-study.ts";
import type { LhMessage } from "./native-messages.ts";
import { isGradedTool, isQuestionTool } from "./pending.ts";
import { confidenceLevel, normalizeQuizType, type ConfidenceLevel, type QuestionAnswerData } from "./question-core.ts";
import { practiceOutcomes, type ConcludeOutcome } from "./practice-outcomes.ts";

// ─── the color ramp + statuses ──────────────────────────────────────────────

/** The topic ramp, red → green: CSS colors (globals.css --lh-ramp-1…5),
 *  so each background keeps them readable. */
export const RAMP_COLORS = ["var(--lh-ramp-1)", "var(--lh-ramp-2)", "var(--lh-ramp-3)", "var(--lh-ramp-4)", "var(--lh-ramp-5)"] as const;
/** Untested (no answers yet): the quietest ink. */
export const UNTESTED_COLOR = "var(--lh-ink-3)";

/** The ramp color for a right rate (0–1); gray when untested (null). */
export function rampColor(rate: number | null): string {
	if (rate === null || !Number.isFinite(rate)) return UNTESTED_COLOR;
	if (rate < 0.4) return RAMP_COLORS[0];
	if (rate < 0.55) return RAMP_COLORS[1];
	if (rate < 0.7) return RAMP_COLORS[2];
	if (rate < 0.85) return RAMP_COLORS[3];
	return RAMP_COLORS[4];
}

export type TopicStatus = "strong" | "shaky" | "weak" | "untested";

/** strong ≥ 85% right, shaky 55–85%, weak < 55%, untested = no answers. */
export function topicStatus(rate: number | null): TopicStatus {
	if (rate === null) return "untested";
	if (rate >= 0.85) return "strong";
	if (rate >= 0.55) return "shaky";
	return "weak";
}

// ─── answers ────────────────────────────────────────────────────────────────

/** "hinted": a practice problem solved with hints, counted at HINTED_WEIGHT of a right answer. */
export type AnswerOutcome = "right" | "hinted" | "wrong" | "dontKnow";

/** How much a problem solved with hints counts toward a rate: one alone reads shaky, not strong. */
export const HINTED_WEIGHT = 0.6;

/** One graded answer from a lesson: a quiz or probe answer, or a practice problem's outcome. */
interface AnsweredQuestion {
	chatId: string;
	/** The assistant message that asked (holds the quiz tool call). */
	messageId: string;
	/** Earlier assistant messages of the same turn, nearest first — the
	 *  fallback anchors when the asking message itself made no facts (the
	 *  teaching prose came a step before the quiz call). */
	contextMessageIds: string[];
	toolCallId: string;
	/** "quiz" (teach), "probe" (probe phase) or "problem" (practice). */
	tool: string;
	/** The facts it names itself (a practice problem's targets). */
	factIds?: string[];
	/** The plan node it is about (teach quizzes, study problems). */
	nodeId?: string;
	question: string;
	outcome: AnswerOutcome;
	/** Stored percentage (0–100), when the learner gave one. */
	confidence?: number;
	/** confidence as the 1–5 meter level. */
	level?: ConfidenceLevel;
	answeredAt: string;
}

/** A compact reference to one answer (what the UI's answer blocks need). */
export interface AnswerRef {
	chatId: string;
	toolCallId: string;
	outcome: AnswerOutcome;
	level?: ConfidenceLevel;
	answeredAt: string;
}

/** The outcome of a graded answer; null when it isn't one (ask/explain,
 *  dismissed, or a record without a verdict). */
export function answerOutcome(ad: Pick<QuestionAnswerData, "kind" | "dontKnow" | "correct" | "dismissed">): AnswerOutcome | null {
	if (ad.dismissed || ad.kind !== "quiz") return null;
	if (ad.dontKnow) return "dontKnow";
	if (typeof ad.correct !== "boolean") return null;
	return ad.correct ? "right" : "wrong";
}

export function isAnswerData(v: unknown): v is QuestionAnswerData {
	return typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";
}

/** A practice outcome as an answer: solved is right, solved with hints is
 *  "hinted", giving up or moving on is wrong. */
const PRACTICE_OUTCOME: Partial<Record<ConcludeOutcome, AnswerOutcome>> = { solved: "right", solvedWithHints: "hinted", movedOn: "wrong", surrendered: "wrong" };

/** Every graded quiz/probe answer in one lesson (predictions aside), in transcript order, then its practice problems' outcomes. */
export function collectAnswers(chatId: string, messages: readonly LhMessage[]): AnsweredQuestion[] {
	const calls = new Map<string, { messageId: string; context: string[]; tool: string; args: Record<string, unknown> }>();
	const out: AnsweredQuestion[] = [];
	// Assistant messages of the current turn, newest last (reset at a user
	// message or a question's answer — a new turn starts there).
	let turn: string[] = [];
	for (const m of messages) {
		const role = (m as { role?: string }).role;
		if (role === "user") {
			turn = [];
			continue;
		}
		if (role === "assistant") {
			const content = (m as { content?: unknown }).content;
			if (Array.isArray(content)) {
				for (const block of content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) {
					if (block.type !== "toolCall" || !block.id || !block.name || !isGradedTool(block.name)) continue;
					calls.set(block.id, {
						messageId: m.id,
						context: [...turn].reverse(),
						tool: block.name,
						args: (block.arguments && typeof block.arguments === "object" ? block.arguments : {}) as Record<string, unknown>,
					});
				}
			}
			turn.push(m.id);
			continue;
		}
		if (role !== "toolResult") continue;
		const result = m as { toolCallId?: string; toolName?: string; details?: unknown };
		// Any question's answer is the learner speaking: a new turn starts.
		if (isQuestionTool(result.toolName ?? "")) turn = [];
		const call = result.toolCallId ? calls.get(result.toolCallId) : undefined;
		if (!call) continue;
		turn = [];
		if (!isAnswerData(result.details)) continue;
		const ad = result.details;
		const outcome = answerOutcome(ad);
		if (!outcome) continue;
		// A prediction is a guess at what hasn't been taught yet: no evidence either way.
		if (normalizeQuizType(ad.questionType ?? call.args.type) === "predict") continue;
		const nodeId = typeof call.args.nodeId === "string" ? call.args.nodeId : undefined;
		const confidence = typeof ad.confidence === "number" && outcome !== "dontKnow" ? ad.confidence : undefined;
		out.push({
			chatId,
			messageId: call.messageId,
			contextMessageIds: call.context,
			toolCallId: result.toolCallId!,
			tool: ad.tool ?? call.tool,
			...(nodeId ? { nodeId } : {}),
			question: ad.questionText ?? (typeof call.args.question === "string" ? call.args.question : ""),
			outcome,
			...(confidence !== undefined ? { confidence, level: confidenceLevel(confidence) } : {}),
			answeredAt: ad.answeredAt ?? "",
		});
	}
	for (const p of practiceOutcomes(messages)) {
		const outcome = PRACTICE_OUTCOME[p.outcome];
		if (!outcome) continue;
		out.push({
			chatId,
			messageId: p.messageId,
			contextMessageIds: [],
			toolCallId: p.problemCallId,
			tool: "problem",
			...(p.targets.length > 0 ? { factIds: p.targets } : {}),
			...(p.nodeId ? { nodeId: p.nodeId } : {}),
			question: p.statement,
			outcome,
			answeredAt: p.at,
		});
	}
	return out;
}

const pointKey = (chatId: string, messageId: string) => `${chatId}\u0000${messageId}`;

/** The facts an answer counts for: the ones it names itself; else those
 *  made from (or tested at) the message that asked it; when that message
 *  has none, the nearest earlier teacher message of the same turn that does. */
export function factsForAnswer(answer: Pick<AnsweredQuestion, "chatId" | "messageId" | "contextMessageIds" | "factIds">, index: ReadonlyMap<string, string[]>): string[] {
	if (answer.factIds?.length) return answer.factIds;
	for (const messageId of [answer.messageId, ...answer.contextMessageIds]) {
		const hit = index.get(pointKey(answer.chatId, messageId));
		if (hit && hit.length > 0) return hit;
	}
	return [];
}

// ─── tallies ────────────────────────────────────────────────────────────────

interface Tally {
	answered: number;
	right: number;
	/** Problems solved with hints, only when there are some. */
	hinted?: number;
	wrong: number;
	dontKnow: number;
	/** (right + HINTED_WEIGHT × hinted) / answered ("I don't know" counts as not right); null = none. */
	rate: number | null;
}

export function tally(answers: ReadonlyArray<{ outcome: AnswerOutcome }>): Tally {
	let right = 0;
	let hinted = 0;
	let wrong = 0;
	let dontKnow = 0;
	for (const a of answers) {
		if (a.outcome === "right") right++;
		else if (a.outcome === "hinted") hinted++;
		else if (a.outcome === "wrong") wrong++;
		else dontKnow++;
	}
	const answered = right + hinted + wrong + dontKnow;
	const rate = answered === 0 ? null : (right + HINTED_WEIGHT * hinted) / answered;
	return { answered, right, ...(hinted > 0 ? { hinted } : {}), wrong, dontKnow, rate };
}

/** "3 of 4 right", and the problems solved with hints apart from those:
 *  "2 of 4 right, 1 solved with hints". */
export function rightWords(t: { right: number; hinted?: number; answered: number }): string {
	return `${t.right} of ${t.answered} right${hintedWords(t)}`;
}

/** ", 1 solved with hints", or "" with none. */
export function hintedWords(t: { hinted?: number }): string {
	return t.hinted ? `, ${t.hinted} solved with hints` : "";
}

// ─── topics: stats, links, columns ──────────────────────────────────────────

export interface TopicProgress extends Tally {
	id: string;
	name: string;
	/** Fact ids. */
	members: string[];
	/** The derived "Ungrouped" bucket (facts no snapshot placed yet). */
	ungrouped?: true;
	material?: TopicMaterial;
	status: TopicStatus;
	/** rampColor(rate). */
	color: string;
	overconfident: boolean;
	/** Every answer that counts for the topic, oldest first. */
	answers: AnswerRef[];
	/** Longest path from a foundation topic (0 = foundation). */
	column: number;
}

export interface TopicLink {
	/** Learn this topic first… */
	from: string;
	/** …then this one. */
	to: string;
	/** How many reasoning chains run from `from` into `to`. */
	weight: number;
}

// ─── facts ──────────────────────────────────────────────────────────────────

export interface FactProgress {
	id: string;
	name: string;
	statement: string;
	topicId: string;
	/** The birth source: a lesson's chat id or a notes/file source id. */
	born: string | null;
	/** True when a lesson produced or touched it (a provenance point from a chat). */
	inLessons: boolean;
	/** Answers that count for it, oldest first. */
	answers: AnswerRef[];
}

/** A fact's mark: its latest answer's outcome, or null when untested. */
export function factMark(f: Pick<FactProgress, "answers">): AnswerOutcome | null {
	return f.answers.length === 0 ? null : f.answers[f.answers.length - 1]!.outcome;
}

const MARK_ORDER: Record<string, number> = { wrong: 0, dontKnow: 1, hinted: 2, right: 3, none: 4 };

/** A topic's facts, the ones to fix first: latest answer wrong, then
 *  "I don't know", then solved with hints, then right, then untested;
 *  ties by name. */
export function topicFacts(facts: readonly FactProgress[], topic: Pick<TopicProgress, "members">): FactProgress[] {
	const members = new Set(topic.members);
	return facts
		.filter((f) => members.has(f.id))
		.sort((a, b) => MARK_ORDER[factMark(a) ?? "none"]! - MARK_ORDER[factMark(b) ?? "none"]! || a.name.localeCompare(b.name));
}

// ─── files ──────────────────────────────────────────────────────────────────

export interface FileCoverage {
	fileId: string;
	name: string;
	/** Facts born in this file. */
	facts: number;
	/** Of those, how many also came up in a lesson. */
	inLessons: number;
	/** inLessons / facts; null when the file has no facts yet. */
	share: number | null;
}

// ─── lessons + calibration ──────────────────────────────────────────────────

export interface LessonProgress {
	chatId: string;
	title: string;
	kind: LessonKind;
	updatedAt: string;
	/** Every graded answer, in order. */
	answers: AnswerRef[];
	right: number;
	/** Problems solved with hints, only when there are some. */
	hinted?: number;
	answered: number;
	/** The rate as a topic's (tally); null before the first answer. */
	score: number | null;
}

export interface CalibrationLevel {
	level: ConfidenceLevel;
	/** The rate this level claims (level × 20, in percent). */
	target: number;
	/** Answers given at this level ("I don't know" carries no level). */
	answered: number;
	right: number;
	/** right / answered; null when none. */
	rate: number | null;
}

export interface SureButWrong {
	chatId: string;
	lessonTitle: string;
	messageId: string;
	toolCallId: string;
	question: string;
	level: ConfidenceLevel;
	answeredAt: string;
}

export interface Calibration {
	levels: CalibrationLevel[];
	/** Wrong answers given at level 4–5, newest first, at most 5. */
	sureButWrong: SureButWrong[];
}

// ─── deadlines + "Work on next" ────────────────────────────────────────────

export interface StatusCounts {
	strong: number;
	shaky: number;
	weak: number;
	untested: number;
}

export interface WorkOnNextItem {
	topicId: string;
	name: string;
	status: TopicStatus;
	/** One short line: "Minibatch noise builds on it, so fix it first". */
	reason: string;
}

export interface DeadlineProgress {
	id: string;
	kind: DeadlineKind;
	name: string;
	date: string;
	/** "HH:MM"; absent = no time (due 23:59). */
	time?: string;
	done: boolean;
	/** Whole days from `today` (negative once the day has passed). */
	daysUntil: number;
	files: { id: string; name: string }[];
	/** Topics with at least one fact born in the deadline's files. */
	topicIds: string[];
	counts: StatusCounts;
	workOnNext: WorkOnNextItem[];
	/** The average right rate over its topics, untested ones counted as 0.
	 *  null when it has no topics. */
	ready: number | null;
	/** Its topics, weakest first (untested counted as 0, then by name). */
	topics: { id: string; name: string; rate: number | null }[];
	/** The unfinished Study session its Study button reopens (continue-study.ts). */
	continueStudy?: ContinueStudy;
	/** Its latest Study session reached its end today. */
	studyEndedToday?: true;
	/** Homework and projects: how many of its problems are done. */
	problems?: { done: number; total: number };
	/** The latest homework session on it, which Work on reopens. */
	continueHomework?: string;
}

/** The space-wide view (no deadline picked, or none exists). */
interface OverallProgress {
	topicIds: string[];
	counts: StatusCounts;
	workOnNext: WorkOnNextItem[];
}

/** Whole days from `today` to `date` (both YYYY-MM-DD). */
export function daysBetween(today: string, date: string): number {
	const utc = (d: string) => {
		const [y, m, day] = d.split("-").map(Number) as [number, number, number];
		return Date.UTC(y, m - 1, day);
	};
	return Math.round((utc(date) - utc(today)) / 86_400_000);
}

// ─── the whole payload ──────────────────────────────────────────────────────

/** GET /api/progress — everything the Overview and the Graph page need. */
export interface ProgressPayload {
	spaceId: string | null;
	today: string;
	/** When the topic snapshot was written; null before the first grouping. */
	topicsAt: string | null;
	/** A topic-grouping run is going. */
	grouping: boolean;
	topics: TopicProgress[];
	topicLinks: TopicLink[];
	facts: FactProgress[];
	/** Study files only, in space order (empty for "No space"). */
	files: FileCoverage[];
	nextUp: FileCoverage | null;
	/** Newest activity first. */
	lessons: LessonProgress[];
	calibration: Calibration;
	/** Every deadline (done ones too), soonest due first. */
	deadlines: DeadlineProgress[];
	overall: OverallProgress;
	/** Totals over every graded answer in the space. */
	totals: Tally;
}

