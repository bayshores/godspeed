/**
 * JobStore — the fs JSON adapter: one file per background sub-agent job in
 * data/jobs/ (contracts.ts "THE ASYNC PROTOCOL"). Keyed by toolCallId for
 * dedup: the chat-handler spawn hook never creates two jobs for the same
 * tool part. Implements core/ports.ts JobStore. Idioms: sync fs, id-guarded
 * filenames, JSON with tab indentation. Writes are small and rare (activity
 * line updates); the read-modify-write sections in the runner contain no
 * awaits, so they are atomic within the single-threaded event loop.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../config.ts";
import { emit } from "../../shared/core/events.ts";
import type { JobStore } from "../../shared/core/ports.ts";
import type { CreateJobInit, JobPatch } from "../../shared/core/ports.ts";
import type { JobRecord } from "../../shared/core/contracts.ts";
import { isRecord, isString } from "./guards.ts";
import { writeFileAtomic } from "./write-file-atomic.ts";

/** Background jobs (data/jobs). Not in src/backend/config.ts PATHS (orchestrator-owned). */
const JOBS_DIR = path.join(PATHS.data, "jobs");

function jobFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid job id: ${id}`);
	return path.join(JOBS_DIR, `${id}.json`);
}

/** Writes announce on the events channel AFTER the write lands (the
 *  notify-after-write law, beginTurn precedent) — jobs-changed lets the view
 *  skip polling: dispatch cards, progress lines, settles, and aborts all
 *  surface as one fetch. */
function createJob(init: CreateJobInit): JobRecord {
	const now = new Date().toISOString();
	const record: JobRecord = {
		id: `job_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		kind: init.kind,
		chatId: init.chatId,
		toolCallId: init.toolCallId,
		...(init.input !== undefined ? { input: init.input } : {}),
		status: "running",
		activity: init.activity ?? "starting",
		createdAt: now,
		updatedAt: now,
	};
	writeFileAtomic(jobFile(record.id), JSON.stringify(record, null, "\t"));
	emit("jobs-changed", { chatId: init.chatId });
	return record;
}

/** Parsed job records kept while their file's modified time and size are
 *  unchanged: the activity feed and every turn start list every job of
 *  every lesson, and a record holds its whole result. Records are SHARED —
 *  callers must never mutate them (frozen under tests). */
const jobCache = new Map<string, { version: string; job: JobRecord | null }>();

function getJob(id: string): JobRecord | null {
	let file: string;
	let version: string;
	try {
		file = jobFile(id);
		const st = fs.statSync(/* turbopackIgnore: true */ file);
		version = `${st.mtimeMs}:${st.size}`;
	} catch {
		jobCache.delete(id);
		return null;
	}
	const hit = jobCache.get(id);
	if (hit?.version === version) return hit.job;
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ file, "utf-8"));
	} catch {
		return null;
	}
	const job = isRecord(parsed) && isString(parsed.id) && isString(parsed.chatId) && isString(parsed.updatedAt) && isString(parsed.status)
		? (parsed as unknown as JobRecord)
		: null;
	if (job && process.env.NODE_ENV === "test") Object.freeze(job);
	jobCache.set(id, { version, job });
	return job;
}

/** Merge a partial patch into the record (identity fields are immutable).
 *  An explicit patch.updatedAt is honored (tests pin deterministic order);
 *  otherwise the merge bumps it to now. */
function updateJob(id: string, patch: JobPatch): JobRecord | null {
	const record = getJob(id);
	if (!record) return null;
	const next: JobRecord = { ...record, ...patch, updatedAt: patch.updatedAt ?? new Date().toISOString() };
	writeFileAtomic(jobFile(id), JSON.stringify(next, null, "\t"));
	jobCache.delete(id); // a same-size write within the clock's tick keeps the version
	// EVERY write, not just status flips: progress-line updates must reach
	// the dispatch cards (the view debounces the fetch bursts). A missing id
	// wrote nothing and stays silent.
	emit("jobs-changed", { chatId: next.chatId });
	return next;
}

/** Every job across all chats, newest activity first: one directory pass. */
function listAllJobs(): JobRecord[] {
	try {
		fs.mkdirSync(JOBS_DIR, { recursive: true });
		const ids = fs
			.readdirSync(JOBS_DIR)
			.filter((f) => f.endsWith(".json"))
			.map((f) => f.slice(0, -5));
		const present = new Set(ids);
		for (const cached of jobCache.keys()) if (!present.has(cached)) jobCache.delete(cached);
		return ids
			.map((id) => getJob(id))
			.filter((j): j is JobRecord => j !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

/** All jobs for a chat, newest activity first. */
function listJobs(chatId: string): JobRecord[] {
	return listAllJobs().filter((j) => j.chatId === chatId);
}

/** The job fulfilling a given tool part, if any (spawn-hook dedup). */
function findJobByToolCallId(chatId: string, toolCallId: string): JobRecord | null {
	return listJobs(chatId).find((j) => j.toolCallId === toolCallId) ?? null;
}

/** Delete every job record file for a chat —
 *  running or finished, they are the chat's records and die with it.
 *  Returns how many files were removed. The deletion route refuses while
 *  jobs are still running, so every record here is terminal. */
function deleteJobsForChat(chatId: string): number {
	let removed = 0;
	for (const job of listJobs(chatId)) {
		try {
			fs.unlinkSync(jobFile(job.id));
			jobCache.delete(job.id);
			removed++;
		} catch {
			/* already gone — the count is best-effort truth */
		}
	}
	// Only when something actually died — a zero-file delete wrote nothing
	// (the endTurn present-entry law).
	if (removed > 0) emit("jobs-changed", { chatId });
	return removed;
}

export const jobStore: JobStore = {
	createJob,
	getJob,
	updateJob,
	listAllJobs,
	listJobs,
	findJobByToolCallId,
	deleteJobsForChat,
};
