/**
 * PROGRESS — every number the Overview and the topic Graph show (redesign
 * plan, owner-approved 2026-10-27). Nothing here is saved: it is all
 * derived from what the app already records (lesson answers, graph facts
 * and chains, class files and deadlines) plus the topic grouper's snapshot.
 *
 *  - answers: every graded quiz/probe answer in a lesson
 *  - answer → facts: the facts made from the lesson message that asked it
 *    (fact provenance (chatId, messageId))
 *  - topic score / status / overconfidence, arrows between topics, columns
 *  - coverage per study file and "Next up"
 *  - how each lesson went, calibration per confidence level
 *  - per deadline: days left, ready %, its topics, where you're at, "Work on next"
 *  - the lesson plan's step bar (planStepBar — the lesson UI calls it
 *    client-side with its view messages)
 *
 * Pure and browser-safe: no node builtins. The server assembles the inputs
 * (src/server/progress.ts → GET /api/progress).
 */
import type { ClassDeadline, ClassFileKind, DeadlineKind, GraphChain, PlanNodeStatus, PlanTree, ProvenancePoint, TopicSnapshot } from "./contracts.ts";
import { compareDeadlines, derivedNodeStatus, derivePlanStatuses } from "./contracts.ts";
import type { LhMessage } from "./native-messages.ts";
import { QUESTION_TOOLS } from "./pending.ts";
import { confidenceLevel, type ConfidenceLevel, type QuestionAnswerData } from "./question-core.ts";
import { birthSessionOf } from "./session-clusters.ts";
import { resolveTopics } from "./topics.ts";

// ─── the color ramp + statuses ──────────────────────────────────────────────

/** The right/confidence ramp, red → green (the design's only colors). */
export const RAMP_COLORS = ["#F2545B", "#F59E4C", "#E8C547", "#9BD35A", "#3DD68C"] as const;
/** Untested (no answers yet). */
export const UNTESTED_COLOR = "#6E6E6E";

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

export type AnswerOutcome = "right" | "wrong" | "dontKnow";

/** One graded quiz/probe answer from a lesson. */
export interface AnsweredQuestion {
	chatId: string;
	/** The assistant message that asked (holds the quiz tool call). */
	messageId: string;
	/** Earlier assistant messages of the same turn, nearest first — the
	 *  fallback anchors when the asking message itself made no facts (the
	 *  teaching prose came a step before the quiz call). */
	contextMessageIds: string[];
	toolCallId: string;
	/** "quiz" (teach) or "probe" (probe phase). */
	tool: string;
	/** The plan node the quiz is about (teach quizzes). */
	nodeId?: string;
	questionType?: string;
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

const GRADED_TOOLS = new Set(["quiz", "probe"]);

/** The outcome of a graded answer; null when it isn't one (ask/explain,
 *  dismissed, or a record without a verdict). */
export function answerOutcome(ad: Pick<QuestionAnswerData, "kind" | "dontKnow" | "correct" | "dismissed">): AnswerOutcome | null {
	if (ad.dismissed || ad.kind !== "quiz") return null;
	if (ad.dontKnow) return "dontKnow";
	if (typeof ad.correct !== "boolean") return null;
	return ad.correct ? "right" : "wrong";
}

function isAnswerData(v: unknown): v is QuestionAnswerData {
	return typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";
}

/** Every graded quiz/probe answer in one lesson, in transcript order. */
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
					if (block.type !== "toolCall" || !block.id || !block.name || !GRADED_TOOLS.has(block.name)) continue;
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
		if ((QUESTION_TOOLS as readonly string[]).includes(result.toolName ?? "")) turn = [];
		const call = result.toolCallId ? calls.get(result.toolCallId) : undefined;
		if (!call) continue;
		turn = [];
		if (!isAnswerData(result.details)) continue;
		const ad = result.details;
		const outcome = answerOutcome(ad);
		if (!outcome) continue;
		const nodeId = typeof call.args.nodeId === "string" ? call.args.nodeId : undefined;
		const questionType = ad.questionType ?? (typeof call.args.type === "string" ? call.args.type : undefined);
		const confidence = typeof ad.confidence === "number" && outcome !== "dontKnow" ? ad.confidence : undefined;
		out.push({
			chatId,
			messageId: call.messageId,
			contextMessageIds: call.context,
			toolCallId: result.toolCallId!,
			tool: ad.tool ?? call.tool,
			...(nodeId ? { nodeId } : {}),
			...(questionType ? { questionType } : {}),
			question: ad.questionText ?? (typeof call.args.question === "string" ? call.args.question : ""),
			outcome,
			...(confidence !== undefined ? { confidence, level: confidenceLevel(confidence) } : {}),
			answeredAt: ad.answeredAt ?? "",
		});
	}
	return out;
}

