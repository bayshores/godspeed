/**
 * The teacher's panel, opened from the pill's card ("Talk to <name>").
 * Docked to the window's right edge, under the top bar. It pushes the page
 * left to make room, and dims the page where it covers it instead. One head
 * row (panel-head.tsx), then the agent's screen (panel-screen.tsx), which
 * grows the panel to fit the whole screen, or in a browser Activity
 * (teacher-activity.tsx).
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { agentWaiting, agentStatusLabel, waitingNotice, type AgentStatus } from "@/frontend/components/agent-status";
import { needsYou, screenStatusLine, teacherTerminalState, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { noAgentHere, useTerminals } from "@/frontend/components/terminal/use-terminals";
import { HELPER_NAME } from "@/frontend/components/work/work-model";
import { useTeacher } from "./teacher-context";
import type { AgentDoing } from "./follow-status";
import { TeacherActivity } from "./teacher-activity";
import { PanelHead } from "./panel-head";
import { PanelScreen } from "./panel-screen";
import { StartTeacher } from "./start-teacher";
import { DOCK_WIDTH, dockLayout, shownScreen, type PanelView } from "./dock-model";

/** The status line under the name: the notice while the agent compacts,
 *  the waiting notice while work waits, what the agent is doing while it
 *  works, then whether it is teaching. Nothing until the first read of the
 *  agent. */
export function agentLine(agent: AgentStatus | null, doing: AgentDoing | null = null): string | null {
	if (!agent) return null;
	if (agent.helperCovering) return `Tidying my memory. ${HELPER_NAME} is answering for a minute.`;
	if (agentWaiting(agent)) return waitingNotice(agent.name);
	if (doing?.working) return doing.text;
	if (agent.teaching) return "Teaching, idle";
	return agent.connected ? agentStatusLabel(agent) : "Not connected";
}

/** The panel's left border (border-l-2). */
const PANEL_BORDER = 2;

/** The page's push while the panel is open (main's padding reads it). */
const PUSH_VAR = "--lh-dock-push";

