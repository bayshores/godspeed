/**
 * The teacher's panel, opened and closed from the pill only: it stays
 * while the learner works on the page, a lesson too. It runs from the
 * top bar down the window's right edge to its bottom, pushing the page
 * left to make room and covering it where there is none; the learner
 * drags its left edge. One head row (panel-head.tsx), then
 * the agent's screen (panel-screen.tsx), or Activity (teacher-activity.tsx)
 * in a browser and while the teacher's screen is in a window of its own.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { BarWindow, observeBar } from "@/frontend/components/ui/bar-window";
import { ResizeHandle, usePaneWidth } from "@/frontend/components/ui/resize-handle";
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
import { PANEL_WIDTH, panelLayout, shownScreen, type PanelView } from "./dock-model";

/** The status line under the name: the notice while the agent compacts,
 *  the waiting notice while work waits, what the agent is doing while it
 *  works, then whether it is teaching. Nothing until the first read of the
 *  agent. */
export function agentLine(agent: AgentStatus | null, teacher: string, doing: AgentDoing | null = null): string | null {
	if (!agent) return null;
	if (agent.helperCovering) return "Tidying my memory. A backup is answering for a minute.";
	if (agentWaiting(agent)) return waitingNotice(teacher, agent.connected);
	if (doing?.working) return doing.text;
	if (agent.teaching) return "Ready";
	return agentStatusLabel(agent, teacher);
}

/** The page's push while the panel is open (main's padding reads it). */
const PUSH_VAR = "--lh-dock-push";

/** The open panel takes the whole window, with no page left beside it. */
export const panelFillsWindow = (): boolean => document.querySelector("[data-teacher-panel][data-whole]") !== null;

export function TeacherPanel({
	name,
	agent,
	view,
	list,
	onList,
	screen,
	onScreen,
	focus,
	state,
}: {
	name: string;
	agent: AgentStatus | null;
	view: PanelView;
	list: boolean;
	onList: (open: boolean) => void;
	/** The screen picked (background work's only while it needs the learner), and the way to one. */
	screen: TerminalRole;
	onScreen: (role: TerminalRole) => void;
	/** The learner opened the screen: it takes the keyboard. */
	focus: boolean;
	/** "closed" while it goes back up into the bar. */
	state: "open" | "closed";
}) {
	const teacher = useTeacher();
	const terminals = useTerminals();
	const onScreenView = view === "terminal";
	const shown = shownScreen(screen, !!terminals?.helper);
	const background = onScreenView && shown === "helper";
	const teacherFacts = terminals?.facts.teacher ?? null;
	const helperFacts = terminals?.facts.helper ?? null;
	const helperCalls = !!helperFacts && !!needsYou(helperFacts);
	const doing = teacher?.doing ?? null;
	const line = agentLine(agent, name, doing);
	const teacherStatus = screenStatusLine(teacherFacts, name);
	const [wanted, setWanted] = usePaneWidth("teacher", PANEL_WIDTH);
	const [{ width, whole, squeezed }, setLayout] = useState({ width: wanted, whole: false, squeezed: false });
	// Only while the page has too little room beside the panel.
	const hide = squeezed && teacher ? () => teacher.setPanelOpen(false) : null;
	const putBack = view === "popped" ? () => terminals?.putBack() : null;
	// Before paint, so the screen is never sized to another box first.
	useLayoutEffect(() => {
		const measure = () => {
			const page = document.querySelector("main")?.getBoundingClientRect().width ?? window.innerWidth;
			const layout = panelLayout(window.innerWidth, page, wanted);
			setLayout({ width: layout.width, whole: layout.width >= window.innerWidth, squeezed: layout.squeezed });
			// On its way out it lets the page back at once.
			document.documentElement.style.setProperty(PUSH_VAR, `${state === "open" ? layout.push : 0}px`);
		};
		measure();
		// After layout, with the window's new size: a one-shot resize (zoom, a snap) can fire the
		// window's resize event before its width changes.
		const observer = new ResizeObserver(measure);
		observer.observe(document.documentElement);
		observeBar(observer);
		return () => observer.disconnect();
	}, [wanted, state]);
	useEffect(
		() => () => {
			document.documentElement.style.removeProperty(PUSH_VAR);
		},
		[],
	);
	return (
		<BarWindow right={0} width={width} height={null} state={state} data-teacher-panel="" data-whole={whole || undefined} data-testid="teacher-panel" aria-label={name}>
			{/* Nothing to drag while it takes the whole window. */}
			{!whole && <ResizeHandle paneKey="teacher" width={width} bounds={PANEL_WIDTH} onWidth={setWanted} label={`Resize ${name}'s panel`} />}
			{background ? (
				<PanelHead
					title={HELPER_NAME}
					status={screenStatusLine(helperFacts, HELPER_NAME)}
					lit={helperCalls}
					working={false}
					list={null}
					need={null}
					back={() => onScreen("teacher")}
					putBack={null}
					hide={hide}
				/>
			) : (
				<PanelHead
					title={null}
					status={teacherStatus ?? line}
					lit={teacherTerminalState(teacherFacts) === "needsYou"}
					working={!teacherStatus && !!doing?.working && line === doing.text}
					list={onScreenView ? { open: list, onOpen: onList } : null}
					need={view !== "activity" && helperCalls ? () => onScreen("helper") : null}
					back={null}
					putBack={putBack}
					hide={hide}
				/>
			)}

			<div
				data-testid="teacher-panel-body"
				className={cn(
					"flex min-h-0 flex-1 flex-col motion-safe:transition-opacity motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)",
					!onScreenView && "gap-[18px] px-[18px] pt-1.5 pb-[18px]",
					// A list dropped from the head lies over the screen: the screen steps back under it.
					onScreenView && "peer-data-[hang]:opacity-40",
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
		</BarWindow>
	);
}
