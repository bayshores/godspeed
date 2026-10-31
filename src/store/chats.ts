/**
 * ChatStore — the fs JSON adapter (one file per chat in data/chats/).
 *
 * Implements core/ports.ts ChatStore; the record shapes live in
 * core/contracts.ts (ChatRecord/ChatSummary). Idioms: sync fs, tiny
 * records, id-guarded filenames, JSON with tab indentation. Wired in the
 * composition root (src/server/stores.ts); nothing else constructs it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../config.ts";
import { emit } from "../core/events.ts";
import type { ChatStore } from "../core/ports.ts";
import type { ChatRecord, ChatSummary, ExtractionRunUsage, PlanTree, TurnUsage } from "../core/contracts.ts";
import { CHAT_ID_PREFIX, CURRENT_CHAT_VERSION } from "../core/contracts.ts";
import type { LhMessage } from "../core/native-messages.ts";
import { danglingQuestionOf } from "../core/native-messages.ts";
import { phaseAt3Lh } from "../core/phases.ts";
import { isRecord, isString } from "./guards.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

function chatFile(id: string): string {
	return `${chatDir(id)}.json`;
}

/** The lesson's folder for files the learner sent (beside its record). */
function chatDir(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid chat id: ${id}`);
	return path.join(PATHS.chats, id);
}

/** THE SILENCE LAW: chats-changed announces ONLY
 *  list-SHAPE mutations — createChat, renameChat, deleteChat (below,
 *  each emits post-write). The content writers (saveMessages,
 *  appendTurnUsage, appendExtractionUsage, saveTree) are
 *  DELIBERATELY SILENT: saveMessages fires per turn-persist and would
 *  spam the bus, and every list-visible change it causes (title, order,
 *  phase, busy, pendingQuestion) is already announced by turn-started /
 *  turn-settled, which the sidebar refetches on. Silence here is law,
 *  not oversight. */
function createChat(title: string, kind?: "practice", classId?: string): ChatRecord {
	const now = new Date().toISOString();
	const record: ChatRecord = {
		id: `${CHAT_ID_PREFIX}${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		title: title.trim() || "Untitled session",
		createdAt: now,
		updatedAt: now,
		messages: [],
		// Practice sessions carry the marker; teach stays ABSENT (absence
		// reads as teach — pre-practice records never migrate).
		...(kind === "practice" ? { kind: "practice" as const } : {}),
		// The lesson's class; ABSENT = "No class".
		...(classId ? { classId } : {}),
	};
	writeChat(record);
	emit("chats-changed", {});
	return { ...record, version: CURRENT_CHAT_VERSION }; // the in-memory twin of what landed on disk
}

/** THE WRITE CHOKE POINT: every
 *  record persist goes through here and carries the CURRENT version stamp —
 *  lazy migration means existing files only get stamped on their next write.
 *  A future-version guard lives on the read side (getChat). */
function writeChat(record: ChatRecord): void {
	summaryCache.delete(record.id);
	writeFileAtomic(chatFile(record.id), JSON.stringify({ ...record, version: CURRENT_CHAT_VERSION }, null, "\t"));
}

function getChat(id: string): ChatRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(chatFile(id), "utf-8"));
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !isString(parsed.id) || !isString(parsed.updatedAt) || !Array.isArray(parsed.messages)) {
		console.error(`[chat ${id}] record has the wrong shape; skipping it`);
		return null;
	}
	// Honest refusal: a record stamped NEWER than
	// this build (the downgrade scenario) reads as absent, never misparsed —
	// the next read-modify-write must not rewrite what it doesn't understand.
	const v = parsed.version;
	if (typeof v === "number" && v > CURRENT_CHAT_VERSION) {
		console.error(`[chat ${id}] record stamped with schema version ${v} > ${CURRENT_CHAT_VERSION} — this app build is older; refusing to read it`);
		return null;
	}
	return parsed as unknown as ChatRecord;
}

/** Lesson summaries kept in memory, so a sidebar refresh does not re-parse
 *  every lesson file. A summary is reused while its file's size and modified-time are
 *  unchanged; writeChat/deleteChat also drop it. Summaries are SHARED —
 *  callers must never mutate them (frozen under tests). */
const summaryCache = new Map<string, { mtimeMs: number; size: number; summary: ChatSummary | null }>();

