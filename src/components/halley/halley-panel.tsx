"use client";

/**
 * Halley's panel (board 7 D): click Halley or the sidebar's agent line.
 * The head (name, the agent's state, the Follow switch), "Now", "Recent"
 * (the agent's last changes; click one to go there) and "Background
 * jobs" (the jobs list that used to be the sidebar's popup).
 */
import { ArrowRightIcon } from "lucide-react";
import type { AgentAction } from "@/core";
import { ActivitySection } from "@/components/activity-dock";
import { WAITING_NOTICE, type AgentStatus } from "@/components/agent-status";
import { cn } from "@/lib/utils";
import { HalleyFace } from "./halley-face";
import type { Home } from "./engine";
import { safePage } from "./follow";
import { pastLabel } from "./tour";

export const PANEL_WIDTH = 360;
const PANEL_GAP = 16;

/** The agent line under the name. */
export function agentLine(agent: AgentStatus | null): string {
	if (agent?.connected) return `${agent.name?.trim() || "Outside agent"} · connected`;
	return WAITING_NOTICE;
}

/** "4:11 PM". */
export function actionTime(at: string): string {
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
	const style = anchor && typeof window !== "undefined" ? panelPlacement(anchor, { width: window.innerWidth, height: window.innerHeight }) : undefined;
	return (
		<section
			data-halley-panel=""
			data-testid="halley-panel"
			aria-label={name}
			style={style}
			className="lh-pop fixed z-40 flex w-[360px] flex-col gap-3.5 overflow-y-auto border border-tone-2 bg-[#141414] px-4 py-3.5 font-ui shadow-[0_10px_30px_#000000aa]"
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
					<button
						type="button"
						role="switch"
						aria-checked={follow}
						aria-label="Follow"
						data-testid="halley-follow"
						onClick={() => onFollow(!follow)}
						className={cn("lh-press relative h-4 w-7 shrink-0", follow ? "bg-ink" : "bg-tone-2")}
					>
						<span
							className={cn(
								"absolute top-[3px] left-[3px] size-2.5 transition-transform duration-(--lh-dur) ease-(--lh-ease-out) motion-reduce:transition-none",
								follow ? "translate-x-3 bg-black" : "translate-x-0 bg-ink-2",
							)}
						/>
					</button>
				</span>
			</div>

			<div data-testid="halley-now" className="flex flex-col gap-1.5 bg-tone px-3 py-2.5">
				<span className="text-[12.5px] font-bold text-ink-3">Now</span>
				{nowText ? (
					<span className="text-sm font-bold text-ink">{nowText}</span>
				) : (
					<span className="text-sm text-ink-2">Nothing right now</span>
				)}
			</div>

			<div data-testid="halley-recent" className="flex flex-col gap-0.5">
				<span className="text-[12.5px] font-bold text-ink-3">Recent</span>
				{recent.length === 0 && <span className="py-1.5 text-[13px] text-ink-3">Nothing yet</span>}
				{recent.map((a) => {
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
							className="lh-press group flex w-full items-center gap-2.5 py-1.5 text-left disabled:cursor-default"
						>
							<span className="w-[58px] shrink-0 font-mono text-xs text-ink-3 tabular-nums">{actionTime(a.at)}</span>
							<span className="flex min-w-0 flex-1 items-center gap-1.5">
								<span className="truncate text-[13.5px] text-ink group-hover:underline group-hover:underline-offset-4">{pastLabel(a.label)}</span>
								{cls && <span className="shrink-0 text-[12.5px] text-ink-3">{cls}</span>}
							</span>
							{canGo && <ArrowRightIcon aria-hidden className="size-[13px] shrink-0 text-ink-3" />}
						</button>
					);
				})}
			</div>

			{jobs ?? <ActivitySection waiting={false} />}
		</section>
	);
}
