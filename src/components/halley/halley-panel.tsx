"use client";

/**
 * The teacher's panel: click the teacher or the sidebar's agent line.
 * Docked to the window's right edge at full height, over the page (in a
 * lesson it covers the Your turn panel until closed). The head (name, the
 * agent's state, close), then two tabs: Talk (a chat outside lessons,
 * talk-view.tsx) and Activity (what the agent is doing now, its last
 * changes, click one to go there, and background jobs; each part shows
 * only when it has something in it, and a line says so when none does).
 */
import { useEffect, useState } from "react";
import { ArrowRightIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentAction } from "@/core";
import { ActivitySection, useActivity, type ActivityFeed } from "@/components/activity-dock";
import { agentWaiting, footerLabel, waitingNotice, type AgentStatus } from "@/components/agent-status";
import { HalleyFace } from "./halley-face";
import { safePage } from "./follow";
import type { AgentDoing } from "./follow-status";
import { pastLabel } from "./tour";
import { TalkView, type TalkAsk } from "./talk-view";

/** Recent rows the panel shows (the server keeps more). */
const RECENT_ROWS = 8;
const DOCK_WIDTH = 400;
/** Below this the panel takes the whole width. */
const DOCK_FULL_BELOW = 640;

type Tab = "talk" | "activity";

/** The agent line under the name: the footer's line, or the waiting notice while work waits. */
export function agentLine(agent: AgentStatus | null): string {
	return agentWaiting(agent) ? waitingNotice(agent?.name) : footerLabel(agent, 0);
}

/** The background jobs block has something to show (it hides otherwise). */
function hasJobs(feed: ActivityFeed, agent: AgentStatus | null): boolean {
	return feed.jobs.length > 0 || feed.extractions.length > 0 || (feed.failed?.length ?? 0) > 0 || agentWaiting(agent);
}

/** "4:11 PM". */
function actionTime(at: string): string {
	const d = new Date(at);
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** How wide the docked panel is: the whole window when it is narrow,
 *  otherwise 400, or the lesson's Your turn panel's width when that is
 *  wider, so the panel covers it. */
export function dockWidth(viewportWidth: number, yourTurnWidth: number | null): number {
	if (viewportWidth < DOCK_FULL_BELOW) return viewportWidth;
	return Math.min(viewportWidth, Math.max(DOCK_WIDTH, yourTurnWidth ?? 0));
}

/** The dock's width for this window, kept current on resize. */
export function currentDockWidth(): number {
	const turn = document.querySelector("[data-testid='your-turn-panel']")?.getBoundingClientRect().width;
	return dockWidth(window.innerWidth, turn || null);
}

export function HalleyPanel({
	name,
	agent,
	onClose,
	doing,
	recent,
	onPick,
	classNameOf,
	ask,
	onAsked,
	jobs,
}: {
	name: string;
	agent: AgentStatus | null;
	onClose: () => void;
	doing: AgentDoing | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	classNameOf: (id: string | null) => string | null;
	/** A message to send in Talk (askTeacher); the panel switches to Talk. */
	ask?: TalkAsk | null;
	onAsked?: (id: number) => void;
	/** The background jobs block (tests pass their own). */
	jobs?: React.ReactNode;
}) {
	const [tab, setTab] = useState<Tab>("talk");
	const { feed } = useActivity();
	const [width, setWidth] = useState(DOCK_WIDTH);
	useEffect(() => {
		const measure = () => setWidth(currentDockWidth());
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
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
			className="lh-dock fixed top-0 right-0 bottom-0 z-[41] flex max-w-full flex-col border-l border-tone-2 bg-panel font-ui"
		>
			<div className="flex shrink-0 items-start gap-3 px-6 pt-5 pb-4">
				<span className="mt-1 size-7 shrink-0">
					<HalleyFace mood="idle" still />
				</span>
				<span className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span data-testid="halley-panel-name" className="truncate font-title text-[22px] leading-7 text-ink">
						{name}
					</span>
					<span data-testid="halley-panel-agent" className="truncate text-[12.5px] text-ink-2">
						{agentLine(agent)}
					</span>
				</span>
				<button
					type="button"
					data-testid="halley-close"
					aria-label="Close"
					onClick={onClose}
					className="lh-press mt-0.5 -mr-1.5 flex size-7 shrink-0 items-center justify-center text-ink-3 hover:bg-tone hover:text-ink"
				>
					<XIcon aria-hidden className="size-4" />
				</button>
			</div>

			<div role="tablist" aria-label={name} className="flex shrink-0 gap-6 border-b border-tone-2 px-6">
				{(["talk", "activity"] as const).map((t) => (
					<button
						key={t}
						type="button"
						role="tab"
						aria-selected={tab === t}
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
				<TalkView name={name} agent={agent} recent={recent} onPick={onPick} ask={ask ?? null} onAsked={onAsked} />
			) : (
				<div data-testid="halley-activity" className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
					{doing?.working && (
						<p data-testid="halley-now" className="text-[15px] font-bold text-ink-max">
							{doing.text}
							{doing.count && <span className="ml-2 font-mono text-[13px] font-normal text-ink-3 tabular-nums">{doing.count}</span>}
						</p>
					)}
					{!doing?.working && recent.length === 0 && !jobs && !hasJobs(feed, agent) && (
						<p data-testid="halley-activity-empty" className="text-[13.5px] text-ink-2">
							Nothing yet. What {name} reads and builds shows here.
						</p>
					)}

					{recent.length > 0 && (
						<div data-testid="halley-recent" className="-mx-2 flex flex-col">
							{recent.slice(0, RECENT_ROWS).map((a) => {
								// A class's own row doesn't repeat its name.
								const cls = a.target?.kind === "class" ? null : classNameOf(a.classId);
								const canGo = safePage(a.page) !== null;
								return (
									<button
										key={a.id}
										type="button"
										data-testid="halley-recent-row"
										disabled={!canGo}
										onClick={() => onPick(a)}
										className="lh-press flex w-full items-center gap-2.5 px-2 py-1.5 text-left hover:bg-tone disabled:cursor-default disabled:hover:bg-transparent"
									>
										<span className="w-[58px] shrink-0 font-mono text-xs text-ink-3 tabular-nums">{actionTime(a.at)}</span>
										<span className="flex min-w-0 flex-1 items-center gap-1.5">
											<span className="truncate text-[13.5px] text-ink">{pastLabel(a.label)}</span>
											{cls && <span className="shrink-0 text-[12.5px] text-ink-3">{cls}</span>}
										</span>
										{canGo && <ArrowRightIcon aria-hidden className="size-[13px] shrink-0 text-ink-3" />}
									</button>
								);
							})}
						</div>
					)}

					{jobs ?? <ActivitySection waiting={false} />}
				</div>
			)}
		</section>
	);
}