function listChats(): ChatSummary[] {
	try {
		fs.mkdirSync(PATHS.chats, { recursive: true });
		const ids = fs
			.readdirSync(PATHS.chats)
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.slice(0, -5));
		for (const cached of summaryCache.keys()) if (!ids.includes(cached)) summaryCache.delete(cached);
		return ids
			.map((id) => {
				let st: fs.Stats;
				try {
					st = fs.statSync(chatFile(id));
				} catch {
					return null;
				}
				const hit = summaryCache.get(id);
				if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.summary;
				const record = getChat(id);
				const summary = record === null ? null : summarize(record);
				if (summary && process.env.NODE_ENV === "test") Object.freeze(summary);
				summaryCache.set(id, { mtimeMs: st.mtimeMs, size: st.size, summary });
				return summary;
			})
			.filter((s): s is ChatSummary => s !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

/** One record → its list summary (null when its messages can't be read). */
function summarize(record: ChatRecord): ChatSummary | null {
	const { messages, tree: _tree, turns: _turns, extractions: _extractions, ...summary } = record;
	// Per-record isolation: a record whose messages fail the projection
	// must not blank the whole sidebar — same isolation getChat's per-file
	// catch gives.
	try {
		return {
			// turns and extractions stay out of the list payload (list =
			// summaries; usage aggregates ride the full record, the picker
			// never needs them).
			...summary,
			// Normalized kind: absent record field reads as teach.
			kind: summary.kind ?? "teach",
			messageCount: messages.length,
			// Record-derived status for the session picker: phase from the
			// transcript's explicit events (probe_done concluded / verdict
			// accepted — docs/archive/probe-teach-split.md §4), pending question
			// from the native dangling-call scan. Both folds read
			// the NATIVE record (core/phases.ts phaseAt3Lh +
			// native-messages.ts danglingQuestionOf). Liveness (busy) is
			// NOT record-derived — the API route merges it (ChatListItem).
			phase: phaseAt3Lh(messages),
			pendingQuestion: danglingQuestionOf(messages) !== null,
			// The cast covers pendingProblem, which the list never sets.
		} as ChatSummary;
	} catch (err) {
		console.error(`[chat ${summary.id}] summary projection failed:`, err);
		return null;
	}
}

/** Persist the full native message list (the record IS the agent state:
 *  replay is state.messages = record.messages). SILENT by the
 *  events law — see the SILENCE LAW comment at createChat. */
function saveMessages(id: string, messages: LhMessage[]): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.messages = messages;
	record.updatedAt = new Date().toISOString();
	writeChat(record);
}

/** Append one usage entry to the record's turn log — idempotent per
 * turn id: each REQUEST carries its own id, so a replay of the same turn's
 * persist appends once, while continuation turns (which share a response
 *  message id) each keep their usage. */
function appendTurnUsage(id: string, entry: TurnUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.turns = record.turns?.some((t) => t.id === entry.id)
		? record.turns
		: [...(record.turns ?? []), entry];
	writeChat(record);
}

/** Append one extraction-run usage entry to the record's extractions
 * log — idempotent per startedAt: a retry that reaches the append twice
 * (abort replays) does not double-count spend. */
function appendExtractionUsage(id: string, entry: ExtractionRunUsage): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.extractions = record.extractions?.some((r) => r.startedAt === entry.startedAt)
		? record.extractions
		: [...(record.extractions ?? []), entry];
	writeChat(record);
}

/** Rename a session (the header's click-to-edit title). Like saveTree, a
 * rename is NOT conversation activity: updatedAt stays put
 * so sidebar order never churns. Same fallback as createChat — the empty
 * string becomes "Untitled session" (the API gate rejects it first; this
 * is the honest floor for any other caller). */
function renameChat(id: string, title: string): ChatRecord {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.title = title.trim() || "Untitled session";
	writeChat(record);
	emit("chats-changed", {});
	return record;
}

/** Delete the session record file entirely. False when the id is unknown — the route turns that
 *  into a 404. The record's graph traces and jobs are the route's
 *  choreography (core/graph-deletion.ts), not the store's. */
function deleteChat(id: string): boolean {
	try {
		summaryCache.delete(id);
		fs.unlinkSync(chatFile(id));
		fs.rmSync(chatDir(id), { recursive: true, force: true });
		emit("chats-changed", {}); // only a real removal — the present-entry law
		return true;
	} catch {
		return false; // never existed, already deleted, or unreadable — same answer
	}
}

function saveAttachment(id: string, fileName: string, data: Uint8Array): string {
	if (fileName !== path.basename(fileName)) throw new Error(`Invalid attachment name: ${fileName}`);
	const file = path.join(chatDir(id), fileName);
	writeFileAtomic(file, data);
	return file;
}

/** Set or clear the lesson's class. Quiet like
 *  rename — updatedAt stays put — but it changes which list the lesson
 *  shows in, so it announces chats-changed (a list-SHAPE mutation). */
function setChatClass(id: string, classId: string | null): ChatRecord {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	if (classId) record.classId = classId;
	else delete record.classId;
	writeChat(record);
	emit("chats-changed", {});
	return record;
}

/** Persist the session plan tree (plan tools call this in execute). */
function saveTree(id: string, tree: PlanTree): void {
	const record = getChat(id);
	if (!record) throw new Error(`Chat not found: ${id}`);
	record.tree = tree;
	// Deliberately does NOT bump updatedAt: tree mutations piggyback on the
	// turn's saveMessages, and sidebar ordering shouldn't churn on tree edits.
	writeChat(record);
}

export const chatStore: ChatStore = {
	createChat,
	getChat,
	listChats,
	saveMessages,
	saveTree,
	renameChat,
	deleteChat,
	saveAttachment,
	setChatClass,
	appendTurnUsage,
	appendExtractionUsage,
};