const pointKey = (chatId: string, messageId: string) => `${chatId}\u0000${messageId}`;

/** (chatId, messageId) → the facts with a provenance point there. */
export function factsByMessage(facts: ReadonlyArray<{ id: string; provenance: ProvenancePoint[] }>): Map<string, string[]> {
	const index = new Map<string, string[]>();
	for (const fact of facts) {
		for (const p of fact.provenance) {
			if (!p.messageId) continue;
			const key = pointKey(p.chatId, p.messageId);
			const list = index.get(key);
			if (!list) index.set(key, [fact.id]);
			else if (!list.includes(fact.id)) list.push(fact.id);
		}
	}
	return index;
}

/** The facts an answer counts for: those made from the message that asked
 *  it; when that message made none, the nearest earlier teacher message of
 *  the same turn that did. */
export function factsForAnswer(answer: Pick<AnsweredQuestion, "chatId" | "messageId" | "contextMessageIds">, index: ReadonlyMap<string, string[]>): string[] {
	for (const messageId of [answer.messageId, ...answer.contextMessageIds]) {
		const hit = index.get(pointKey(answer.chatId, messageId));
		if (hit && hit.length > 0) return hit;
	}
	return [];
}

const refOf = (a: AnsweredQuestion): AnswerRef => ({
	chatId: a.chatId,
	toolCallId: a.toolCallId,
	outcome: a.outcome,
	...(a.level ? { level: a.level } : {}),
	answeredAt: a.answeredAt,
});

const byTime = (a: { answeredAt: string }, b: { answeredAt: string }) => a.answeredAt.localeCompare(b.answeredAt);

// ─── tallies ────────────────────────────────────────────────────────────────

export interface Tally {
	answered: number;
	right: number;
	wrong: number;
	dontKnow: number;
	/** right / answered ("I don't know" counts as not right); null = none. */
	rate: number | null;
}

export function tally(answers: ReadonlyArray<{ outcome: AnswerOutcome }>): Tally {
	let right = 0;
	let wrong = 0;
	let dontKnow = 0;
	for (const a of answers) {
		if (a.outcome === "right") right++;
		else if (a.outcome === "wrong") wrong++;
		else dontKnow++;
	}
	const answered = right + wrong + dontKnow;
	return { answered, right, wrong, dontKnow, rate: answered === 0 ? null : right / answered };
}

/** Overconfident: at least 2 answers given at level 4–5, right less often
 *  than those answers claimed (each answer claims level × 20 %). */
export function isOverconfident(answers: ReadonlyArray<{ outcome: AnswerOutcome; level?: ConfidenceLevel }>): boolean {
	const sure = answers.filter((a) => a.outcome !== "dontKnow" && a.level !== undefined && a.level >= 4);
	if (sure.length < 2) return false;
	const right = sure.filter((a) => a.outcome === "right").length;
	const claimed = sure.reduce((sum, a) => sum + a.level! * 20, 0) / sure.length / 100;
	return right / sure.length < claimed;
}

// ─── topics: stats, links, columns ──────────────────────────────────────────

