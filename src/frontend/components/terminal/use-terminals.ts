/**
 * The agents' terminals in the desktop app, shared by every surface: the
 * teacher's and the helper's latest terminal, and starting and stopping
 * them. The helper starts by itself once the teacher has checked in and
 * background jobs wait; the shell stops it with the teacher. The teacher's
 * earlier chats come along, to go back to one.
 * The teacher's terminal can pop out into a window of its own (`popped`);
 * the main window starts the helper and wakes the teacher, never that window.
 * Outside the desktop app `available` is false and nothing here runs.
 */
import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import type { FolderAgent } from "@/shared/core";
import { savedAgent } from "@/frontend/components/agent-folder/agent-folder-api";
import { useAgentFolderView } from "@/frontend/components/agent-folder/agent-folder-context";
import { AgentStatusContext, type AgentStatus } from "@/frontend/components/agent-status";
import { useServerEvent } from "@/frontend/components/server-events";
import { send as sendRequest } from "@/frontend/lib/api";
import { readBase64 } from "@/frontend/lib/read-base64";
import {
	ATTACH_MAX_BYTES,
	ATTACH_TOO_BIG,
	CHECK_IN_WAIT_MS,
	OUTSIDE_REFUSAL,
	TEACH_WAIT_MS,
	chatGone,
	helperShouldStart,
	statusFromTerminals,
	teacherStartRefused,
	wakeAgent,
	type TeacherChat,
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
	/** The teacher's earlier chats, newest first (only in the desktop app). */
	chats: readonly TeacherChat[];
	/** Resolves to why it couldn't start, or null. `resume`: the teacher's chat to go back to. */
	start: (role: TerminalRole, agent: FolderAgent, resume?: string) => Promise<string | null>;
	/** The teacher leaves the chat it runs for a new one, or for `resume`: the running teacher is
	 *  turned off first. Resolves like `start`. */
	changeChat: (agent: FolderAgent, resume?: string) => Promise<string | null>;
	stop: (role: TerminalRole) => void;
	/** These resolve to why the shell refused, or null. */
	answer: (role: TerminalRole, kind: "trust" | "enter") => Promise<string | null>;
	paste: (role: TerminalRole) => Promise<string | null>;
	/** A starter key: the line typed into the teacher's input and sent. */
	send: (role: TerminalRole, line: string) => Promise<string | null>;
	/** Attach on the teacher's screen: the file's path typed into its input. */
	addFile: (file: File) => Promise<string | null>;
	/** Start lesson and a lesson's send: start the teacher hidden when it may (wakeAgent).
	 *  True when it didn't because the learner picks the chat first. */
	wake: () => boolean;
	/** A wake is starting the teacher and its terminal is not there yet. */
	waking: boolean;
	/** The teacher's terminal is in its own window, which the main window hears of. While it is,
	 *  the main window never shows that terminal. */
	popped: boolean;
	/** Pops the teacher's terminal out, or brings its window forward, titled with the teacher's
	 *  name. Resolves to why the shell refused, or null. Null where there is no such window to
	 *  make: a browser, an older shell, the terminal window itself. */
	popOut: ((name: string) => Promise<string | null>) | null;
	/** Brings the terminal window forward. */
	focusWindow: () => void;
	/** Closes the terminal window and has the main window show the terminal again. */
	putBack: () => void;
	/** How many times a page asked for that: the panel shows the teacher's screen at each. */
	putBacks: number;
}

const UNSTARTED = "Couldn't turn the teacher on. Try again.";
const ROLES: readonly TerminalRole[] = ["teacher", "helper"];

/** A start's error: the shell rejects with a sentence. */
const reason = (err: unknown): string => (typeof err === "string" && err ? err : err instanceof Error && err.message ? err.message : UNSTARTED);

const ATTACH_UNREAD = "godspeed couldn't read that file.";

/** A shell refusal's sentence, or null when it went through. */
const refusal = (p: Promise<void> | undefined): Promise<string | null> => (p ?? Promise.resolve()).then(() => null, (err: unknown) => (typeof err === "string" ? err : null));

