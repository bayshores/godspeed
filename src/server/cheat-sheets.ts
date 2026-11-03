/**
 * CHEAT SHEETS — the one writer of a deadline's cheat sheet
 * (store/cheat-sheets.ts) and the requests behind it.
 *
 * Every agent request is a background work item on the single-submit seam
 * (agent/subagents/cheat-sheet-writer.ts), like the topic grouper: it is a
 * one-off that hands back data, not a conversation, so it stays out of
 * the Talk chat. One request at a time per sheet (making it or changing
 * blocks), plus the rules reader when the setup opens. Each change goes
 * out as "cheat-sheet-changed"; the studio fetches the view again.
 */
import {
	WATCH_OUT,
	lineBudgets,
	linesPerColumn,
	mergePrefs,
	mergeRules,
	mistakeCounts,
	newBlockId,
	newCheatSheet,
	sheetContent,
	sheetLines,
	sheetMistakes,
	sheetTopics,
	type CheatSheet,
	type CheatSheetBlock,
	type CheatSheetRun,
	type CheatSheetView,
	type SheetMistake,
	type SheetTopic,
} from "../core/cheat-sheet.ts";
import { emit } from "../core/events.ts";
import { topicFacts, topicStatus, type ProgressPayload } from "../core/progress.ts";
import { agentEngine, type PiEngine } from "../agent/models.ts";
import { searchTools } from "../agent/tools/class.ts";
import { changeBlocks, readRules, writeSheet, type BlockChange, type RequestTopic, type WrittenBlock } from "../agent/subagents/cheat-sheet-writer.ts";
import { readCheatSheet, writeCheatSheet } from "../store/cheat-sheets.ts";
import { classMistakes, classOrderFor, progressFor } from "./progress.ts";
import { readPassage, searchClassFiles } from "./search-index.ts";
import { stores } from "./stores.ts";

/** Test seam: a scripted engine in place of the outside agent. */
export const cheatSheetSeams: { engine?: PiEngine } = {};

/** Facts sent per topic, to keep the request short. */
const FACTS_PER_TOPIC = 5;

interface Running extends CheatSheetRun {
	controller: AbortController;
}

interface SheetState {
	runs: Map<string, Running>;
	reading: Map<string, AbortController>;
	errors: Map<string, string>;
}

/** globalThis: Next can load this module more than once. */
function state(): SheetState {
	const g = globalThis as typeof globalThis & { __lhCheatSheets?: SheetState };
	return (g.__lhCheatSheets ??= { runs: new Map(), reading: new Map(), errors: new Map() });
}

type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string): { ok: false; status: number; error: string } => ({ ok: false, status, error });

const changed = (deadlineId: string) => emit("cheat-sheet-changed", { deadlineId });

/** Everything one request needs: the class, the deadline, its topics. */
interface Context {
	classId: string;
	className: string;
	classNotes: string;
	deadline: { id: string; name: string; date: string };
	progress: ProgressPayload;
	/** The deadline's topics in class order. */
	topics: SheetTopic[];
	mistakes: SheetMistake[];
	/** The saved sheet, or null. */
	saved: CheatSheet | "newer" | null;
}

function contextFor(classId: string, deadlineId: string): Outcome<Context> {
	const record = stores.classStore.getClass(classId);
	const deadline = record?.deadlines?.find((d) => d.id === deadlineId);
	const progress = record && deadline ? progressFor(classId) : null;
	const due = progress?.deadlines.find((d) => d.id === deadlineId);
	if (!record || !deadline || !progress || !due) return fail(404, "No such deadline");
	const order = classOrderFor(classId, progress);
	const rank = (topicId: string) => Math.min(...(progress.topics.find((t) => t.id === topicId)?.members.map((id) => order.get(id) ?? Infinity) ?? [Infinity]));
	const ids = [...due.topicIds].sort((a, b) => rank(a) - rank(b));
	const all = classMistakes(classId, progress);
	const mistakes = sheetMistakes(all, ids);
	const counts = mistakeCounts(all, ids);
	const topics = ids.map((id) => {
		const t = progress.topics.find((x) => x.id === id)!;
		return { id, name: t.name, status: topicStatus(t.rate), mistakes: counts.get(id) ?? 0 };
	});
	return {
		ok: true,
		value: { classId, className: record.name, classNotes: record.description, deadline: { id: deadline.id, name: deadline.name, date: deadline.date }, progress, topics, mistakes, saved: readCheatSheet(classId, deadlineId) },
	};
}

