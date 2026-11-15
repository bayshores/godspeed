import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { useActivity } from "@/frontend/components/activity-dock";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useMinute } from "@/frontend/components/countdown";
import { setNoticesOpen, useNotices } from "@/frontend/components/notice-store";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { useSpaces } from "@/frontend/components/space-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { needsYou, teacherTerminalState } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useWorker } from "@/frontend/components/work/use-worker";
import { workProgress } from "@/frontend/components/work/work-model";
import { dueSoon, idleWords, pillClick, pillLine, pillThings, thingsAt, type PillLine, type PillPlace, type PillThing } from "./live-pill-model";
import { NOTICE_STACK_ID } from "./pill-panel";
import { followButtons } from "./top-bar-model";
import { useReadyLessons } from "./use-ready-lessons";

interface PillApi {
	/** What the pill at `place` says. */
	lineAt: (place: PillPlace) => PillLine;
	/** What the pill opens is open: the teacher's panel, or in a page's own bar the notices. */
	open: (place: PillPlace) => boolean;
	/** The teacher's panel is open: the pill is its key, held down. */
	on: boolean;
	/** How many notices wait folded in the pill. */
	waiting: number;
	notices: boolean;
	/** The pill clicked (pillClick). */
	click: (pill: HTMLElement, place: PillPlace) => void;
	/** The pill at `place` does something when clicked. */
	clickable: (place: PillPlace) => boolean;
	/** The count of folded notices clicked: they show, or fold again. */
	showNotices: (from: HTMLElement) => void;
	closeNotices: () => void;
	/** What a thing's own button does. */
	act: (thing: PillThing) => void;
}

const PillContext = createContext<PillApi | null>(null);

/** The pill's state; null outside the app shell. */
export function usePill(): PillApi | null {
	return useContext(PillContext);
}

/**
 * The live pill's state, one for the window: every bar draws the same pill
 * (live-pill.tsx), and the notices hang from the bar in the pill's panel
 * (pill-panel.tsx).
 */
export function PillProvider({ children }: { children: ReactNode }) {
	const teacher = useTeacher();
	const agent = useAgentStatus();
	const terminals = useTerminals();
	const { spaces, setActive } = useSpaces();
	const { feed } = useActivity();
	const { worker } = useWorker();
	const { deadlines } = useOpenDeadlines();
	const minute = useMinute();
	const ready = useReadyLessons();
	const notices = useNotices();
	const navigate = useNavigate();
	const { pathname } = useLocation();

	const name = teacher?.name ?? "";
	const doing = teacher?.doing ?? null;
	const offer = teacher?.offer ?? null;
	const following = teacher?.follow ?? false;
	const terminal = teacherTerminalState(terminals?.facts.teacher ?? null);
	const helper = terminals?.facts.helper ?? null;
	const background = !!helper && !!needsYou(helper);
	const jobs = feed.jobs.length + feed.extractions.length;
	const requests = useMemo(() => (feed.requests ?? []).map((r) => r.title), [feed.requests]);
	const things = useMemo(
		() =>
			pillThings({
				name,
				doing,
				agent,
				terminal,
				background,
				work: workProgress({ worker, spaces, jobs, requests }),
				ready,
				due: deadlines && minute !== null ? dueSoon(deadlines, minute, pathname) : null,
				offer: followButtons({ following, working: false, offer }).go && offer ? offer.label : null,
			}),
		[name, doing, agent, terminal, background, worker, spaces, jobs, requests, ready, deadlines, minute, pathname, following, offer],
	);
	const said = notices.said?.title ?? null;
	const known = notices.known.length;
	// The teacher's open panel says in its head what the teacher does and
	// that background work needs the learner: the pill, in every bar, is
	// the name alone, and closes it.
	const panelOpen = teacher?.panelOpen ?? false;
	const shownAt = useCallback((at: PillPlace) => (panelOpen ? things.filter((t) => t.kind !== "teacher" && t.kind !== "background") : thingsAt(things, at)), [things, panelOpen]);
	const lineAt = useCallback(
		(at: PillPlace) => pillLine({ things: shownAt(at), notice: said, idle: panelOpen ? name : idleWords({ name, agent, notices: known, own: at.own }) }),
		[shownAt, said, name, agent, known, panelOpen],
	);

	const noticesOpen = notices.open;
	const anchor = useRef<HTMLElement | null>(null);
	const closeNotices = useCallback(() => setNoticesOpen(false), []);
	const showNotices = useCallback(
		(from: HTMLElement) => {
			anchor.current = from;
			setNoticesOpen(!noticesOpen);
		},
		[noticesOpen],
	);
	useMenuDismiss(noticesOpen, closeNotices, anchor);
	// Another page: the notices fold. So does leaving the app frame.
	useEffect(() => closeNotices, [closeNotices, pathname]);
	// The keyboard lands in them, as in a menu.
	useEffect(() => {
		if (noticesOpen) document.getElementById(NOTICE_STACK_ID)?.focus();
	}, [noticesOpen]);

	const setPanelOpen = teacher?.setPanelOpen;
	const showTerminal = teacher?.showTerminal;
	const click = useCallback(
		(pill: HTMLElement, at: PillPlace) => {
			const does = pillClick({ main: lineAt(at).thing, place: at, panelOpen, notices: known });
			if (does === "notices") return showNotices(pill);
			closeNotices();
			if (does === "close") setPanelOpen?.(false);
			else if (does) showTerminal?.(does.open);
		},
		[showNotices, closeNotices, panelOpen, known, setPanelOpen, showTerminal, lineAt],
	);
	const clickable = useCallback((at: PillPlace) => pillClick({ main: lineAt(at).thing, place: at, panelOpen, notices: known }) !== null, [panelOpen, known, lineAt]);
	const open = useCallback((at: PillPlace) => (at.own ? noticesOpen : panelOpen), [noticesOpen, panelOpen]);
	const act = useCallback(
		(thing: PillThing) => {
			closeNotices();
			if (thing.kind === "ready") void navigate(`/chat/${encodeURIComponent(thing.key)}`);
			if (thing.due) {
				setActive(thing.due.spaceId);
				void navigate(deadlineHref(thing.due.id));
			}
		},
		[closeNotices, navigate, setActive],
	);

	const api = useMemo(
		() => ({ lineAt, open, on: panelOpen, waiting: notices.waiting, notices: noticesOpen, click, clickable, showNotices, closeNotices, act }),
		[lineAt, open, panelOpen, notices.waiting, noticesOpen, click, clickable, showNotices, closeNotices, act],
	);
	if (!teacher) return <>{children}</>;
	return <PillContext.Provider value={api}>{children}</PillContext.Provider>;
}
