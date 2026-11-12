/**
 * PREP — the rules of a prep sheet (contracts/prep.ts): reading a saved
 * one, taking the sheet the teacher wrote, the learner's own changes, and
 * how solid each topic is from the answers tagged with it. Pure and
 * browser-safe.
 */
import type { SpacePrep, MockFormat, PrepSource, PrepTopic } from "./contracts.ts";
import { isCalendarDate } from "./contracts.ts";
import { tally, topicStatus, type AnswerOutcome, type TopicStatus } from "./progress.ts";
import { isLatestWrong, type StudyTopic } from "./study.ts";
import type { MockSummary } from "./mock.ts";
import { oneLine } from "./teaching-areas.ts";

export const GOAL_MAX = 300;
const ABOUT_MAX = 4000;
const NAME_MAX = 60;
export const TOPIC_NAME_MAX = 80;
const TOPIC_WHY_MAX = 200;
export const MAX_PREP_TOPICS = 12;
const MAX_PREP_SOURCES = 8;
export const MOCK_QUESTIONS = { min: 1, max: 10 } as const;
export const MOCK_MINUTES = { min: 5, max: 240 } as const;
const MOCK_RANGE = `mock must be ${MOCK_QUESTIONS.min} to ${MOCK_QUESTIONS.max} questions in ${MOCK_MINUTES.min} to ${MOCK_MINUTES.max} minutes.`;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Longest name a prep gets from its goal, before the sheet names it. */
const GOAL_NAME_MAX = 40;

/** A prep's name before its sheet is written: the goal, or when longer
 *  its whole words within GOAL_NAME_MAX and "…", so its top bar tab stays
 *  short. */
export function goalName(goal: string): string {
	const chars = [...goal];
	if (chars.length <= GOAL_NAME_MAX) return goal;
	const head = chars.slice(0, GOAL_NAME_MAX + 1).join("");
	const cut = head.lastIndexOf(" ");
	// One word longer than the limit is cut inside it.
	return `${(cut > 0 ? head.slice(0, cut) : chars.slice(0, GOAL_NAME_MAX).join("")).trimEnd()}…`;
}

/** A new prep, before its sheet is written. Null when nothing was typed. */
export function newPrep(goal: string, date?: string): SpacePrep | null {
	const clean = oneLine(goal, GOAL_MAX);
	if (!clean) return null;
	return { goal: clean, ...(isCalendarDate(date) ? { date } : {}), about: "", sources: [], topics: [] };
}

function cleanSources(raw: unknown): PrepSource[] {
	if (!Array.isArray(raw)) return [];
	const out: PrepSource[] = [];
	for (const s of raw) {
		if (!isRecord(s) || typeof s.url !== "string" || !/^https?:\/\/\S+$/i.test(s.url.trim())) continue;
		const url = s.url.trim();
		if (out.some((o) => o.url === url)) continue;
		out.push({ title: oneLine(typeof s.title === "string" ? s.title : "", 120) || url, url });
	}
	return out.slice(0, MAX_PREP_SOURCES);
}

function cleanMock(raw: unknown): MockFormat | undefined {
	if (!isRecord(raw) || !Number.isInteger(raw.questions) || !Number.isInteger(raw.minutes)) return undefined;
	const questions = raw.questions as number;
	const minutes = raw.minutes as number;
	if (questions < MOCK_QUESTIONS.min || questions > MOCK_QUESTIONS.max || minutes < MOCK_MINUTES.min || minutes > MOCK_MINUTES.max) return undefined;
	return { questions, minutes };
}

/** A saved prep, cleaned; null when it isn't one. */
export function parsePrep(raw: unknown): SpacePrep | null {
	if (!isRecord(raw) || typeof raw.goal !== "string") return null;
	const start = newPrep(raw.goal, typeof raw.date === "string" ? raw.date : undefined);
	if (!start) return null;
	const topics: PrepTopic[] = [];
	for (const t of Array.isArray(raw.topics) ? raw.topics : []) {
		if (!isRecord(t) || typeof t.id !== "string" || !/^pt_[a-z0-9]+$/.test(t.id) || typeof t.name !== "string") continue;
		const name = oneLine(t.name, TOPIC_NAME_MAX);
		if (!name || topics.some((o) => o.id === t.id)) continue;
		const why = typeof t.why === "string" ? oneLine(t.why, TOPIC_WHY_MAX) : "";
		topics.push({ id: t.id, name, ...(why ? { why } : {}) });
	}
	const mock = cleanMock(raw.mock);
	return {
		...start,
		about: typeof raw.about === "string" ? raw.about.trim().slice(0, ABOUT_MAX) : "",
		sources: cleanSources(raw.sources),
		topics: topics.slice(0, MAX_PREP_TOPICS),
		...(mock ? { mock } : {}),
		...(typeof raw.writtenAt === "string" ? { writtenAt: raw.writtenAt } : {}),
	};
}