/** The saved sheet, or a new one with the defaults. */
function sheetOf(ctx: Context): CheatSheet {
	return ctx.saved && ctx.saved !== "newer" ? ctx.saved : newCheatSheet(ctx.deadline.id, new Date().toISOString());
}

/** GET: the setup's and the studio's view. */
export function cheatSheetView(classId: string, deadlineId: string): Outcome<CheatSheetView> {
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	const ctx = got.value;
	const s = state();
	const run = s.runs.get(deadlineId);
	return {
		ok: true,
		value: {
			className: ctx.className,
			deadlineName: ctx.deadline.name,
			date: ctx.deadline.date,
			sheet: sheetOf(ctx),
			saved: ctx.saved !== null && ctx.saved !== "newer",
			topics: ctx.topics,
			mistakes: ctx.topics.reduce((n, t) => n + t.mistakes, 0),
			running: run ? { kind: run.kind, blockIds: run.blockIds, ...(run.topicId ? { topicId: run.topicId } : {}) } : null,
			readingRules: s.reading.has(deadlineId),
			error: s.errors.get(deadlineId) ?? null,
			...(ctx.saved === "newer" ? { newer: true as const } : {}),
		},
	};
}

/** Save a changed sheet (refused when a newer build wrote it). */
function save(ctx: Context, next: CheatSheet): Outcome<CheatSheet> {
	if (ctx.saved === "newer") return fail(409, "A newer godspeed saved this cheat sheet. Update godspeed to change it.");
	const sheet = { ...next, updatedAt: new Date().toISOString() };
	writeCheatSheet(ctx.classId, sheet);
	changed(ctx.deadline.id);
	return { ok: true, value: sheet };
}

/** PUT: the rules and the choices (the setup's fields and the studio's rail). */
export function saveCheatSheet(classId: string, deadlineId: string, patch: { rules?: unknown; prefs?: unknown }): Outcome<CheatSheet> {
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	const sheet = sheetOf(got.value);
	return save(got.value, { ...sheet, rules: mergeRules(sheet.rules, patch.rules), prefs: mergePrefs(sheet.prefs, patch.prefs) });
}

/** A block edit made in the studio itself: pin, remove, move. */
export type BlockEdit = { kind: "pin"; blockId: string; pinned: boolean } | { kind: "remove"; blockId: string } | { kind: "move"; blockId: string; before: string | null };

export function editCheatSheetBlocks(classId: string, deadlineId: string, edit: BlockEdit): Outcome<CheatSheet> {
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	const sheet = sheetOf(got.value);
	const block = sheet.blocks.find((b) => b.id === edit.blockId);
	if (!block) return fail(404, "No such block");
	let blocks = sheet.blocks;
	if (edit.kind === "pin") blocks = blocks.map((b) => (b.id === edit.blockId ? withPin(b, edit.pinned) : b));
	if (edit.kind === "remove") blocks = blocks.filter((b) => b.id !== edit.blockId);
	if (edit.kind === "move") {
		const rest = blocks.filter((b) => b.id !== edit.blockId);
		const at = edit.before === null ? rest.length : rest.findIndex((b) => b.id === edit.before);
		blocks = [...rest.slice(0, at < 0 ? rest.length : at), block, ...rest.slice(at < 0 ? rest.length : at)];
	}
	return save(got.value, { ...sheet, blocks });
}

function withPin(b: CheatSheetBlock, pinned: boolean): CheatSheetBlock {
	const { pinned: _was, ...rest } = b;
	return pinned ? { ...rest, pinned: true } : rest;
}

// ─── requests to the agent ──────────────────────────────────────────────────

function engine(): PiEngine {
	return cheatSheetSeams.engine ?? agentEngine();
}