export interface TopicProgress extends Tally {
	id: string;
	name: string;
	/** Fact ids. */
	members: string[];
	/** The derived "Ungrouped" bucket (facts no snapshot placed yet). */
	ungrouped?: true;
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

/**
 * Arrows between topics: a chain with a premise in topic A and its
 * conclusion in topic B (A ≠ B) adds 1 to A → B (once per chain). Cycles
 * are broken by keeping the heaviest edges first (ties: from, then to, in
 * id order) and dropping any edge that would close a loop.
 */
export function topicLinks(
	chains: ReadonlyArray<Pick<GraphChain, "premises" | "conclusion">>,
	topicOfFact: ReadonlyMap<string, string>,
): TopicLink[] {
	const weights = new Map<string, TopicLink>();
	for (const chain of chains) {
		const to = topicOfFact.get(chain.conclusion);
		if (!to) continue;
		const froms = new Set(chain.premises.map((p) => topicOfFact.get(p)).filter((t): t is string => !!t && t !== to));
		for (const from of froms) {
			const key = `${from}\u0000${to}`;
			const link = weights.get(key);
			if (link) link.weight++;
			else weights.set(key, { from, to, weight: 1 });
		}
	}
	const sorted = [...weights.values()].sort((a, b) => b.weight - a.weight || a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
	const out = new Map<string, string[]>();
	const reaches = (start: string, goal: string): boolean => {
		const stack = [start];
		const seen = new Set<string>();
		while (stack.length > 0) {
			const at = stack.pop()!;
			if (at === goal) return true;
			if (seen.has(at)) continue;
			seen.add(at);
			stack.push(...(out.get(at) ?? []));
		}
		return false;
	};
	const kept: TopicLink[] = [];
	for (const link of sorted) {
		if (reaches(link.to, link.from)) continue; // would close a loop
		kept.push(link);
		const list = out.get(link.from);
		if (list) list.push(link.to);
		else out.set(link.from, [link.to]);
	}
	return kept;
}

/** Column per topic: the longest path from a topic with no incoming arrow
 *  (links must be acyclic — topicLinks guarantees it). */
export function topicColumns(topicIds: readonly string[], links: readonly TopicLink[]): Map<string, number> {
	const incoming = new Map<string, string[]>();
	for (const l of links) {
		const list = incoming.get(l.to);
		if (list) list.push(l.from);
		else incoming.set(l.to, [l.from]);
	}
	const memo = new Map<string, number>();
	const visiting = new Set<string>();
	const column = (id: string): number => {
		const known = memo.get(id);
		if (known !== undefined) return known;
		if (visiting.has(id)) return 0; // defensive: never loops on bad input
		visiting.add(id);
		let best = 0;
		for (const from of incoming.get(id) ?? []) best = Math.max(best, column(from) + 1);
		visiting.delete(id);
		memo.set(id, best);
		return best;
	};
	for (const id of topicIds) column(id);
	return memo;
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

/** A provenance point from a lesson (not a notes/file source). */
const fromLesson = (p: ProvenancePoint) => !p.chatId.startsWith("src_");

// ─── files ──────────────────────────────────────────────────────────────────

export interface ProgressFileInput {
	id: string;
	name: string;
	kind: ClassFileKind;
	/** The notes-source id its facts are born under (server: sourceIdFor). */
	sourceId: string;
}

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

/** Coverage for every STUDY file, in the class's file order. */
export function fileCoverage(
	files: readonly ProgressFileInput[],
	facts: ReadonlyArray<{ id: string; provenance: ProvenancePoint[] }>,
): FileCoverage[] {
	const bySource = new Map<string, { facts: number; inLessons: number }>();
	for (const fact of facts) {
		const born = birthSessionOf(fact);
		if (!born) continue;
		const entry = bySource.get(born) ?? { facts: 0, inLessons: 0 };
		entry.facts++;
		if (fact.provenance.some(fromLesson)) entry.inLessons++;
		bySource.set(born, entry);
	}
	return files
		.filter((f) => f.kind === "study")
		.map((f) => {
			const entry = bySource.get(f.sourceId) ?? { facts: 0, inLessons: 0 };
			return { fileId: f.id, name: f.name, facts: entry.facts, inLessons: entry.inLessons, share: entry.facts === 0 ? null : entry.inLessons / entry.facts };
		});
}

/** "Next up": the earliest study file (class file order) that has facts
 *  but none of them came up in a lesson yet. */
export function nextUpFile(coverage: readonly FileCoverage[]): FileCoverage | null {
	return coverage.find((f) => f.facts > 0 && f.inLessons === 0) ?? null;
}

// ─── lessons + calibration ──────────────────────────────────────────────────

export interface ProgressLessonInput {
	id: string;
	title: string;
	kind?: "teach" | "practice";
	updatedAt: string;
	messages: readonly LhMessage[];
}

export interface LessonProgress {
	chatId: string;
	title: string;
	kind: "teach" | "practice";
	updatedAt: string;
	/** Every graded answer, in order. */
	answers: AnswerRef[];
	right: number;
	answered: number;
	/** right / answered; null before the first answer. */
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

export function calibration(answers: readonly AnsweredQuestion[], titleOf: (chatId: string) => string): Calibration {
	const levels: CalibrationLevel[] = ([1, 2, 3, 4, 5] as const).map((level) => {
		const at = answers.filter((a) => a.level === level && a.outcome !== "dontKnow");
		const right = at.filter((a) => a.outcome === "right").length;
		return { level, target: level * 20, answered: at.length, right, rate: at.length === 0 ? null : right / at.length };
	});
	const sureButWrong = answers
		.filter((a) => a.outcome === "wrong" && a.level !== undefined && a.level >= 4)
		.sort((a, b) => b.answeredAt.localeCompare(a.answeredAt))
		.slice(0, 5)
		.map((a) => ({
			chatId: a.chatId,
			lessonTitle: titleOf(a.chatId),
			messageId: a.messageId,
			toolCallId: a.toolCallId,
			question: a.question,
			level: a.level!,
			answeredAt: a.answeredAt,
		}));
	return { levels, sureButWrong };
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
}

/** The class-wide view (no deadline picked, or none exists). */
export interface OverallProgress {
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

export function statusCounts(topics: ReadonlyArray<Pick<TopicProgress, "status">>): StatusCounts {
	const counts: StatusCounts = { strong: 0, shaky: 0, weak: 0, untested: 0 };
	for (const t of topics) counts[t.status]++;
	return counts;
}

/**
 * "Work on next" over a set of topics, in four groups:
 *  1. weak/shaky topics another weak/shaky topic in the set builds on
 *     ("<dependent> builds on it, so fix it first");
 *  2. overconfident topics ("overconfident");
 *  3. the remaining weak/shaky ones ("Needed for <dependent>" when a topic
 *     in the set builds on it, else "<n>% right");
 *  4. untested topics ("Due soon, never practiced" / "Never practiced").
 * Within a group: lowest right rate first, then earlier column, then name.
 */
export function workOnNext(
	topics: readonly TopicProgress[],
	links: readonly TopicLink[],
	context: "deadline" | "class",
): WorkOnNextItem[] {
	const inSet = new Map(topics.map((t) => [t.id, t]));
	const struggling = (t: TopicProgress | undefined) => !!t && (t.status === "weak" || t.status === "shaky");
	const dependents = (id: string, filter: (t: TopicProgress) => boolean): TopicProgress[] =>
		links
			.filter((l) => l.from === id && inSet.has(l.to) && filter(inSet.get(l.to)!))
			.sort((a, b) => b.weight - a.weight || a.to.localeCompare(b.to))
			.map((l) => inSet.get(l.to)!);
	const order = (a: TopicProgress, b: TopicProgress) =>
		(a.rate ?? 2) - (b.rate ?? 2) || a.column - b.column || a.name.localeCompare(b.name);
	const out: WorkOnNextItem[] = [];
	const listed = new Set<string>();
	const add = (t: TopicProgress, reason: string) => {
		listed.add(t.id);
		out.push({ topicId: t.id, name: t.name, status: t.status, reason });
	};
	const sorted = [...topics].sort(order);
	for (const t of sorted) {
		if (!struggling(t)) continue;
		const dep = dependents(t.id, (d) => d.id !== t.id && struggling(d))[0];
		if (dep) add(t, `${dep.name} builds on it, so fix it first`);
	}
	for (const t of sorted) if (!listed.has(t.id) && t.overconfident) add(t, "overconfident");
	for (const t of sorted) {
		if (listed.has(t.id) || !struggling(t)) continue;
		const dep = dependents(t.id, () => true)[0];
		add(t, dep ? `Needed for ${dep.name}` : `${Math.round((t.rate ?? 0) * 100)}% right`);
	}
	for (const t of sorted) {
		if (listed.has(t.id) || t.status !== "untested") continue;
		add(t, context === "deadline" ? "Due soon, never practiced" : "Never practiced");
	}
	return out;
}

// ─── the whole payload ──────────────────────────────────────────────────────

export interface ProgressInput {
	classId: string | null;
	/** The learner's calendar day, YYYY-MM-DD (days-until counts from it). */
	today: string;
	/** The graph's facts (core/graph.ts getGraph nodes). */
	facts: ReadonlyArray<{ id: string; name: string; statement: string; provenance: ProvenancePoint[] }>;
	chains: ReadonlyArray<Pick<GraphChain, "premises" | "conclusion">>;
	topics: TopicSnapshot | null;
	/** The class's files (empty for "No class"), in class order. */
	files: readonly ProgressFileInput[];
	deadlines: readonly ClassDeadline[];
	/** The lessons in the class (teach and practice). */
	lessons: readonly ProgressLessonInput[];
	/** A topic-grouping run is going right now. */
	grouping?: boolean;
}

/** GET /api/progress — everything the Overview and the Graph page need. */
export interface ProgressPayload {
	classId: string | null;
	today: string;
	/** When the topic snapshot was written; null before the first grouping. */
	topicsAt: string | null;
	/** A topic-grouping run is going. */
	grouping: boolean;
	topics: TopicProgress[];
	topicLinks: TopicLink[];
	facts: FactProgress[];
	/** Study files only, in class order (empty for "No class"). */
	files: FileCoverage[];
	nextUp: FileCoverage | null;
	/** Newest activity first. */
	lessons: LessonProgress[];
	calibration: Calibration;
	/** Every deadline (done ones too), soonest due first. */
	deadlines: DeadlineProgress[];
	overall: OverallProgress;
	/** Totals over every graded answer in the class. */
	totals: Tally;
}

export function deriveProgress(input: ProgressInput): ProgressPayload {
	const factIds = input.facts.map((f) => f.id);
	const resolved = resolveTopics(input.topics, factIds);
	const topicOfFact = new Map<string, string>();
	for (const t of resolved) for (const id of t.members) topicOfFact.set(id, t.id);

	// Answers, per lesson and for the whole class.
	const titles = new Map(input.lessons.map((l) => [l.id, l.title]));
	const answersByLesson = new Map(input.lessons.map((l) => [l.id, collectAnswers(l.id, l.messages)]));
	const allAnswers = [...answersByLesson.values()].flat().sort(byTime);

	// Answer → facts → topics.
	const index = factsByMessage(input.facts);
	const factAnswers = new Map<string, AnsweredQuestion[]>();
	const topicAnswers = new Map<string, AnsweredQuestion[]>();
	for (const answer of allAnswers) {
		const facts = factsForAnswer(answer, index);
		const topicsHit = new Set<string>();
		for (const id of facts) {
			const list = factAnswers.get(id);
			if (list) list.push(answer);
			else factAnswers.set(id, [answer]);
			const topic = topicOfFact.get(id);
			if (topic) topicsHit.add(topic);
		}
		for (const topic of topicsHit) {
			const list = topicAnswers.get(topic);
			if (list) list.push(answer);
			else topicAnswers.set(topic, [answer]);
		}
	}

	const links = topicLinks(input.chains, topicOfFact);
	const columns = topicColumns(resolved.map((t) => t.id), links);
	const topics: TopicProgress[] = resolved.map((t) => {
		const answers = topicAnswers.get(t.id) ?? [];
		const counts = tally(answers);
		return {
			id: t.id,
			name: t.name,
			members: t.members,
			...(t.ungrouped ? { ungrouped: true as const } : {}),
			...counts,
			status: topicStatus(counts.rate),
			color: rampColor(counts.rate),
			overconfident: isOverconfident(answers),
			answers: answers.map(refOf),
			column: columns.get(t.id) ?? 0,
		};
	});

	const facts: FactProgress[] = input.facts.map((f) => ({
		id: f.id,
		name: f.name,
		statement: f.statement,
		topicId: topicOfFact.get(f.id)!,
		born: birthSessionOf(f),
		inLessons: f.provenance.some(fromLesson),
		answers: (factAnswers.get(f.id) ?? []).map(refOf),
	}));

	const files = fileCoverage(input.files, input.facts);

	const lessons: LessonProgress[] = input.lessons
		.map((l) => {
			const answers = answersByLesson.get(l.id) ?? [];
			const counts = tally(answers);
			return {
				chatId: l.id,
				title: l.title,
				kind: l.kind === "practice" ? ("practice" as const) : ("teach" as const),
				updatedAt: l.updatedAt,
				answers: answers.map(refOf),
				right: counts.right,
				answered: counts.answered,
				score: counts.rate,
			};
		})
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

	// Deadlines: topics born in the deadline's files. The "Ungrouped"
	// bucket is never a recommendation.
	const grouped = topics.filter((t) => !t.ungrouped);
	const bornIn = new Map(input.facts.map((f) => [f.id, birthSessionOf(f)]));
	const sourceOfFile = new Map(input.files.map((f) => [f.id, f.sourceId]));
	const nameOfFile = new Map(input.files.map((f) => [f.id, f.name]));
	const deadlines: DeadlineProgress[] = [...input.deadlines].sort(compareDeadlines).map((d) => {
		const sources = new Set(d.fileIds.map((id) => sourceOfFile.get(id)).filter((s): s is string => !!s));
		const covered = grouped.filter((t) => t.members.some((id) => sources.has(bornIn.get(id) ?? "")));
		const weakest = [...covered].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0) || a.name.localeCompare(b.name));
		return {
			id: d.id,
			kind: d.kind,
			name: d.name,
			date: d.date,
			...(d.time !== undefined ? { time: d.time } : {}),
			done: d.done,
			daysUntil: daysBetween(input.today, d.date),
			files: d.fileIds.map((id) => ({ id, name: nameOfFile.get(id) ?? id })),
			topicIds: covered.map((t) => t.id),
			counts: statusCounts(covered),
			workOnNext: workOnNext(covered, links, "deadline"),
			ready: covered.length === 0 ? null : covered.reduce((sum, t) => sum + (t.rate ?? 0), 0) / covered.length,
			topics: weakest.map((t) => ({ id: t.id, name: t.name, rate: t.rate })),
		};
	});

	return {
		classId: input.classId,
		today: input.today,
		topicsAt: input.topics?.at ?? null,
		grouping: input.grouping === true,
		topics,
		topicLinks: links,
		facts,
		files,
		nextUp: nextUpFile(files),
		lessons,
		calibration: calibration(allAnswers, (id) => titles.get(id) ?? id),
		deadlines,
		overall: { topicIds: grouped.map((t) => t.id), counts: statusCounts(grouped), workOnNext: workOnNext(grouped, links, "class") },
		totals: tally(allAnswers),
	};
}

// ─── the lesson plan's step bar ─────────────────────────────────────────────

/** The view-message slice the step bar reads (core/view.ts LhViewMessage). */
export interface StepBarMessage {
	parts: Array<{ type: string; state?: string; toolCallId?: string; input?: unknown; output?: unknown }>;
}

export interface StepAnswer {
	toolCallId: string;
	/** "ungraded": an explain answer (the teacher grades it in words). */
	outcome: AnswerOutcome | "ungraded";
	level?: ConfidenceLevel;
}

export interface PlanStep {
	id: string;
	title: string;
	status: PlanNodeStatus;
	/** The answers to questions about this step, in order. */
	answers: StepAnswer[];
}

export interface PlanStepBar {
	steps: PlanStep[];
	/** Index of the current step; -1 before the first tagged question. */
	currentIndex: number;
}

/** Plan nodes in learning order: prerequisites first, ties in authored order. */
export function orderedPlanNodes(tree: PlanTree): PlanTree["nodes"] {
	const index = new Map(tree.nodes.map((n, i) => [n.id, i]));
	const indegree = new Map(tree.nodes.map((n) => [n.id, 0]));
	const next = new Map<string, string[]>();
	for (const e of tree.edges) {
		if (!index.has(e.from) || !index.has(e.to)) continue;
		indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
		const list = next.get(e.from);
		if (list) list.push(e.to);
		else next.set(e.from, [e.to]);
	}
	const ready = tree.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
	const out: string[] = [];
	while (ready.length > 0) {
		ready.sort((a, b) => index.get(a)! - index.get(b)!);
		const id = ready.shift()!;
		out.push(id);
		for (const to of next.get(id) ?? []) {
			const d = indegree.get(to)! - 1;
			indegree.set(to, d);
			if (d === 0) ready.push(to);
		}
	}
	// A malformed tree (a cycle) keeps the rest in authored order.
	for (const n of tree.nodes) if (!out.includes(n.id)) out.push(n.id);
	return out.map((id) => tree.nodes[index.get(id)!]!);
}

/** The step bar for a lesson: the plan's nodes in order with their status
 *  (derivePlanStatuses) and the answers per step (matched by the quiz's
 *  nodeId). Empty when the lesson has no plan yet. */
export function planStepBar(tree: PlanTree | null, messages: readonly StepBarMessage[]): PlanStepBar {
	if (!tree || tree.nodes.length === 0) return { steps: [], currentIndex: -1 };
	const statuses = derivePlanStatuses(tree, messages as Parameters<typeof derivePlanStatuses>[1]);
	const answers = new Map<string, StepAnswer[]>();
	for (const m of messages) {
		for (const part of m.parts) {
			if (part.type !== "tool-quiz" && part.type !== "tool-explain") continue;
			if (part.state !== "output-available" || !isAnswerData(part.output)) continue;
			const nodeId = (part.input as { nodeId?: unknown } | undefined)?.nodeId;
			if (typeof nodeId !== "string") continue;
			const ad = part.output;
			if (ad.dismissed) continue;
			const outcome = ad.kind === "explain" ? (ad.dontKnow ? "dontKnow" : "ungraded") : answerOutcome(ad);
			if (!outcome) continue;
			const entry: StepAnswer = {
				toolCallId: part.toolCallId ?? "",
				outcome,
				...(typeof ad.confidence === "number" && !ad.dontKnow ? { level: confidenceLevel(ad.confidence) } : {}),
			};
			const list = answers.get(nodeId);
			if (list) list.push(entry);
			else answers.set(nodeId, [entry]);
		}
	}
	const steps = orderedPlanNodes(tree).map((n) => ({
		id: n.id,
		title: n.title,
		status: derivedNodeStatus(statuses, n.id),
		answers: answers.get(n.id) ?? [],
	}));
	return { steps, currentIndex: steps.findIndex((s) => s.status === "current") };
}
