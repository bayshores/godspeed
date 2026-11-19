/**
 * The teacher: one provider in the app shell.
 *
 *  - Follow: every "agent-action" event is a change the outside agent
 *    made. With Follow on, the window goes to the change's page and the
 *    changed item (data-teacher-target) lights up (tour.ts paces it). On
 *    by default; the learner turns it on and off, and the status line
 *    says what the agent is doing (follow-status.ts).
 *  - Opens: a change marked `open` (a page the agent opened, a lesson
 *    the learner asked for) goes there with Follow off too. While the
 *    window holds (unsent lesson text, a mock, a dialog) it waits as a
 *    held "Go to" instead; a newer open replaces it.
 *  - The panel (use-teacher-panel.ts): in the desktop app the agent's
 *    screen, where the learner talks to it outside lessons, and Activity
 *    (teacher-activity.tsx); in a browser Activity alone. It stays open
 *    across pages, lessons too. It opens by itself for a need and closes
 *    when that is settled or a lesson reply starts.
 *
 * The name is the learner's choice (Settings → General → Teacher name) and
 * only ever shown on screen.
 *
 * Each job has its own hook: Follow (use-follow.ts), the recent changes and
 * what the pill offers from them (use-recent-actions.ts), the tour
 * (use-tour.ts) and the panel. This provider joins them into one context.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useServerEvent } from "@/frontend/components/server-events";
import { useDoneSound } from "./use-done-sound";
import { useAgentStatus } from "@/frontend/components/agent-status";
import { useActivity } from "@/frontend/components/activity-dock";
import { useSpaces } from "@/frontend/components/space-context";
import { usePresence } from "@/frontend/components/presence";
import { useSettings } from "@/frontend/components/settings-context";
import { noAgentHere, useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useWindowPage } from "@/frontend/components/terminal/use-terminal-lines";
import { TeacherPanel, panelFillsWindow } from "./teacher-panel";
import { TeacherContext, useTeacher, type TeacherApi, type LessonPresence } from "./teacher-context";
import { useTeacherPanel } from "./use-teacher-panel";
import { panelBody, panelStarts, shownScreen } from "./dock-model";
import { agentDoing } from "./follow-status";
import { useFollow } from "./use-follow";
import { useRecentActions } from "./use-recent-actions";
import { useTour } from "./use-tour";

// Most of the app reads the teacher from here.
export { useTeacher };

/** A lesson screen reports whether the teacher is writing or working, and
 *  whether the learner has unsent text (Follow then stays on the lesson). */
export function useTeacherLesson(streaming: boolean, working: boolean, draft: boolean): void {
	const api = useTeacher();
	const set = api?.setLesson;
	useEffect(() => {
		set?.({ streaming, working, draft });
	}, [set, streaming, working, draft]);
	useEffect(() => () => set?.(null), [set]);
}

export function TeacherProvider({ children }: { children: ReactNode }) {
	const name = useSettings().teacherName;
	const agent = useAgentStatus();
	const { feed } = useActivity();
	const spaces = useSpaces();
	const { pathname } = useLocation();
	useWindowPage(pathname, spaces.active);

	const { followRef, followOn, dispatchFollow, setFollow } = useFollow();

	// ── the lesson screen ──
	const [lesson, setLessonState] = useState<LessonPresence | null>(null);
	const setLesson = useCallback((p: LessonPresence | null) => {
		setLessonState((prev) => (prev === p || (prev && p && prev.streaming === p.streaming && prev.working === p.working && prev.draft === p.draft) ? prev : p));
	}, []);
	const lessonRef = useRef(lesson);
	lessonRef.current = lesson;

	const { recent, add, fresh, offer, held, setHeld } = useRecentActions(followOn, pathname);

	// ── what it's doing ──
	const doing = useMemo(
		() => agentDoing({ agent, fresh, lesson, extractions: feed.extractions, jobs: feed.jobs }),
		[agent, fresh, lesson, feed.extractions, feed.jobs],
	);

	// ── the panel ──
	const panel = useTeacherPanel(lesson?.working ?? null);
	const { open: panelOpen, setOpen: setPanelOpen, showTerminal, setList } = panel;
	useDoneSound(panelOpen);
	// The panel stays while the page shows; across the whole window it gets out of the way.
	const stepAside = useCallback(() => {
		if (panelFillsWindow()) setPanelOpen(false);
		else setList(false);
	}, [setPanelOpen, setList]);

	const { take, go } = useTour({ followRef, dispatchFollow, lessonRef, setHeld, stepAside });
	useServerEvent("agent-action", (action) => {
		if (!action || typeof action.id !== "string") return;
		add(action);
		take(action);
	});

	const terminals = useTerminals();
	const view = panelBody(!!terminals?.available);
	const shown = usePresence(panelOpen);
	const starts =
		panelOpen &&
		panelStarts({
			view,
			screen: shownScreen(panel.role, !!terminals?.helper),
			terminals: !!terminals?.available,
			noAgent: noAgentHere(agent, terminals),
			teacher: terminals?.teacher ?? null,
			outside: !!terminals?.outsideHere,
		});

	const spaceList = spaces.spaces;
	const spaceNameOf = useCallback((id: string | null) => (id ? (spaceList.find((c) => c.id === id)?.name ?? null) : null), [spaceList]);

	const api = useMemo<TeacherApi>(
		() => ({ name, follow: followOn, setFollow, panelOpen, panelStarts: starts, setPanelOpen, showTerminal, recent, doing, setLesson, go, offer: held ?? offer, held: !!held, spaceNameOf }),
		[name, followOn, setFollow, panelOpen, starts, setPanelOpen, showTerminal, recent, doing, setLesson, go, held, offer, spaceNameOf],
	);

	return (
		<TeacherContext.Provider value={api}>
			{children}
			{/* On the page's top layer. The pill closes it; it also closes by itself (use-teacher-panel.ts). */}
			{shown.mounted &&
				createPortal(
					<TeacherPanel
						name={name}
						agent={agent}
						view={view}
						list={panel.list}
						onList={panel.setList}
						screen={panel.role}
						onScreen={showTerminal}
						focus={panel.focus}
						state={shown.state}
					/>,
					document.body,
				)}
		</TeacherContext.Provider>
	);
}
