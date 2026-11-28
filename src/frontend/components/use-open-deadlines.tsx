/**
 * The deadlines of every space not closed (GET /api/deadlines): the open
 * ones, for Home and the welcome screen, and the ones
 * ticked done today, which Home keeps with Undo, and the gaps: spaces that
 * look to be missing a deadline. One shared read in
 * OpenDeadlinesProvider: it re-reads when spaces change (every deadline
 * edit announces spaces-changed), after the events channel reconnects and
 * when the day changes in an open window (a gap depends on today).
 * `markDone` ticks one done and `undo` unticks it (PUT done); a save that
 * fails says so in a notice. One being ticked is named for a moment
 * (`useDoneMoment`): a Done block first drawn then prints its stamp, and
 * the done sound plays with it.
 * `useAnswerGap` waves a gap off.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { localDay, readGaps, type SpaceGap } from "@/shared/core";
import { useMinute } from "@/frontend/components/countdown";
import type { OpenDeadline } from "@/frontend/components/deadlines-model";
import { DoneNotice } from "@/frontend/components/done-notice";
import { useJustNow } from "@/frontend/components/presence";
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
	/** The id of the deadline being ticked done, from the click until its moment is over. */
	justDone: string | null;
	/** True once for each ticked deadline, however many blocks draw it. */
	claimDoneSound: (id: string) => boolean;
	/** Save a deadline's done and read the lists again; `failed` is the
	 *  notice when the save doesn't work. Settles once the lists are read. */
	setDone: (d: DeadlineRef, done: boolean, failed: string) => Promise<void>;
}

const OpenDeadlinesContext = createContext<SharedDeadlines>({ fetched: null, error: null, load: async () => {}, justDone: null, claimDoneSound: () => false, setDone: async () => {} });

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
	const [justDone, setJustDone] = useJustNow();
	const sounded = useRef<string | null>(null);
	useEffect(() => {
		if (justDone === null) sounded.current = null;
	}, [justDone]);
	const claimDoneSound = useCallback((id: string) => {
		if (sounded.current === id) return false;
		sounded.current = id;
		return true;
	}, []);
	// The deadlines whose save is out: a second click on the same key sends nothing.
	const saving = useRef(new Set<string>());
	const setDone = useCallback(
		async (d: DeadlineRef, done: boolean, failed: string) => {
			if (saving.current.has(d.id)) return;
			saving.current.add(d.id);
			setNotice(null);
			// Named before the save, so no read can draw it done before it is named. Three reads hold a
			// deadline's done (these lists, progress, the space's record) and answer in any order.
			const unname = (named: string | null) => (named === d.id ? null : named);
			setJustDone(done ? d.id : unname);
			const { error } = await send(`/api/spaces/${encodeURIComponent(d.spaceId)}/deadlines/${encodeURIComponent(d.id)}`, jsonInit("PUT", { done }));
			if (error) {
				setNotice(failed);
				setJustDone(unname);
			} else await load();
			saving.current.delete(d.id);
		},
		[load, setJustDone],
	);

	const value = useMemo(() => ({ fetched, error, load, justDone, claimDoneSound, setDone }), [fetched, error, load, justDone, claimDoneSound, setDone]);
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
	/** Both settle once the save is read back. */
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
 * For a Done block, decided when it is first drawn: whether its deadline is the one being ticked.
 * Then its stamp prints and the done sound plays with it. A block drawn for a deadline done before
 * is at rest.
 */
export function useDoneMoment(id: string): boolean {
	const { justDone, claimDoneSound } = useContext(OpenDeadlinesContext);
	const play = useSound();
	const [fresh] = useState(justDone === id);
	useEffect(() => {
		if (fresh && claimDoneSound(id)) play("done");
	}, [fresh, id, claimDoneSound, play]);
	return fresh;
}
