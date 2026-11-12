"use client";

/**
 * The teacher's panel: click the teacher in the top bar.
 * Docked to the window's right edge, under the top bar. It pushes the page
 * left to make room. Never open over a lesson (the lesson has its own
 * teacher column). The head (name, the agent's state, close), then two
 * tabs: Talk (a chat outside lessons, talk-view.tsx) and Activity
 * (teacher-activity.tsx).
 */
import { useEffect, useId, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import type { AgentAction } from "@/shared/core";
import { agentWaiting, agentStatusLabel, waitingNotice, type AgentStatus } from "@/frontend/components/agent-status";
import { tabListKeys } from "@/frontend/components/ui/tab-list";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { TeacherSprite } from "./teacher-sprite";
import { TalkView, type TalkAsk } from "./talk-view";
import { TeacherActivity } from "./teacher-activity";
import { DOCK_WIDTH, dockPush, dockWidth } from "./dock-model";

const TABS = ["talk", "activity"] as const;
type Tab = (typeof TABS)[number];

/** The agent line under the name: the backup notice while the agent
 *  compacts, the waiting notice while work waits, the agent's state while
 *  one is connected. Nothing otherwise: the Talk box already says no agent
 *  is connected. */
export function agentLine(agent: AgentStatus | null): string | null {
	if (agent?.backupAnswering) return "Catching up on my notes. My backup is answering for a minute.";
	if (agentWaiting(agent)) return waitingNotice(agent?.name);
	return agent?.connected || agent?.teaching ? agentStatusLabel(agent, 0) : null;
}

/** The page's push while the panel is open (main's padding reads it). */
const PUSH_VAR = "--lh-dock-push";

export function HalleyPanel({
	name,
	agent,
	onClose,
	recent,
	onPick,
	ask,
	onAsked,
}: {
	name: string;
	agent: AgentStatus | null;
	onClose: () => void;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	/** A message to send in Talk (askTeacher); the panel switches to Talk. */
	ask?: TalkAsk | null;
	onAsked?: (id: number) => void;
}) {
	const [tab, setTab] = useState<Tab>("talk");
	const tabsId = useId();
	const [width, setWidth] = useState(DOCK_WIDTH);
	useEffect(() => {
		const root = document.documentElement;
		const measure = () => {
			setWidth(dockWidth(window.innerWidth));
			const page = document.querySelector("main")?.getBoundingClientRect().width ?? window.innerWidth;
			root.style.setProperty(PUSH_VAR, `${dockPush(window.innerWidth, page)}px`);
		};
		measure();
		window.addEventListener("resize", measure);
		return () => {
			window.removeEventListener("resize", measure);
			root.style.removeProperty(PUSH_VAR);
		};
	}, []);
	useEffect(() => {
		if (ask) setTab("talk");
	}, [ask]);

	return (
		<section
			data-halley-panel=""
			data-testid="halley-panel"
			aria-label={name}
			style={{ width }}
			className="lh-slide-in fixed top-12 right-0 bottom-0 z-[41] flex max-w-full flex-col border-l border-tone-2 bg-panel font-ui"
		>
			<div className="flex shrink-0 items-start gap-3 px-6 pt-5 pb-4">
				<TeacherSprite mood="idle" className="mt-1 w-[22px] shrink-0" />
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span data-testid="halley-panel-name" className="truncate font-bold text-[22px] leading-7 text-ink">
						{name}
					</span>
					{agentLine(agent) && (
						<span data-testid="halley-panel-agent" className="text-[12.5px] text-ink-2">
							{agentLine(agent)}
						</span>
					)}
				</span>
				<button
					type="button"
					data-testid="halley-close"
					aria-label="Close"
					onClick={onClose}
					className="lh-press mt-0.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink"
				>
					<PixelIcon name="close" />
				</button>
			</div>

			<div
				role="tablist"
				aria-label={name}
				onKeyDown={tabListKeys(TABS.indexOf(tab), TABS.length, (i) => setTab(TABS[i]!))}
				className="flex shrink-0 gap-6 border-b border-tone-2 px-6"
			>
				{TABS.map((t) => (
					<button
						key={t}
						type="button"
						role="tab"
						id={`${tabsId}-${t}`}
						aria-selected={tab === t}
						aria-controls={`${tabsId}-panel`}
						tabIndex={tab === t ? 0 : -1}
						data-testid={`halley-tab-${t}`}
						onClick={() => setTab(t)}
						className={cn(
							"lh-press -mb-px border-b-2 py-2.5 text-[13.5px] font-bold",
							tab === t ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
						)}
					>
						{t === "talk" ? "Talk" : "Activity"}
					</button>
				))}
			</div>

			{tab === "talk" ? (
				<div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-talk`} className="flex min-h-0 flex-1 flex-col">
					<TalkView name={name} agent={agent} recent={recent} onPick={onPick} ask={ask ?? null} onAsked={onAsked} />
				</div>
			) : (
				<div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-activity`} className="flex min-h-0 flex-1 flex-col px-5 py-[18px]">
					<TeacherActivity />
				</div>
			)}
		</section>
	);
}
