/**
 * The agents' terminals in the desktop app, shared by every surface: the
 * teacher's latest terminal, and starting and stopping it. Lessons, jobs and
 * the teacher panel's chat run without it. The panel's chat can pop out into
 * a window of its own (`popped`), which the shell still calls the terminal
 * window. Outside the desktop app `available` is false and nothing here runs.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { FolderAgent } from "@/shared/core";
import { useAgentFolderView } from "@/frontend/components/agent-folder/agent-folder-context";
import { AgentStatusContext, type AgentStatus } from "@/frontend/components/agent-status";
import { readBase64 } from "@/frontend/lib/read-base64";
import {
	ATTACH_MAX_BYTES,
	ATTACH_TOO_BIG,
	CHECK_IN_WAIT_MS,
	OUTSIDE_REFUSAL,
	statusFromTerminals,
	teacherStartRefused,
	type TerminalFacts,
	type TerminalRecord,
} from "./terminal-model";

interface TerminalsApi {
	/** The desktop app runs terminals; false in a browser. */
	available: boolean;
	teacher: TerminalRecord | null;
	/** What the teacher's words are made from; null with no terminal. */
	facts: TerminalFacts | null;
	/** The godspeed folder, short ("~/godspeed"). */
	folder: string;
	outsideHere: boolean;
	/** An agent is here to teach: one outside godspeed, or godspeed's own
	 *  teacher, running and checked in. */
	agentHere: boolean;
	/** The shell's first list of terminals has answered. */
	loaded: boolean;
	/** Resolves to why it couldn't start, or null. */
	start: (agent: FolderAgent) => Promise<string | null>;
	stop: () => void;
	/** These resolve to why the shell refused, or null. */
	answer: (kind: "trust" | "enter") => Promise<string | null>;
	paste: () => Promise<string | null>;
	/** Attach on the teacher's screen: the file's path typed into its input. */
	addFile: (file: File) => Promise<string | null>;
	/** The panel's chat is in its own window, which the main window hears of. */
	popped: boolean;
	/** Pops the panel's chat out, or brings its window forward, titled with the teacher's name.
	 *  Resolves to why the shell refused, or null. Null where there is no such window to make: a
	 *  browser, an older shell, the window itself. */
	popOut: ((name: string) => Promise<string | null>) | null;
	/** Brings the chat's window forward. */
	focusWindow: () => void;
	/** Closes the chat's window and has the main window's panel show the chat again. */
	putBack: () => void;
	/** How many times a page asked for that: the panel shows its chat at each. */
	putBacks: number;
}

const UNSTARTED = "Couldn't turn the teacher on. Try again.";

/** A start's error: the shell rejects with a sentence. */
const reason = (err: unknown): string => (typeof err === "string" && err ? err : err instanceof Error && err.message ? err.message : UNSTARTED);

const ATTACH_UNREAD = "godspeed couldn't read that file.";

/** A shell refusal's sentence, or null when it went through. */
const refusal = (p: Promise<void> | undefined): Promise<string | null> => (p ?? Promise.resolve()).then(() => null, (err: unknown) => (typeof err === "string" ? err : null));

