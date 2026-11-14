/**
 * The agents' terminals in the desktop app, shared by every surface: the
 * teacher's and the helper's latest terminal, starting and stopping them,
 * and the overlay that shows their screens. The overlay opens by itself
 * when the learner is needed (terminal-model.ts), never over a dialog,
 * and once per reason. The helper starts by itself once the teacher has
 * checked in and background jobs wait, and stops with the teacher.
 * Outside the desktop app `available` is false and nothing here runs.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { FolderAgent } from "@/shared/core";
import { postAgentFolder } from "@/frontend/components/agent-folder/use-agent-folder";
import type { FolderView } from "@/frontend/components/agent-folder/agent-folder-model";
import {
	CHECK_IN_WAIT_MS,
	TEACH_WAIT_MS,
	helperShouldStart,
	needsYou,
	teacherStartRefused,
	type TerminalFacts,
	type TerminalRecord,
	type TerminalRole,
} from "./terminal-model";

/** What /api/mcp-access says that the terminals need. */
export interface TerminalAccess {
	teaching: boolean;
	helperHere: boolean;
	pendingWork: number;
	pendingTurns: number;
	/** The live terminals, and whether each checked in within 3 minutes. */
	terminals: { id: string; here: boolean }[];
	/** An agent with no terminal id checked in within 3 minutes. */
	outsideHere: boolean;
}

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
	/** The overlay's tab, or null while it is hidden. */
	overlay: TerminalRole | null;
	show: (role: TerminalRole) => void;
	hide: () => void;
	/** Resolves to why it couldn't start, or null. */
	start: (role: TerminalRole, agent: FolderAgent) => Promise<string | null>;
	stop: (role: TerminalRole) => void;
	/** These resolve to why the shell refused, or null. */
	answer: (role: TerminalRole, kind: "trust" | "enter") => Promise<string | null>;
	paste: (role: TerminalRole) => Promise<string | null>;
}

const UNSTARTED = "Couldn't start the agent. Try again.";
const ROLES: readonly TerminalRole[] = ["teacher", "helper"];

/** A start's error: the shell rejects with a sentence. */
const reason = (err: unknown): string => (typeof err === "string" && err ? err : err instanceof Error && err.message ? err.message : UNSTARTED);

/** A shell refusal's sentence, or null when it went through. */
const refusal = (p: Promise<void> | undefined): Promise<string | null> => (p ?? Promise.resolve()).then(() => null, (err: unknown) => (typeof err === "string" ? err : null));

/** Another modal dialog is open: the overlay waits for it to close. */
const dialogOpen = () => !!document.querySelector('[aria-modal="true"]:not([data-terminal-overlay])');

function useTerminalsState(status: TerminalAccess | null): TerminalsApi {
	const lh = typeof window === "undefined" ? undefined : window.lh?.terminals;
	const [records, setRecords] = useState<Records>({ teacher: null, helper: null });
	const [folder, setFolder] = useState("~/godspeed");
	const [overlay, setOverlay] = useState<TerminalRole | null>(null);
	const [quietSince, setQuietSince] = useState<number | null>(null);
	// Re-renders when a timer crosses its threshold, or to look for a closed dialog again.
	const [tick, bump] = useReducer((n: number) => n + 1, 0);

	const put = useCallback((term: TerminalRecord) => setRecords((r) => ({ ...r, [term.role]: term })), []);
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
			}).catch(() => {/* the next push tries again */});
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

	const here = useCallback((id: string | undefined) => !!id && !!status?.terminals.some((t) => t.id === id && t.here), [status]);
	const teacher = records.teacher;
	const helper = records.helper;
	const teacherLive = !!teacher && !teacher.ended;
	const teacherHere = here(teacher?.id);

	// The teacher is here, not teaching, while a lesson or Talk turn waits.
	const quiet = teacherLive && teacherHere && !!status && !status.teaching && status.pendingTurns > 0;
	useEffect(() => setQuietSince((since) => (quiet ? (since ?? Date.now()) : null)), [quiet]);

	const facts = useMemo(() => {
		const now = Date.now();
		const of = (term: TerminalRecord | null): TerminalFacts | null =>
			term && {
				term,
				here: here(term.id),
				teaching: !!status?.teaching,
				now,
				quietSince: term.role === "teacher" ? quietSince : null,
				helperBusy: !!status && status.pendingWork > status.pendingTurns,
			};
		return { teacher: of(teacher), helper: of(helper) };
		// tick: a timer crossed its threshold, so `now` must move.
	}, [teacher, helper, here, status, quietSince, tick]);

	// Wake at the next threshold a timer crosses.
	useEffect(() => {
		const at = [teacherLive && !teacherHere && teacher ? teacher.startedAt + CHECK_IN_WAIT_MS : null, quietSince === null ? null : quietSince + TEACH_WAIT_MS]
			.filter((t): t is number => t !== null && t > Date.now());
		if (at.length === 0) return;
		const t = setTimeout(bump, Math.min(...at) - Date.now() + 50);
		return () => clearTimeout(t);
	}, [teacher, teacherLive, teacherHere, quietSince]);

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
		setOverlay(next[1]);
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
				const { id } = await lh.start(role, agent, view.folder);
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
				setOverlay("teacher");
				return null;
			}
			if (role === "teacher" && refused === "outside") return null;
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
			teacherHere,
			helper,
			helperHere: !!status?.helperHere,
			backgroundWaiting: status ? status.pendingWork - status.pendingTurns : 0,
		});
	useEffect(() => {
		if (!helperWanted || !teacher || helperTried.current === teacher.id) return;
		helperTried.current = teacher.id;
		void start("helper", teacher.agent);
	}, [helperWanted, teacher, start]);

	// The helper stops with the teacher.
	const helperLive = !!helper && !helper.ended;
	useEffect(() => {
		if (teacher?.ended && helperLive && helper) lh?.stop(helper.id).catch(() => {/* it has ended already */});
	}, [teacher?.ended, helperLive, helper, lh]);

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
	const hide = useCallback(() => setOverlay(null), []);

	const outsideHere = !!status?.outsideHere;
	return useMemo(
		() => ({ available: !!lh, teacher, helper, facts, folder, outsideHere, overlay, show: setOverlay, hide, start: startRole, stop, answer, paste }),
		[lh, teacher, helper, facts, folder, outsideHere, overlay, hide, startRole, stop, answer, paste],
	);
}

const TerminalsContext = createContext<TerminalsApi | null>(null);

export function TerminalsProvider({ status, children }: { status: TerminalAccess | null; children: ReactNode }) {
	return createElement(TerminalsContext.Provider, { value: useTerminalsState(status) }, children);
}

/** The terminals; null outside the provider. */
export function useTerminals(): TerminalsApi | null {
	return useContext(TerminalsContext);
}
