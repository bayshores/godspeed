import { useMemo } from "react";
import type { AgentAction, GraphCostSummary } from "@/shared/core";
import { DEFAULT_TEACHER_NAME } from "@/shared/core";
import { useActivity, type ActivityFeed } from "@/frontend/components/activity-dock";
import { useGraphCosts } from "@/frontend/components/graph/use-graph-costs";
import { useSpaces } from "@/frontend/components/space-context";
import { useNow } from "@/frontend/components/use-now";
import { cn } from "@/frontend/lib/utils";
import { useTeacher } from "./teacher-context";
import { BackgroundJobs, type RunningChat } from "./background-jobs";
import { GraphCosts } from "./graph-costs";
import { pastLabel } from "./tour";
import { ACTIVITY_ROW, ACTIVITY_ROWS } from "./activity-look";
import { agoLabel, recentRows } from "./activity-model";

/**
 * The teacher's Activity: the jobs running in the background, its recent
 * changes and what the open space's graph took, a log to read. What it is doing now sits in the
 * panel's head, and Follow beside it. It scrolls inside its parent, which pads it. With `chats`,
 * the panel's chats writing a reply are jobs too: no thread on screen shows them.
 */

const NO_CHATS: readonly RunningChat[] = [];

export function TeacherActivity({ chats = false }: { chats?: boolean }) {
	const teacher = useTeacher();
	const { feed } = useActivity();
	const name = teacher?.name ?? DEFAULT_TEACHER_NAME;
	const { active, spaces } = useSpaces();
	const costs = useGraphCosts(active);
	const all = teacher?.talk.chats;
	const running = useMemo(() => (chats ? (all ?? []).filter((c) => c.running).map(({ id, title }) => ({ id, title })) : NO_CHATS), [chats, all]);
	return (
		<ActivityList
			name={name}
			graph={costs && costs.runs.length > 0 ? { costs, space: spaces.find((s) => s.id === active)?.name ?? null } : null}
			recent={teacher?.recent ?? []}
			spaceNameOf={teacher?.spaceNameOf ?? (() => null)}
			feed={feed}
			chats={running}
		/>
	);
}

/** The list itself, from its data (exported for tests). */
export function ActivityList({
	name,
	recent,
	spaceNameOf,
	feed,
	chats,
	graph,
}: {
	name: string;
	recent: readonly AgentAction[];
	spaceNameOf: (id: string | null) => string | null;
	feed: ActivityFeed;
	/** The panel's chats writing a reply, where no thread shows them. */
	chats: readonly RunningChat[];
	/** The open space's graph costs, once it has a run. */
	graph: { costs: GraphCostSummary; space: string | null } | null;
}) {
	const now = useNow(recent.length > 0); // "2 min" stays true
	// A space's own row doesn't repeat its name.
	const rows = recentRows(recent.map((a) => ({ id: a.id, label: pastLabel(a.label), space: a.target?.kind === "space" ? null : spaceNameOf(a.spaceId), at: a.at })));
	const jobs = feed.jobs.length > 0 || feed.extractions.length > 0 || (feed.failed?.length ?? 0) > 0 || chats.length > 0;

	return (
		<div data-testid="activity-list" className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto">
			{recent.length === 0 && !jobs && !graph && (
				<p data-testid="activity-empty" className="text-ui text-ink-2">
					Nothing yet. What {name} reads and builds shows here.
				</p>
			)}

			<BackgroundJobs feed={feed} chats={chats} />

			{rows.length > 0 && (
				<section className="flex flex-col gap-3">
					<h3 className="lh-inner-title">Recent</h3>
					<div data-testid="activity-recent" className={ACTIVITY_ROWS}>
						{rows.map((row) => (
							<div key={row.id} data-testid="activity-recent-row" className={cn(ACTIVITY_ROW, "flex w-full items-baseline gap-3 py-2 text-ui")}>
								<span className="flex min-w-0 flex-1 items-baseline gap-2">
									<span className="truncate text-ink" title={row.label}>
										{row.label}
									</span>
									{row.times > 1 && <span className="shrink-0 text-ink-2">{row.times} times</span>}
									{row.space && <span className="shrink-0 text-ink-2">{row.space}</span>}
								</span>
								<span data-testid="activity-recent-time" className="shrink-0 font-count text-ink-2">
									{agoLabel(row.at, now)}
								</span>
							</div>
						))}
					</div>
				</section>
			)}

			{graph && <GraphCosts costs={graph.costs} space={graph.space} />}
		</div>
	);
}
