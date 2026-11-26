import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useNavigate, useRouteLoaderData } from "react-router";
import { useActivity } from "@/frontend/components/activity-dock";
import { compact } from "@/frontend/components/agent-setup/agent-card-model";
import { useAgentSetup } from "@/frontend/components/agent-setup/agent-setup-context";
import { useMinute } from "@/frontend/components/countdown";
import { noticesAlone, setNoticesOpen, useNotices } from "@/frontend/components/notice-store";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { useSpaces } from "@/frontend/components/space-context";
import { useOpenInSpace } from "@/frontend/components/use-join-space";
import { useTeacher } from "@/frontend/components/teacher/teacher-context";
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
	const requests = useMemo(() => (feed.requests ?? []).map((r) => r.title), [feed.requests]);
	const work = useMemo(() => workProgress({ spaces, extractions: feed.extractions, jobs: feed.jobs, requests }), [spaces, feed.extractions, feed.jobs, requests]);
	const waiting = teacher?.waiting ?? null;
	// A reply in the panel's chat is work too, though its thread shows it there.
	const talkWorking = !!teacher?.talk.chats?.some((c) => c.running);
	const view = useMemo(
		() => stripView({ talkWaits: !!waiting?.talk, working: !!doing?.working || talkWorking, work, ready, asking: waiting?.lessons ?? [], panelOpen }),
		[waiting, doing, talkWorking, work, ready, panelOpen],
	);
	// While the agent can't run the peek says why, quietly: a skipped setup is not nagged about.
	const { health, update } = useAgentSetup();
	const cantRun = compact(health, update)?.sentence ?? null;
	// What stops the agent, else as the panel's head: the work it does, else its name. The open
	// panel's head says it, so the peek leaves it out.
	const status = useMemo(
		() => (panelOpen ? null : cantRun ? { status: cantRun, working: false } : doing?.working ? { status: doing.text, working: true } : { status: name, working: false }),
		[panelOpen, cantRun, doing, name],
	);
	const due = useMemo(() => (deadlines && minute !== null ? dueSoon(deadlines, minute, pathname) : null), [deadlines, minute, pathname]);

	// Beside the strip a notice waits in its count, so none lies over the page unasked; only an error comes out, and not over the open panel's head.
	useEffect(() => {
		noticesAlone(panelOpen ? "none" : "errors");
		return () => noticesAlone("all");
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
