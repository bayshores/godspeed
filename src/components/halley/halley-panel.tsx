"use client";

/**
 * The teacher's panel: click the teacher or the sidebar's agent line.
 * The head (name, the agent's state, the Follow switch), then two tabs:
 * Talk (a chat outside lessons, talk-view.tsx) and Activity (what the agent
 * is doing now, its last changes, click one to go there, and background
 * jobs; each part shows only when it has something in it).
 */
import { useState } from "react";
import { ArrowRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentAction } from "@/core";
import { ActivitySection } from "@/components/activity-dock";
import { agentWaiting, footerLabel, waitingNotice, type AgentStatus } from "@/components/agent-status";
import { SmallSwitch } from "@/components/ui/small-switch";
import { HalleyFace } from "./halley-face";
import type { Home } from "./engine";
import { safePage } from "./follow";
import { pastLabel } from "./tour";
import { TalkView } from "./talk-view";


/** Recent rows the panel shows (the server keeps more). */
const RECENT_ROWS = 8;
const PANEL_WIDTH = 360;
/** Talk needs room for a few messages and the box. */
const TALK_HEIGHT = 520;
const PANEL_GAP = 16;

/** The agent line under the name: the footer's line, or the waiting notice while work waits. */
export function agentLine(agent: AgentStatus | null): string {
	return agentWaiting(agent) ? waitingNotice(agent?.name) : footerLabel(agent, 0);
}

/** "4:11 PM". */
function actionTime(at: string): string {
	const d = new Date(at);
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Where the panel sits: beside Halley's resting spot, above it when it
 *  rests low and below when high, aligned to the nearer side. */
export function panelPlacement(anchor: Pick<Home, "spot" | "size">, viewport: { width: number; height: number }): React.CSSProperties {
	const { spot, size } = anchor;
	const right = spot.x + size / 2 > viewport.width / 2;
	const low = spot.y + size / 2 > viewport.height / 2;
	const style: React.CSSProperties = {};
	if (right) style.right = Math.max(8, viewport.width - (spot.x + size));
	else style.left = Math.max(8, Math.min(spot.x, viewport.width - PANEL_WIDTH - 8));
	if (low) style.bottom = viewport.height - spot.y + PANEL_GAP;
	else style.top = spot.y + size + PANEL_GAP;
	style.maxHeight = low ? spot.y - PANEL_GAP - 8 : viewport.height - (spot.y + size + PANEL_GAP) - 8;
	return style;
}

export function HalleyPanel({
	name,
	agent,
	follow,
	onFollow,
	nowText,
	recent,
	onPick,
	classNameOf,
	anchor,
	jobs,
}: {
	name: string;
	agent: AgentStatus | null;
	follow: boolean;
	onFollow: (on: boolean) => void;
	nowText: string | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	classNameOf: (id: string | null) => string | null;
	anchor?: Pick<Home, "spot" | "size">;
	/** The background jobs block (tests pass their own). */
	jobs?: React.ReactNode;
}) {
	const [tab, setTab] = useState<"talk" | "activity">("talk");
	const placed = anchor && typeof window !== "undefined" ? panelPlacement(anchor, { width: window.innerWidth, height: window.innerHeight }) : undefined;
	const style = tab === "talk" ? { ...placed, height: TALK_HEIGHT } : placed;
	return (
		<section
			data-halley-panel=""
			data-testid="halley-panel"
			aria-label={name}
			style={style}
			className={cn("lh-pop lh-glass fixed z-40 flex w-[360px] flex-col gap-4 px-[18px] py-4 font-ui", tab === "activity" && "overflow-y-auto")}
		>
			<div className="flex items-center gap-2.5">
				<span className="size-7 shrink-0">
					<HalleyFace mood="idle" still />
				</span>
				<span className="flex min-w-0 flex-1 flex-col">
					<span data-testid="halley-panel-name" className="truncate text-[15px] font-extrabold text-ink">
						{name}
					</span>
					<span data-testid="halley-panel-agent" className="truncate text-[12.5px] text-ink-2">
						{agentLine(agent)}
					</span>
				</span>
				<span className="flex shrink-0 items-center gap-[7px]">
					<span className="text-[13px] text-ink-2">Follow</span>
					<SmallSwitch on={follow} onChange={onFollow} label="Follow" testId="halley-follow" />
				</span>
			</div>

			<div role="tablist" aria-label={name} className="-mt-1 flex shrink-0 gap-0.5">
				{(["talk", "activity"] as const).map((t) => (
					<button
						key={t}
						type="button"
						role="tab"
						aria-selected={tab === t}
						data-testid={`halley-tab-${t}`}
						onClick={() => setTab(t)}
						className={cn("lh-press px-3 py-[5px] text-[13px] font-bold", tab === t ? "bg-ink text-background" : "bg-tone text-ink-2 hover:text-ink")}
					>
						{t === "talk" ? "Talk" : "Activity"}
					</button>
				))}
			</div>

			{tab === "talk" ? (
				<TalkView name={name} agent={agent} recent={recent} onPick={onPick} />
			) : (
				<>
					{nowText && (
						<p data-testid="halley-now" className="text-[15px] font-bold text-ink-max">
							{nowText}
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
				</>
			)}
		</section>
	);
}