/** The request's shared part: rules, choices, budgets, topics with facts. */
function request(ctx: Context, sheet: CheatSheet, topics: readonly SheetTopic[], signal: AbortSignal) {
	const content = sheetContent(sheet);
	const mistakes = content.includes("mistakes") ? ctx.mistakes : [];
	const budgets = lineBudgets(sheetLines(sheet), topics, mistakes.length);
	const withFacts: RequestTopic[] = topics.map((t) => ({
		...t,
		lines: budgets.get(t.id) ?? 2,
		facts: topicFacts(ctx.progress.facts, ctx.progress.topics.find((x) => x.id === t.id) ?? { members: [] })
			.slice(0, FACTS_PER_TOPIC)
			.map((f) => ({ name: f.name, statement: f.statement })),
	}));
	return {
		input: {
			title: `${ctx.className} ${ctx.deadline.name}`,
			classNotes: ctx.classNotes,
			date: ctx.deadline.date,
			rules: sheet.rules,
			content,
			textSize: sheet.prefs.textSize,
			columns: sheet.prefs.columns,
			linesPerColumn: linesPerColumn(sheet),
			topics: withFacts,
			mistakes,
			engine: engine(),
			signal,
		},
		watchOutLines: budgets.get(WATCH_OUT) ?? 0,
	};
}

/** Run one request for a sheet: refused while another runs; its end is announced. */
function startRun(ctx: Context, run: CheatSheetRun, work: (signal: AbortSignal) => Promise<void>): Outcome<null> {
	const s = state();
	const id = ctx.deadline.id;
	if (s.runs.has(id)) return fail(409, "Your agent is still working on this cheat sheet.");
	if (ctx.saved === "newer") return fail(409, "A newer godspeed saved this cheat sheet. Update godspeed to change it.");
	const controller = new AbortController();
	s.runs.set(id, { ...run, controller });
	s.errors.delete(id);
	changed(id);
	void work(controller.signal)
		.catch((err: unknown) => {
			if (controller.signal.aborted) return;
			console.error(`[cheat-sheet ${id}] request failed:`, err);
			s.errors.set(id, err instanceof Error ? err.message : "the request failed");
		})
		.finally(() => {
			s.runs.delete(id);
			changed(id);
		});
	return { ok: true, value: null };
}

/** The latest saved sheet (the learner may have edited it meanwhile). */
function latest(ctx: Context): CheatSheet {
	const now = readCheatSheet(ctx.classId, ctx.deadline.id);
	return now && now !== "newer" ? now : sheetOf(ctx);
}

/** A written block placed among the others: Watch out first, the rest in class order. */
function inOrder(blocks: CheatSheetBlock[], topics: readonly SheetTopic[]): CheatSheetBlock[] {
	const rank = new Map(topics.map((t, i) => [t.id, i]));
	const at = (b: CheatSheetBlock) => (b.topicId === WATCH_OUT ? -1 : (rank.get(b.topicId) ?? topics.length));
	return [...blocks].sort((a, b) => at(a) - at(b));
}

const toBlock = (w: WrittenBlock, id = newBlockId()): CheatSheetBlock => ({ id, topicId: w.topicId, title: w.title, body: w.body, reason: w.reason, ...(w.why ? { why: w.why } : {}) });

/** "Make my cheat sheet": confirm the rules and choices, then write every
 *  block. Pinned blocks stay as they are. */
export function makeCheatSheet(classId: string, deadlineId: string, patch: { rules?: unknown; prefs?: unknown }): Outcome<null> {
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	const ctx = got.value;
	if (state().runs.has(deadlineId)) return fail(409, "Your agent is still working on this cheat sheet.");
	const base = sheetOf(ctx);
	const sheet: CheatSheet = { ...base, rules: mergeRules(base.rules, patch.rules), prefs: mergePrefs(base.prefs, patch.prefs), confirmedAt: new Date().toISOString() };
	if (!sheet.rules.allowed) return fail(400, "This class doesn't allow a cheat sheet for it.");
	const pinned = new Set(sheet.blocks.filter((b) => b.pinned).map((b) => b.topicId));
	const topics = sheetTopics(ctx.topics).on.filter((t) => !pinned.has(t.id));
	if (topics.length === 0 && ctx.mistakes.length === 0) return fail(400, "Nothing to put on it yet: link what this deadline covers first.");
	const saved = save(ctx, sheet);
	if (!saved.ok) return saved;
	state().reading.get(deadlineId)?.abort();
	return startRun(ctx, { kind: "make", blockIds: [] }, async (signal) => {
		const { input, watchOutLines } = request(ctx, sheet, topics, signal);
		const written = await writeSheet({ ...input, mistakes: pinned.has(WATCH_OUT) ? [] : input.mistakes }, watchOutLines);
		const now = latest(ctx);
		const kept = now.blocks.filter((b) => b.pinned);
		const fresh = written.filter((w) => !kept.some((k) => k.topicId === w.topicId)).map((w) => toBlock(w));
		save(ctx, { ...now, blocks: inOrder([...kept, ...fresh], ctx.topics) });
	});
}