function useTerminalsState(status: AgentStatus | null, inTerminalWindow: boolean): TerminalsApi {
	const lh = typeof window === "undefined" ? undefined : window.lh?.terminals;
	const windowLh = typeof window === "undefined" ? undefined : window.lh?.terminalWindow;
	const [records, setRecords] = useState<Records>({ teacher: null, helper: null });
	// The first list has answered: before it, no record says whether an agent runs.
	const [loaded, setLoaded] = useState(false);
	const { view: folderView, post: postFolder } = useAgentFolderView();
	const folder = folderView?.short ?? "~/godspeed";
	// The terminals that have checked in at least once.
	const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
	const [quietSince, setQuietSince] = useState<number | null>(null);
	const [chats, setChats] = useState<readonly TeacherChat[]>([]);
	// terminal id → the chat it went back to.
	const resumed = useRef(new Map<string, string>());
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
		return () => {
			on = false;
			off();
		};
	}, [lh, put]);

	// Only the main window hears whether the terminal window is open (the shell also says so after
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

	// The list changes as a teacher run starts, is used and ends; a chat the agent said is gone leaves it.
	const [chatsChanged, chatsChange] = useReducer((n: number) => n + 1, 0);
	useServerEvent("teacher-chats-changed", chatsChange);
	const runId = records.teacher?.id;
	const runGone = chatGone(records.teacher?.ended ?? null);
	const runEnded = !!records.teacher?.ended;
	useEffect(() => {
		if (!lh) return;
		let on = true;
		const gone = runId && runGone ? resumed.current.get(runId) : undefined;
		const url = `/api/teacher-chats${gone ? `?id=${encodeURIComponent(gone)}` : ""}`;
		void sendRequest(url, gone ? { method: "DELETE" } : { cache: "no-store" }).then(({ body, status }) => {
			// Unreachable: the list waits for the next look.
			if (!on || status === 0) return;
			const { chats } = body as { chats?: TeacherChat[] };
			setChats(Array.isArray(chats) ? chats : []);
		});
		return () => {
			on = false;
		};
	}, [lh, runId, runGone, runEnded, chatsChanged]);

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

	// The teacher checked in and is not teaching while a lesson turn waits.
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
				turnWaits: !!status && status.pendingTurns > 0,
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

	const start = useCallback(
		async (role: TerminalRole, agent: FolderAgent, resume?: string): Promise<string | null> => {
			if (!lh) return UNSTARTED;
			try {
				await postFolder({ action: "setup" });
			} catch (err) {
				return reason(err);
			}
			try {
				const { id } = await lh.start(role, agent, resume);
				if (resume) resumed.current.set(id, resume);
				setRecords((r) => (r[role]?.id === id ? r : { ...r, [role]: { id, role, agent, startedAt: Date.now(), ended: null, prompt: null, url: false } }));
				return null;
			} catch (err) {
				return reason(err);
			}
		},
		[lh, postFolder],
	);

	const refused = teacherStartRefused(teacher, !!status?.outsideHere);
	const startRole = useCallback(
		async (role: TerminalRole, agent: FolderAgent, resume?: string) => {
			// Its screen shows where the start was asked for.
			if (role === "teacher" && refused === "running") return null;
			if (role === "teacher" && refused === "outside") {
				// The folder is still set up: "Set up my folder" does its part.
				try {
					await postFolder({ action: "setup" });
				} catch (err) {
					return reason(err);
				}
				return OUTSIDE_REFUSAL;
			}
			return start(role, agent, resume);
		},
		[refused, start, postFolder],
	);

	// A change of chat waits here for the running teacher to end.
	const teacherEnded = useRef<(() => void) | null>(null);
	useEffect(() => {
		if (teacherLive) return;
		teacherEnded.current?.();
		teacherEnded.current = null;
	}, [teacherLive]);
	const changeChat = useCallback(
		async (agent: FolderAgent, resume?: string) => {
			if (!teacher || !teacherLive || !lh) return startRole("teacher", agent, resume);
			const ended = new Promise<void>((done) => (teacherEnded.current = done));
			try {
				await lh.stop(teacher.id);
			} catch (err) {
				teacherEnded.current = null;
				return reason(err);
			}
			await ended;
			return start("teacher", agent, resume);
		},
		[teacher, teacherLive, lh, startRole, start],
	);

	// The helper starts by itself, once per teacher run.
	const helperTried = useRef<string | null>(null);
	const helperWanted =
		!!lh &&
		!inTerminalWindow &&
		helperShouldStart({
			teacher,
			teacherCheckedIn,
			helper,
			helperHere: !!status?.helperHere,
			helperWork: status?.helperWork ?? 0,
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
	const send = useCallback(
		(role: TerminalRole, line: string) => {
			const id = idOf(role);
			return refusal(id ? lh?.send(id, line) : undefined);
		},
		[idOf, lh],
	);
	const addFile = useCallback(
		(file: File) => {
			const id = idOf("teacher");
			if (!id || !lh) return Promise.resolve(null);
			if (file.size > ATTACH_MAX_BYTES) return Promise.resolve(ATTACH_TOO_BIG);
			return refusal(readBase64(file).then((data) => lh.addFile(id, file.name, data).then(() => undefined), () => Promise.reject(ATTACH_UNREAD)));
		},
		[idOf, lh],
	);
	// The server's `connected` lasts up to 3 minutes after a terminal ended; the terminals know at once.
	const agentHere = outsideHere || (teacherLive && teacherCheckedIn);
	// Two sends close together start one teacher: the second comes before the first start's record.
	const waking = useRef(false);
	const [wakingShown, setWaking] = useState(false);
	const wake = useCallback(() => {
		const agent = lh && !inTerminalWindow && loaded && !waking.current && wakeAgent({ teacher, agentHere, outsideHere, saved: savedAgent() });
		if (!agent) return false;
		// With earlier chats the learner picks which one teaches.
		if (chats.length > 0) return true;
		waking.current = true;
		setWaking(true);
		void start("teacher", agent).finally(() => {
			waking.current = false;
			setWaking(false);
		});
		return false;
	}, [lh, inTerminalWindow, loaded, teacher, agentHere, outsideHere, chats, start]);

	return useMemo(
		() => ({ available: !!lh, teacher, helper, facts, folder, outsideHere, agentHere, loaded, chats, start: startRole, changeChat, stop, answer, paste, send, addFile, wake, waking: wakingShown, popped, popOut, focusWindow, putBack, putBacks }),
		[lh, teacher, helper, facts, folder, outsideHere, agentHere, loaded, chats, startRole, changeChat, stop, answer, paste, send, addFile, wake, wakingShown, popped, popOut, focusWindow, putBack, putBacks],
	);
}

/** Whether an agent is here to teach: in the desktop app from its
 *  terminals, else from the server. Null before the first read of either. */
export function agentHereNow(status: AgentStatus | null, terminals: TerminalsApi | null): boolean | null {
	if (!status) return null;
	if (!terminals?.available) return status.connected || status.teaching;
	return terminals.loaded ? terminals.agentHere : null;
}

/** No agent is here and godspeed is not starting one: the start pair shows. */
export const noAgentHere = (status: AgentStatus | null, terminals: TerminalsApi | null): boolean =>
	agentHereNow(status, terminals) === false && !(terminals?.teacher && !terminals.teacher.ended);

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
