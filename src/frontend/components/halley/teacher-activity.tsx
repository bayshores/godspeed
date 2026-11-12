"use client";

import type { AgentAction } from "@/shared/core";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useActivity, type ActivityFeed } from "@/frontend/components/activity-dock";
import { agentWaiting, useAgentStatus, waitingNotice } from "@/frontend/components/agent-status";
import { useNow } from "@/frontend/components/use-now";
import { followButtons } from "@/frontend/components/top-bar/top-bar-model";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { cn } from "@/frontend/lib/utils";
import { useHalley } from "./halley-context";
import { BackgroundJobs } from "./background-jobs";
import { safePage } from "./follow";
import type { AgentDoing } from "./follow-status";
import { pastLabel } from "./tour";
import { agoLabel } from "./activity-model";

/**
 * The teacher's Activity: what the agent is doing now (with Follow), the
 * jobs running in the background, and its recent changes (click one to go
 * there). Shared by the lesson's teacher column and the teacher panel.
 * It scrolls inside its parent, which pads it.
 */

/** Recent rows shown (the server keeps more). */
const RECENT_ROWS = 8;

export function TeacherActivity() {
	const halley = useHalley();
	const { feed } = useActivity();
	const agent = useAgentStatus();
	return (
		<ActivityList
			name={halley?.name ?? DEFAULT_TEACHER_NAME}
			doing={halley?.doing ?? null}
			follow={halley ? { on: halley.follow, set: halley.setFollow } : null}
			recent={halley?.recent ?? []}
			onPick={(a) => halley?.go(a)}
			classNameOf={halley?.classNameOf ?? (() => null)}
			feed={feed}
			waiting={agentWaiting(agent) ? waitingNotice(agent?.name) : null}
		/>
	);
}

/** The list itself, from its data (exported for tests). */
export function ActivityList({
	name,
	doing,
	follow,
	recent,
	onPick,
	classNameOf,
	feed,
	waiting,
}: {
	name: string;
	doing: AgentDoing | null;
	follow: { on: boolean; set: (on: boolean) => void } | null;
	recent: readonly AgentAction[];
	onPick: (action: AgentAction) => void;
	classNameOf: (id: string | null) => string | null;
	feed: ActivityFeed;
	waiting: string | null;
}) {
	const now = useNow(recent.length > 0); // "2 min" stays true
	const working = !!doing?.working;
	const jobs = feed.jobs.length > 0 || feed.extractions.length > 0 || (feed.failed?.length ?? 0) > 0 || !!waiting;
	const followWord = follow ? followButtons({ following: follow.on, working, offer: null }).follow : null;

	return (
		<div data-testid="halley-activity" className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto">
			{doing && working && (
				<div data-testid="halley-now" className="flex shrink-0 flex-col gap-2 bg-highlight px-3.5 py-3">
					<p className="break-words text-lg text-ink">{doing.text}</p>
					{(doing.count || followWord) && (
						<div className="flex items-center gap-2">
							{doing.count && <span className="font-count text-[15px] text-ink-2">{doing.count}</span>}
							{follow && followWord && (
								<button
									type="button"
									data-testid="activity-follow"
									aria-pressed={follow.on}
									onClick={() => follow.set(!follow.on)}
									className={cn("lh-btn ml-auto text-[15px]", follow.on ? "lh-btn-main" : "bg-panel")}
								>
									{followWord}
								</button>
							)}
						</div>
					)}
				</div>
			)}

			{!working && recent.length === 0 && !jobs && (
				<p data-testid="halley-activity-empty" className="text-[15px] text-ink-2">
					Nothing yet. What {name} reads and builds shows here.
				</p>
			)}

			<BackgroundJobs feed={feed} waiting={waiting} />

			{recent.length > 0 && (
				<section className="flex flex-col gap-3.5">
					<h3 className="text-[17px] font-normal text-ink">Recent</h3>
					<div data-testid="halley-recent" className="flex flex-col border-y-[1.5px] border-ink">
						{recent.slice(0, RECENT_ROWS).map((a) => {
							// A class's own row doesn't repeat its name.
							const cls = a.target?.kind === "class" ? null : classNameOf(a.classId);
							const canGo = safePage(a.page) !== null;
							const label = pastLabel(a.label);
							return (
								<button
									key={a.id}
									type="button"
									data-testid="halley-recent-row"
									disabled={!canGo}
									onClick={() => onPick(a)}
									className="lh-press flex w-full items-center gap-3 border-b border-dotted border-edge py-[9px] text-left last:border-b-0 hover:bg-tone disabled:cursor-default disabled:hover:bg-transparent"
								>
									<span className="flex min-w-0 flex-1 items-baseline gap-2">
										<span className="truncate text-[15px] text-ink" title={label}>
											{label}
										</span>
										{cls && <span className="shrink-0 text-[15px] text-ink-2">{cls}</span>}
									</span>
									<span data-testid="halley-recent-time" className="shrink-0 font-count text-[15px] text-ink-2">
										{agoLabel(a.at, now)}
									</span>
									{canGo ? <PixelIcon name="chevron" className="text-ink-2" /> : <span aria-hidden className="w-2 shrink-0" />}
								</button>
							);
						})}
					</div>
				</section>
			)}
		</div>
	);
}
