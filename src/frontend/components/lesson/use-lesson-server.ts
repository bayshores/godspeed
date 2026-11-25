import { useCallback, useEffect, useRef, useState } from "react";
import { getJson } from "@/frontend/lib/api";
import { useTrailing } from "@/frontend/lib/use-trailing";
import { useServerEvent, useServerResync } from "@/frontend/components/server-events";
import type { useChatSession } from "@/frontend/components/session";
import type { ChatRecord, JobRecord, SessionPricing, TurnUsage } from "@/shared/core";

type Session = ReturnType<typeof useChatSession>;

/** GET /api/chats/[id]: the record plus its pricing, the lesson size where
 *  the server summarizes it, whether a turn is running and the last turn's
 *  failure. */
export type ChatRead = ChatRecord & { pricing?: SessionPricing; summarizeAt?: number; turnInFlight: boolean; turnError?: string };

/** The chat's record, or null when it can't be read right now (the next
 *  event or send heals). */
async function readRecord(chatId: string): Promise<ChatRead | null> {
	return (await getJson<ChatRead>(`/api/chats/${encodeURIComponent(chatId)}`)).body;
}

/** The stats row's figures as the route's loader read them. */
export type LessonStats = Pick<ChatRead, "turns" | "pricing" | "summarizeAt">;

/**
 * A chat's server seams, for a lesson and for the teacher panel's chat alike: record
 * sync and append-only adoption, the turn-start adoption window, the
 * session usage log, the central jobs fetch, and the events-channel
 * subscriptions (turn-started / turn-settled / compaction / record).
 *
 * The rules these keep (contracts.ts "THE ASYNC PROTOCOL" §4 and the
 * push-architecture rounds):
 * - Never swap in a full record snapshot while a turn streams — it breaks
 *   the in-place continuation merge. Mid-turn deliveries adopt APPEND-ONLY;
 *   the full sync waits for idle.
 * - Every turn this chat runs is announced on the events channel; handlers
 *   read refs (events fire between renders).
 * - turn-settled for OUR OWN turn arrives before [DONE]: flag it, and the
 *   ready flip canonizes the view onto the durable record.
 */
