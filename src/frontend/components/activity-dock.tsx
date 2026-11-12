"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CallUsage, JobKind, JobRecord } from "@/shared/core";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";

/**
 * THE ACTIVITY FEED: one feed of GET /api/activity (running sub-agent jobs
 * across all lessons, title-joined, the fact-building runs, and jobs that
 * failed lately), fetched when truth moves. The teacher's Activity list
 * (halley/teacher-activity.tsx) draws it. Teaching turns are not in it:
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
}

const EMPTY_FEED: ActivityFeed = { jobs: [], extractions: [], failed: [] };

// ─── The activity feed (composition root: the root layout) ───────────────────

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
	const [feed, setFeed] = useState<ActivityFeed>(EMPTY_FEED);
	const [nonce, setNonce] = useState(0);
	const refresh = useCallback(() => setNonce((n) => n + 1), []);
	const refreshRef = useRef(refresh);
	refreshRef.current = refresh;
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	useEffect(() => {
		let alive = true;
		void (async () => {
			try {
				const res = await fetch("/api/activity");
				if (res.ok) {
					const data = (await res.json()) as Partial<ActivityFeed>;
					if (alive)
						setFeed({ jobs: data.jobs ?? [], extractions: data.extractions ?? [], failed: data.failed ?? [] });
				}
			} catch {
				// transport blip: keep the last feed, announce again next event
			}
		})();
		return () => {
			alive = false;
		};
	}, [nonce]);

	// Announcements → one trailing fetch per burst.
	const scheduleAnnouncedFetch = () => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => {
			debounceRef.current = undefined;
			refreshRef.current();
		}, 250);
	};
	useServerEvent("activity-changed", scheduleAnnouncedFetch);
	useServerEvent("jobs-changed", scheduleAnnouncedFetch);
	// Reconnect catch-up: events missed while the channel was down.
	useServerResync(() => refreshRef.current());

	// The visibility nudge: returning to the tab refetches immediately —
	// anything missed while hidden lands at once.
	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState === "visible") setNonce((n) => n + 1);
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => document.removeEventListener("visibilitychange", onVisibility);
	}, []);

	// The debounce timer never outlives the provider.
	useEffect(
		() => () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		},
		[],
	);

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
