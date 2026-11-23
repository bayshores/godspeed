/**
 * The teacher: one provider in the app shell.
 *
 *  - Follow: every "agent-action" event is a change the outside agent
 *    made. With Follow on, the window goes to the change's page and the
 *    changed item (data-teacher-target) lights up (tour.ts paces it) and
 *    stays lit (lit-model.ts: one style rule per mark, drawn here). On by
 *    default; the learner turns it on and off, and the status line says
 *    what the agent is doing (follow-status.ts).
 *  - The round: what the teacher reads and changes while it works
 *    (use-teacher-work.ts, timeline-model.ts), which Follow's slip shows at
 *    the page's foot (use-follow-slip.ts, follow-slip.tsx).
 *  - Opens: a change marked `open` (a page the agent opened, a lesson
 *    the learner asked for) goes there with Follow off too. While the
 *    window holds (unsent lesson text, a mock, a dialog) it waits as a
 *    held "Go to" instead; a newer open replaces it.
 *  - The panel (use-teacher-panel.ts): in the desktop app the agent's
 *    screen, where the learner talks to it outside lessons, and Activity
 *    (teacher-activity.tsx); in a browser Activity alone. It stays open
 *    across pages, lessons too. It opens by itself for a need and closes
 *    when that is settled or a lesson reply starts. While the teacher's
 *    screen is in a window of its own the panel shows Activity instead.
 *
 * The name is the learner's choice (Settings → General → Teacher name) and
 * only ever shown on screen.
 *
 * Each job has its own hook: Follow (use-follow.ts), the recent changes and
 * what the strip's peek offers from them (use-recent-actions.ts), the tour
 * (use-tour.ts), the round and its slip, and the panel. This provider joins
 * them into one context.
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
import { TeacherPanel } from "./teacher-panel";
import { TeacherContext, useTeacher, type TeacherApi, type LessonPresence } from "./teacher-context";
import { useTeacherPanel } from "./use-teacher-panel";
import { panelBody, panelStarts, shownScreen } from "./dock-model";
import { agentDoing } from "./follow-status";
import { useFollow } from "./use-follow";
import { useRecentActions } from "./use-recent-actions";
import { useTour } from "./use-tour";
import { useTeacherWork } from "./use-teacher-work";
import { roundTimeline } from "./timeline-model";
import { slipFits } from "./follow-slip-model";
import { useFollowSlip } from "./use-follow-slip";
import { litRules } from "./lit-model";

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

	const { recent, add, offer, held, setHeld } = useRecentActions(followOn, pathname);

	// ── the panel ──
	const panel = useTeacherPanel(lesson?.working ?? null, pathname === "/");
	const { open: panelOpen, setOpen: setPanelOpen, showTerminal, setList } = panel;
	useDoneSound(panelOpen);
	const [panelWhole, setPanelWhole] = useState(false);
	const [slipRoom, setSlipRoom] = useState(true);
	const onBeside = useCallback((beside: number | null) => {
		setPanelWhole(beside === 0);
		setSlipRoom(slipFits(beside));
	}, []);
	// The panel stays while the page shows; across the whole window it gets out of the way.
	const stepAside = useCallback(() => {
		if (panelWhole) setPanelOpen(false);
		else setList(false);
	}, [panelWhole, setPanelOpen, setList]);

	const { take, go, pause, lit, clearLit } = useTour({ followRef, dispatchFollow, lessonRef, setHeld, stepAside });

	// ── the round of work and Follow's slip ──
	const work = useTeacherWork();
	const timeline = useMemo(() => roundTimeline(work, recent), [work, recent]);
	const since = work?.since ?? null;
	useEffect(() => {
		if (since) clearLit();
	}, [since, clearLit]);
	// While Follow waits, the slip offers the change it waits to show, or else an open the window held.
	const slipPause = useMemo(() => (pause ? { why: pause.why, waiting: pause.waiting ?? held } : null), [pause, held]);
	const slip = useFollowSlip({ follow: followOn, work, timeline, pause: slipPause, path: pathname, room: slipRoom });

	// ── what it's doing ──
	// While the slip is up it says what the teacher does, and the other places say only "Working".
	const round = work?.live ? (slip ? "Working" : (timeline.at(-1)?.text ?? "Working")) : null;
	const doing = useMemo(() => agentDoing({ agent, round, lesson, extractions: feed.extractions, jobs: feed.jobs }), [agent, round, lesson, feed.extractions, feed.jobs]);

	useServerEvent("agent-action", (action) => {
		if (!action || typeof action.id !== "string") return;
		add(action);
		take(action);
	});

	const terminals = useTerminals();
	const screen = shownScreen(panel.role, !!terminals?.helper);
	const view = panelBody(!!terminals?.available, !!terminals?.popped && screen === "teacher");
	const shown = usePresence(panelOpen);
	const starts =
		panelOpen &&
		panelStarts({
			view,
			screen,
			terminals: !!terminals?.available,
			noAgent: noAgentHere(agent, terminals),
			teacher: terminals?.teacher ?? null,
			outside: !!terminals?.outsideHere,
		});

	// One line a page key handed over; the panel's screen sends it and clears it, or it goes when the panel closes.
	const [asking, setAsking] = useState<string | null>(null);
	const ask = useCallback(
		(line: string) => {
			setAsking(line);
			showTerminal("teacher");
		},
		[showTerminal],
	);
	useEffect(() => {
		if (!panelOpen) setAsking(null);
	}, [panelOpen]);
	const waiting = useMemo(() => (asking === null ? null : { line: asking, clear: () => setAsking(null) }), [asking]);
	const canAsk = !!terminals?.available && !terminals.outsideHere && !terminals.popped;

	const spaceList = spaces.spaces;
	const spaceNameOf = useCallback((id: string | null) => (id ? (spaceList.find((c) => c.id === id)?.name ?? null) : null), [spaceList]);

	const api = useMemo<TeacherApi>(
		() => ({ name, follow: followOn, setFollow, panelOpen, panelStarts: starts, setPanelOpen, showTerminal, canAsk, ask, asking: waiting, recent, doing, setLesson, go, slip, offer: held ?? offer, held: !!held, spaceNameOf }),
		[name, followOn, setFollow, panelOpen, starts, setPanelOpen, showTerminal, canAsk, ask, waiting, recent, doing, setLesson, go, slip, held, offer, spaceNameOf],
	);
	const marks = useMemo(() => litRules(lit, CSS.escape), [lit]);

	return (
		<TeacherContext.Provider value={api}>
			{children}
			{/* What the teacher changed stays lit: one rule per mark, so a row drawn again keeps it. */}
			{marks && <style data-testid="teacher-lit">{marks}</style>}
			{/* On the page's top layer. The strip closes it; it also closes by itself (use-teacher-panel.ts). */}
			{shown.mounted &&
				createPortal(
					<TeacherPanel
						name={name}
						agent={agent}
						view={view}
						list={panel.list}
						onList={panel.setList}
						screen={panel.role}
						onScreen={panel.showScreen}
						focus={panel.focus}
						state={shown.state}
						onBeside={onBeside}
					/>,
					document.body,
				)}
		</TeacherContext.Provider>
	);
}
