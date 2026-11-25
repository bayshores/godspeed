import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { useActivity } from "@/frontend/components/activity-dock";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useMinute } from "@/frontend/components/countdown";
import { coverNotices, setNoticesOpen, useNotices } from "@/frontend/components/notice-store";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { useSpaces } from "@/frontend/components/space-context";
import { useOpenInSpace } from "@/frontend/components/use-join-space";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
import { teacherHead } from "@/frontend/components/teacher/teacher-panel";
import { teacherTerminalState } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { goLabel } from "@/frontend/components/top-bar/top-bar-model";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { prefersReducedMotion } from "@/frontend/components/presence";
import { workProgress } from "@/frontend/components/work/work-model";
import { tuckPeek } from "./peek-store";
import { dueSoon, stripClick, stripView } from "./strip-model";
import { useReadyLessons } from "./use-ready-lessons";

/**
 * The strip's state, read once for the window: what it marks, what its
 * peek lists and what its clicks do. Null outside the app shell.
 */
export function useStrip() {
	const teacher = useTeacher();
	const agent = useAgentStatus();
	const terminals = useTerminals();
	const { spaces } = useSpaces();
	const openInSpace = useOpenInSpace();
	const { feed } = useActivity();
	const { deadlines } = useOpenDeadlines();
	const minute = useMinute();
	const ready = useReadyLessons();
	const notices = useNotices();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	const lessonDeadline = (useRouteLoaderData("lesson") as { chat: { deadlineId?: string } } | undefined)?.chat.deadlineId ?? null;

	const name = teacher?.name ?? "";
	const doing = teacher?.doing ?? null;
	const panelOpen = teacher?.panelOpen ?? false;
	const teacherFacts = terminals?.facts ?? null;
	const terminal = teacherTerminalState(teacherFacts);
	const requests = useMemo(() => (feed.requests ?? []).map((r) => r.title), [feed.requests]);
	const work = useMemo(() => workProgress({ spaces, extractions: feed.extractions, jobs: feed.jobs, requests }), [spaces, feed.extractions, feed.jobs, requests]);
	const waiting = teacher?.waiting ?? null;
	// A reply in the panel's chat is work too, though its thread shows it there.
	const talkWorking = !!teacher?.talk.chats?.some((c) => c.running);
	const view = useMemo(
		() => stripView({ agent, terminal, talkWaits: !!waiting?.talk, working: !!doing?.working || talkWorking, work, ready, asking: waiting?.lessons ?? [], panelOpen }),
		[agent, terminal, waiting, doing, talkWorking, work, ready, panelOpen],
	);
	// The open panel's head says the teacher's status: the peek leaves it out.
	const status = useMemo(() => (panelOpen ? null : teacherHead({ agent, name, doing, facts: teacherFacts })), [panelOpen, agent, name, doing, teacherFacts]);
	const due = useMemo(() => (deadlines && minute !== null ? dueSoon(deadlines, minute, pathname) : null), [deadlines, minute, pathname]);

	// No card shows by itself over the open panel's head: it waits in the strip's count.
	useEffect(() => {
		coverNotices(panelOpen);
		return () => coverNotices(false);
	}, [panelOpen]);
	// Another page: the peek tucks back and the notices fold. So does leaving the app frame.
	useEffect(
		() => () => {
			tuckPeek();
			setNoticesOpen(false);
		},
		[pathname],
	);

	const setPanelOpen = teacher?.setPanelOpen;
	const showChat = teacher?.showChat;
	const talkWaits = waiting?.talk ?? null;
	const need = view.need;
	const ask = view.ask;
	const click = useCallback(() => {
		setNoticesOpen(false);
		const does = stripClick(need, ask, panelOpen);
		if (does === "open" || does === "close") setPanelOpen?.(does === "open");
		else if (does === "show") showChat?.(talkWaits ?? undefined);
		else {
			const href = `/chat/${encodeURIComponent(does.lesson)}`;
			// On its lesson, the card is brought into view; elsewhere the lesson opens, where its desk shows it.
			if (pathname === href) document.querySelector("[data-testid=approval-card]")?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "instant" : "smooth" });
			else void navigate(href);
		}
	}, [need, ask, panelOpen, setPanelOpen, showChat, talkWaits, pathname, navigate]);
	const leave = useCallback(() => {
		tuckPeek();
		setNoticesOpen(false);
	}, []);
	const openLesson = useCallback(
		(id: string) => {
			leave();
			void navigate(`/chat/${encodeURIComponent(id)}`);
		},
		[leave, navigate],
	);
	// While Follow's slip says why it waits, its "Go to" is the one: the peek leaves its own out.
	const slip = teacher?.slip?.view ?? null;
	const offered = slip?.paused ? null : (teacher?.offer ?? null);
	const goWords = teacher && goLabel({ following: teacher.follow, offer: offered, held: teacher.held });
	const go = teacher?.go;
	const offer = useMemo(
		() =>
			offered && goWords && go
				? {
						label: offered.label,
						key: goWords,
						go: () => {
							leave();
							go(offered);
						},
					}
				: null,
		[offered, goWords, go, leave],
	);
	const openDue = useMemo(
		() =>
			due && due.id !== lessonDeadline
				? () => {
						leave();
						openInSpace(due.spaceId, deadlineHref(due.id));
					}
				: null,
		[due, lessonDeadline, leave, openInSpace],
	);

	if (!teacher) return null;
	return {
		name,
		view,
		status,
		/** While Follow's slip is up, its line is what a screen reader hears; the other places say only "Working". */
		slipLine: slip?.line ?? null,
		panelOpen,
		waiting: notices.waiting,
		noticesOpen: notices.open,
		offer,
		due,
		openDue,
		click,
		openLesson,
		inLesson: pathname.startsWith("/chat/"),
	};
}

/** What the strip and its peek draw. */
export type StripState = NonNullable<ReturnType<typeof useStrip>>;