export function useLessonServer({
	chatId,
	session,
	initiallyInFlight,
	initialStats,
	initialJobs,
}: {
	chatId: string;
	session: Session;
	initiallyInFlight: boolean;
	initialStats: LessonStats;
	/** The lesson's jobs as the page's loader read them, so their cards open as they stand; null when that read failed. */
	initialJobs: JobRecord[] | null;
}) {
	const { status, setMessages, continueIfOwed, adoptRecord, resumeStream, clearError, setReattachSettled } = session;

	// A turn running server-side that no live stream of ours holds yet (the
	// fallback liveness source until the resumed stream attaches).
	const [turnInFlight, setTurnInFlight] = useState(initiallyInFlight);
	const turnInFlightRef = useRef(turnInFlight);
	turnInFlightRef.current = turnInFlight;
	const localStream = status === "submitted" || status === "streaming";
	const localStreamRef = useRef(localStream);
	localStreamRef.current = localStream;
	const statusRef = useRef(status);
	statusRef.current = status;

	// The attach handoff: once the resumed stream renders, drop the fallback.
	useEffect(() => {
		if (turnInFlight && (status === "submitted" || status === "streaming")) setTurnInFlight(false);
	}, [status, turnInFlight]);

	const attachToRunningTurn = useCallback(() => {
		setTurnInFlight(true);
		void resumeStream();
	}, [resumeStream]);

	// ── the session usage log (the stats row) ──
	const [turns, setTurns] = useState<TurnUsage[]>(Array.isArray(initialStats.turns) ? initialStats.turns : []);
	const [pricing, setPricing] = useState<SessionPricing | undefined>(initialStats.pricing);
	const [summarizeAt, setSummarizeAt] = useState<number | null>(initialStats.summarizeAt ?? null);
	const applyStats = useCallback((record: ChatRead) => {
		if (Array.isArray(record.turns)) setTurns(record.turns);
		setPricing(record.pricing);
		setSummarizeAt(record.summarizeAt ?? null);
	}, []);
	// A failed read leaves the stats on the last known figures.
	const syncTurns = useCallback(async () => {
		const record = await readRecord(chatId);
		if (record) applyStats(record);
	}, [chatId, applyStats]);

	const syncFromServer = useCallback(async () => {
		// A failed read: the next record-changed / turn-settled event re-syncs.
		const record = await readRecord(chatId);
		if (!record) return;
		applyStats(record);
		if (!Array.isArray(record.messages)) return;
		setMessages(record.messages, record.turnError);
		// A job result landing in the record leaves the agent owing a
		// continuation (the native fold decides).
		continueIfOwed(record.messages);
	}, [chatId, applyStats, setMessages, continueIfOwed]);

	// The reattach stream's settled terminal: drop the fallback and adopt.
	setReattachSettled(() => {
		setTurnInFlight(false);
		void syncFromServer();
	});

	// Append-only adoption: server-delivered content (sub-agent artifacts,
	// abort notes, answers to questions from earlier) shows the moment it
	// persists, mid-turn included.
	// A failed read is covered by the idle full sync.
	const adoptAppendOnly = useCallback(async () => {
		const record = await readRecord(chatId);
		if (Array.isArray(record?.messages)) adoptRecord(record.messages);
	}, [chatId, adoptRecord]);

	// Turn-start window: the server inserts claimed steers right after our
	// outgoing message, before the stream produces anything — three bounded
	// record fetches (400ms/1s/2s) catch the insert, then stop. The timers
	// must survive the submitted→streaming flip, so the pending ones are
	// cleared only at unmount.
	const turnStartStatusRef = useRef(status);
	const turnStartTimersRef = useRef(new Set<ReturnType<typeof setTimeout>>());
	useEffect(() => {
		const was = turnStartStatusRef.current;
		turnStartStatusRef.current = status;
		if (was === "submitted" || status !== "submitted") return;
		const timers = turnStartTimersRef.current;
		for (const ms of [400, 1000, 2000]) {
			const id = setTimeout(() => {
				timers.delete(id);
				void adoptAppendOnly();
			}, ms);
			timers.add(id);
		}
	}, [status, adoptAppendOnly]);
	useEffect(() => {
		const timers = turnStartTimersRef.current;
		return () => {
			timers.forEach(clearTimeout);
			timers.clear();
		};
	}, []);

	const settleAnnouncedRef = useRef(false);
	const prevStatusRef = useRef(status);
	useEffect(() => {
		const transitioned = prevStatusRef.current !== "ready" && status === "ready";
		prevStatusRef.current = status;
		if (!transitioned) return;
		// Canonize onto the record when our own turn's settle was announced,
		// so the previous message never shows twice; that sync refreshes the
		// stats too, so only the other settles fetch them alone.
		if (settleAnnouncedRef.current) {
			settleAnnouncedRef.current = false;
			void syncFromServer();
		} else void syncTurns();
	}, [status, syncTurns, syncFromServer]);

	// A stream that died mid-flight: the server turn runs on — re-enter the
	// in-flight watch, or adopt the record if it already settled.
	const prevErrorStatusRef = useRef(status);
	useEffect(() => {
		const was = prevErrorStatusRef.current;
		prevErrorStatusRef.current = status;
		if (was === "error" || status !== "error") return;
		let cancelled = false;
		void (async () => {
			// A failed read: the banner stands; the next send heals.
			const record = await readRecord(chatId);
			if (!record || cancelled) return;
			if (record.turnInFlight === true) setTurnInFlight(true);
			else void syncFromServer();
		})();
		return () => {
			cancelled = true;
		};
	}, [status, chatId, syncFromServer]);

	// ── central jobs: one fetch drives every job surface ──
	const [jobs, setJobs] = useState<JobRecord[]>(initialJobs ?? []);
	const jobStatusRef = useRef<Map<string, string>>(new Map(initialJobs?.map((j) => [j.id, j.status])));
	const pendingSyncRef = useRef(false);
	const fetchJobs = useCallback(async () => {
		const { body: data } = await getJson<{ jobs?: JobRecord[]; turnInFlight?: boolean }>(`/api/jobs?chatId=${encodeURIComponent(chatId)}`);
		// A failed read: the next jobs-changed announcement reads again.
		if (!data) return;
		const list = data.jobs ?? [];
		for (const j of list) {
			const prev = jobStatusRef.current.get(j.id);
			if (prev === "running" && j.status !== "running") {
				// A settle: adopt append-only now; the full sync waits for idle.
				if (localStreamRef.current || data.turnInFlight === true) {
					pendingSyncRef.current = true;
					void adoptAppendOnly();
				} else {
					void syncFromServer();
				}
			}
			jobStatusRef.current.set(j.id, j.status);
		}
		if (pendingSyncRef.current && !localStreamRef.current && data.turnInFlight !== true) {
			pendingSyncRef.current = false;
			void syncFromServer();
		}
		setJobs(list);
	}, [chatId, syncFromServer, adoptAppendOnly]);
	// The loader's read failed: the page reads them itself.
	useEffect(() => {
		if (initialJobs === null) void fetchJobs();
	}, [initialJobs, fetchJobs]);
	const fetchJobsSoon = useTrailing(() => void fetchJobs(), 250);
	useServerEvent("jobs-changed", (p) => {
		if (p.chatId == null || p.chatId === chatId) fetchJobsSoon();
	});
	useServerResync(() => void fetchJobs());

	// ── server-initiated turn discovery ──
	useServerEvent("turn-started", (p) => {
		if (p.chatId !== chatId) return;
		if (localStreamRef.current) return; // our OWN turn
		if (turnInFlightRef.current) return; // already attached
		attachToRunningTurn();
	});
	useServerEvent("turn-settled", (p) => {
		if (p.chatId !== chatId) return;
		if (localStreamRef.current) {
			settleAnnouncedRef.current = true; // the ready flip canonizes
			return;
		}
		if (turnInFlightRef.current) {
			// The attached stream owns the settle; only a dead stream heals here.
			if (statusRef.current === "error") {
				setTurnInFlight(false);
				clearError();
				void syncFromServer();
			}
			return;
		}
		void syncFromServer(); // fully idle: a turn we never saw
	});
	useServerEvent("record-changed", (p) => {
		// The silent dismissal write: only the record moved. Busy states
		// ignore it (a running turn owns the view).
		if (p.chatId !== chatId) return;
		if (localStreamRef.current || turnInFlightRef.current) return;
		void syncFromServer();
	});

	return {
		turnInFlight,
		localStreamRef,
		jobs,
		turns,
		pricing,
		summarizeAt,
		adoptAppendOnly,
	};
}
