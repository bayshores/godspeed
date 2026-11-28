/**
 * The deadlines of every space not closed (GET /api/deadlines): the open
 * ones, for Home and the welcome screen, and the ones
 * ticked done today, which Home keeps with Undo, and the gaps: spaces that
 * look to be missing a deadline. One shared read in
 * OpenDeadlinesProvider: it re-reads when spaces change (every deadline
 * edit announces spaces-changed), after the events channel reconnects and
 * when the day changes in an open window (a gap depends on today).
 * `markDone` ticks one done and `undo` unticks it (PUT done); a save that
 * fails says so in a notice. Each one being ticked is named for its moment
 * (`useDoneMoment`): a Done block first drawn then prints its stamp, and
 * the done sound plays with it.
 * `useAnswerGap` waves a gap off.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { localDay, readGaps, type SpaceGap } from "@/shared/core";
import { useMinute } from "@/frontend/components/countdown";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { DoneNotice } from "@/frontend/components/done-notice";
import { MOMENT_MS } from "@/frontend/components/presence";
import { useSound } from "@/frontend/components/sounds";
import { useGuardedAction } from "@/frontend/components/use-guarded-action";
import { useServerResource } from "@/frontend/components/use-server-resource";
import { jsonInit, send, type WriteResult } from "@/frontend/lib/api";

interface Fetched {
	open: OpenDeadline[];
	doneToday: OpenDeadline[];
	/** The overdue ones the learner already answered Not yet to. */
	overdueAsked: string[];
	gaps: SpaceGap[];
}

/** The deadline a save names. */
type DeadlineRef = Pick<OpenDeadline, "spaceId" | "id">;

interface SharedDeadlines {
	/** null until the first response. */
	fetched: Fetched | null;
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	load: () => Promise<void>;
	/** Whether this deadline is being ticked done: from the click until MOMENT_MS after its save was read back. */
	tickedNow: (id: string) => boolean;
	/** True once for each tick, however many blocks draw the deadline. */
	claimDoneSound: (id: string) => boolean;
	/** Save a deadline's done and read the lists again; `failed` is the
	 *  notice when the save doesn't work. Settles once the lists are read. */
	setDone: (d: DeadlineRef, done: boolean, failed: string) => Promise<void>;
}

const OpenDeadlinesContext = createContext<SharedDeadlines>({ fetched: null, error: null, load: async () => {}, tickedNow: () => false, claimDoneSound: () => false, setDone: async () => {} });

export function OpenDeadlinesProvider({ children }: { children: React.ReactNode }) {
	// A failed read keeps what we have; the error only matters before a first list.
	const { value: read, error, reload: load } = useServerResource<{ deadlines?: OpenDeadline[]; doneToday?: OpenDeadline[]; overdueAsked?: string[]; gaps?: unknown }>("/api/deadlines", {
		on: { "spaces-changed": true },
	});
	const fetched = useMemo<Fetched | null>(
		() =>
			read && {
				open: Array.isArray(read.deadlines) ? read.deadlines : [],
				doneToday: Array.isArray(read.doneToday) ? read.doneToday : [],
				overdueAsked: Array.isArray(read.overdueAsked) ? read.overdueAsked : [],
				gaps: readGaps(read.gaps),
			},
		[read],
	);

	// A gap depends on today, so a window left open overnight reads again once the day turns.
	const minute = useMinute();
	const day = minute === null ? null : localDay(minute);
	const lastDay = useRef(day);
	useEffect(() => {
		const before = lastDay.current;
		if (day === before) return;
		lastDay.current = day;
		if (before !== null) void load();
	}, [day, load]);

	const [notice, setNotice] = useState<string | null>(null);
	const clearNotice = useCallback(() => setNotice(null), []);
	// The deadlines being ticked done, each with whether its done sound has played and the timer that
	// ends its moment. One is named at the click, so no read can draw it done before it is named
	// (three reads hold a deadline's done: these lists, progress and the space's record, and they
	// answer in any order), and its moment is counted from when its save was read back.
	const ticked = useRef(new Map<string, { sounded: boolean; over: ReturnType<typeof setTimeout> | null }>());
	const unname = useCallback((id: string) => {
		const over = ticked.current.get(id)?.over;
		if (over) clearTimeout(over);
		ticked.current.delete(id);
	}, []);
	useEffect(() => {
		const named = ticked.current;
		return () => [...named.keys()].forEach(unname);
	}, [unname]);
	const tickedNow = useCallback((id: string) => ticked.current.has(id), []);
	const claimDoneSound = useCallback((id: string) => {
		const tick = ticked.current.get(id);
		if (!tick || tick.sounded) return false;
		tick.sounded = true;
		return true;
	}, []);
	// The deadlines whose save is out: a second click on the same key sends nothing.
	const saving = useRef(new Set<string>());
	const setDone = useCallback(
		async (d: DeadlineRef, done: boolean, failed: string) => {
			if (saving.current.has(d.id)) return;
			saving.current.add(d.id);
			try {
				setNotice(null);
				unname(d.id);
				const tick = { sounded: false, over: null as ReturnType<typeof setTimeout> | null };
				if (done) ticked.current.set(d.id, tick);
				const { error } = await send(`/api/spaces/${encodeURIComponent(d.spaceId)}/deadlines/${encodeURIComponent(d.id)}`, jsonInit("PUT", { done }));
				if (error) {
					setNotice(failed);
					unname(d.id);
					return;
				}
				await load();
				if (done) tick.over = setTimeout(() => unname(d.id), MOMENT_MS);
			} finally {
				saving.current.delete(d.id);
			}
		},
		[load, unname],
	);

	const value = useMemo(() => ({ fetched, error, load, tickedNow, claimDoneSound, setDone }), [fetched, error, load, tickedNow, claimDoneSound, setDone]);
	return (
		<OpenDeadlinesContext.Provider value={value}>
			{children}
			{notice && <DoneNotice text={notice} onExpire={clearNotice} />}
		</OpenDeadlinesContext.Provider>
	);
}