function useTerminalsState(status: AgentStatus | null, inTerminalWindow: boolean): TerminalsApi {
	const lh = typeof window === "undefined" ? undefined : window.lh?.terminals;
	const windowLh = typeof window === "undefined" ? undefined : window.lh?.terminalWindow;
	const [teacher, setTeacher] = useState<TerminalRecord | null>(null);
	// The first list has answered: before it, no record says whether an agent runs.
	const [loaded, setLoaded] = useState(false);
	const { view: folderView, post: postFolder } = useAgentFolderView();
	const folder = folderView?.short ?? "~/godspeed";
	// The terminals that have checked in at least once.
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	// Re-renders when a timer crosses its threshold, or to look for a closed dialog again.
	const [tick, bump] = useReducer((n: number) => n + 1, 0);

	// A late list answer never replaces a newer record, nor the pushed state
	// of the same one; but an end always wins, in whichever order it comes.
	const put = useCallback(
		(term: TerminalRecord) =>
			setTeacher((cur) => {
				if (cur?.id === term.id) return term.ended && !cur.ended ? { ...cur, ended: term.ended, prompt: term.prompt, url: term.url } : cur;
				return cur && cur.startedAt > term.startedAt ? cur : term;
			}),
		[],
	);
	const known = useRef(teacher);
	useEffect(() => {
		known.current = teacher;
	}, [teacher]);

	useEffect(() => {
		if (!lh) return;
		let on = true;
		const load = () =>
			lh.list().then((list) => {
				if (!on) return;
				const latest = [...list].sort((a, b) => b.startedAt - a.startedAt)[0];
				if (latest) put(latest);
			}).catch(() => {/* the next push tries again */}).finally(() => on && setLoaded(true));
		void load();
		// A push names only the terminal; one this page has not seen yet comes from the list.
		const off = lh.onState((s) => {
			if (known.current?.id !== s.id) return void load();
			setTeacher((old) => (old?.id === s.id ? { ...old, ended: s.ended, prompt: s.prompt, url: s.url } : old));
		});
		return () => {
			on = false;
			off();
		};
	}, [lh, put]);

	// Only the main window hears whether the chat's window is open (the shell also says so after
	// each load of this page).
	const [popped, setPopped] = useState(false);
	const [putBacks, countPutBack] = useReducer((n: number) => n + 1, 0);
	useEffect(() => {
		if (!windowLh || inTerminalWindow) return;
		return windowLh.onChange(({ open, back }) => {
			setPopped(open);
			if (back) countPutBack();
		});
	}, [windowLh, inTerminalWindow]);
	const popOut = useMemo(() => (windowLh && !inTerminalWindow ? (name: string) => refusal(windowLh.open(name)) : null), [windowLh, inTerminalWindow]);
	// A window closed or not open any more is what these wanted.
	const focusWindow = useCallback(() => void windowLh?.focus().catch(() => {/* it closed since */}), [windowLh]);
	const putBack = useCallback(() => void windowLh?.close().catch(() => {/* it is gone already */}), [windowLh]);

	const here = useCallback((id: string | undefined) => !!id && !!status?.terminals?.some((t) => t.id === id && t.here), [status]);
	const teacherLive = !!teacher && !teacher.ended;
	useEffect(() => {
		const id = teacher?.id;
		if (id && here(id) && !checked.has(id)) setChecked((s) => new Set([...s, id]));
	}, [teacher, here, checked]);
	const checkedIn = useCallback((id: string | undefined) => here(id) || (!!id && checked.has(id)), [here, checked]);
	const teacherCheckedIn = checkedIn(teacher?.id);
	const outsideHere = !!status?.outsideHere;

	const facts = useMemo(
		(): TerminalFacts | null => teacher && { term: teacher, checkedIn: checkedIn(teacher.id), outsideHere, now: Date.now() },
		// tick: the check-in wait ran out, so `now` must move.
		[teacher, checkedIn, outsideHere, tick],
	);

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

	// Look again once the check-in wait runs out.
	useEffect(() => {
		const at = teacherLive && !teacherCheckedIn && teacher ? teacher.startedAt + CHECK_IN_WAIT_MS : null;
		if (at === null || at <= Date.now()) return;
		const t = setTimeout(bump, at - Date.now() + 50);
		return () => clearTimeout(t);
	}, [teacher, teacherLive, teacherCheckedIn]);

	const start = useCallback(
		async (agent: FolderAgent): Promise<string | null> => {
			if (!lh) return UNSTARTED;
			try {
				await postFolder({ action: "setup" });
			} catch (err) {
				return reason(err);
			}
			try {
				const { id } = await lh.start(agent);
				setTeacher((cur) => (cur?.id === id ? cur : { id, agent, startedAt: Date.now(), ended: null, prompt: null, url: false }));
				return null;
			} catch (err) {
				return reason(err);
			}
		},
		[lh, postFolder],
	);

	const refused = teacherStartRefused(teacher, !!status?.outsideHere);
	const startTeacher = useCallback(
		async (agent: FolderAgent) => {
			// Its screen shows where the start was asked for.
			if (refused === "running") return null;
			if (refused === "outside") {
				// The folder is still set up: "Set up my folder" does its part.
				try {
					await postFolder({ action: "setup" });
				} catch (err) {
					return reason(err);
				}
				return OUTSIDE_REFUSAL;
			}
			return start(agent);
		},
		[refused, start, postFolder],
	);

	const id = teacher?.id;
	const stop = useCallback(() => {
		if (id) lh?.stop(id).catch(() => {/* it has ended already */});
	}, [id, lh]);
	const answer = useCallback((kind: "trust" | "enter") => refusal(id ? lh?.answer(id, kind) : undefined), [id, lh]);
	const paste = useCallback(() => refusal(id ? lh?.paste(id) : undefined), [id, lh]);
	const addFile = useCallback(
		(file: File) => {
			if (!id || !lh) return Promise.resolve(null);
			if (file.size > ATTACH_MAX_BYTES) return Promise.resolve(ATTACH_TOO_BIG);
			return refusal(readBase64(file).then((data) => lh.addFile(id, file.name, data).then(() => undefined), () => Promise.reject(ATTACH_UNREAD)));
		},
		[id, lh],
	);
	// The server's `connected` lasts up to 3 minutes after a terminal ended; the terminals know at once.
	const agentHere = outsideHere || (teacherLive && teacherCheckedIn);

	return useMemo(
		() => ({ available: !!lh, teacher, facts, folder, outsideHere, agentHere, loaded, start: startTeacher, stop, answer, paste, addFile, popped, popOut, focusWindow, putBack, putBacks }),
		[lh, teacher, facts, folder, outsideHere, agentHere, loaded, startTeacher, stop, answer, paste, addFile, popped, popOut, focusWindow, putBack, putBacks],
	);
}

const TerminalsContext = createContext<TerminalsApi | null>(null);

/** Every surface below reads the agent's status as the terminals correct it. `inTerminalWindow`:
 *  this page is the terminal window, which starts nothing by itself. */
export function TerminalsProvider({ status, inTerminalWindow = false, children }: { status: AgentStatus | null; inTerminalWindow?: boolean; children: ReactNode }) {
	const api = useTerminalsState(status, inTerminalWindow);
	const shown = useMemo(() => statusFromTerminals(status, api.teacher, api.agentHere), [status, api.teacher, api.agentHere]);
	return createElement(TerminalsContext.Provider, { value: api }, createElement(AgentStatusContext.Provider, { value: shown }, children));
}

/** The terminals; null outside the provider. */
export function useTerminals(): TerminalsApi | null {
	return useContext(TerminalsContext);
}
