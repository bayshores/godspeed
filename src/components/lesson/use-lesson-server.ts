import { useCallback, useEffect, useRef, useState } from "react";
import { useServerEvent, useServerResync } from "@/components/server-events";
import type { useChatSession } from "@/components/session";
import type { JobRecord, LhMessage, SessionPricing, TurnUsage } from "@/core";

type Session = ReturnType<typeof useChatSession>;

/**
 * The lesson's server seams (split out of src/components/chat.tsx): record
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
	initiallyCompacting,
}: {
	chatId: string;
	session: Session;
	initiallyInFlight: boolean;
	initiallyCompacting: boolean;
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
	const [turns, setTurns] = useState<TurnUsage[]>([]);
	const [pricing, setPricing] = useState<SessionPricing | undefined>();
	const syncTurns = useCallback(async () => {
		try {
			const res = await fetch(`/api/chats/${chatId}`);
			if (!res.ok) return;
			const record = (await res.json()) as { turns?: TurnUsage[]; pricing?: SessionPricing };
			if (Array.isArray(record.turns)) setTurns(record.turns);
			setPricing(record.pricing);
		} catch {
			// transient: stats stay on the last known figures
		}
	}, [chatId]);
	useEffect(() => {
		void syncTurns();
	}, [syncTurns]);

	const syncFromServer = useCallback(async () => {
		let record: { messages?: LhMessage[]; turns?: TurnUsage[]; pricing?: SessionPricing; turnError?: string };
		try {
			const res = await fetch(`/api/chats/${chatId}`);
			if (!res.ok) return;
			record = await res.json();
		} catch {
			return; // transient: the next record-changed / turn-settled event re-syncs
		}
		if (Array.isArray(record.turns)) setTurns(record.turns);
		setPricing(record.pricing);
		if (!Array.isArray(record.messages)) return;
		setMessages(record.messages, record.turnError);
		// A job result landing in the record leaves the agent owing a
		// continuation (the native fold decides).
		continueIfOwed(record.messages);
	}, [chatId, setMessages, continueIfOwed]);

	// The reattach stream's settled terminal: drop the fallback and adopt.
	setReattachSettled(() => {
		setTurnInFlight(false);
		void syncFromServer();
	});

	// Append-only adoption: server-delivered content (sub-agent artifacts,
	// abort notes) shows the moment it persists, mid-turn included.
	const adoptAppendOnly = useCallback(async () => {
		try {
			const res = await fetch(`/api/chats/${chatId}`);
			if (!res.ok) return;
			const record = (await res.json()) as { messages?: LhMessage[] };
			if (!Array.isArray(record.messages)) return;
			adoptRecord(record.messages);
		} catch {
			/* transient — the idle full sync is the net */
		}
	}, [chatId, adoptRecord]);

	// Turn-start window: the server inserts claimed steers right after our
	// outgoing message, before the stream produces anything — three bounded
	// record fetches (400ms/1s/2s) catch the insert, then stop. The timers
	// must survive the submitted→streaming flip, so they are cleared only
	// at unmount.
	const turnStartStatusRef = useRef(status);
	const adoptionWindowOpenRef = useRef(false);
	const turnStartTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
	useEffect(() => {
		const was = turnStartStatusRef.current;
		turnStartStatusRef.current = status;
		if (was === "submitted" || status !== "submitted") return;
		adoptionWindowOpenRef.current = true;
		for (const ms of [400, 1000, 2000]) {
			turnStartTimerRefs.current.push(
				setTimeout(() => {
					if (adoptionWindowOpenRef.current) void adoptAppendOnly();
				}, ms),
			);
		}
	}, [status, adoptAppendOnly]);
	useEffect(() => {
		const timers = turnStartTimerRefs;
		return () => {
			adoptionWindowOpenRef.current = false;
			timers.current.forEach(clearTimeout);
			timers.current = [];
		};
	}, []);

	const settleAnnouncedRef = useRef(false);
	const prevStatusRef = useRef(status);
	useEffect(() => {
		const transitioned = prevStatusRef.current !== "ready" && status === "ready";
		prevStatusRef.current = status;
		if (!transitioned) return;
		void syncTurns();
		// Canonize onto the record when our own turn's settle was announced,
		// so the previous message never shows twice.
		if (settleAnnouncedRef.current) {
			settleAnnouncedRef.current = false;
			void syncFromServer();
		}
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
			try {
				const res = await fetch(`/api/chats/${chatId}`);
				if (!res.ok || cancelled) return;
				const record = (await res.json()) as { turnInFlight?: boolean };
				if (cancelled) return;
				if (record.turnInFlight === true) setTurnInFlight(true);
				else void syncFromServer();
			} catch {
				/* transient — the banner stands; the next send heals */
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [status, chatId, syncFromServer]);

	// ── central jobs: one fetch drives every job surface ──
	const [jobs, setJobs] = useState<JobRecord[]>([]);
	const jobStatusRef = useRef<Map<string, string>>(new Map());
	const pendingSyncRef = useRef(false);
	const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const fetchJobsRef = useRef<() => void>(() => {});
	const fetchJobs = useCallback(async () => {
		try {
			const res = await fetch(`/api/jobs?chatId=${encodeURIComponent(chatId)}`);
			if (!res.ok) return;
			const data = (await res.json()) as { jobs?: JobRecord[]; turnInFlight?: boolean };
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
		} catch {
			/* transient — the next jobs-changed announcement re-fetches */
		}
	}, [chatId, syncFromServer, adoptAppendOnly]);
	fetchJobsRef.current = () => void fetchJobs();
	useEffect(() => {
		void fetchJobs();
	}, [fetchJobs]);
	useServerEvent("jobs-changed", (p) => {
		if (p.chatId != null && p.chatId !== chatId) return;
		if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
		fetchDebounceRef.current = setTimeout(() => {
			fetchDebounceRef.current = undefined;
			fetchJobsRef.current();
		}, 250);
	});
	useServerResync(() => fetchJobsRef.current());
	useEffect(
		() => () => {
			if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
		},
		[],
	);

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
	const [compacting, setCompacting] = useState(initiallyCompacting);
	useServerEvent("compaction-changed", (p) => {
		if (p.chatId !== chatId) return;
		setCompacting(p.running);
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
		syncFromServer,
		jobs,
		turns,
		pricing,
		compacting,
	};
}
