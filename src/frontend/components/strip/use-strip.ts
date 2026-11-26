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
import { needsYou, teacherTerminalState } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { goLabel } from "@/frontend/components/top-bar/top-bar-model";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useWorker } from "@/frontend/components/work/use-worker";
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
	const { worker } = useWorker();
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
	const teacherFacts = terminals?.facts.teacher ?? null;
	const terminal = teacherTerminalState(teacherFacts);
	const helper = terminals?.facts.helper ?? null;
	const background = !!helper && !!needsYou(helper);
	const requests = useMemo(() => (feed.requests ?? []).map((r) => r.title), [feed.requests]);
	const work = useMemo(() => workProgress({ worker, spaces, extractions: feed.extractions, jobs: feed.jobs, requests }), [worker, spaces, feed.extractions, feed.jobs, requests]);
	const view = useMemo(
		() => stripView({ agent, terminal, working: !!doing?.working, background, work, ready, panelOpen }),
		[agent, terminal, doing, background, work, ready, panelOpen],
	);
	// The open panel's head says the teacher's status: the peek leaves it out.
	const status = useMemo(() => (panelOpen ? null : teacherHead({ agent, name, doing, facts: teacherFacts })), [panelOpen, agent, name, doing, teacherFacts]);
	const due = useMemo(() => (deadlines && minute !== null ? dueSoon(deadlines, minute, pathname) : null), [deadlines, minute, pathname]);

	// No card shows by itself over the open panel's head or the lesson's step line: it waits in the strip's count.
	const inLesson = pathname.startsWith("/chat/");
	useEffect(() => {
		coverNotices(panelOpen || inLesson);
		return () => coverNotices(false);
	}, [panelOpen, inLesson]);
	// Another page: the peek tucks back and the notices fold. So does leaving the app frame.
	useEffect(
		() => () => {
			tuckPeek();
			setNoticesOpen(false);
		},
		[pathname],
	);

	const setPanelOpen = teacher?.setPanelOpen;
	const showTerminal = teacher?.showTerminal;
	const need = view.need;
	const click = useCallback(() => {
		setNoticesOpen(false);
		const does = stripClick(need, panelOpen);
		if (does === "open" || does === "close") setPanelOpen?.(does === "open");
		else showTerminal?.(does.show);
	}, [need, panelOpen, setPanelOpen, showTerminal]);
	const leave = useCallback(() => {
		tuckPeek();
		setNoticesOpen(false);
	}, []);
	const showHelper = useCallback(() => {
		leave();
		showTerminal?.("helper");
	}, [leave, showTerminal]);
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
		showHelper,
		openLesson,
		inLesson,
	};
}

/** What the strip and its peek draw. */
export type StripState = NonNullable<ReturnType<typeof useStrip>>;