/** The sheet as the teacher sends it. */
export interface WrittenSheet {
	/** A short name for the prep ("Backend phone screen"). */
	name: string;
	about: string;
	sources: Array<{ title: string; url: string }>;
	topics: Array<{ name: string; why?: string }>;
	mock: MockFormat;
}

/** Why a written sheet can't be kept; null when it can. */
export function sheetProblem(sheet: WrittenSheet): string | null {
	if (!oneLine(sheet.name, NAME_MAX)) return "name is empty: give the prep a short name.";
	if (!sheet.about.trim()) return "about is empty: say what it is like.";
	if (sheet.topics.every((t) => !oneLine(t.name, TOPIC_NAME_MAX))) return "topics is empty: list what to study, in order.";
	if (!cleanMock(sheet.mock)) return MOCK_RANGE;
	return null;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The prep with the teacher's sheet. A topic the old sheet had under the
 * same name keeps its id, so what the learner answered on it still counts,
 * and an old topic in `answered` the new sheet left out stays at its end,
 * so no answer stops counting. Returns the prep and the teacher's name for it.
 */
export function withSheet(prep: SpacePrep, sheet: WrittenSheet, at: string, newId: () => string, answered: ReadonlySet<string>): { prep: SpacePrep; name: string } {
	const named = sheet.topics.map((t) => ({ name: oneLine(t.name, TOPIC_NAME_MAX), why: oneLine(t.why ?? "", TOPIC_WHY_MAX) }));
	const carried = prep.topics.filter((o) => answered.has(o.id) && !named.some((t) => sameName(t.name, o.name)));
	const topics: PrepTopic[] = [];
	for (const { name, why } of named) {
		if (!name || topics.some((o) => sameName(o.name, name)) || topics.length + carried.length >= MAX_PREP_TOPICS) continue;
		const id = prep.topics.find((o) => sameName(o.name, name))?.id ?? newId();
		topics.push({ id, name, ...(why ? { why } : {}) });
	}
	topics.push(...carried);
	const mock = cleanMock(sheet.mock);
	return {
		prep: {
			goal: prep.goal,
			...(prep.date ? { date: prep.date } : {}),
			about: sheet.about.trim().slice(0, ABOUT_MAX),
			sources: cleanSources(sheet.sources),
			topics,
			...(mock ? { mock } : {}),
			writtenAt: at,
		},
		name: oneLine(sheet.name, NAME_MAX),
	};
}

/** Changes to a sheet, from the learner's page or the teacher in Talk.
 *  Only what is given changes. */
export interface PrepEdits {
	/** null clears the day. */
	date?: string | null;
	about?: string;
	mock?: MockFormat;
	/** Added at the end, in order. */
	addTopics?: ReadonlyArray<{ name: string; why?: string }>;
	removeTopicIds?: readonly string[];
}

/** The prep with the edits, or why they can't be made (then nothing changes). */
export function withEdits(prep: SpacePrep, edits: PrepEdits, newId: () => string): SpacePrep | string {
	let topics = prep.topics;
	for (const id of edits.removeTopicIds ?? []) {
		if (!topics.some((t) => t.id === id)) return `No topic "${id}" on the sheet.`;
		topics = topics.filter((t) => t.id !== id);
	}
	for (const t of edits.addTopics ?? []) {
		const name = oneLine(t.name, TOPIC_NAME_MAX);
		if (!name) return "A topic's name is empty.";
		if (topics.some((o) => sameName(o.name, name))) return `"${name}" is already on the sheet.`;
		if (topics.length >= MAX_PREP_TOPICS) return `The sheet is full (${MAX_PREP_TOPICS} topics). Remove one first.`;
		const why = oneLine(t.why ?? "", TOPIC_WHY_MAX);
		topics = [...topics, { id: newId(), name, ...(why ? { why } : {}) }];
	}
	if (typeof edits.date === "string" && !isCalendarDate(edits.date)) return "date must be YYYY-MM-DD.";
	const about = edits.about?.trim().slice(0, ABOUT_MAX);
	if (edits.about !== undefined && !about) return "about is empty: say what it is like.";
	const mock = edits.mock === undefined ? prep.mock : cleanMock(edits.mock);
	if (!mock && edits.mock !== undefined) return MOCK_RANGE;
	const { date: oldDate, mock: _oldMock, ...rest } = prep;
	const date = edits.date === undefined ? oldDate : edits.date;
	return { ...rest, ...(date ? { date } : {}), about: about ?? prep.about, topics, ...(mock ? { mock } : {}) };
}

// ─── how solid each topic is ────────────────────────────────────────────────

export interface PrepTopicProgress extends PrepTopic {
	status: TopicStatus;
	/** Weak, and the newest answer on it was not right. */
	latestWrong?: true;
	answered: number;
	right: number;
	/** right / answered; null before the first answer. */
	rate: number | null;
}

/** Each topic with its track record: the answers tagged with its id (study
 *  sessions tag a question's plan node, mocks tag a question's topic). */
export function prepTopicProgress(topics: readonly PrepTopic[], answers: ReadonlyArray<{ nodeId?: string; outcome: AnswerOutcome; answeredAt: string }>): PrepTopicProgress[] {
	return topics.map((t) => {
		const tagged = answers.filter((a) => a.nodeId === t.id);
		const mine = tally(tagged);
		const status = topicStatus(mine.rate);
		const latest = tagged.reduce<(typeof tagged)[number] | undefined>((l, a) => (!l || a.answeredAt >= l.answeredAt ? a : l), undefined);
		return { ...t, status, ...(isLatestWrong(status, latest?.outcome) ? { latestWrong: true as const } : {}), answered: mine.answered, right: mine.right, rate: mine.rate };
	});
}

const STUDY_FIRST: Record<TopicStatus, number> = { weak: 0, shaky: 1, untested: 2, strong: 3 };

/** The topics in the order to study them: the ones going badly first, then
 *  the ones not started, the solid ones last; ties keep the sheet's order. */
export function weakestFirst<T extends { status: TopicStatus }>(topics: readonly T[]): T[] {
	return topics
		.map((t, i) => ({ t, i }))
		.sort((a, b) => STUDY_FIRST[a.t.status] - STUDY_FIRST[b.t.status] || a.i - b.i)
		.map((r) => r.t);
}

/** How many topics one Study click takes on. */
const STUDY_TOPIC_COUNT = 3;

/** A study session's topics from the sheet: the ones named, in the sheet's
 *  order, or with none named the few that most need work. A sheet topic
 *  has no material label (the topic grouper never sees it), so the study
 *  prompt picks its move from where the learner stands alone. */
export function prepStudyTopics(topics: readonly PrepTopicProgress[], topicIds: readonly string[]): StudyTopic[] {
	const picked = topicIds.length > 0 ? topics.filter((t) => topicIds.includes(t.id)) : weakestFirst(topics).slice(0, STUDY_TOPIC_COUNT);
	return picked.map((t) => ({ id: t.id, name: t.name, status: t.status, ...(t.latestWrong ? { latestWrong: true as const } : {}), factIds: [] }));
}

// ─── what the teacher is asked, what the page shows ─────────────────────────

/** The sheet writer's request: the learner's words, the day, the files
 *  they attached, and the topics the sheet already has. */
export function prepRequestText(input: {
	goal: string;
	date?: string;
	today: string;
	/** Attached files with where to read them. */
	files: ReadonlyArray<{ name: string; path: string }>;
	topics: readonly PrepTopic[];
}): string {
	return [
		`They are preparing for: ${input.goal}`,
		`Today is ${input.today}. ${input.date ? `It is on ${input.date}.` : "They have no date for it yet."}`,
		...(input.files.length > 0 ? ["", "They attached these files. Read them first:", ...input.files.map((f) => `- ${f.name}: ${f.path}`)] : []),
		...(input.topics.length > 0 ? ["", "The sheet's topics now (keep a name where it still fits):", ...input.topics.map((t) => `- ${t.name}`)] : []),
	].join("\n");
}

/** A prep as its page shows it. */
export interface PrepView {
	spaceId: string;
	name: string;
	prep: SpacePrep;
	/** The sheet's topics, in its order, each with its track record. */
	topics: PrepTopicProgress[];
	/** Its mocks, oldest first. */
	mocks: MockSummary[];
	/** The teacher is writing the sheet now. */
	writing: boolean;
	/** Why the last write failed. */
	error?: string;
}
