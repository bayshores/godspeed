/**
 * The teacher's panel, opened and closed from the pill only: it stays
 * beside the page while the learner works there. Docked to the window's
 * right edge, under the top bar (the app's, or a lesson's own), as wide
 * as the learner dragged its left edge. It pushes the page left to make
 * room, and covers it where there is none. One head row (panel-head.tsx), then the agent's screen
 * (panel-screen.tsx), or in a browser Activity (teacher-activity.tsx).
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { cn } from "@/frontend/lib/utils";
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
import { PANEL_WIDTH, dockLayout, shownScreen, type PanelView } from "./dock-model";

/** The status line under the name: the notice while the agent compacts,
 *  the waiting notice while work waits, what the agent is doing while it
 *  works, then whether it is teaching. Nothing until the first read of the
 *  agent. */
export function agentLine(agent: AgentStatus | null, doing: AgentDoing | null = null): string | null {
	if (!agent) return null;
	if (agent.helperCovering) return "Tidying my memory. A backup is answering for a minute.";
	if (agentWaiting(agent)) return waitingNotice(agent.name);
	if (doing?.working) return doing.text;
	if (agent.teaching) return "Ready";
	return agent.connected ? agentStatusLabel(agent) : "Not connected";
}

/** The page's push while the panel is open (main's padding reads it). */
const PUSH_VAR = "--lh-dock-push";

/** The open panel lies over the page instead of pushing it aside. */
export const panelCovers = (): boolean => !(parseFloat(document.documentElement.style.getPropertyValue(PUSH_VAR)) > 0);

export function TeacherPanel({
	name,
	agent,
	view,
	listable,
	list,
	onList,
	screen,
	onScreen,
	focus,
}: {
	name: string;
	agent: AgentStatus | null;
	view: PanelView;
	/** The status chip drops the Activity list (not in a lesson, which has its own). */
	listable: boolean;
	list: boolean;
	onList: (open: boolean) => void;
	/** The screen picked (background work's only while it needs the learner), and the way to one. */
	screen: TerminalRole;
	onScreen: (role: TerminalRole) => void;
	/** The learner opened the screen: it takes the keyboard. */
	focus: boolean;
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
	const line = agentLine(agent, doing);
	const teacherStatus = screenStatusLine(teacherFacts, name);
	const [wanted, setWanted] = usePaneWidth("teacher", PANEL_WIDTH);
	const [{ width, whole }, setDock] = useState({ width: wanted, whole: false });
	// Before paint, so the screen is never sized to another width first.
	useLayoutEffect(() => {
		const root = document.documentElement;
		const measure = () => {
			const page = document.querySelector("main")?.getBoundingClientRect().width ?? window.innerWidth;
			const dock = dockLayout(window.innerWidth, page, wanted);
			setDock({ width: dock.width, whole: dock.width >= window.innerWidth });
			root.style.setProperty(PUSH_VAR, `${dock.push}px`);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [wanted]);
	useEffect(
		() => () => {
			document.documentElement.style.removeProperty(PUSH_VAR);
		},
		[],
	);

	return (
		<section data-teacher-panel="" data-testid="teacher-panel" aria-label={name} style={{ width, borderRadius: 0 }} className="lh-slide-in fixed top-12 right-0 bottom-0 z-[41] flex max-w-full flex-col overflow-hidden lh-popup font-ui">
			{/* Nothing to drag while it takes the whole window. */}
			{!whole && <ResizeHandle paneKey="teacher" width={width} bounds={PANEL_WIDTH} onWidth={setWanted} label={`Resize ${name}'s panel`} />}
				{background ? (
					<PanelHead
						title={HELPER_NAME}
						status={screenStatusLine(helperFacts, HELPER_NAME)}
						lit={helperCalls}
						working={false}
						list={null}
						follow={false}
						need={null}
						back={() => onScreen("teacher")}
					/>
				) : (
					<PanelHead
						title={null}
						status={teacherStatus ?? line}
						lit={teacherTerminalState(teacherFacts) === "needsYou"}
						working={!teacherStatus && !!doing?.working && line === doing.text}
						list={listable && onScreenView ? { open: list, onOpen: onList } : null}
						follow={listable}
						need={onScreenView && helperCalls ? () => onScreen("helper") : null}
						back={null}
					/>
				)}

				<div
					data-testid="teacher-panel-body"
					className={cn(
						"flex min-h-0 flex-1 flex-col motion-safe:transition-opacity motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)",
						!onScreenView && "gap-[18px] px-[18px] pt-1.5 pb-[18px]",
						// The Activity list drops over the screen: the screen steps back under it.
						list && onScreenView && "opacity-40",
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
	);
}
