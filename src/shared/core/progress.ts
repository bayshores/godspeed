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
import { type ConfidenceLevel, type QuestionAnswerData } from "./question-core.ts";

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
const HINTED_WEIGHT = 0.6;

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
function hintedWords(t: { hinted?: number }): string {
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
	/** Where the lesson's plan is, as its step bar counts it; absent with no plan. */
	step?: { done: number; total: number };
	/** Set while the lesson has not reached its end. */
	unfinished?: true;
	/** The deadline it was started from. */
	deadlineId?: string;
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
	/** Its topics, weakest first (untested counted as 0, then by name);
	 *  `finishedToday` when it was finished in a Study session today. */
	topics: { id: string; name: string; rate: number | null; finishedToday?: true }[];
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

// ─── the path toward a goal ─────────────────────────────────────────────────

/** A topic on the space's path, tallied over the answers given on it (its
 *  id is the plan node of its Study sessions). */
export interface PathTopicProgress extends Tally {
	id: string;
	name: string;
	/** One line on what it covers. */
	covers: string;
	status: TopicStatus;
	/** rampColor(rate). */
	color: string;
}

/** The space's path: its goal (it follows "Path to") and its topics in
 *  order. `nextId` is the topic Study takes: the first one not strong and
 *  not studied today. */
export interface PathProgress {
	goal: string;
	topics: PathTopicProgress[];
	nextId: string | null;
}

/** The topic Study takes and its place on the path (1 for the first); null
 *  with none. */
export function pathNext(path: PathProgress): { topic: PathTopicProgress; position: number } | null {
	const at = path.topics.findIndex((t) => t.id === path.nextId);
	return at < 0 ? null : { topic: path.topics[at]!, position: at + 1 };
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
	/** Only in a space with a path. */
	path?: PathProgress;
}

