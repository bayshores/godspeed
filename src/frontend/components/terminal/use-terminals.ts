/**
 * The agents' terminals in the desktop app, shared by every surface: the
 * teacher's and the helper's latest terminal, starting and stopping them,
 * and the overlay that shows their screens. The overlay opens by itself
 * when the learner is needed (terminal-model.ts), never over a dialog,
 * once per reason, and without taking the keyboard: keys the learner was
 * typing elsewhere never reach an agent's question. The helper starts by itself once the teacher has
 * checked in and background jobs wait; the shell stops it with the teacher.
 * Outside the desktop app `available` is false and nothing here runs.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { FolderAgent } from "@/shared/core";
import { postAgentFolder, savedAgent } from "@/frontend/components/agent-folder/agent-folder-api";
import type { FolderView } from "@/frontend/components/agent-folder/agent-folder-model";
import { AgentStatusContext, type AgentStatus } from "@/frontend/components/agent-status";
import {
	CHECK_IN_WAIT_MS,
	OUTSIDE_REFUSAL,
	TEACH_WAIT_MS,
	helperShouldStart,
	needsYou,
	statusFromTerminals,
	teacherStartRefused,
	wakeAgent,
	type TerminalFacts,
	type TerminalRecord,
	type TerminalRole,
} from "./terminal-model";

type Records = Record<TerminalRole, TerminalRecord | null>;

export interface TerminalsApi {
	/** The desktop app runs terminals; false in a browser. */
	available: boolean;
	teacher: TerminalRecord | null;
	helper: TerminalRecord | null;
	/** What the words are made from; null when that role has no terminal. */
	facts: Record<TerminalRole, TerminalFacts | null>;
	/** The godspeed folder, short ("~/godspeed"). */
	folder: string;
	outsideHere: boolean;
	/** An agent is here to teach: one outside godspeed, or godspeed's own
	 *  teacher, running and checked in. */
	agentHere: boolean;
	/** The shell's first list of terminals has answered. */
	loaded: boolean;
	/** The overlay's tab, or null while it is hidden. */
	overlay: TerminalRole | null;
	/** The learner opened it: the screen takes the keyboard. Opened by
	 *  itself, it waits for a click in the screen. */
	focusOnOpen: boolean;
	/** Onboarding shows the teacher's screen in its step instead. */
	inline: boolean;
	/** The learner opens a screen. */
	show: (role: TerminalRole) => void;
	/** Onboarding's step shows the teacher's screen (on) or stops (off). */
	showInline: (on: boolean) => void;
	hide: () => void;
	/** Resolves to why it couldn't start, or null. */
	start: (role: TerminalRole, agent: FolderAgent) => Promise<string | null>;
	stop: (role: TerminalRole) => void;
	/** These resolve to why the shell refused, or null. */
	answer: (role: TerminalRole, kind: "trust" | "enter") => Promise<string | null>;
	paste: (role: TerminalRole) => Promise<string | null>;
	/** Start lesson and a Talk send: start the teacher hidden when it may (wakeAgent). */
	wake: () => void;
}

const UNSTARTED = "Couldn't start the agent. Try again.";
const ROLES: readonly TerminalRole[] = ["teacher", "helper"];

/** A start's error: the shell rejects with a sentence. */
const reason = (err: unknown): string => (typeof err === "string" && err ? err : err instanceof Error && err.message ? err.message : UNSTARTED);

/** A shell refusal's sentence, or null when it went through. */
const refusal = (p: Promise<void> | undefined): Promise<string | null> => (p ?? Promise.resolve()).then(() => null, (err: unknown) => (typeof err === "string" ? err : null));

/** Another modal dialog is open: the overlay waits for it to close. */
const dialogOpen = () => !!document.querySelector('[aria-modal="true"]:not([data-terminal-overlay])');