export function TeacherPanel({
	name,
	agent,
	view,
	listable,
	list,
	onList,
	overLesson,
	screen,
	onScreen,
	focus,
	onClose,
}: {
	name: string;
	agent: AgentStatus | null;
	view: PanelView;
	/** The status chip drops the Activity list (not in a lesson, which has its own). */
	listable: boolean;
	list: boolean;
	onList: (open: boolean) => void;
	/** It opened over a lesson: it covers the page instead of pushing it. */
	overLesson: boolean;
	/** The screen picked (background work's only while it needs the learner), and the way to one. */
	screen: TerminalRole;
	onScreen: (role: TerminalRole) => void;
	/** The learner opened the screen: it takes the keyboard. */
	focus: boolean;
	onClose: () => void;
}) {
	const teacher = useTeacher();
	const terminals = useTerminals();
	const onScreenView = view === "terminal";
	const shown = shownScreen(screen, !!terminals?.helper);
	const background = onScreenView && shown === "helper";
	const hasScreen = !!terminals?.facts[shown];
	const teacherFacts = terminals?.facts.teacher ?? null;
	const helperFacts = terminals?.facts.helper ?? null;
	const helperCalls = !!helperFacts && !!needsYou(helperFacts);
	const doing = teacher?.doing ?? null;
	const line = agentLine(agent, doing);
	const teacherStatus = screenStatusLine(teacherFacts, name);
	const [{ width, wide, covers }, setDock] = useState({ width: DOCK_WIDTH, wide: false, covers: false });
	const section = useRef<HTMLElement>(null);
	const lastWidth = useRef(DOCK_WIDTH);
	// While the panel grows to a new width the screen, laid out at the
	// final width, would show cut off on its left: it waits, then fades in.
	const [settling, setSettling] = useState(false);
	// Before paint, so a screen that just appeared is never fitted to the narrow width first.
	useLayoutEffect(() => {
		const root = document.documentElement;
		let settled: ReturnType<typeof setTimeout> | undefined;
		const measure = (changed: boolean) => {
			const page = document.querySelector("main")?.getBoundingClientRect().width ?? window.innerWidth;
			const dock = dockLayout(window.innerWidth, page, view, hasScreen, overLesson);
			if (changed) {
				// No width animation under reduced motion: 0s, shown at once.
				const moves = dock.wide && dock.width !== lastWidth.current && !!section.current;
				const ms = moves ? parseFloat(getComputedStyle(section.current!).transitionDuration) * 1000 : 0;
				const grows = ms > 0;
				setSettling(grows);
				// The width's transitionend shows it; the timer only if that never comes.
				if (grows) settled = setTimeout(() => setSettling(false), ms + 100);
			}
			lastWidth.current = dock.width;
			setDock({ width: dock.width, wide: dock.wide, covers: dock.push < dock.width });
			root.style.setProperty(PUSH_VAR, `${dock.push}px`);
		};
		measure(true);
		const onResize = () => measure(false);
		window.addEventListener("resize", onResize);
		return () => {
			clearTimeout(settled);
			window.removeEventListener("resize", onResize);
		};
	}, [view, hasScreen, overLesson]);
	useEffect(
		() => () => {
			document.documentElement.style.removeProperty(PUSH_VAR);
		},
		[],
	);

	return (
		<>
			{/* Where it covers the page, the page dims under it, as under a drawer. */}
			{covers && <div aria-hidden data-testid="teacher-panel-scrim" data-state="open" style={{ right: width }} className="lh-fade pointer-events-none fixed top-12 bottom-0 left-0 z-40 bg-bar/25" />}
			<section
				ref={section}
				onTransitionEnd={(e) => e.target === e.currentTarget && e.propertyName === "width" && setSettling(false)}
				data-teacher-panel=""
				data-testid="teacher-panel"
				aria-label={name}
				style={{ width }}
				className="lh-slide-in fixed top-12 right-0 bottom-0 z-[41] flex max-w-full flex-col overflow-hidden border-l-2 border-line bg-panel font-ui motion-safe:transition-[width] motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)"
			>
				{background ? (
					<PanelHead
						title={HELPER_NAME}
						status={screenStatusLine(helperFacts, HELPER_NAME)}
						lit={helperCalls}
						working={false}
						list={null}
						need={null}
						back={() => onScreen("teacher")}
						wide={wide}
						onClose={onClose}
					/>
				) : (
					<PanelHead
						title={name}
						status={teacherStatus ?? line}
						lit={teacherTerminalState(teacherFacts) === "needsYou"}
						working={!teacherStatus && !!doing?.working && line === doing.text}
						list={listable && onScreenView ? { open: list, onOpen: onList } : null}
						need={onScreenView && helperCalls ? () => onScreen("helper") : null}
						back={null}
						wide={wide}
						onClose={onClose}
					/>
				)}

				{/* The screen is laid out at the panel's final width, against its
				    right edge, so its font is fitted once, not every frame. It is
				    hidden at once while the panel grows and fades in after. */}
				<div
					data-testid="teacher-panel-body"
					data-settling={settling || undefined}
					style={wide ? { width: width - PANEL_BORDER } : undefined}
					className={cn(
						"flex min-h-0 flex-1 flex-col",
						!onScreenView && "gap-[18px] px-3 pt-1.5 pb-[18px]",
						wide && "self-end",
						settling ? "opacity-0" : "motion-safe:transition-opacity motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)",
					)}
				>
					{onScreenView ? (
						<PanelScreen name={background ? HELPER_NAME : name} role={shown} focus={focus} />
					) : (
						<>
							{/* In a browser there is no screen to start from. */}
							{!terminals?.available && noAgentHere(agent, terminals) && <StartTeacher />}
							<TeacherActivity underStatus />
						</>
					)}
				</div>
			</section>
		</>
	);
}
