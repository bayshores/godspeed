import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { useActivity } from "@/frontend/components/activity-dock";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useMinute } from "@/frontend/components/countdown";
import { setNoticesOpen, useNotices } from "@/frontend/components/notice-store";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { useSpaces } from "@/frontend/components/space-context";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { teacherTerminalState } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useMenuDismiss } from "@/frontend/components/use-menu-dismiss";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useWorker } from "@/frontend/components/work/use-worker";
import { workProgress } from "@/frontend/components/work/work-model";
import { dueSoon, idleWords, pillLine, pillThings, thingsAt, type PillLine, type PillPlace, type PillThing } from "./live-pill-model";
import { PillCard } from "./pill-card";
import { PILL_CARD_ID } from "./pill-panel";
import { followButtons } from "./top-bar-model";
import { useReadyLessons } from "./use-ready-lessons";

interface PillApi {
	/** What the pill at `place` says. */
	lineAt: (place: PillPlace) => PillLine;
	open: boolean;
	/** How many notices wait folded in the pill. */
	waiting: number;
	/** The pill clicked opens or closes its card. */
	toggle: (pill: HTMLElement, place: PillPlace) => void;
	close: () => void;
	/** What a thing's button does. */
	act: (thing: PillThing) => void;
}

const APP_BAR: PillPlace = { own: false, named: false };

const PillContext = createContext<PillApi | null>(null);

/** The pill's state; null outside the app shell. */
export function usePill(): PillApi | null {
	return useContext(PillContext);
}

/**
 * The live pill's state, one for the window: every bar draws the same pill
 * (live-pill.tsx) and the one card opens in the pill's panel
 * (pill-panel.tsx), under the notices.
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
	const jobs = feed.jobs.length + feed.extractions.length;
	const things = useMemo(
		() =>
			pillThings({
				name,
				doing,
				agent,
				terminal,
				work: workProgress({ worker, spaces, jobs }),
				ready,
				due: deadlines && minute !== null ? dueSoon(deadlines, minute, pathname) : null,
				offer: followButtons({ following, working: false, offer }).go && offer ? offer.label : null,
			}),
		[name, doing, agent, terminal, worker, spaces, jobs, ready, deadlines, minute, pathname, following, offer],
	);
	const said = notices.said?.title ?? null;
	const known = notices.known.length;
	const lineAt = useCallback((at: PillPlace) => pillLine({ things: thingsAt(things, at), notice: said, idle: idleWords({ name, agent, notices: known, own: at.own }) }), [things, said, name, agent, known]);

	const open = notices.open;
	const pillRef = useRef<HTMLElement | null>(null);
	const [place, setPlace] = useState(APP_BAR);
	const close = useCallback(() => setNoticesOpen(false), []);
	const toggle = useCallback(
		(pill: HTMLElement, at: PillPlace) => {
			pillRef.current = pill;
			setPlace(at);
			setNoticesOpen(!open);
		},
		[open],
	);
	useMenuDismiss(open, close, pillRef);
	// Another page: the card closes. So does leaving the app frame.
	useEffect(() => close, [close, pathname]);
	// The keyboard lands in the card, as in a menu.
	useEffect(() => {
		if (open) document.getElementById(PILL_CARD_ID)?.focus();
	}, [open]);

	const showTerminal = terminals?.show;
	const showActivity = teacher?.showActivity;
	const act = useCallback(
		(thing: PillThing) => {
			close();
			if (thing.kind === "teacher") showTerminal?.("teacher");
			if (thing.kind === "work") showActivity?.();
			if (thing.kind === "ready") void navigate(`/chat/${encodeURIComponent(thing.key)}`);
			if (thing.due) {
				setActive(thing.due.spaceId);
				void navigate(deadlineHref(thing.due.id));
			}
		},
		[close, showTerminal, showActivity, navigate, setActive],
	);

	const api = useMemo(() => ({ lineAt, open, waiting: notices.waiting, toggle, close, act }), [lineAt, open, notices.waiting, toggle, close, act]);
	const card = open && typeof document !== "undefined" ? document.getElementById(PILL_CARD_ID) : null;
	if (!teacher) return <>{children}</>;
	return (
		<PillContext.Provider value={api}>
			{children}
			{card &&
				createPortal(
					<PillCard
						things={thingsAt(things, place)}
						main={lineAt(place).thing}
						name={teacher.name}
						panel={!place.own}
						follow={!place.named}
						onAct={act}
						onTalk={() => {
							close();
							teacher.setPanelOpen(true);
						}}
					/>,
					card,
				)}
		</PillContext.Provider>
	);
}