function useTerminalsState(status: AgentStatus | null): TerminalsApi {
	const lh = typeof window === "undefined" ? undefined : window.lh?.terminals;
	const [records, setRecords] = useState<Records>({ teacher: null, helper: null });
	// The first list has answered: before it, no record says whether an agent runs.
	const [loaded, setLoaded] = useState(false);
	const [folder, setFolder] = useState("~/godspeed");
	const [shown, setShown] = useState<{ role: TerminalRole; focus: boolean; inline: boolean } | null>(null);
	const overlay = shown?.role ?? null;
	// The terminals that have checked in at least once.
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	const [quietSince, setQuietSince] = useState<number | null>(null);
	// Re-renders when a timer crosses its threshold, or to look for a closed dialog again.
	const [tick, bump] = useReducer((n: number) => n + 1, 0);

	// A late list answer never replaces a newer record, nor the pushed state
	// of the same one; but an end always wins, in whichever order it comes.
	const put = useCallback(
		(term: TerminalRecord) =>
			setRecords((r) => {
				const cur = r[term.role];
				if (cur?.id === term.id) return term.ended && !cur.ended ? { ...r, [term.role]: { ...cur, ended: term.ended, prompt: term.prompt, url: term.url } } : r;
				return cur && cur.startedAt > term.startedAt ? r : { ...r, [term.role]: term };
			}),
		[],
	);
	const known = useRef(records);
	useEffect(() => {
		known.current = records;
	}, [records]);

	useEffect(() => {
		if (!lh) return;
		let on = true;
		const load = () =>
			lh.list().then((list) => {
				if (!on) return;
				for (const role of ROLES) {
					const latest = list.filter((t) => t.role === role).sort((a, b) => b.startedAt - a.startedAt)[0];
					if (latest) put(latest);
				}
			}).catch(() => {/* the next push tries again */}).finally(() => on && setLoaded(true));
		void load();
		// A push names only the terminal; one this page has not seen yet comes from the list.
		const off = lh.onState((s) => {
			const role = ROLES.find((r) => known.current[r]?.id === s.id);
			if (!role) return void load();
			setRecords((r) => {
				const old = r[role];
				return old?.id === s.id ? { ...r, [role]: { ...old, ended: s.ended, prompt: s.prompt, url: s.url } } : r;
			});
		});
		fetch("/api/agent-folder", { cache: "no-store" })
			.then((res) => (res.ok ? (res.json() as Promise<FolderView>) : null))
			.then((v) => v && on && setFolder(v.short))
			.catch(() => {/* a start sets it */});
		return () => {
			on = false;
			off();
		};
	}, [lh, put]);

	const here = useCallback((id: string | undefined) => !!id && !!status?.terminals?.some((t) => t.id === id && t.here), [status]);
	const teacher = records.teacher;
	const helper = records.helper;
	const teacherLive = !!teacher && !teacher.ended;
	useEffect(() => {
		const fresh = ROLES.map((role) => records[role]?.id).filter((id): id is string => here(id) && !checked.has(id!));
		if (fresh.length > 0) setChecked((s) => new Set([...s, ...fresh]));
	}, [records, here, checked]);
	const checkedIn = useCallback((id: string | undefined) => here(id) || (!!id && checked.has(id)), [here, checked]);
	const teacherCheckedIn = checkedIn(teacher?.id);
	const outsideHere = !!status?.outsideHere;

	// The teacher checked in and is not teaching while a lesson or Talk turn waits.
	const quiet = teacherLive && teacherCheckedIn && !!status && !status.teaching && status.pendingTurns > 0;
	useEffect(() => setQuietSince((since) => (quiet ? (since ?? Date.now()) : null)), [quiet]);

	const facts = useMemo(() => {
		const now = Date.now();
		const of = (term: TerminalRecord | null): TerminalFacts | null =>
			term && {
				term,
				checkedIn: checkedIn(term.id),
				outsideHere,
				teaching: !!status?.teaching,
				now,
				quietSince: term.role === "teacher" ? quietSince : null,
				helperBusy: !!status && status.pendingWork > status.pendingTurns,
			};
		return { teacher: of(teacher), helper: of(helper) };
		// tick: a timer crossed its threshold, so `now` must move.
	}, [teacher, helper, checkedIn, outsideHere, status, quietSince, tick]);

	// The system holds a background window's timers back, so the window
	// coming back looks again: a reason that came due meanwhile shows at once.
	useEffect(() => {
		if (!lh) return;
		const look = () => document.visibilityState !== "hidden" && bump();
		document.addEventListener("visibilitychange", look);
		window.addEventListener("focus", look);
		return () => {
			document.removeEventListener("visibilitychange", look);
			window.removeEventListener("focus", look);
		};
	}, [lh]);

	// Wake at the next threshold a timer crosses.
	useEffect(() => {
		const at = [teacherLive && !teacherCheckedIn && teacher ? teacher.startedAt + CHECK_IN_WAIT_MS : null, quietSince === null ? null : quietSince + TEACH_WAIT_MS]
			.filter((t): t is number => t !== null && t > Date.now());
		if (at.length === 0) return;
		const t = setTimeout(bump, Math.min(...at) - Date.now() + 50);
		return () => clearTimeout(t);
	}, [teacher, teacherLive, teacherCheckedIn, quietSince]);

	// The overlay opens by itself once per reason, never over a dialog. A
	// reason that shows while its screen is open counts as seen.
	const fired = useRef(new Set<string>());
	useEffect(() => {
		const reasons = new Map<string, TerminalRole>();
		for (const role of ROLES) {
			const f = facts[role];
			const why = f && needsYou(f);
			if (f && why) reasons.set(`${f.term.id}:${why}`, role);
		}
		for (const key of fired.current) if (!reasons.has(key)) fired.current.delete(key);
		for (const [key, role] of reasons) if (overlay === role) fired.current.add(key);
		const next = [...reasons].find(([key]) => !fired.current.has(key));
		if (!next || overlay) return;
		if (dialogOpen()) {
			const t = setTimeout(bump, 1000);
			return () => clearTimeout(t);
		}
		fired.current.add(next[0]);
		// Never over what shows already (onboarding's step may have just shown its screen).
		setShown((cur) => cur ?? { role: next[1], focus: false, inline: false });
	}, [facts, overlay]);

	const start = useCallback(
		async (role: TerminalRole, agent: FolderAgent): Promise<string | null> => {
			if (!lh) return UNSTARTED;
			let view: FolderView;
			try {
				view = await postAgentFolder({ action: "setup" });
			} catch (err) {
				return reason(err);
			}
			setFolder(view.short);
			try {
				const { id } = await lh.start(role, agent);
				setRecords((r) => (r[role]?.id === id ? r : { ...r, [role]: { id, role, agent, startedAt: Date.now(), ended: null, prompt: null, url: false } }));
				return null;
			} catch (err) {
				return reason(err);
			}
		},
		[lh],
	);

	const refused = teacherStartRefused(teacher, !!status?.outsideHere);
	const startRole = useCallback(
		async (role: TerminalRole, agent: FolderAgent) => {
			if (role === "teacher" && refused === "running") {
				setShown({ role: "teacher", focus: true, inline: false });
				return null;
			}
			if (role === "teacher" && refused === "outside") {
				// The folder is still set up: "Set up my folder" does its part.
				try {
					setFolder((await postAgentFolder({ action: "setup" })).short);
				} catch (err) {
					return reason(err);
				}
				return OUTSIDE_REFUSAL;
			}
			return start(role, agent);
		},
		[refused, start],
	);

	// The helper starts by itself, once per teacher run.
	const helperTried = useRef<string | null>(null);
	const helperWanted =
		!!lh &&
		helperShouldStart({
			teacher,
			teacherCheckedIn,
			helper,
			helperHere: !!status?.helperHere,
			backgroundWaiting: status ? status.pendingWork - status.pendingTurns : 0,
		});
	useEffect(() => {
		if (!helperWanted || !teacher || helperTried.current === teacher.id) return;
		helperTried.current = teacher.id;
		void start("helper", teacher.agent);
	}, [helperWanted, teacher, start]);

	const idOf = useCallback((role: TerminalRole) => records[role]?.id, [records]);
	const stop = useCallback(
		(role: TerminalRole) => {
			const id = idOf(role);
			if (id) lh?.stop(id).catch(() => {/* it has ended already */});
		},
		[idOf, lh],
	);
	const answer = useCallback(
		(role: TerminalRole, kind: "trust" | "enter") => {
			const id = idOf(role);
			return refusal(id ? lh?.answer(id, kind) : undefined);
		},
		[idOf, lh],
	);
	const paste = useCallback(
		(role: TerminalRole) => {
			const id = idOf(role);
			return refusal(id ? lh?.paste(id) : undefined);
		},
		[idOf, lh],
	);
	const show = useCallback((role: TerminalRole) => setShown({ role, focus: true, inline: false }), []);
	const showInline = useCallback((on: boolean) => setShown(on ? { role: "teacher", focus: false, inline: true } : null), []);
	const hide = useCallback(() => setShown(null), []);
	// The server's `connected` lasts up to 3 minutes after a terminal ended; the terminals know at once.
	const agentHere = outsideHere || (teacherLive && teacherCheckedIn);
	// Two sends close together start one teacher: the second comes before the first start's record.
	const waking = useRef(false);
	const wake = useCallback(() => {
		const agent = lh && loaded && !waking.current && wakeAgent({ teacher, agentHere, outsideHere, saved: savedAgent() });
		if (!agent) return;
		waking.current = true;
		void start("teacher", agent).finally(() => {
			waking.current = false;
		});
	}, [lh, loaded, teacher, agentHere, outsideHere, start]);

	const focusOnOpen = !!shown?.focus;
	const inline = !!shown?.inline;
	return useMemo(
		() => ({ available: !!lh, teacher, helper, facts, folder, outsideHere, agentHere, loaded, overlay, focusOnOpen, inline, show, showInline, hide, start: startRole, stop, answer, paste, wake }),
		[lh, teacher, helper, facts, folder, outsideHere, agentHere, loaded, overlay, focusOnOpen, inline, show, showInline, hide, startRole, stop, answer, paste, wake],
	);
}

/** Whether an agent is here to teach: in the desktop app from its
 *  terminals, else from the server. Null before the first read of either. */
export function agentHereNow(status: AgentStatus | null, terminals: TerminalsApi | null): boolean | null {
	if (!status) return null;
	if (!terminals?.available) return status.connected || status.teaching;
	return terminals.loaded ? terminals.agentHere : null;
}

const TerminalsContext = createContext<TerminalsApi | null>(null);

/** Every surface below reads the agent's status as the terminals correct it. */
export function TerminalsProvider({ status, children }: { status: AgentStatus | null; children: ReactNode }) {
	const api = useTerminalsState(status);
	const shown = useMemo(() => statusFromTerminals(status, api.teacher, api.agentHere), [status, api.teacher, api.agentHere]);
	return createElement(TerminalsContext.Provider, { value: api }, createElement(AgentStatusContext.Provider, { value: shown }, children));
}

/** The terminals; null outside the provider. */
export function useTerminals(): TerminalsApi | null {
	return useContext(TerminalsContext);
}
