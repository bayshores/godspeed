/**
 * The teacher's panel: click the teacher in the top bar.
 * Docked to the window's right edge, under the top bar. It pushes the page
 * left to make room. The head (name, the teacher's status, Close), then
 * the tabs (dock-model.ts panelTabs): Talk (a chat outside lessons,
 * talk-view.tsx, with Clear chat on the tab row), Activity
 * (teacher-activity.tsx) and Terminal (terminal-tab.tsx), which grows the
 * panel to fit the agent's whole screen and, while a helper runs, carries
 * the switch between its screen and the teacher's. A screen that needs the
 * learner marks the Terminal tab while another tab shows.
 */
import { useEffect, useId, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import type { AgentAction } from "@/shared/core";
import { agentWaiting, agentStatusLabel, waitingNotice, type AgentStatus } from "@/frontend/components/agent-status";
import { tabListKeys } from "@/frontend/components/ui/tab-list";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { TeacherStatus } from "@/frontend/components/terminal/teacher-status";
import { needsYou, type TerminalRole } from "@/frontend/components/terminal/terminal-model";
import { useTerminals } from "@/frontend/components/terminal/use-terminals";
import { useTeacher } from "./teacher-context";
import type { AgentDoing } from "./follow-status";
import { TalkView, type TalkAsk } from "./talk-view";
import { TeacherActivity } from "./teacher-activity";
import { TerminalTab } from "./terminal-tab";
import { DOCK_WIDTH, dockPush, dockWidth, type PanelTab } from "./dock-model";

const TAB_LABEL: Record<PanelTab, string> = { talk: "Talk", activity: "Activity", terminal: "Terminal" };

/** The status line under the name: the helper notice while the agent
 *  compacts, the waiting notice while work waits, what the agent is doing
 *  while it works, then whether it is teaching. Nothing until the first
 *  read of the agent. */
export function agentLine(agent: AgentStatus | null, doing: AgentDoing | null = null): string | null {
	if (!agent) return null;
	if (agent.helperCovering) return "Tidying my memory. My helper is answering for a minute.";
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
	tabs,
	tab,
	onTab,
	overLesson,
	screen,
	onScreen,
	focus,
	onClose,
	recent,
	onPick,
	ask,
	onAsked,
}: {
	name: string;
	agent: AgentStatus | null;
	tabs: readonly PanelTab[];
	tab: PanelTab;
	onTab: (tab: PanelTab) => void;
	/** It opened over a lesson: it covers the page instead of pushing it. */
	overLesson: boolean;
	/** The screen the Terminal tab shows, and the learner's pick of one. */
	screen: TerminalRole;
	onScreen: (role: TerminalRole) => void;
	/** The learner opened the Terminal tab: its screen takes the keyboard. */
	focus: boolean;
	onClose: () => void;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	/** A message to send in Talk (askTeacher). */
	ask?: TalkAsk | null;
	onAsked?: (id: number) => void;
}) {
	const [clearSlot, setClearSlot] = useState<HTMLElement | null>(null);
	const teacher = useTeacher();
	const terminals = useTerminals();
	const line = agentLine(agent, teacher?.doing ?? null);
	const tabsId = useId();
	const wide = tab === "terminal";
	const [width, setWidth] = useState(DOCK_WIDTH);
	useEffect(() => {
		const root = document.documentElement;
		const measure = () => {
			setWidth(dockWidth(window.innerWidth, wide));
			const page = document.querySelector("main")?.getBoundingClientRect().width ?? window.innerWidth;
			root.style.setProperty(PUSH_VAR, `${dockPush(window.innerWidth, page, wide, overLesson)}px`);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [wide, overLesson]);
	useEffect(
		() => () => {
			document.documentElement.style.removeProperty(PUSH_VAR);
		},
		[],
	);
	// A screen that needs the learner, and the one the Terminal tab shows.
	const calls = (role: TerminalRole) => !!terminals?.facts[role] && !!needsYou(terminals.facts[role]!);
	const shown: TerminalRole = screen === "helper" && terminals?.helper ? "helper" : "teacher";

	return (
		<section
			data-teacher-panel=""
			data-testid="teacher-panel"
			aria-label={name}
			style={{ width }}
			className="lh-slide-in fixed top-12 right-0 bottom-0 z-[41] flex max-w-full flex-col overflow-hidden border-l-2 border-line bg-panel font-ui motion-safe:transition-[width] motion-safe:duration-(--lh-dur) motion-safe:ease-(--lh-ease-out)"
		>
			<div className="flex shrink-0 items-center gap-3 pt-4 pr-3.5 pb-3 pl-5">
				<span className="flex min-w-0 flex-1 flex-col gap-px">
					<span data-testid="teacher-panel-name" className="truncate text-xl leading-snug font-medium text-ink">
						{name}
					</span>
					<TeacherStatus name={name} line={line} testid="teacher-panel-agent" className="max-w-full text-base text-ink-2" />
				</span>
				<button type="button" data-testid="teacher-panel-close" onClick={onClose} className="lh-btn lh-btn-quiet shrink-0 text-[15px]">
					<PixelIcon name="close" />
					Close
				</button>
			</div>

			<div className="flex shrink-0 items-center border-b border-tone-2 px-3.5">
				<div
					role="tablist"
					aria-label={name}
					onKeyDown={tabListKeys(tabs.indexOf(tab), tabs.length, (i) => onTab(tabs[i]!))}
					className="flex gap-1.5"
				>
					{tabs.map((t) => {
						const marked = t === "terminal" && tab !== "terminal" && (calls("teacher") || calls("helper"));
						return (
							<button
								key={t}
								type="button"
								role="tab"
								id={`${tabsId}-${t}`}
								aria-selected={tab === t}
								aria-controls={`${tabsId}-panel`}
								aria-description={marked ? `${name} needs you here` : undefined}
								tabIndex={tab === t ? 0 : -1}
								data-testid={`teacher-tab-${t}`}
								onClick={() => onTab(t)}
								className={cn(
									"lh-press -mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-lg",
									tab === t ? "border-ink font-medium text-ink" : "border-transparent text-ink-2 hover:text-ink",
								)}
							>
								{TAB_LABEL[t]}
								{marked && <NeedsMark testid="teacher-tab-terminal-mark" />}
							</button>
						);
					})}
				</div>
				{tab === "talk" && <span ref={setClearSlot} className="ml-auto" />}
				{tab === "terminal" && terminals?.helper && (
					<div role="group" aria-label="Screen" className="ml-auto flex shrink-0 gap-1">
						{(["teacher", "helper"] as const).map((role) => (
							<button
								key={role}
								type="button"
								aria-pressed={shown === role}
								data-testid={`terminal-screen-${role}`}
								onClick={() => onScreen(role)}
								className={cn("lh-btn text-[15px]", shown !== role && "lh-btn-quiet")}
							>
								<span className="max-w-32 truncate">{role === "teacher" ? name : "Helper"}</span>
								{shown !== role && calls(role) && <NeedsMark testid={`terminal-screen-${role}-mark`} />}
							</button>
						))}
					</div>
				)}
			</div>

			{/* The Terminal tab is laid out at the panel's final width, against its
			    right edge, so the growing panel uncovers the screen at its final
			    font instead of refitting it every frame. */}
			<div
				role="tabpanel"
				id={`${tabsId}-panel`}
				aria-labelledby={`${tabsId}-${tab}`}
				style={wide ? { width: width - PANEL_BORDER } : undefined}
				className={cn("flex min-h-0 flex-1 flex-col", tab === "activity" && "px-5 py-[18px]", wide && "self-end")}
			>
				{tab === "talk" ? (
					<TalkView name={name} agent={agent} recent={recent} onPick={onPick} ask={ask ?? null} onAsked={onAsked} clearSlot={clearSlot} />
				) : tab === "activity" ? (
					<TeacherActivity underStatus />
				) : (
					<TerminalTab name={name} role={shown} focus={focus} />
				)}
			</div>
		</section>
	);
}

/** A screen needs the learner: a square in the bright key's color. */
function NeedsMark({ testid }: { testid: string }) {
	return <span aria-hidden data-testid={testid} className="size-2.5 shrink-0 bg-tint" />;
}