interface OpenDeadlinesState {
	/** The open deadlines; null until the first response. */
	deadlines: OpenDeadline[] | null;
	/** The ones ticked done today. */
	doneToday: OpenDeadline[];
	/** The overdue ones the learner already answered Not yet to. */
	overdueAsked: string[];
	/** The spaces that look to be missing a deadline, one each. */
	gaps: SpaceGap[];
	/** Why the last read failed; null once one succeeds. */
	error: string | null;
	/** Both settle once the save is read back, or at once, sending nothing, while that deadline's save is still out. */
	markDone: (d: DeadlineRef) => Promise<void>;
	undo: (d: DeadlineRef) => Promise<void>;
	/** Wave a space's gap off (its key), then read the lists again; the error line, or null. */
	answerGap: (gap: Pick<SpaceGap, "spaceId" | "key">) => Promise<WriteResult>;
	/** Read the lists again now (Try again). */
	reload: () => Promise<void>;
}

const NONE: OpenDeadline[] = [];
const NO_IDS: string[] = [];
const NO_GAPS: SpaceGap[] = [];

export function useOpenDeadlines(): OpenDeadlinesState {
	const { fetched, error, load, setDone } = useContext(OpenDeadlinesContext);
	const markDone = useCallback((d: DeadlineRef) => setDone(d, true, "Couldn't mark it done. Try again."), [setDone]);
	const undo = useCallback((d: DeadlineRef) => setDone(d, false, "Couldn't undo that. Try again."), [setDone]);
	const answerGap = useCallback(
		async ({ spaceId, key }: Pick<SpaceGap, "spaceId" | "key">): Promise<WriteResult> => {
			const { error: failed } = await send(`/api/deadlines/${encodeURIComponent(spaceId)}/nothing-new`, jsonInit("POST", { key }));
			if (!failed) await load();
			return failed;
		},
		[load],
	);
	return { deadlines: fetched?.open ?? null, doneToday: fetched?.doneToday ?? NONE, overdueAsked: fetched?.overdueAsked ?? NO_IDS, gaps: fetched?.gaps ?? NO_GAPS, error, markDone, undo, answerGap, reload: load };
}

/** A gap's quiet key: wave it off once at a time; `error` is the failure line, or null. */
export function useAnswerGap(gap: Pick<SpaceGap, "spaceId" | "key">) {
	const { answerGap } = useOpenDeadlines();
	const { run, busy, error } = useGuardedAction();
	return { answer: () => void run(() => answerGap(gap)), busy, error };
}

/**
 * For a Done block, decided when it is first drawn: whether its deadline is being ticked. Then its
 * stamp prints and the done sound plays with it. A block drawn for a deadline done before is at
 * rest. The block is keyed by its deadline, so one handed another deadline decides again.
 */
export function useDoneMoment(id: string): boolean {
	const { tickedNow, claimDoneSound } = useContext(OpenDeadlinesContext);
	const play = useSound();
	const [fresh] = useState(() => tickedNow(id));
	useEffect(() => {
		if (fresh && claimDoneSound(id)) play("done");
	}, [fresh, id, claimDoneSound, play]);
	return fresh;
}
