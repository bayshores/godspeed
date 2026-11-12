import { useMemo, useState } from "react";
import { Link } from "react-router";
import type { SpaceDeadline, DeadlineProgress } from "@/shared/core";
import { spaceColorVar } from "@/frontend/components/space-color";
import { useSpaces } from "@/frontend/components/space-context";
import { useMinute } from "@/frontend/components/countdown";
import { DeadlineBlock } from "@/frontend/components/deadline/deadline-block";
import { useSpaceRecord } from "@/frontend/components/files/space-files-api";
import { dueThisWeek } from "@/frontend/components/home-page/home-page-model";
import { LoadFailed } from "@/frontend/components/load-failed";
import { deadlineHref } from "@/frontend/components/overview/overview-model";
import { PickSpace } from "@/frontend/components/pick-space";
import { Pane } from "@/frontend/components/ui/pane";
import { PixelIcon } from "@/frontend/components/ui/pixel-icon";
import { useOpenDeadlines } from "@/frontend/components/use-open-deadlines";
import { useProgress } from "@/frontend/components/use-progress";
import { cn } from "@/frontend/lib/utils";
import { DeadlineDialog } from "./deadline-dialog";
import { deadlineLine, deadlineLists } from "./deadlines-tab-model";

/**
 * The space's deadlines: "Coming up" with "Add a deadline", then "Done or
 * past". A row opens the deadline's page; "Mark done" and "Undo" work in
 * place.
 */
export function DeadlinesTab() {
	const { active, activeSpace } = useSpaces();
	const { record, failed, reload } = useSpaceRecord(active);
	const progress = useProgress().data;
	const { markDone, undo } = useOpenDeadlines();
	const nowMs = useMinute();
	const [adding, setAdding] = useState(false);
	// The dialog compares its mode by identity: one object per open.
	const addMode = useMemo(() => (adding && record ? { spaceId: record.id, deadline: null, files: record.files } : null), [adding, record]);
	const progressOf = useMemo(() => new Map((progress?.spaceId === active ? progress.deadlines : []).map((d) => [d.id, d])), [progress, active]);

	if (!active || !activeSpace) {
		return (
			<div className="mx-auto w-full max-w-[908px] px-6 py-9">
				<PickSpace line="Pick a space to see its deadlines." />
			</div>
		);
	}
	const lists = record && nowMs !== null ? deadlineLists(record.deadlines ?? [], nowMs) : null;
	const row = (d: SpaceDeadline) => (
		<DeadlineRow
			key={d.id}
			deadline={d}
			progress={progressOf.get(d.id)}
			color={spaceColorVar(activeSpace.color)}
			nowMs={nowMs!}
			onDone={() => markDone({ ...d, spaceId: active, spaceName: activeSpace.name })}
			onUndo={() => undo({ ...d, spaceId: active, spaceName: activeSpace.name })}
		/>
	);
	return (
		<div data-testid="deadlines-tab" className="mx-auto flex w-full max-w-[908px] flex-col gap-9 px-6 py-9">
			<section className="flex flex-col gap-2.5">
				<div className="flex items-center gap-2">
					<h2 className="min-w-0 flex-1 text-[22px] leading-tight text-ink">Coming up</h2>
					<button type="button" data-testid="deadline-add" disabled={!record} onClick={() => setAdding(true)} className="lh-btn lh-btn-quiet text-[15px]">
						<PixelIcon name="plus" />
						Add a deadline
					</button>
				</div>
				{!record && failed ? (
					<LoadFailed message="Couldn't load this space's deadlines." onRetry={() => void reload()} />
				) : lists && lists.coming.length === 0 ? (
					<p data-testid="deadlines-none" className="text-[15px] text-ink-2">
						Nothing is coming up.
					</p>
				) : (
					<ul className="flex flex-col gap-2.5">{lists?.coming.map(row)}</ul>
				)}
			</section>
			{lists && lists.past.length > 0 && (
				<section className="flex flex-col gap-2.5">
					<h2 className="text-[22px] leading-tight text-ink">Done or past</h2>
					<ul className="flex flex-col gap-2.5">{lists.past.map(row)}</ul>
				</section>
			)}
			<DeadlineDialog mode={addMode} onClose={() => setAdding(false)} />
		</div>
	);
}

/** One deadline: its block (days left, the Done stamp, or "was due"), its
 *  name and line, and "Mark done" or "Undo". The whole row opens its page. */
function DeadlineRow({
	deadline: d,
	progress,
	color,
	nowMs,
	onDone,
	onUndo,
}: {
	deadline: SpaceDeadline;
	progress: DeadlineProgress | undefined;
	/** The space's color. */
	color: string;
	nowMs: number;
	onDone: () => void;
	onUndo: () => void;
}) {
	return (
		<li data-testid={`deadline-row-${d.id}`} data-halley-target={`deadline:${d.id}`}>
			<Pane className="flex min-h-[84px] items-center overflow-hidden transition-colors hover:bg-tone">
				<DeadlineBlock deadline={d} color={color} nowMs={nowMs} size="list" pale={!dueThisWeek(d, nowMs)} />
				<span className="flex min-w-0 flex-1 flex-col gap-[3px] px-5 py-3">
					{/* Stretched over the row, so a click anywhere opens the page. */}
					<Link to={deadlineHref(d.id)} data-testid="deadline-open" title={d.name} className={cn("truncate text-xl leading-tight after:absolute after:inset-0", d.done ? "text-ink-3" : "text-ink")}>
						{d.name}
					</Link>
					<span className="truncate text-base text-ink-2">{deadlineLine(d, progress, nowMs)}</span>
				</span>
				<span className="flex shrink-0 items-center gap-2.5 pr-5">
					<button type="button" data-testid={d.done ? "deadline-undo" : "deadline-done"} onClick={d.done ? onUndo : onDone} className="lh-btn lh-btn-quiet relative text-[15px]">
						{d.done ? "Undo" : "Mark done"}
					</button>
					<PixelIcon name="chevron" className="h-3.5 text-ink" />
				</span>
			</Pane>
		</li>
	);
}
