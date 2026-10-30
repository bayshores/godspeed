/**
 * Server-side observability surface — what the transport layer
 * (src/app/api/*) reads for background-process status.
 *
 * THE ACTIVITY FEED: the bottom-right dock is
 * visible in every view, so it needs the complete running-process picture —
 * sub-agent jobs across ALL chats (not just the open one) plus the global
 * extraction runs — in one poll. The dock is BACKGROUND PROCESSES ONLY:
 * teaching sessions already have their own observability, so in-flight
 * teacher turns are deliberately NOT in the feed. /api/jobs stays
 * chat-scoped: it is the transcript
 * machinery's poll and carries turnInFlight for the re-attach seam
 * (chat-transport); the dock is a different consumer with a different
 * shape, served here. Single sources of truth are unchanged: the job
 * store and the pipeline registry — this file only composes them.
 *
 * The extraction side of the dock's controls also surfaces here:
 * abortExtraction (true mid-run cancellation) is exported
 * from the pipeline's module for the abort route to call.
 */

import { extractionStatuses, type ExtractionPhase, type RunningExtraction } from "../agent/subagents/extraction.ts";
import { chatStore } from "../store/chats.ts";
import { agentModel } from "../agent/agent-bridge.ts";
import { listAllJobs } from "./jobs.ts";
import type { JobRecord } from "../core/contracts.ts";

export { abortExtraction, extractionStatuses } from "../agent/subagents/extraction.ts";

/** A running sub-agent job, joined with its chat's title for the dock.
 *  contextLimit: the model's
 *  live catalog limit, resolved SERVER-SIDE from pi's catalog — the dock
 *  reads it off the feed instead of any client-side table. Null when the
 *  model is missing from the catalog (the blob then renders no context
 *  line — never a fake window). */
interface ActivityJob extends JobRecord {
	title: string;
	contextLimit: number | null;
}

/** One extraction-pipeline JOB (title joined), oldest first. Per-chunk
 *  jobs: a multi-chunk source owns SEVERAL rows — id
 *  is the unique job key (source id, or "src#i"), chatId stays the SOURCE
 *  id (abort + chat links are source-scoped), and the title carries the
 *  "· i/N" part suffix. */
interface ActivityExtraction {
	id: string;
	chatId: string;
	kind: RunningExtraction["kind"];
	part?: { i: number; n: number };
	title: string;
	phase: ExtractionPhase;
	startedAt: number;
}

/** A job that ended with an error lately (Halley's @_@ and the panel's
 *  error line). */
interface ActivityFailedJob {
	id: string;
	kind: JobRecord["kind"];
	chatId: string;
	title: string;
	error: string;
	/** When it failed (the job's last update, ISO). */
	at: string;
}

/** Failed jobs stay in the feed this long. */
const FAILED_JOB_WINDOW_MS = 10 * 60_000;

/** The dock's whole world in one payload: every running process, every view.
 *  Jobs are RUNNING-ONLY — finished jobs belong to their chat's transcript;
 *  the blob disappears when the process ends. */
export function activityFeed(now = Date.now()): {
	jobs: ActivityJob[];
	extractions: ActivityExtraction[];
	failed: ActivityFailedJob[];
} {
	const chats = chatStore.listChats();
	// Every job runs on the outside agent: one context window.
	const agentWindow = agentModel().contextWindow;
	const agentModelId = `${agentModel().provider}:${agentModel().id}`;
	const jobs: ActivityJob[] = [];
	const failed: ActivityFailedJob[] = [];
	// One read of every job, grouped by lesson; jobs of unlisted lessons stay out.
	const jobsByChat = new Map<string, JobRecord[]>();
	for (const job of listAllJobs()) {
		const group = jobsByChat.get(job.chatId);
		if (group) group.push(job);
		else jobsByChat.set(job.chatId, [job]);
	}
	for (const chat of chats) {
		for (const job of jobsByChat.get(chat.id) ?? []) {
			if (job.status === "error" && now - Date.parse(job.updatedAt) < FAILED_JOB_WINDOW_MS) {
				failed.push({ id: job.id, kind: job.kind, chatId: job.chatId, title: chat.title ?? chat.id, error: job.error?.trim() || "Something went wrong", at: job.updatedAt });
			}
			if (job.status === "running") {
				jobs.push({
					...job,
					title: chat.title ?? chat.id,
					contextLimit: job.usage?.model === agentModelId ? agentWindow : null,
				});
			}
		}
	}
	const extractions: ActivityExtraction[] = extractionStatuses().map((run) => ({
		id: run.part ? `${run.chatId}#${run.part.i}` : run.chatId,
		chatId: run.chatId,
		kind: run.kind,
		part: run.part,
		// The run's own label (a notes import's file path), else the chat's
		// title, else the bare id, plus the chunk suffix when the source fanned out.
		title:
			(run.label ?? chatStore.getChat(run.chatId)?.title ?? run.chatId) +
			(run.part ? ` · ${run.part.i}/${run.part.n}` : ""),
		phase: run.phase,
		startedAt: run.startedAt,
	}));
	// oldest-first on last activity: the stable blob order (ISO strings sort chronologically)
	jobs.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
	return {
		jobs,
		extractions: extractions.sort((a, b) => a.startedAt - b.startedAt),
		failed: failed.sort((a, b) => b.at.localeCompare(a.at)),
	};
}
