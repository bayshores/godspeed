import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import type { CallUsage, JobKind, JobRecord } from "@/shared/core";
import { useServerResource } from "@/frontend/components/use-server-resource";

/**
 * THE ACTIVITY FEED: one feed of GET /api/activity (running sub-agent jobs
 * across all lessons, title-joined, the fact-building runs, the deadline
 * requests, and jobs that failed lately), fetched when truth moves. The teacher's Activity list
 * (teacher/teacher-activity.tsx) draws it. Teaching turns are not in it:
 * a turn in flight shows where it happens.
 */

// ─── Wire shapes (client-safe mirrors of server/observability.ts) ────────────

/** JobUsage extended by lastStep (the context line). */
interface FeedUsage extends NonNullable<JobRecord["usage"]> {
	lastStep?: CallUsage;
}

interface FeedJob extends JobRecord {
	title: string;
	usage?: FeedUsage;
	/** Server-joined live catalog limit —
	 *  null when the model is missing from pi's catalog (no context line). */
	contextLimit: number | null;
}

export interface FeedExtraction {
	/** Unique row id (source id, or "src#i" for chunk jobs). */
	id: string;
	chatId: string;
	/** Only a "chat" run's chatId is a lesson; notes and topics runs use a source key. */
	kind: "chat" | "notes" | "topics";
	part?: { i: number; n: number };
	title: string;
	phase: string;
	startedAt: number;
}

/** A deadline's or a plugin's request the agent works on ("Deadline: Wave Optics Final", "Memes"); it has no Stop. */
interface FeedRequest {
	/** Its first deadline's id. */
	id: string;
	title: string;
	startedAt: number;
}

/** A job that failed lately (server/observability.ts ActivityFailedJob). */
interface FeedFailedJob {
	id: string;
	kind: JobKind;
	chatId: string;
	title: string;
	error: string;
	at: string;
}

export interface ActivityFeed {
	jobs: FeedJob[];
	extractions: FeedExtraction[];
	/** Jobs that failed in the last few minutes (absent on older payloads). */
	failed?: FeedFailedJob[];
	/** Deadline and plugin requests running (absent on older payloads). */
	requests?: FeedRequest[];
}

const EMPTY_FEED: ActivityFeed = { jobs: [], extractions: [], failed: [], requests: [] };

// ─── The activity feed (composition root: src/frontend/routes/root.tsx) ───────────────────

const ActivityContext = createContext<{ feed: ActivityFeed; refresh: () => void }>({
	feed: EMPTY_FEED,
	refresh: () => {},
});

/**
 * THE ACTIVITY FEED, PUSH-DRIVEN: it refetches exactly when truth
 * moves, never on a poll. Every cause is announced on the events channel: extraction phase
 * transitions (activity-changed), job writes
 * (jobs-changed — the running-jobs blobs), and channel resync (reconnect /
 * dev-restart catch-up) — plus the one client-local cause: visibility, a
 * tab becoming visible refetches at once.
 * Announced fetches ride a 250ms trailing debounce (extraction phase
 * bursts); resync and visibility are immediate. A failed
 * fetch keeps the last feed (the list never flickers to empty on a blip).
 */
export function ActivityProvider({ children }: { children: React.ReactNode }) {
	const { value: read, reload } = useServerResource<Partial<ActivityFeed>>("/api/activity", {
		on: { "activity-changed": true, "jobs-changed": true },
		debounceMs: 250,
	});
	const feed = useMemo<ActivityFeed>(
		() => (read ? { jobs: read.jobs ?? [], extractions: read.extractions ?? [], failed: read.failed ?? [], requests: read.requests ?? [] } : EMPTY_FEED),
		[read],
	);
	const refresh = useCallback(() => void reload(), [reload]);

	// The visibility nudge: returning to the tab refetches immediately —
	// anything missed while hidden lands at once.
	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState === "visible") refresh();
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, [refresh]);

	const value = useMemo(() => ({ feed, refresh }), [feed, refresh]);
	return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}

/** The activity feed seam for the rest of the shell: the feed +
 *  its refresh nudge. The remaining nudgers are client-visible causes
 *  (the extract/import buttons — extraction-coverage, graph-view); every
 *  server-side cause announces itself on the events channel. */
export function useActivity(): { feed: ActivityFeed; refresh: () => void } {
	return useContext(ActivityContext);
}