/** Tighten, Redo, a change in the learner's words, or a left-out topic
 *  added back: a small request for those blocks only. */
export function changeCheatSheetBlocks(
	classId: string,
	deadlineId: string,
	ask: { how: "tighten" | "redo" | "ask"; blockIds: string[]; text?: string } | { how: "add"; topicId: string },
): Outcome<null> {
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	const ctx = got.value;
	const sheet = sheetOf(ctx);
	const blocks = ask.how === "add" ? [] : sheet.blocks.filter((b) => ask.blockIds.includes(b.id));
	if (ask.how !== "add" && (blocks.length === 0 || blocks.length !== ask.blockIds.length)) return fail(404, "No such block");
	if (ask.how === "ask" && !ask.text?.trim()) return fail(400, "Say what to change.");
	if (ask.how === "add" && (!ctx.topics.some((t) => t.id === ask.topicId) || sheet.blocks.some((b) => b.topicId === ask.topicId))) return fail(400, "That topic can't be added.");
	const topicIds = new Set(ask.how === "add" ? [ask.topicId] : blocks.map((b) => b.topicId));
	const change: BlockChange = ask.how === "add" ? { how: "add", blocks: [], topicId: ask.topicId } : { how: ask.how, blocks, ...(ask.text ? { text: ask.text.trim() } : {}) };
	const run: CheatSheetRun = ask.how === "add" ? { kind: "change", blockIds: [], topicId: ask.topicId } : { kind: "change", blockIds: ask.blockIds };
	return startRun(ctx, run, async (signal) => {
		const { input } = request(ctx, sheet, ctx.topics.filter((t) => topicIds.has(t.id)), signal);
		const written = await changeBlocks(input, change);
		const now = latest(ctx);
		const next =
			ask.how === "add"
				? inOrder([...now.blocks, toBlock(written[0]!)], ctx.topics)
				: now.blocks.map((b) => {
						const w = written.find((x) => x.blockId === b.id);
						return w ? { ...toBlock(w, b.id), ...(b.pinned ? { pinned: true as const } : {}) } : b;
					});
		save(ctx, { ...now, blocks: next });
	});
}

/** Stop the request the agent is working on. */
export function stopCheatSheet(deadlineId: string): void {
	state().runs.get(deadlineId)?.controller.abort();
}

/** When the setup opens: ask the agent for the rules in the class's files,
 *  once, and only until the learner confirmed them. The answer fills the
 *  setup for the learner to check. */
export function readCheatSheetRules(classId: string, deadlineId: string): Outcome<null> {
	const got = contextFor(classId, deadlineId);
	if (!got.ok) return got;
	const ctx = got.value;
	const sheet = sheetOf(ctx);
	const s = state();
	if (sheet.rulesRead || sheet.confirmedAt || s.reading.has(deadlineId) || ctx.saved === "newer") return { ok: true, value: null };
	const controller = new AbortController();
	s.reading.set(deadlineId, controller);
	changed(deadlineId);
	const record = stores.classStore.getClass(classId);
	void readRules({
		title: `${ctx.className} ${ctx.deadline.name}`,
		date: ctx.deadline.date,
		infoFiles: (record?.files ?? []).filter((f) => f.kind === "info").map((f) => f.name),
		lookups: Object.values(searchTools({ searchFiles: (query, limit) => searchClassFiles(classId, query, limit), readPassage: (ref) => readPassage(classId, ref) })),
		engine: engine(),
		signal: controller.signal,
	})
		.then((found) => {
			const now = latest(ctx);
			if (now.confirmedAt) return;
			save(ctx, { ...now, rules: found.found ? mergeRules(now.rules, found.rules) : now.rules, rulesRead: true });
		})
		.catch((err: unknown) => {
			if (!controller.signal.aborted) console.error(`[cheat-sheet ${deadlineId}] reading the rules failed:`, err);
		})
		.finally(() => {
			s.reading.delete(deadlineId);
			changed(deadlineId);
		});
	return { ok: true, value: null };
}

/** Resolves when no request for the sheet is going (tests). */
export async function cheatSheetIdle(deadlineId: string): Promise<void> {
	while (state().runs.has(deadlineId) || state().reading.has(deadlineId)) await new Promise((r) => setTimeout(r, 5));
}
